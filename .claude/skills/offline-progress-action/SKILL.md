---
name: offline-progress-action
description: Add a new progress-modifying action that must work offline. Progress writes queue to IndexedDB on network failure, replay FIFO when online, and apply optimistic updates locally. Adding such an action requires lockstep edits to API client (`src/lib/api/`), queue entry shape (`src/lib/storage/progress-queue.ts` v2 with mandatory `cycle`), runner dispatch (`progress-queue-runner.ts`), and optimistic update in `src/stores/path-repo.ts`. Covers cycle-aware composite (cycle, level_id) keying, FIFO ordering, 5-attempt drop policy, online-only flush triggers, at-most-once enforcement, IDB schema versioning. USE FOR: new queueable progress mutations, debugging stuck queue items, fixing FIFO violations, bumping queue schema. DO NOT USE FOR: queueing audio uploads (at-most-once by design), arbitrary GETs, or non-progress backend writes (other write types need their own queue + runner).
---

# Adding a queueable offline progress action

This project's progress mutations (`progress_set`) are the only writes that survive offline. The pattern is rigid by design getting any one piece wrong silently corrupts the user's path state.

Touch all four files **in the same commit**:

1. `src/lib/api/progress.ts` the actual fetch.
2. `src/lib/storage/progress-queue.ts` IDB entry shape.
3. `src/lib/storage/progress-queue-runner.ts` replay dispatch.
4. `src/stores/path-repo.ts` optimistic update + enqueue-on-failure.

## 1. Why progress writes are queued (and audio is not)

Read the comments at:

- `src/lib/storage/progress-queue.ts:1-32` the rationale for a separate queue
- `src/app/(app)/level/[cycleLevel]/page.tsx:455-465` why audio submit is at-most-once

Summary:

- **Progress writes are FIFO, idempotent, small (no Blob).** A `completed` row + a dependent `current` promotion are written as a pair. The promotion only makes sense after the completion lands. They MUST replay in order.
- **Audio uploads are independent and large.** Earlier the audio path queued failures too, but combining a client retry queue with the audio API's own retry loop produced duplicate writes in the storage bucket on ambiguous failures (timeout-after-store, lost response). Both layers are now at-most-once: one POST per user tap.

If you find yourself wanting to queue audio, **don't.** The user retries by tapping Submit again. Surface a clear "you're offline" snackbar (`levelOfflineSubmitSnack`).

## 2. The triad required files

### a. API client (`src/lib/api/progress.ts`)

```ts
export async function setProgress(args: {
  deviceId: string;
  cycle: number;        // ← MANDATORY. Never omit.
  levelId: number;
  status: LevelProgressStatus;
}): Promise<ProgressEntry> {
  const data = await invokeEdge<unknown>("progress_set", {
    method: "POST",
    body: {
      device_id: args.deviceId,
      cycle: args.cycle,
      level_id: args.levelId,
      status: args.status,
    },
  });
  return parseProgressEntry(data);
}
```

The server tolerates a missing `cycle` (defaults to top cycle) for legacy clients but **the PWA never relies on that**. The composite (cycle, level_id) is the canonical identity level_id alone collides across cycles.

`invokeEdge` (see `src/lib/api/edge.ts`) throws `EdgeFunctionError` on any failure. A pure-network failure has `status === 0`; an HTTP failure has the actual status code.

### b. Queue entry shape (`src/lib/storage/progress-queue.ts`)

```ts
export interface QueuedProgressWrite {
  v: 2;                   // schema version
  id: string;             // `${seq}-${cycle}-${levelId}-${status}`
  seq: number;            // monotonic FIFO key
  cycle: number;          // mandatory in v2
  levelId: number;
  status: LevelProgressStatus;
  enqueuedAt: number;     // ms epoch, diagnostics only
  attempts: number;       // bumped by the runner on each replay
}
```

Stored via `idb-keyval` in DB `afriklang.progress`, store `StorageKeys.progressQueueStore`. **Why a separate IDB database from the audio queue?** `idb-keyval` opens the DB at version 1 with one store and offers no migration path to add a second store later. Sharing one DB between two queues caused `NotFoundError: One of the specified object stores was not found` whichever runner booted second. See the comment block at lines 42–51.

### c. Runner dispatch (`src/lib/storage/progress-queue-runner.ts`)

