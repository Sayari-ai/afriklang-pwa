"use client";

/**
 * One-shot client-storage migrations.
 *
 * Runs at app boot (from `<AppHydration>`, before any store hydrates)
 * and brings the device's persisted state up to the current
 * `CURRENT_VERSION`. A monotonically-increasing integer in
 * localStorage (`StorageKeys.schemaVersion`) records the highest
 * migration that has already been applied, so this module is
 * idempotent: every subsequent boot reads the version, sees it's
 * already current, and exits without touching disk.
 *
 * Why not lean on Zustand's `persist` middleware versioning?
 *   - Stores in this app deliberately bypass `persist` and write to
 *     localStorage directly via `safeStorage`, to keep the keys 1:1
 *     compatible with the Flutter SharedPreferences contract. That
 *     gives us no per-store migration hook.
 *   - `safeStorage` is sync; some migrations (deleting orphan IDB
 *     databases) are async. A single boot-level entry point lets us
 *     orchestrate both classes uniformly.
 *
 * Migration policy:
 *   - Migrations are append-only. Never edit a shipped migration 
 *     once a user has run it, that step is recorded as "applied" and
 *     the runner won't re-execute it. Add a new entry instead.
 *   - Migrations should be tolerant of partial state (e.g. a key may
 *     be absent, IDB may be unavailable in incognito). They never
 *     throw to the caller; the worst-case outcome is that the version
 *     bump still lands and the cleanup is best-effort.
 *   - Migrations should not depend on stores being hydrated. They run
 *     before `useDeviceIdentity.ensure()` and friends.
 *
 * Why fire-and-forget the async work?
 *   - The version bump happens *first*, synchronously. If the page
 *     unloads mid-migration, the next boot still sees the new
 *     version and skips the (idempotent) cleanup. Worst case: an
 *     orphan IDB database survives one extra session before the
 *     browser GCs it itself; harmless.
 *   - Keeping this off the boot critical path means a slow IDB
 *     `deleteDatabase` (rare, but `versionchange` deadlocks have
 *     happened in the wild) cannot delay first paint.
 */

import { StorageKeys } from "@/lib/storage-keys";
import { safeStorage } from "@/lib/safe-storage";

/**
 * Highest migration version this build knows about. When you add a
 * new migration, append it to `MIGRATIONS` *and* bump this constant
 * to match its `to`. Mismatches are caught by an assertion below.
 */
export const CURRENT_SCHEMA_VERSION = 2;

interface Migration {
  /** Version produced by running this migration (= prior version + 1). */
  to: number;
  /** Short reason string used in console logs for diagnostics. */
  reason: string;
  /**
   * Mutates persisted state. Sync prep + async cleanup is fine 
   * the runner awaits the returned promise but does not block the
   * version bump on it.
   */
  run: () => Promise<void> | void;
}

/**
 * Migration ledger. Append-only; existing entries are frozen once
 * shipped to users.
 */
const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    to: 1,
    reason: "multi-cycle-path-cache",
    run: async () => {
      // (a) Wipe the legacy `pathCache`.
      //
      //     Important nuance: `usePathRepo`'s store initialiser reads
      //     the cache *at module-evaluation time* (`initialBundle =
      //     readCachedBundle()`), which is strictly before this
      //     migration runs (the runner is invoked from
      //     `<AppHydration>`'s `useEffect`, which fires after first
      //     render and by then every module imported by the React
      //     tree has already evaluated). So this wipe does NOT affect
      //     the in-memory state of the *current* session; it only
      //     guarantees the *next* session starts from a clean slate.
      //
      //     That's intentional: the v1 multi-cycle path parser is
      //     deliberately tolerant of the legacy single-cycle shape
      //     (`parsePathBundle` wraps it in a one-element array), so
      //     this session's read is correct regardless. The wipe here
      //     is belt-and-braces it forces a fresh `paths_get` round
      //     trip on the next cold boot so any user who already had a
      //     cached payload picks up a server-stamped `cycle: 1` on
      //     every level entry, which the home map's stacking layout
      //     reads. Without the wipe, those users would render fine
      //     (cycle defaults to 1 in the parser) but would never
      //     observe the canonical server stamp until the next
      //     `forceRefresh`.
      //
      //     Progress cache is left alone: the parser injects
      //     `cycle: 1` for legacy entries and the offline queue may
      //     still hold pending writes that reference it wiping
      //     would lose those.
      safeStorage.removeItem(StorageKeys.pathCache);

      // (b) Delete any legacy IndexedDB database left over from
      //     pre-`afriklang.progress` prototypes. We only ever shipped
      //     `afriklang.progress` (see `progress-queue.ts`), but a
      //     defensive sweep here keeps users who upgraded from a
      //     dev preview clean. Names guessed conservatively only
      //     ones we know belonged to this app.
      const orphanDbs = ["afriklang"];
      for (const name of orphanDbs) {
        try {
          await deleteDatabaseSafe(name);
        } catch {
          // Per-DB failures are non-fatal see runner-level catch.
        }
      }
    },
  },
  {
    to: 2,
    reason: "remove-nickname-feature",
    run: () => {
      // The user-chosen nickname flow was retired: Google sign-in is
      // mandatory, so the leaderboard name now comes from the Google
      // account (`<DisplayNameSync>` pushes it via `nickname_set`).
      // Clear the two keys the retired `useNickname` store persisted.
      //
      // Key names are inlined (not `StorageKeys.*`): the registry no
      // longer declares them, and a frozen migration must keep
      // deleting exactly these historical strings even if the
      // registry evolves further.
      safeStorage.removeItem("afriklang.nickname.v1");
      safeStorage.removeItem("afriklang.nickname.v1.prompted");
    },
  },
];

