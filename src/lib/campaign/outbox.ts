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

import { applyDecision, decideSubmit, decideUploadFailure, dueItems, nextWake, type Decision, type OutboxItem, type OutboxSummary } from "./outbox-logic";
import type { CampaignResult, RecordingMetadata } from "./types";

export type OutboxStore = {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
};

export type OutboxEvent =
  | { type: "sent"; item: OutboxSummary; duplicate: boolean }
  | { type: "rejected"; item: OutboxSummary; reason: string }
  | { type: "superseded"; item: OutboxSummary }
  | { type: "failed"; item: OutboxSummary; code: string }
  | { type: "held"; item: OutboxSummary; code: string };

export type OutboxDeps = {
  store: OutboxStore;
  upload: (item: OutboxItem) => Promise<{ recordingId: string | null }>;
  submit: (missionId: string, metadata: RecordingMetadata) => Promise<CampaignResult<{ duplicate: boolean }>>;
  online: () => boolean;
  now?: () => number;
  /** Serialise runs across tabs when the browser can. */
  withLock?: (run: () => Promise<void>) => Promise<void>;
};

/** An error from `upload` that carries an HTTP status (AudioUploadError has this shape). */
type UploadErrorLike = { status?: number; isNetwork?: boolean };

const summary = ({ blob: _blob, ...rest }: OutboxItem): OutboxSummary => rest;

export function createOutbox(deps: OutboxDeps) {
  const now = deps.now ?? Date.now;
  let items: OutboxSummary[] = [];
  let loaded = false;
  let running: Promise<void> | null = null;
  let again = false;
  /** The take being sent right now (for a "sending…" state). */
  let activeId: string | null = null;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(e: OutboxEvent) => void>();
  let snapshot: { items: OutboxSummary[]; activeId: string | null; loaded: boolean } = { items, activeId, loaded };

  const notify = () => {
    snapshot = { items, activeId, loaded };
    for (const l of [...listeners]) l();
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
  }

  /** Send one take as far as it can go. Returns false when the network is gone (stop the run). */
  async function sendOne(item: OutboxItem): Promise<boolean> {
    let current = item;
    if (!current.uploaded) {
      if (!deps.online()) return false;
      try {
        const res = await deps.upload(current);
        current = { ...current, uploaded: true, sayariId: res.recordingId, metadata: { ...current.metadata, ...(res.recordingId ? { sayari_recording_id: res.recordingId } : {}) } };
        await deps.store.put(current);
      } catch (e) {
        const err = (e ?? {}) as UploadErrorLike;
        const d = decideUploadFailure({ status: err.status ?? 0, isNetwork: Boolean(err.isNetwork) }, current.attempts, deps.online());
        await settle(current, d);
        return d.kind !== "retry" || d.code !== "offline";
      }
    }
    let res: CampaignResult<{ duplicate: boolean }>;
    try {
      res = await deps.submit(current.missionId, current.metadata);
    } catch {
      res = { ok: false, status: 0, code: "network", message: "" };
    }
    const d = decideSubmit(res.ok ? { ok: true, duplicate: res.data.duplicate } : res, current.attempts);
    await settle(current, d);
    return !(d.kind === "retry" && d.code === "offline");
  }

  async function runOnce(userId: string) {
    let all: OutboxItem[];
    try {
      all = await deps.store.all();
    } catch {
      return;
    }
    for (const item of dueItems(all, userId, now())) {
      activeId = item.id;
      notify();
      const keepGoing = await sendOne(item);
      activeId = null;
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
    /** Drop a take (the contributor discards it, or records the mission again). */
    async discard(id: string) {
      await deps.store.remove(id);
      await refresh();
    },
    /** Make held and failed-by-network takes due now (a manual "send now"). */
    async retryNow(userId: string) {
      const all = await deps.store.all();
      await Promise.all(all.filter((i) => i.userId === userId && i.state !== "failed").map((i) => deps.store.put({ ...i, nextAttemptAt: 0, state: "pending" })));
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
