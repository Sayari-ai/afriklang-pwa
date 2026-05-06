"use client";

/**
 * Path + progress repository (Zustand).
 *
 * Mirrors `lib/core/content/path_repository.dart`. Single source of
 * truth for:
 *   - the device's assigned path bundle (1+ `PathDefinition`s, one per
 *     cycle the device has been issued, in cycle-ascending order)
 *   - the per-level progress vector (`ProgressVector`)
 *
 * Cycles model:
 *   - The first time a device boots, the backend issues cycle 1 — a
 *     single `PathDefinition` with 8 levels. Once all 8 are completed,
 *     the user can opt-in (via the cycle-complete celebration screen)
 *     to be issued a new cycle. Calling `advanceCycle()` POSTs
 *     `paths_assign` with `{ advance: true }`, which (per the server
 *     contract) returns a fresh `(path_id, cycle)`. We then re-fetch
 *     `paths_get?multicycle=1` (which returns every cycle the device
 *     has been issued, in `{ cycles: [...] }` shape) and
 *     `progress_get?multicycle=1` (whose entries carry a `cycle` field).
 *   - `bundle` is the flat array of cycles. The home map flattens to a
 *     single continuous scroll via `flattenLevels(bundle)`.
 *   - Level ids are 1..8 *within a cycle* and NOT globally unique across
 *     cycles. The composite (cycle, levelId) is the canonical identity.
 *     All splice/find operations on `progress.entries` filter by both.
 *
 * Tolerance:
 *   - Parsers accept both the legacy single-cycle shape and the new
 *     multi-cycle shape, so the client doesn't break on either side of
 *     the backend deploy.
 *   - `ProgressEntry.cycle` defaults to `1` when missing.
 *   - The localStorage cache reads either shape and writes the new
 *     `{ cycles: [...] }` shape going forward.
 *
 * Lifecycle:
 *   1. `boot({ forceRefresh })` is called by the path-setup screen.
 *      We try the localStorage cache first; on miss (or refresh) we go
 *      assign → getPath → getProgress and write both back to disk.
 *   2. `completeLevel(cycle, levelId)` is called by the level screen
 *      when the user finishes a mission. We POST `progress_set` for the
 *      completion (passing the cycle), then — if no other level is
 *      `current` *in the same cycle* — promote the lowest-numbered
 *      locked level *in that cycle* to `current`. Returns
 *      `{ promotedId, cycleComplete }`. `cycleComplete` is `true` when
 *      every entry in the just-completed level's cycle is `"completed"`
 *      AND no `locked` entry exists in that cycle to promote — i.e. the
 *      user has finished cycle N and there is no cycle N+1 yet. The
 *      level screen routes to the cycle-complete celebration variant
 *      when this flag is set.
 *   3. `advanceCycle()` POSTs `paths_assign?advance=true`, refetches
 *      `paths_get` + `progress_get` (multicycle), and merges into
 *      `bundle`/`progress`. Online-only.
 *   4. `reset()` is a dev-time affordance: clears caches and rotates
 *      the device id so the next boot claims a fresh path slot.
 *
 * Error policy: `boot()` throws on network failure with no cache to
 * fall back on. `advanceCycle()` throws on any failure (the celebration
 * screen catches and snackbars).
 */

import { create } from "zustand";

import { EdgeFunctionError } from "@/lib/api/edge";
import { advanceCycleApi, assignPath, getPath } from "@/lib/api/paths";
import { getProgress, setProgress } from "@/lib/api/progress";
import {
  type LevelProgressStatus,
  type PathDefinition,
  type ProgressEntry,
  type ProgressVector,
  isCycleComplete,
  parsePathBundle,
  parseProgressVector,
} from "@/lib/content/models";
import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";
import {
  enqueueProgressWrite,
  hasPendingProgressWrites,
} from "@/lib/storage/progress-queue";
import { useDeviceIdentity } from "@/stores/device-identity";