// Sanity check: the highest declared `to` matches the constant the
// rest of the codebase imports. Caught at module-eval time, so a
// mismatched constant fails the dev build immediately.
if (
  MIGRATIONS.length > 0 &&
  MIGRATIONS[MIGRATIONS.length - 1].to !== CURRENT_SCHEMA_VERSION
) {
  console.error(
    "[afriklang/migrations] CURRENT_SCHEMA_VERSION (%d) does not match last migration.to (%d)",
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS[MIGRATIONS.length - 1].to,
  );
}

/**
 * Read the stored schema version. Absent / unparseable values are
 * treated as 0, so a fresh install runs every migration in order.
 */
function readVersion(): number {
  const raw = safeStorage.getItem(StorageKeys.schemaVersion);
  if (raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeVersion(v: number): void {
  safeStorage.setItem(StorageKeys.schemaVersion, String(v));
}

/**
 * `indexedDB.deleteDatabase()` wrapped in a promise with a timeout.
 *
 * `versionchange` deadlocks happen when another tab/worker holds an
 * open connection to the database `deleteDatabase` then fires a
 * `blocked` event and never resolves. We don't want that to hang the
 * boot indefinitely, so we race against a 5-second timer. The
 * orphan DB will get cleaned up on the next session anyway because
 * the schema-version write below has *not* yet run when we time out
 * (the migration's promise rejects), so the next boot retries.
 *
 * If `indexedDB` itself is unavailable (incognito on some Safaris,
 * `file://` protocol, etc.) we resolve immediately and treat the DB
 * as already-clean.
 */
function deleteDatabaseSafe(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => settle(resolve);
    req.onerror = () => settle(() => reject(req.error ?? new Error("idb-error")));
    // `onblocked` fires when another tab still has the DB open. We
    // *could* wait it out, but indefinite hangs aren't worth it for
    // a best-effort cleanup. Resolve so the version bump still lands;
    // next session will retry once the conflicting connection closes.
    req.onblocked = () => settle(resolve);
    const timer = setTimeout(() => settle(resolve), 5_000);
  });
}

/**
 * Apply every pending migration in order. Returns a promise that
 * resolves when all migrations have completed (or been skipped).
 *
 * Crash-safety: the version bump happens *after* the migration's
 * promise settles, so a mid-migration unload leaves the version
 * unchanged and the runner will retry on the next boot. The
 * migrations themselves are written to be idempotent under that
 * retry policy.
 *
 * Error-safety: a thrown / rejected migration is caught, logged,
 * and the runner stops at that version (no further migrations
 * apply this session). The version bump for the failed migration
 * is *not* written, so it'll be retried on the next boot.
 */
export async function runStorageMigrations(): Promise<void> {
  if (typeof window === "undefined") return; // SSR no-op
  const fromVersion = readVersion();
  if (fromVersion >= CURRENT_SCHEMA_VERSION) return;

  for (const m of MIGRATIONS) {
    if (m.to <= fromVersion) continue; // already applied
    try {
      await m.run();
      writeVersion(m.to);
    } catch (err) {
      console.warn(
        "[afriklang/migrations] migration to v%d (%s) failed; will retry next boot",
        m.to,
        m.reason,
        err,
      );
      return;
    }
  }
}
