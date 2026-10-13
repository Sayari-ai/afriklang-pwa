/**
 * The recording outbox: takes waiting on the phone to be sent.
 *
 * A take is saved here the moment the contributor taps "Submit", so they can move on at once and
 * nothing is lost when the network drops, the tab closes or the phone sleeps. A runner sends each
 * take in two steps, remembering which one is done so neither repeats needlessly:
 *
 *   1. the audio to Sayari (through /api/audio-upload)
 *   2. the metadata to the dashboard (`submit`; safe to repeat: the same file answers duplicate: true)
 *
 * The audio leaves the phone's storage once the dashboard has the recording, or when the
 * contributor discards it.
 *
 * Note on step 1: an upload whose answer was lost (timeout mid-flight) is sent again on the next
 * attempt. Sayari may then hold two copies of the same file; both carry the same `source_sha256`
 * field, and the dashboard stores the recording once.
 */

import { applyDecision, decideSubmit, decideUploadFailure, dueItems, nextWake, STOP_RUN_CODES, type Decision, type OutboxItem, type OutboxSummary } from "./outbox-logic";

const MINUTE = 60_000;
import type { CampaignResult, RecordingMetadata } from "./types";

export type OutboxStore = {
  all(): Promise<OutboxItem[]>;
  get(id: string): Promise<OutboxItem | undefined>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
};

export type OutboxEvent =
  | { type: "sent"; item: OutboxSummary; duplicate: boolean }
  | { type: "rejected"; item: OutboxSummary; reason: string }
  | { type: "superseded"; item: OutboxSummary }
  | { type: "failed"; item: OutboxSummary; code: string }
  | { type: "dropped"; item: OutboxSummary; code: string }
  | { type: "held"; item: OutboxSummary; code: string };

export type OutboxDeps = {
  store: OutboxStore;
  /** Send the audio. `onProgress` reports bytes sent so far; `signal` aborts it. */
  upload: (item: OutboxItem, onProgress: (sent: number, total: number) => void, signal: AbortSignal) => Promise<{ recordingId: string | null }>;
  submit: (missionId: string, metadata: RecordingMetadata) => Promise<CampaignResult<{ duplicate: boolean }>>;
  online: () => boolean;
  /** What the saved campaign card says before an upload: a submit code to hold or drop the take, or null (precheckFromCard). */
  precheck?: (item: OutboxItem) => string | null;
  now?: () => number;
  /** Serialise runs across tabs when the browser can. */
  withLock?: (run: () => Promise<void>) => Promise<void>;
};

/** An error from `upload` that carries an HTTP status (AudioUploadError has this shape). */
type UploadErrorLike = { status?: number; isNetwork?: boolean };

/** How far the take being sent has gone (bytes of the request body). */
export type OutboxProgress = { id: string; sent: number; total: number };

/** A decision after which the next take would fail the same way (the network is gone or too weak). */
const stopsRun = (d: Decision) => d.kind === "retry" && STOP_RUN_CODES.has(d.code);

const summary = (item: OutboxItem): OutboxSummary => {
  const { blob, ...rest } = item;
  return { ...rest, bytes: blob?.size ?? 0 };
};

