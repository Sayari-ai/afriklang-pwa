"use client";

/**
 * Path + progress repository (Zustand).
 *
 * Mirrors `lib/core/content/path_repository.dart`. Single source of
 * truth for:
 *   - the device's assigned path (PathDefinition)
 *   - the per-level progress vector (ProgressVector)
 *
 * Lifecycle:
 *   1. `boot({ forceRefresh })` is called by the path-setup screen.
 *      We try the localStorage cache first; on miss (or refresh) we go
 *      assign → getPath → getProgress and write both back to disk.
 *   2. `completeLevel(levelId)` is called by the level screen when the
 *      user finishes a mission. We POST `progress_set` for the
 *      completion, then — if no other level is `current` — promote the
 *      lowest-numbered locked level to `current`. Both writes are
 *      pushed to the backend, and the cache is updated. Returns the
 *      promoted level id (or `null`) so the celebration screen can
 *      deep-link "Next mission".
 *   3. `reset()` is a dev-time affordance: clears caches and rotates
 *      the device id so the next boot claims a fresh path slot.
 *
 * Error policy: `boot()` throws on network failure with no cache to
 * fall back on. The path-setup screen catches and shows the retry UI
 * defined by `pathSetupErrorTitle` / `pathSetupRetryButton`.
 */

import { create } from "zustand";

import { assignPath, getPath } from "@/lib/api/paths";
import { getProgress, setProgress } from "@/lib/api/progress";
import {
  type LevelProgressStatus,
  type PathDefinition,
  type ProgressEntry,
  type ProgressVector,
  parsePath,
  parseProgressVector,
} from "@/lib/content/models";
import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";
import { useDeviceIdentity } from "@/stores/device-identity";

interface PathRepoState {
  path: PathDefinition | null;
  progress: ProgressVector | null;
  /** True once both `path` and `progress` are populated. */
  isReady: boolean;
  /** Last error from `boot()`, if any. UI uses this for the retry screen. */
  error: string | null;
  /** Reentrant-safe: returns the in-flight promise if `boot()` is already running. */
  boot: (opts?: { forceRefresh?: boolean }) => Promise<void>;
  /** Marks `levelId` complete, promotes next locked → current. Returns promoted id. */
  completeLevel: (levelId: number) => Promise<number | null>;
  /** Dev-only: wipe caches and rotate device id. */
  reset: () => void;
}let inFlightBoot: Promise<void> | null = null;

function readCachedPath(): PathDefinition | null {
  const raw = safeStorage.getItem(StorageKeys.pathCache);
  if (!raw) return null;
  try {
    return parsePath(JSON.parse(raw));
  } catch {
    // Corrupt cache — drop it.
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

function writeCachedPath(path: PathDefinition): void {
  // Re-serialise via the snake-case wire shape so reads round-trip.
  safeStorage.setItem(
    StorageKeys.pathCache,
    JSON.stringify({
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
      })),
    }),
  );
}

export const usePathRepo = create<PathRepoState>((set, get) => {
  const initialPath = readCachedPath();
  const initialProgress = readCachedProgress();
  return {
    path: initialPath,
    progress: initialProgress,
    isReady: initialPath !== null && initialProgress !== null,
    error: null,

  boot: async (opts = {}) => {
    if (inFlightBoot) return inFlightBoot;
    const run = async (): Promise<void> => {
      const { forceRefresh = false } = opts;
      set({ error: null });

      // Cache hit fast-path.
      if (!forceRefresh) {
        const cachedPath = get().path ?? readCachedPath();
        const cachedProgress = get().progress ?? readCachedProgress();
        if (cachedPath && cachedProgress) {
          set({ path: cachedPath, progress: cachedProgress, isReady: true });
          return;
        }
      }

      const deviceId = useDeviceIdentity.getState().ensure();
      try {
        // Idempotent server-side; safe to call every boot.
        await assignPath(deviceId);
        const [pathDef, progress] = await Promise.all([
          getPath(deviceId),
          getProgress(deviceId),
        ]);
        writeCachedPath(pathDef);
        writeCachedProgress(progress);
        set({ path: pathDef, progress, isReady: true, error: null });
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

  completeLevel: async (levelId) => {
    const current = get().progress;
    if (!current) {
      throw new Error("completeLevel called before boot()");
    }
    const deviceId = useDeviceIdentity.getState().ensure();

    // 1. Mark this level completed (server returns the canonical entry,
    //    including `completed_at` and `points`).
    const completed = await setProgress({
      deviceId,
      levelId,
      status: "completed",
    });

    // 2. Splice the completion in.
    const splicedEntries: ProgressEntry[] = current.entries.map((e) =>
      e.levelId === levelId ? completed : e,
    );

    // 3. If no other level is `current`, promote the lowest locked id.
    const hasOtherCurrent = splicedEntries.some((e) => e.status === "current");
    let promotedId: number | null = null;
    let finalEntries = splicedEntries;

    if (!hasOtherCurrent) {
      const nextLocked = splicedEntries
        .filter((e) => e.status === "locked")
        .sort((a, b) => a.levelId - b.levelId)[0];
      if (nextLocked) {
        const promoted = await setProgress({
          deviceId,
          levelId: nextLocked.levelId,
          status: "current",
        });
        promotedId = promoted.levelId;
        finalEntries = splicedEntries.map((e) =>
          e.levelId === promoted.levelId ? promoted : e,
        );
      }
    }

    const updated: ProgressVector = {
      entries: finalEntries,
      totalPoints: finalEntries.reduce((sum, e) => sum + e.points, 0),
    };
    writeCachedProgress(updated);
    set({ progress: updated, isReady: get().path !== null });
    return promotedId;
  },

  reset: () => {
    safeStorage.removeItem(StorageKeys.pathCache);
    safeStorage.removeItem(StorageKeys.progressCache);
    useDeviceIdentity.getState().rotate();
    set({ path: null, progress: null, isReady: false, error: null });
  },
  };
});

// ---------------------------------------------------------------------------
// Convenience selectors (re-exported for screen modules)
// ---------------------------------------------------------------------------

export function selectLevel(
  state: PathRepoState,
  levelId: number,
) {
  return state.path?.levels.find((l) => l.levelId === levelId) ?? null;
}

export function selectProgressEntry(
  state: PathRepoState,
  levelId: number,
): ProgressEntry | null {
  return state.progress?.entries.find((e) => e.levelId === levelId) ?? null;
}

export function selectStatus(
  state: PathRepoState,
  levelId: number,
): LevelProgressStatus {
  return selectProgressEntry(state, levelId)?.status ?? "locked";
}
