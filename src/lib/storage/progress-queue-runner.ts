"use client";

/**
 * Offline progress-write queue runner.
 *
 * Sibling of {@link ./upload-queue-runner.ts}. Drains queued
 * `progress_set` calls (level completions and `current` promotions
 * made while the device was offline) against the backend.
 *
 * Why a separate runner?
 *
 *   - Different ordering contract: progress writes are strictly FIFO
 *     per device, because the second write of a completion (`current`
 *     promotion of the next level) is *only* meaningful after the
 *     first write (`completed` for the just-finished level) lands.
 *     A failure on row N must stop the pass — if N+1 succeeded while
 *     N was still pending, the leaderboard would show a half-applied
 *     state.
 *   - Different drop policy: a 4xx from the backend on a queued
 *     progress write (e.g. unknown level id, malformed status) is
 *     unrecoverable by the user, and leaving such a row in the queue
 *     would block every subsequent write forever. We drop both
 *     network-permanent (5 attempts) and non-network failures.
 *     The local cache is, by design, ahead of the backend in this
 *     case; the next `boot({ forceRefresh })` after the queue empties
 *     will reconcile from the server side.
 *   - Different copy: the dropped-item snackbar refers to "progress",
 *     not "recordings".
 *
 * Lifecycle parallels the audio runner:
 *
 *   startProgressQueueRunner({ getCopy })
 *     ↳ idempotent — second call refreshes copy only
 *     ↳ wires `online` + `visibilitychange`
 *     ↳ kicks once for items left from a prior session
 *
 *   kickProgressQueue()
 *     ↳ public manual trigger (also called by the listeners)
 */

import { EdgeFunctionError } from "@/lib/api/edge";
import { setProgress } from "@/lib/api/progress";
import {
  bumpProgressAttempts,
  listProgressQueued,
  removeProgressWrite,
  type QueuedProgressWrite,
} from "@/lib/storage/progress-queue";
import { useDeviceIdentity } from "@/stores/device-identity";
import { useSnackbar } from "@/stores/snackbar";

/** Maximum replay attempts per item before we give up and drop it. */
const MAX_REPLAY_ATTEMPTS = 5;

/** Initial inter-attempt backoff; doubles per attempt, capped at 60 s. */
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 60_000;

/** i18n strings the runner needs at runtime. Injected at start-up. */
export interface ProgressDrainCopy {
  /** Shown once per dropped item. */
  syncFailed: string;
}

interface RunnerHandle {
  started: boolean;
  draining: boolean;
  getCopy: (() => ProgressDrainCopy) | null;
  pendingKick: ReturnType<typeof setTimeout> | null;
}

const runner: RunnerHandle = {
  started: false,
  draining: false,
  getCopy: null,
  pendingKick: null,
};

export function startProgressQueueRunner(opts: {
  getCopy: () => ProgressDrainCopy;
}): void {
  runner.getCopy = opts.getCopy;

  if (runner.started) return;
  runner.started = true;

  if (typeof window === "undefined") return;

  window.addEventListener("online", () => kickProgressQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kickProgressQueue();
  });

  kickProgressQueue();
}

export function kickProgressQueue(): void {
  if (runner.pendingKick != null) return;
  runner.pendingKick = setTimeout(() => {
    runner.pendingKick = null;
    void drainOnce();
  }, 50);
}

async function drainOnce(): Promise<void> {
  if (runner.draining) return;
  runner.draining = true;
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const items = await listProgressQueued();
    if (items.length === 0) return;

    // The device id is owned by the device-identity store; reading
    // it once per drain is fine because rotating it (dev-only
    // `reset()`) also clears caches and wouldn't co-exist with a
    // populated queue in practice.
    const deviceId = useDeviceIdentity.getState().ensure();

    for (const item of items) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      const outcome = await replayItem(item, deviceId);
      if (outcome === "stop") {
        // Strict-FIFO contract: a transient failure on row N freezes
        // the entire pass. Resume on the next online/focus event.
        scheduleBackoffKick(item.attempts + 1);
        return;
      }
      // outcome === "continue" — row was either uploaded or dropped;
      // either way, advance to the next item.
    }
  } finally {
    runner.draining = false;
  }
}

type ReplayOutcome = "continue" | "stop";

/**
 * Replay a single queued progress write.
 *
 *   - success → drop the row, return `"continue"`.
 *   - network failure under the cap → bump attempts, return `"stop"`
 *     so the FIFO contract holds.
 *   - network failure at/over the cap → drop with snackbar, return
 *     `"continue"` so the queue can unwedge.
 *   - non-network error (4xx/5xx with status) → drop with snackbar,
 *     return `"continue"`. There is no human-recoverable retry path
 *     and leaving the row in place would block every future write.
 */
async function replayItem(
  item: QueuedProgressWrite,
  deviceId: string,
): Promise<ReplayOutcome> {
  try {
    await setProgress({
      deviceId,
      levelId: item.levelId,
      status: item.status,
    });
    await removeProgressWrite(item.id);
    return "continue";
  } catch (e) {
    const isNetwork = e instanceof EdgeFunctionError && e.status === 0;

    if (!isNetwork) {
      // Permanent backend rejection — drop and surface, otherwise the
      // FIFO would block forever on a row the server will never accept.
      await removeProgressWrite(item.id);
      surfaceDropped();
      return "continue";
    }

    const attempts = await bumpProgressAttempts(item.id);
    if (attempts >= MAX_REPLAY_ATTEMPTS) {
      await removeProgressWrite(item.id);
      surfaceDropped();
      return "continue";
    }
    return "stop";
  }
}

function surfaceDropped(): void {
  const copy = runner.getCopy?.();
  if (copy) {
    useSnackbar.getState().show(copy.syncFailed, 4000);
  }
}

function scheduleBackoffKick(attempt: number): void {
  if (typeof window === "undefined") return;
  const exp = RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * exp * 0.25;
  const ms = Math.min(exp + jitter, RETRY_CAP_MS);
  setTimeout(() => kickProgressQueue(), ms);
}