export function createOutbox(deps: OutboxDeps) {
  const now = deps.now ?? Date.now;
  let items: OutboxSummary[] = [];
  let loaded = false;
  let running: Promise<void> | null = null;
  let again = false;
  /** The take being sent right now (for a "sending…" state). */
  let activeId: string | null = null;
  let progress: OutboxProgress | null = null;
  /** The upload going now, so a withdrawal or a delete can stop it. */
  let inflight: { id: string; campaignId: string; ctrl: AbortController } | null = null;
  /** Campaigns whose takes must not be sent (a consent withdrawal in progress). */
  const blocked = new Set<string>();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(e: OutboxEvent) => void>();
  let snapshot: { items: OutboxSummary[]; activeId: string | null; loaded: boolean; progress: OutboxProgress | null } = { items, activeId, loaded, progress };

  const notify = () => {
    snapshot = { items, activeId, loaded, progress };
    for (const l of [...listeners]) l();
  };
  /** Progress events come many times a second: tell the screens only when the whole percent changes. */
  const onProgress = (id: string) => (sent: number, total: number) => {
    const pct = (b: number, t: number) => (t > 0 ? Math.floor((100 * b) / t) : 0);
    if (progress && progress.id === id && pct(progress.sent, progress.total) === pct(sent, total)) return;
    progress = { id, sent, total };
    notify();
  };
  const emit = (e: OutboxEvent) => {
    for (const l of [...eventListeners]) l(e);
  };

  async function refresh() {
    try {
      items = (await deps.store.all()).map(summary);
    } catch {
      // storage unavailable: keep the last known list
    }
    loaded = true;
    notify();
  }

  async function settle(item: OutboxItem, d: Decision) {
    const next = applyDecision(item, d, now());
    if (next) await deps.store.put(next);
    else await deps.store.remove(item.id);
    const s = summary(next ?? item);
    if (d.kind === "done") emit({ type: "sent", item: s, duplicate: Boolean(d.duplicate) });
    else if (d.kind === "rejected") emit({ type: "rejected", item: s, reason: d.reason });
    else if (d.kind === "superseded") emit({ type: "superseded", item: s });
    else if (d.kind === "fail") emit({ type: "failed", item: s, code: d.code });
    else if (d.kind === "hold") emit({ type: "held", item: s, code: d.code });
    else if (d.kind === "drop") emit({ type: "dropped", item: s, code: d.code });
  }

  /** The item is still to be sent: not deleted meanwhile, its campaign not blocked. */
  async function stillWanted(item: OutboxItem): Promise<boolean> {
    if (blocked.has(item.campaignId)) return false;
    try {
      return Boolean(await deps.store.get(item.id));
    } catch {
      return false;
    }
  }

  /**
   * Send one take as far as it can go. Returns false when the network is gone or failing (stop
   * the run): trying the next take on the same weak link would only spend more of the speaker's data.
   */
  async function sendOne(item: OutboxItem): Promise<boolean> {
    let current = item;
    if (!current.uploaded) {
      if (!deps.online()) return false;
      const pre = deps.precheck?.(current) ?? null;
      if (pre) {
        // Hold for the card's reason (a withdrawn consent is never uploaded; see precheckFromCard).
        await settle(current, { kind: "hold", code: pre, delayMs: 10 * MINUTE });
        return true;
      }
      const ctrl = new AbortController();
      inflight = { id: current.id, campaignId: current.campaignId, ctrl };
      try {
        const res = await deps.upload(current, onProgress(current.id), ctrl.signal);
        inflight = null;
        // Deleted or withdrawn while it was going: do not write it back.
        if (!(await stillWanted(current))) return true;
        current = { ...current, uploaded: true, sayariId: res.recordingId, metadata: { ...current.metadata, ...(res.recordingId ? { sayari_recording_id: res.recordingId } : {}) } };
        await deps.store.put(current);
      } catch (e) {
        inflight = null;
        if (ctrl.signal.aborted) return true;
        // The network went away during the upload: leave the take as it was (no attempt counted,
        // nothing written) and stop; the runner wakes when the network is back (APP-006).
        if (!deps.online()) return false;
        const err = (e ?? {}) as UploadErrorLike;
        const d = decideUploadFailure({ status: err.status ?? 0, isNetwork: Boolean(err.isNetwork) }, current.attempts, deps.online());
        await settle(current, d);
        return !stopsRun(d);
      }
    }
    // Offline: the submit cannot go either. Untouched, as above.
    if (!deps.online()) return false;
    let res: CampaignResult<{ duplicate: boolean }>;
    try {
      res = await deps.submit(current.missionId, current.metadata);
    } catch {
      res = { ok: false, status: 0, code: "network", message: "" };
    }
    const d = decideSubmit(res.ok ? { ok: true, duplicate: res.data.duplicate } : res, current.attempts);
    if (d.kind === "retry" && d.code === "offline") return false;
    await settle(current, d);
    return !stopsRun(d);
  }

  async function runOnce(userId: string) {
    // Offline: nothing can go, so do not even look (no "Sending…" flash, no storage traffic).
    if (!deps.online()) return;
    let all: OutboxItem[];
    try {
      all = await deps.store.all();
    } catch {
      return;
    }
    for (const listed of dueItems(all, userId, now())) {
      // Read it again: it may have been deleted, sent by another tab or changed since the list was read.
      const item = blocked.has(listed.campaignId) ? undefined : await deps.store.get(listed.id).catch(() => undefined);
      if (!item || item.state === "failed" || item.nextAttemptAt > now()) continue;
      activeId = item.id;
      notify();
      const keepGoing = await sendOne(item);
      activeId = null;
      progress = null;
      await refresh();
      if (!keepGoing) break;
    }
  }

  /** Send what is due for `userId`. Calls made while a run is going schedule one more pass. */
  function drain(userId: string): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    const lock = deps.withLock ?? ((run) => run());
    running = (async () => {
      do {
        again = false;
        await lock(() => runOnce(userId));
      } while (again);
    })().finally(() => {
      running = null;
      activeId = null;
      progress = null;
      notify();
    });
    return running;
  }

  return {
    /** Load the list from storage (call once on start). */
    refresh,
    drain,
    async add(item: OutboxItem) {
      await deps.store.put(item);
      await refresh();
    },
    /** Drop a take (the contributor discards it, or records the mission again). Stops its upload if it is going. */
    async discard(id: string) {
      // No lock needed: the runner re-reads a take before sending it and never writes back one
      // that disappeared during its upload.
      if (inflight?.id === id) inflight.ctrl.abort();
      await deps.store.remove(id);
      await refresh();
    },
    /** Stop sending a campaign's takes at once (the upload going now is aborted), until `unblock`. */
    block(campaignId: string) {
      blocked.add(campaignId);
      if (inflight?.campaignId === campaignId) inflight.ctrl.abort();
    },
    unblock(campaignId: string) {
      blocked.delete(campaignId);
    },
    /** Takes of a campaign on the phone for this user. */
    async countCampaign(userId: string, campaignId: string) {
      const all = await deps.store.all().catch(() => [] as OutboxItem[]);
      return all.filter((i) => i.userId === userId && i.campaignId === campaignId).length;
    },
    /**
     * Delete every take of a campaign for this user (consent withdrawn, APP-004): the one being
     * uploaded is aborted, none is sent afterwards. Returns how many were deleted.
     */
    async discardCampaign(userId: string, campaignId: string): Promise<number> {
      blocked.add(campaignId);
      if (inflight?.campaignId === campaignId) inflight.ctrl.abort();
      try {
        const all = await deps.store.all();
        const mine = all.filter((i) => i.userId === userId && i.campaignId === campaignId);
        for (const i of mine) await deps.store.remove(i.id);
        return mine.length;
      } finally {
        // The runner re-reads each take before sending it, so nothing deleted comes back.
        blocked.delete(campaignId);
        await refresh();
      }
    },
    /**
     * Make held and waiting takes due now (a manual "send now"). Runs under the cross-tab lock and
     * re-reads each take before writing it, so a take another run just uploaded or sent is never
     * reset or brought back (APP-019).
     */
    async retryNow(userId: string) {
      const lock = deps.withLock ?? ((run) => run());
      await lock(async () => {
        const all = await deps.store.all();
        for (const listed of all) {
          if (listed.userId !== userId || listed.state === "failed") continue;
          const i = await deps.store.get(listed.id);
          if (i && i.state !== "failed") await deps.store.put({ ...i, nextAttemptAt: 0, state: "pending" });
        }
      });
      await refresh();
      return drain(userId);
    },
    nextWake: (userId: string) => nextWake(items, userId),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onEvent(fn: (e: OutboxEvent) => void) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    snapshot: () => snapshot,
    isRunning: () => running !== null,
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
