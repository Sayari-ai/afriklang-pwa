"use client";

/**
 * Offline progress-write queue (IndexedDB).
 *
 * `usePathRepo.completeLevel()` writes two progress rows to the
 * backend per completion: the level itself (status `completed`) and
 * the next-locked level (status `current`). When either call fails
 * with a network error (i.e. the device is offline / dyno asleep /
 * CORS preflight blocked), we:
 *
 *   1. Apply the change *locally* anyway, so the user sees the
 *      celebration screen and the home map updates immediately
 *      (optimistic commit).
 *   2. Persist a record of the missing backend write here, so the
 *      runner can replay it once connectivity returns.
 *
 * Why a separate store from the audio-upload queue?
 *   - Different payload shape (no Blob).
 *   - Different ordering semantics: progress writes are per-device
 *     ordered (FIFO is mandatory — `completed` must reach the backend
 *     before the dependent `current` promotion). Audio uploads are
 *     independent and can drain out-of-order if needed.
 *   - Different drop-handling: dropping a queued audio loses one
 *     recording; dropping a queued progress write means the local
 *     cache gets ahead of the backend, which `boot({ forceRefresh })`
 *     will eventually reconcile from the server side.
 *
 * Storage shape: a single per-item key in IDB (via idb-keyval), with a
 * monotonic `seq` field that the drainer uses to enforce FIFO order
 * across all items — even when keys are removed in the middle.
 */

import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";

import { type LevelProgressStatus } from "@/lib/content/models";
import { StorageKeys } from "@/lib/storage-keys";

const DB_NAME = "afriklang.progress";
const STORE_NAME = StorageKeys.progressQueueStore;

// Why a *separate* IndexedDB database from the audio upload queue?
// `idb-keyval`'s `createStore(db, store)` opens the database at
// version 1 with exactly that one store — there's no migration path
// to add a second store later. If both queues shared the
// `"afriklang"` database, whichever runner booted first would lock
// the schema to its own store, and the other's `transaction()` calls
// would throw `NotFoundError: One of the specified object stores was
// not found.` Giving each queue its own DB sidesteps the entire
// problem at the cost of one extra IDB connection per session, which
// is cheap.

let cachedStore: UseStore | null = null;
function store(): UseStore {
  if (cachedStore == null) {
    cachedStore = createStore(DB_NAME, STORE_NAME);
  }
  return cachedStore;
}

/**
 * Persisted record of a single `progress_set` call that needs to be
 * replayed against the backend. The `seq` field is a monotonic
 * sequence number assigned at enqueue time so the drainer can iterate
 * in strict insertion order — `Date.now()` collisions are possible
 * when two writes are enqueued in the same tick (the `complete` +
 * `promote-next-locked` pair always lands inside one synchronous
 * block), so we add a per-process counter on top.
 *
 * Schema v2 adds a mandatory `cycle` field (multi-cycle support). v1
 * rows from before the upgrade are tolerated on read: they're
 * up-converted in-place to `cycle = 1` (the only legal value at the
 * time v1 was written, since the multi-cycle backend hadn't shipped
 * yet). We deliberately do NOT do an eager IDB-wide migration on
 * boot — the queue is short-lived (anything older than a few days
 * gets snapped on the 5-attempt cap) and rewriting on read keeps the
 * code path single-purpose.
 */
export interface QueuedProgressWrite {
  v: 2;
  /** Stable id (= `${seq}-${cycle}-${levelId}-${status}`). Doubles as the IDB key. */
  id: string;
  /** Monotonic FIFO sequence. */
  seq: number;
  cycle: number;
  levelId: number;
  status: LevelProgressStatus;
  /** ms epoch when the write was enqueued. Diagnostics only. */
  enqueuedAt: number;
  /** Replay attempts already made. */
  attempts: number;
}

let seqCounter = Date.now();
function nextSeq(): number {
  // Start from `Date.now()` so seqs stay roughly time-ordered across
  // sessions, but always strictly-monotonic within one tab.
  seqCounter += 1;
  return seqCounter;
}

/**
 * Append a progress write to the queue. Returns the assigned id so
 * the caller can correlate it with UI state if needed.
 *
 * Each call gets a fresh seq; even two writes that share the same
 * `(cycle, levelId, status)` (e.g. retrying the same completion)
 * become distinct queue entries. That's deliberate — the backend's
 * `progress_set` is idempotent on the level row, so a duplicate
 * replay just rewrites the same final state.
 */