/**
 * `setProgress` wrapper that falls back to the offline queue on a
 * pure-network failure. Returns the entry the caller should splice
 * into its in-memory vector:
 *   - online success → the canonical row from the server
 *   - offline / unreachable → a synthesized optimistic row, plus an
 *     enqueued progress-set replay for the runner to drain later
 *
 * Real backend errors (4xx/5xx with a status) re-throw — we don't
 * want to silently mask, say, a 409 from the level-id being unknown.
 *
 * `cycle` is mandatory. The client always knows which cycle it's
 * mutating because `completeLevel` resolves it before calling. The
 * server still tolerates an absent `cycle` (defaults to top cycle)
 * for the deployed mobile app, but the PWA never relies on that.
 */
async function setProgressOrQueue(args: {
  deviceId: string;
  cycle: number;
  levelId: number;
  status: LevelProgressStatus;
  /** Used as fallback `points` for an optimistic row. */
  fallbackPoints: number;
}): Promise<ProgressEntry> {
  try {
    return await setProgress({
      deviceId: args.deviceId,
      cycle: args.cycle,
      levelId: args.levelId,
      status: args.status,
    });
  } catch (e) {
    const isNetwork = e instanceof EdgeFunctionError && e.status === 0;
    if (!isNetwork) throw e;
    await enqueueProgressWrite({
      cycle: args.cycle,
      levelId: args.levelId,
      status: args.status,
    });
    return {
      levelId: args.levelId,
      status: args.status,
      // Server stamps these on success; for an optimistic row we use
      // "now" + the level's reward so the celebration screen and home
      // header don't read NaN until the queue drains.
      completedAt:
        args.status === "completed" ? new Date().toISOString() : null,
      points: args.status === "completed" ? args.fallbackPoints : 0,
      cycle: args.cycle,
    };
  }
}

interface PathRepoState {
  /**
   * Every cycle the device has been issued, in cycle-ascending order.
   * Each cycle has its own `pathId` and `levels[]`. The home map
   * flattens this with `flattenLevels(bundle)` into a single scroll.
   * `null` until `boot()` populates it.
   */
  bundle: PathDefinition[] | null;
  progress: ProgressVector | null;
  /** True once both `bundle` and `progress` are populated. */
  isReady: boolean;
  /** Last error from `boot()`, if any. UI uses this for the retry screen. */
  error: string | null;
  /** Reentrant-safe: returns the in-flight promise if `boot()` is already running. */
  boot: (opts?: { forceRefresh?: boolean }) => Promise<void>;
  /**
   * Marks `(cycle, levelId)` complete, promotes next locked → current
   * **within the same cycle**. Returns `{ promotedId, cycleComplete }`:
   *   - `promotedId`: id of the level promoted to `current` (or `null`).
   *   - `cycleComplete`: `true` iff after this completion every entry in
   *     `cycle` is `"completed"` AND there is no `current` row in that
   *     cycle. Signals to the caller that the user should be routed to
   *     the cycle-complete celebration variant instead of the per-level
   *     one.
   *
   * `opts` controls the *quality* of the completion (full vs. partial):
   *   - `pointsOverride`: if provided, the level's `points` field in the
   *     cache is overwritten with this value AFTER the backend round-trip.
   *     The backend currently has no notion of "partial credit" so it
   *     always returns the full `pointsReward`; the UI compensates by
   *     rewriting the local copy. Total points are recomputed from this
   *     overridden value, so the home/leaderboard headers stay in sync
   *     with what the user sees on the celebration screen.
   *   - `submittedCount` / `totalSteps`: stamped on the cached entry so
   *     the home map can render the 3-star rating. Both are client-only.
   */
  completeLevel: (
    cycle: number,
    levelId: number,
    opts?: {
      pointsOverride?: number;
      submittedCount?: number;
      totalSteps?: number;
    },
  ) => Promise<{ promotedId: number | null; cycleComplete: boolean }>;
  /**
   * Request the next cycle from the backend. POSTs `paths_assign`
   * (which now re-issues a fresh cycle once the previous is fully
   * completed server-side), then refetches `paths_get` + `progress_get`
   * and merges the result into the store.
   *
   * Online-only — the celebration screen disables the CTA when the
   * client believes it's offline. Throws on any failure; the caller
   * surfaces a snackbar.
   */
  advanceCycle: () => Promise<void>;
  /**
   * Replace the question at `(cycle, levelId, qIndex)` in the in-memory
   * bundle with `replacement`, persist the patched bundle to localStorage,
   * and notify subscribers. The `qIndex` is the **slot** index (1..7) —
   * the original question's position. The replacement may carry a
   * different `promptEn`/`imageUrl` but the slot's `qIndex` is preserved
   * so the audio filename slug `pNN-Lx-qy` keeps pointing at the slot.
   *
   * No backend call here — the swap was already persisted server-side
   * by the `question_swap` edge function call that produced `replacement`.
   * This method just keeps the cached bundle in sync without forcing a
   * full `paths_get` round-trip.
   *
   * Throws if `boot()` hasn't run yet or if the cycle/level/slot doesn't
   * exist in the cached bundle (silent no-op would be a bug).
   */
  applyQuestionSwap: (
    cycle: number,
    levelId: number,
    qIndex: number,
    replacement: import("@/lib/content/models").LevelQuestionData,
  ) => void;
  /** Dev-only: wipe caches and rotate device id. */
  reset: () => void;
}