```ts
async function replayItem(item: QueuedProgressWrite, deviceId: string): Promise<ReplayOutcome> {
  try {
    await setProgress({
      deviceId,
      cycle: item.cycle,     // forward the queued cycle
      levelId: item.levelId,
      status: item.status,
    });
    await removeProgressWrite(item.id);
    return "continue";
  } catch (e) {
    const isNetwork = e instanceof EdgeFunctionError && e.status === 0;
    if (!isNetwork) {
      // 4xx/5xx → drop & surface. Leaving it would block FIFO forever.
      await removeProgressWrite(item.id);
      surfaceDropped();
      return "continue";
    }
    const attempts = await bumpProgressAttempts(item.id);
    if (attempts >= MAX_REPLAY_ATTEMPTS) { // = 5
      await removeProgressWrite(item.id);
      surfaceDropped();
      return "continue";
    }
    return "stop"; // FIFO: don't try the next item until this one lands
  }
}
```

Three outcomes only: `continue` (next item), `stop` (freeze the pass, retry on next online/focus), or drop-with-snackbar (count >= 5 OR non-network HTTP error). Never silently drop without surfacing.

### d. Optimistic update (`src/stores/path-repo.ts`)

```ts
async function setProgressOrQueue(args: {
  deviceId: string;
  cycle: number;
  levelId: number;
  status: LevelProgressStatus;
  fallbackPoints: number;
}): Promise<ProgressEntry> {
  try {
    return await setProgress(args);  // server returns canonical row
  } catch (e) {
    const isNetwork = e instanceof EdgeFunctionError && e.status === 0;
    if (!isNetwork) throw e;          // real backend error → don't mask

    await enqueueProgressWrite({
      cycle: args.cycle,
      levelId: args.levelId,
      status: args.status,
    });

    // Synthesize an optimistic row so the celebration screen and home
    // header don't render NaN until the queue drains.
    return {
      levelId: args.levelId,
      status: args.status,
      completedAt: args.status === "completed" ? new Date().toISOString() : null,
      points: args.status === "completed" ? args.fallbackPoints : 0,
      cycle: args.cycle,
    };
  }
}
```

The synthesized row matches the server's eventual canonical row close enough that the UI can splice it in without flicker. When the queue drains, the runner doesn't update path-repo state (the local copy is already correct).

## 3. Cycle-aware composite key

Level ids are 1..8 *within a cycle* and **NOT globally unique**. Once a device advances past cycle 1, level 3 of cycle 1 and level 3 of cycle 2 coexist. Every operation that touches a progress entry keys on (cycle, level_id):

```ts
// path-repo.ts:439 splicing a completion in
const splicedEntries = current.entries.map((e) =>
  e.cycle === cycle && e.levelId === levelId ? completedPatched : e,
);

// path-repo.ts:446 finding the next locked level
const hasOtherCurrentInCycle = splicedEntries.some(
  (e) => e.status === "current" && e.cycle === cycle,
);
```

Look at `src/stores/path-repo.ts:557-563` for the canonical selector. **If your action's lookup uses `levelId` alone, you have a bug.**

## 4. FIFO ordering and ordering across cycles

The queue is per-device strict FIFO via the monotonic `seq` field assigned at `enqueueProgressWrite` time. `nextSeq()` starts from `Date.now()` and increments, so seqs are roughly time-ordered across sessions and strictly monotonic within a tab.

`completeLevel` writes two rows in one synchronous block: the `completed` for the just-finished level, then the `current` promotion for the next-locked sibling. Both share the same outer try/catch but they enqueue separately, in order, so on replay the completion lands before the promotion.

## 5. Drop policy

- **Network failure with attempts < 5** → bump and stop (retry later).
- **Network failure with attempts >= 5** → drop + snackbar (`progressQueuedSyncFailedSnack`).
- **HTTP 4xx/5xx (non-network)** → drop + snackbar **immediately**. Leaving an unrecoverable row in the queue would block every subsequent write, since FIFO is mandatory.

The snackbar copy is injected via `startProgressQueueRunner({ getCopy })` the runner is non-React and can't call `t()` itself. See the i18n-add-string skill for the pattern.

## 6. Flush triggers

The runner wires three events on start (`startProgressQueueRunner` is idempotent safe to call from layout effects on every mount):

```ts
window.addEventListener("online", () => kickProgressQueue());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") kickProgressQueue();
});
kickProgressQueue(); // catch-up for items left from a prior session
```

`kickProgressQueue()` is debounced via a 50 ms `setTimeout` so a flurry of events (e.g. `online` immediately followed by `visibilitychange`) coalesces into one drain pass.

`drainOnce` re-checks `navigator.onLine === false` between every item drop the queue and exit cleanly if the tab loses connectivity mid-pass.

## 7. Boot interaction (the flicker hazard)

`usePathRepo.boot({ forceRefresh: true })` (the user pulls-to-refresh / switches account) would normally re-fetch `getProgress` and clobber the local cache. **But if the queue is non-empty, the local cache is by construction ahead of the server.** Re-fetching now would briefly show the user's progress reverted, then flip forward when the queue drains. Visible flicker, looks like a bug.