export async function enqueueProgressWrite(args: {
  cycle: number;
  levelId: number;
  status: LevelProgressStatus;
}): Promise<string> {
  const seq = nextSeq();
  const item: QueuedProgressWrite = {
    v: 2,
    id: `${seq}-${args.cycle}-${args.levelId}-${args.status}`,
    seq,
    cycle: args.cycle,
    levelId: args.levelId,
    status: args.status,
    enqueuedAt: Date.now(),
    attempts: 0,
  };
  await set(item.id, item, store());
  return item.id;
}

/**
 * Snapshot of the queue, oldest-first by `seq`. The runner pulls one
 * item at a time and uses {@link removeProgressWrite} on success.
 * Malformed rows are silently filtered so a single corrupt record
 * can't deadlock the drain.
 */
export async function listProgressQueued(): Promise<QueuedProgressWrite[]> {
  const rows = await entries<string, unknown>(store());
  const out: QueuedProgressWrite[] = [];
  for (const [, value] of rows) {
    if (isQueuedProgressWrite(value)) out.push(upgradeIfNeeded(value));
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

/** Cheap "is the queue empty?" check used by `boot()`. Avoids loading every record. */
export async function hasPendingProgressWrites(): Promise<boolean> {
  const rows = await entries<string, unknown>(store());
  for (const [, value] of rows) {
    if (isQueuedProgressWrite(value)) return true;
  }
  return false;
}

export async function getProgressQueued(
  id: string,
): Promise<QueuedProgressWrite | null> {
  const v = await get<unknown>(id, store());
  return isQueuedProgressWrite(v) ? upgradeIfNeeded(v) : null;
}

export async function removeProgressWrite(id: string): Promise<void> {
  await del(id, store());
}

/**
 * Bump the attempt counter for a queued write. Used by the runner to
 * decide when to give up. Returns the new attempt count, or
 * `+Infinity` if the row no longer exists (concurrent removal).
 *
 * Reads the raw on-disk row (NOT the upgraded view) so that a v1 row
 * stays a v1 row on disk after a bump. Rewriting it as v2 would
 * change the schema in place without going through `enqueue`, which
 * is a footgun if we ever ship a v3 — keep the upgrade surface
 * exclusively at the read boundary.
 */
export async function bumpProgressAttempts(id: string): Promise<number> {
  const raw = await get<unknown>(id, store());
  if (!isQueuedProgressWrite(raw)) return Number.POSITIVE_INFINITY;
  const next = { ...(raw as object), attempts: ((raw as { attempts: number }).attempts ?? 0) + 1 } as QueuedProgressWrite;
  await set(id, next, store());
  return next.attempts;
}

function isQueuedProgressWrite(v: unknown): v is QueuedProgressWrite {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  // Accept both v1 (pre-multi-cycle) and v2 rows. v1 rows lack
  // `cycle`; the upgrader below stamps cycle=1 before handing the
  // row out, since v1 was only ever written before multi-cycle
  // shipped (so cycle=1 is by construction the only legal value).
  const versionOk = o.v === 1 || o.v === 2;
  return (
    versionOk &&
    typeof o.id === "string" &&
    typeof o.seq === "number" &&
    typeof o.levelId === "number" &&
    typeof o.status === "string" &&
    typeof o.enqueuedAt === "number" &&
    typeof o.attempts === "number" &&
    (o.v === 2 ? typeof o.cycle === "number" : true)
  );
}

/**
 * Up-convert a v1 row to v2 in-memory. NOT persisted — we leave the
 * legacy row on disk and let the runner drop it on success or on
 * `MAX_REPLAY_ATTEMPTS`. Persisting a converted copy would change the
 * id (which encodes cycle), breaking the runner's `removeProgressWrite`
 * call. The legacy id is preserved as-is.
 */
function upgradeIfNeeded(row: QueuedProgressWrite): QueuedProgressWrite {
  if (row.v === 2) return row;
  const r = row as unknown as {
    id: string;
    seq: number;
    levelId: number;
    status: LevelProgressStatus;
    enqueuedAt: number;
    attempts: number;
  };
  return {
    v: 2,
    id: r.id,
    seq: r.seq,
    cycle: 1,
    levelId: r.levelId,
    status: r.status,
    enqueuedAt: r.enqueuedAt,
    attempts: r.attempts,
  };
}