let inFlightBoot: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

/**
 * Read the cached path bundle. Tolerates both shapes:
 *   - Legacy single cycle: `{ path_id, cycle, levels[] }`
 *   - Multi-cycle: `{ cycles: [...] }`
 *
 * Returns `null` on miss or corruption (the caller will refetch).
 */
function readCachedBundle(): PathDefinition[] | null {
  const raw = safeStorage.getItem(StorageKeys.pathCache);
  if (!raw) return null;
  try {
    return parsePathBundle(JSON.parse(raw));
  } catch {
    safeStorage.removeItem(StorageKeys.pathCache);
    return null;
  }
}

function readCachedProgress(): ProgressVector | null {
  const raw = safeStorage.getItem(StorageKeys.progressCache);
  if (!raw) return null;
  try {
    return parseProgressVector(JSON.parse(raw));
  } catch {
    safeStorage.removeItem(StorageKeys.progressCache);
    return null;
  }
}

/**
 * Persist the multi-cycle bundle. Always writes the new `{ cycles: [...] }`
 * shape regardless of how many cycles are present, so a subsequent
 * read goes through the multi-cycle branch of `parsePathBundle`.
 */
function writeCachedBundle(bundle: ReadonlyArray<PathDefinition>): void {
  safeStorage.setItem(
    StorageKeys.pathCache,
    JSON.stringify({
      cycles: bundle.map((path) => ({
        path_id: path.pathId,
        cycle: path.cycle,
        levels: path.levels.map((l) => ({
          level_id: l.levelId,
          theme: l.theme,
          points_reward: l.pointsReward,
          questions: l.questions.map((q) => ({
            q_index: q.qIndex,
            prompt_en: q.promptEn,
            image_url: q.imageUrl,
            language: q.languageIso,
          })),
        })),
      })),
    }),
  );
}

function writeCachedProgress(vector: ProgressVector): void {
  safeStorage.setItem(
    StorageKeys.progressCache,
    JSON.stringify({
      total_points: vector.totalPoints,
      levels: vector.entries.map((e) => ({
        level_id: e.levelId,
        status: e.status,
        completed_at: e.completedAt,
        points: e.points,
        cycle: e.cycle,
        // Client-only fields — backend ignores them on read; we
        // round-trip through localStorage so the home map keeps the
        // 3-star rating across reloads.
        submitted_count: e.submittedCount,
        total_steps: e.totalSteps,
      })),
    }),
  );
}

// ---------------------------------------------------------------------------
// Bundle merging
// ---------------------------------------------------------------------------

/**
 * Merge a freshly-fetched bundle with the existing one. The backend's
 * `paths_get` is canonical when it returns multi-cycle (`cycles[]`),
 * but during the rollout window it may still return only the active
 * cycle. We union by `cycle`: any cycle in `next` overwrites the
 * matching one in `prev`; cycles in `prev` not present in `next` are
 * preserved (so we don't lose history if the server hasn't shipped
 * multi-cycle responses yet).
 */