Fix at `src/stores/path-repo.ts:335-344`:

```ts
let effectiveForceRefresh = forceRefresh;
if (effectiveForceRefresh) {
  try {
    if (await hasPendingProgressWrites()) {
      effectiveForceRefresh = false; // skip the network leg this boot
    }
  } catch {
    // IDB inaccessible assume empty and proceed.
  }
}
```

If you add a new flush event or a new boot path, replicate this guard.

## 8. IDB schema versioning

The current schema is **v2**, distinguished from v1 by the mandatory `cycle` field. v1 rows from before the multi-cycle backend rollout are tolerated on read and up-converted in-memory to `cycle = 1`:

```ts
function upgradeIfNeeded(row: QueuedProgressWrite): QueuedProgressWrite {
  if (row.v === 2) return row;
  return { ...row, v: 2, cycle: 1 };
}
```

The on-disk row is **deliberately not** rewritten see the comment at lines 207–213. Persisting a converted copy would change the id (which encodes cycle), breaking the runner's `removeProgressWrite` call.

If you bump to **v3**, you must:

1. Add a new field to `QueuedProgressWrite` and bump `v: 3`.
2. Update `isQueuedProgressWrite` to accept `v === 1 | 2 | 3`.
3. Extend `upgradeIfNeeded` to up-convert v1 AND v2 rows.
4. Update `enqueueProgressWrite` to write `v: 3`.
5. Decide if the id format changes if yes, the runner's `removeProgressWrite(item.id)` still works (we use the row's own id), but external code that reconstructs ids by hand (none currently) would break.
6. **Do NOT** open a new IDB database. Bump within the existing store.

`createStore(DB_NAME, STORE_NAME)` from `idb-keyval` doesn't allow adding object stores after v1, but it does allow adding fields to existing rows the upgrade-on-read pattern is the only schema migration we need.

## 9. Step-by-step "add a new queueable action" playbook

1. **Confirm it's a progress mutation.** If it's an audio upload, a leaderboard write, or a profile update **stop**. Those are at-most-once and don't belong in this queue. Open a new queue + runner pair if needed.
2. **Extend `LevelProgressStatus`** in `src/lib/content/models.ts` if your new action uses a new status value. Update the parser too.
3. **Add the API call** in `src/lib/api/progress.ts` (or extend `setProgress` if it's a new status only). Always include `cycle`.
4. **No queue-shape change is usually needed.** The existing `QueuedProgressWrite` already carries `(cycle, levelId, status)`. Only bump to v3 if you need a new field.
5. **Wire the optimistic path.** In `src/stores/path-repo.ts`, call `setProgressOrQueue({ ... })` for the new mutation. Splice the returned row into `progress.entries` keyed on `(cycle, levelId)`. Update `totalPoints` accordingly. Always call `writeCachedProgress(updated)`.
6. **Verify the runner handles it.** If you only added a new `status` value to existing fields, `replayItem` calls `setProgress(args)` and the server handles it. No runner change needed. If you added a new ENTRY TYPE (different action, not just a status), the runner needs a new switch arm.
7. **Test offline → online cycle:**
   - DevTools → Network → Offline.
   - Trigger the action.
   - Confirm UI updates optimistically and an entry appears in IDB (DevTools → Application → IndexedDB → `afriklang.progress`).
   - Network → Online.
   - Confirm the entry disappears within ~50 ms (the kick debounce).
   - Refresh the page. Run `boot({ forceRefresh: true })`. Confirm no flicker.
8. **Test the drop paths:**
   - Force a 4xx response (mock `setProgress` to throw `EdgeFunctionError(fn, 400, "...")` once). Item should drop on the first replay with a snackbar.
   - Force 5 network failures. Item should drop on attempt 5 with a snackbar.
9. **Run the verification triad** (see `build-verify` skill):

   ```bash
   npx tsc --noEmit && npx eslint . && npx next build --webpack
   ```

## 10. Common mistakes

- **Queueing on a 4xx.** The repo wrapper checks `status === 0` (network only) before enqueueing. A 409 from the backend should propagate to the caller, not silently queue.
- **Keying on `levelId` alone.** Once cycle ≥ 2, you mutate the wrong row. Always `(cycle, levelId)`.
- **Forgetting to write the cache.** `writeCachedProgress(updated)` after every state change otherwise a reload reverts to the pre-action state.
- **Calling `t()` inside the runner.** No React context. Use the `getCopy` callback pattern (see `progressDrainCopy` in `progress-queue-runner.ts:60-63`).
- **Skipping the FIFO `stop` outcome.** Returning `continue` on a transient failure means the dependent next-row will land before the failed one lands eventually leaderboard half-state.
- **Sharing the IDB database with the audio queue.** Don't. Each queue gets its own DB (see §2b).