function mergeBundles(
  prev: ReadonlyArray<PathDefinition> | null,
  next: ReadonlyArray<PathDefinition>,
): PathDefinition[] {
  if (!prev || prev.length === 0) {
    return [...next].sort((a, b) => a.cycle - b.cycle);
  }
  const byCycle = new Map<number, PathDefinition>();
  for (const c of prev) byCycle.set(c.cycle, c);
  for (const c of next) byCycle.set(c.cycle, c);
  return Array.from(byCycle.values()).sort((a, b) => a.cycle - b.cycle);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePathRepo = create<PathRepoState>((set, get) => {
  const initialBundle = readCachedBundle();
  const initialProgress = readCachedProgress();
  return {
    bundle: initialBundle,
    progress: initialProgress,
    isReady: initialBundle !== null && initialProgress !== null,
    error: null,

    boot: async (opts = {}) => {
      if (inFlightBoot) return inFlightBoot;
      const run = async (): Promise<void> => {
        const { forceRefresh = false } = opts;
        set({ error: null });

        // If the offline progress-queue is non-empty, the local cache
        // is by construction *ahead of* the backend (optimistic commits
        // applied here, replays still pending in the runner). Pulling
        // a fresh `getProgress` now would clobber those optimistic
        // rows back to their old server state, then the queue would
        // drain and flip them forward again — causing a visible
        // round-trip flicker on the home map. Skip the network leg
        // until the queue empties; on the *next* boot after drain,
        // we'll do a full refresh as usual.
        let effectiveForceRefresh = forceRefresh;
        if (effectiveForceRefresh) {
          try {
            if (await hasPendingProgressWrites()) {
              effectiveForceRefresh = false;
            }
          } catch {
            // IDB inaccessible — assume empty queue and proceed.
          }
        }

        // Cache hit fast-path.
        if (!effectiveForceRefresh) {
          const cachedBundle = get().bundle ?? readCachedBundle();
          const cachedProgress = get().progress ?? readCachedProgress();
          if (cachedBundle && cachedProgress) {
            set({
              bundle: cachedBundle,
              progress: cachedProgress,
              isReady: true,
            });
            return;
          }
        }

        const deviceId = useDeviceIdentity.getState().ensure();
        try {
          // Idempotent server-side; safe to call every boot.
          await assignPath(deviceId);
          const [bundle, progress] = await Promise.all([
            getPath(deviceId),
            getProgress(deviceId),
          ]);
          writeCachedBundle(bundle);
          writeCachedProgress(progress);
          set({ bundle, progress, isReady: true, error: null });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set({ error: msg });
          throw e;
        }
      };
      inFlightBoot = run().finally(() => {
        inFlightBoot = null;
      });
      return inFlightBoot;
    },

    completeLevel: async (cycle, levelId, opts = {}) => {
      const current = get().progress;
      const bundle = get().bundle;
      if (!current) {
        throw new Error("completeLevel called before boot()");
      }
      const deviceId = useDeviceIdentity.getState().ensure();

      // Resolve the level definition inside the requested cycle. The
      // home map and the level page are responsible for passing the
      // matching cycle in; if they don't, we refuse rather than silently
      // mutating a different cycle's entry.
      const owningCycleDef =
        bundle?.find((c) => c.cycle === cycle) ?? null;
      const levelDef =
        owningCycleDef?.levels.find((l) => l.levelId === levelId) ?? null;
      const fullReward = levelDef?.pointsReward ?? 0;

      // 1. Mark this level completed (server returns the canonical entry,
      //    including `completed_at`, `points`, and `cycle`).
      const completed = await setProgressOrQueue({
        deviceId,
        cycle,
        levelId,
        status: "completed",
        fallbackPoints: fullReward,
      });

      // 1a. Apply client-side overrides for partial completions. The
      //     backend returns full `pointsReward` regardless of how many
      //     questions the user actually submitted, so we patch the
      //     locally-cached entry to reflect the half-credit the user
      //     just saw on the celebration screen. Force `cycle` to the
      //     caller-supplied one — the legacy server response may omit
      //     it (defaulting to 1 in the parser) which would silently
      //     reassign a cycle-2 completion to cycle 1.
      const completedPatched: ProgressEntry = {
        ...completed,
        cycle,
        points:
          typeof opts.pointsOverride === "number"
            ? Math.max(0, Math.trunc(opts.pointsOverride))
            : completed.points,
        submittedCount:
          typeof opts.submittedCount === "number"
            ? Math.max(0, Math.trunc(opts.submittedCount))
            : completed.submittedCount,
        totalSteps:
          typeof opts.totalSteps === "number"
            ? Math.max(0, Math.trunc(opts.totalSteps))
            : completed.totalSteps,
      };

      // 2. Splice the (patched) completion in. KEYED ON (cycle, levelId)
      //    — never on levelId alone — because the same levelId exists
      //    across cycles.
      const splicedEntries: ProgressEntry[] = current.entries.map((e) =>
        e.cycle === cycle && e.levelId === levelId ? completedPatched : e,
      );

      // 3. If no other level *in the same cycle* is `current`, promote
      //    the lowest locked id *within that cycle*. Cross-cycle
      //    promotion is the job of `advanceCycle()`, not this method.
      const hasOtherCurrentInCycle = splicedEntries.some(
        (e) => e.status === "current" && e.cycle === cycle,
      );
      let promotedId: number | null = null;
      let finalEntries = splicedEntries;

      if (!hasOtherCurrentInCycle) {
        const nextLocked = splicedEntries
          .filter((e) => e.status === "locked" && e.cycle === cycle)
          .sort((a, b) => a.levelId - b.levelId)[0];
        if (nextLocked) {
          const promoted = await setProgressOrQueue({
            deviceId,
            cycle,
            levelId: nextLocked.levelId,
            status: "current",
            // The promotion row carries 0 points by definition (status
            // is `current`, not `completed`), so the fallback value is
            // unused — pass 0 for clarity.
            fallbackPoints: 0,
          });
          // Force cycle on the optimistic row (same reasoning as above).
          const promotedPatched: ProgressEntry = { ...promoted, cycle };
          promotedId = promotedPatched.levelId;
          finalEntries = splicedEntries.map((e) =>
            e.cycle === cycle && e.levelId === promotedPatched.levelId
              ? promotedPatched
              : e,
          );
        }
      }

      const updated: ProgressVector = {
        entries: finalEntries,
        totalPoints: finalEntries.reduce((sum, e) => sum + e.points, 0),
      };
      writeCachedProgress(updated);
      set({ progress: updated, isReady: get().bundle !== null });

      // 4. Detect "cycle complete": every entry in `cycle` is
      //    `"completed"` AND no level was promoted (the only way
      //    `promotedId` stays null inside the same cycle is when no
      //    locked sibling existed — i.e. the user just finished the
      //    last level of the cycle). The two conditions together
      //    avoid a false positive from a cross-cycle promotion that
      //    we don't currently do but might in future.
      const cycleComplete =
        promotedId === null && isCycleComplete(updated, cycle);

      return { promotedId, cycleComplete };
    },

    advanceCycle: async () => {
      const deviceId = useDeviceIdentity.getState().ensure();
      // Re-issue WITH `advance: true` — that's the explicit-advance
      // signal the server-side `advance_path()` RPC requires. Without
      // the flag, `paths_assign` is idempotent and just returns the
      // current top cycle, so we'd silently never get a new cycle.
      //
      // The RPC rejects with HTTP 409 (`cycle_incomplete`) if the
      // user's current top cycle isn't fully completed yet. The
      // celebration screen catches and surfaces a snackbar — we
      // intentionally let the error propagate untransformed.
      await advanceCycleApi(deviceId);
      const [nextBundle, nextProgress] = await Promise.all([
        getPath(deviceId),
        getProgress(deviceId),
      ]);
      // Merge with whatever we already had locally — see `mergeBundles`
      // for why this is union-by-cycle and not a wholesale replace.
      // The server now always returns the multi-cycle envelope (we
      // pass `?multicycle=1`), but we still merge defensively in case
      // a transient response drops a historical cycle.
      const merged = mergeBundles(get().bundle, nextBundle);
      writeCachedBundle(merged);
      writeCachedProgress(nextProgress);
      set({ bundle: merged, progress: nextProgress, isReady: true, error: null });
    },

    applyQuestionSwap: (cycle, levelId, qIndex, replacement) => {
      const bundle = get().bundle;
      if (!bundle) {
        throw new Error("applyQuestionSwap called before boot()");
      }
      const cycleIdx = bundle.findIndex((c) => c.cycle === cycle);
      if (cycleIdx === -1) {
        throw new Error(`applyQuestionSwap: cycle ${cycle} not in bundle`);
      }
      const cycleDef = bundle[cycleIdx];
      const levelIdx = cycleDef.levels.findIndex(
        (l) => l.levelId === levelId,
      );
      if (levelIdx === -1) {
        throw new Error(
          `applyQuestionSwap: cycle ${cycle} level ${levelId} not in bundle`,
        );
      }
      const levelDef = cycleDef.levels[levelIdx];
      const qIdx = levelDef.questions.findIndex((q) => q.qIndex === qIndex);
      if (qIdx === -1) {
        throw new Error(
          `applyQuestionSwap: cycle ${cycle} level ${levelId} q_index ${qIndex} not in bundle`,
        );
      }

      // Force the slot's original qIndex onto the replacement so the
      // audio filename slug never drifts, even if a future server
      // change starts echoing the replacement's own qIndex back.
      const patchedQuestion: import("@/lib/content/models").LevelQuestionData =
        {
          qIndex,
          promptEn: replacement.promptEn,
          imageUrl: replacement.imageUrl,
          languageIso: replacement.languageIso,
        };

      // Immutable patch: rebuild the questions array, level, cycle, and
      // bundle so React subscribers see new references all the way up.
      const nextQuestions = levelDef.questions.slice();
      nextQuestions[qIdx] = patchedQuestion;
      const nextLevel = { ...levelDef, questions: nextQuestions };
      const nextLevels = cycleDef.levels.slice();
      nextLevels[levelIdx] = nextLevel;
      const nextCycle = { ...cycleDef, levels: nextLevels };
      const nextBundle = bundle.slice();
      nextBundle[cycleIdx] = nextCycle;

      writeCachedBundle(nextBundle);
      set({ bundle: nextBundle });
    },

    reset: () => {
      safeStorage.removeItem(StorageKeys.pathCache);
      safeStorage.removeItem(StorageKeys.progressCache);
      useDeviceIdentity.getState().rotate();
      set({ bundle: null, progress: null, isReady: false, error: null });
    },
  };
});

// ---------------------------------------------------------------------------
// Convenience selectors (re-exported for screen modules)
// ---------------------------------------------------------------------------

/**
 * Look up a level definition by composite (cycle, levelId) key.
 * Level ids are 1..8 *within a cycle* and NOT globally unique; passing
 * just a levelId would silently match the wrong cycle once the device
 * has been advanced past cycle 1.
 */
export function selectLevel(
  state: PathRepoState,
  cycle: number,
  levelId: number,
) {
  if (!state.bundle) return null;
  const cycleDef = state.bundle.find((c) => c.cycle === cycle);
  return cycleDef?.levels.find((l) => l.levelId === levelId) ?? null;
}

export function selectProgressEntry(
  state: PathRepoState,
  cycle: number,
  levelId: number,
): ProgressEntry | null {
  return (
    state.progress?.entries.find(
      (e) => e.cycle === cycle && e.levelId === levelId,
    ) ?? null
  );
}

export function selectStatus(
  state: PathRepoState,
  cycle: number,
  levelId: number,
): LevelProgressStatus {
  return selectProgressEntry(state, cycle, levelId)?.status ?? "locked";
}
