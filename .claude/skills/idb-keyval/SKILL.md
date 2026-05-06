---
name: idb-keyval
description: Tiny promise-based IndexedDB key-value store. USE FOR: persisting structured-clonable data (objects, blobs, numbers, dates) across sessions, custom IndexedDB stores per database, batch get/set/del, atomic update() with auto-queueing, the offline progress-write queue and audio-upload queue in this project. DO NOT USE FOR: complex querying, indexes, cursors, multi-store schemas (use the `idb` package instead), localStorage-style synchronous reads, ephemeral state (use Zustand or React state).
---

# idb-keyval@^6.2.2

## When to use

`idb-keyval` is the project's persistence layer for **offline mutation queues**. Two queues use it:

- **Progress-write queue** (`src/lib/storage/progress-queue.ts`) — replays failed `progress_set` Edge Function calls in strict FIFO order once connectivity returns.
- **Audio-upload queue** (sibling pattern in `src/lib/storage/`) — replays failed Sayari WAV uploads.

Each queue runs in its **own IndexedDB database** (NOT just a separate object store) for a specific reason — see Gotchas.

Reach for `idb-keyval` when you need:
- Promise-based key/value persistence in the browser
- Storing `Blob`, `ArrayBuffer`, `Date`, plain objects (anything structured-clonable)
- Atomic read-modify-write via `update()`
- A per-feature isolated store

Don't use it for:
- Cross-tab synchronous reads (use `localStorage` — but note IDB events fire across tabs)
- Queries / indexes / range scans (use `idb` ~1 KB heavier)
- Trivial flags that fit in `localStorage`
- React component state

## API reference

All functions return `Promise`. All accept an optional final `store: UseStore` argument; without it, the default store (`keyval-store` DB / `keyval` object store) is used.

### `set(key, value, store?): Promise<void>`

```ts
import { set } from "idb-keyval";
await set("hello", "world");
await set(123, { foo: "bar", blob: someBlob });
```

Keys may be `string | number | Date | (typed) array of those`. Values may be anything [structured-clonable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) — objects, arrays, `Blob`, `File`, `ArrayBuffer`, `Date`, `Map`, `Set`. **Not** functions, DOM nodes, or class instances with prototype.

### `get<T>(key, store?): Promise<T | undefined>`

```ts
const value = await get<string>("hello");
// value is `string | undefined` — `undefined` when missing
```

### `del(key, store?): Promise<void>`

```ts
await del("hello");
```

### `clear(store?): Promise<void>`

Wipe the entire store.

### `keys<K>(store?): Promise<K[]>`

```ts
const allKeys = await keys<string>(); // [123, "hello", ...]
```

### `values<V>(store?): Promise<V[]>`

### `entries<K, V>(store?): Promise<[K, V][]>`

```ts
const rows = await entries<string, QueuedProgressWrite>(store());
for (const [key, value] of rows) { /* ... */ }
```

Used by `listProgressQueued()` in `src/lib/storage/progress-queue.ts:138-146`.

### `setMany(entries, store?): Promise<void>`

Atomic batch set. Faster than `Promise.all([set(...), set(...)])` because it uses a single transaction.

```ts
await setMany([[123, 456], ["hello", "world"]]);
```

If one entry fails (e.g. quota), **none** are committed.

### `getMany<T>(keys, store?): Promise<T[]>`

```ts
const [a, b] = await getMany(["hello", 123]);
```

### `delMany(keys, store?): Promise<void>`

Atomic batch delete.

### `update<T>(key, updater, store?): Promise<void>`

Read-modify-write inside a single transaction. Critical for counters and lists where two callers might race:

```ts
import { update } from "idb-keyval";
await update("counter", (val) => (val ?? 0) + 1);
```

Without `update()`, two concurrent `get()`/`set()` pairs both see `undefined`, both write `1`, and you've lost an increment.

### `createStore(dbName, storeName): UseStore`

Open a custom IndexedDB database + object store. Returns a `UseStore` to pass as the trailing argument of every other call.

```ts
import { createStore, set, get, type UseStore } from "idb-keyval";

let cached: UseStore | null = null;
function store(): UseStore {
  if (cached == null) cached = createStore("afriklang.progress", "queue");
  return cached;
}

await set("k", "v", store());
```

This is the pattern used at `src/lib/storage/progress-queue.ts:53-59`.

### `promisifyRequest`, `getDefaultStore` (advanced, rarely needed)

Internal helpers exported for users wrapping IDB requests directly.

## Common patterns (project-specific)

### Per-feature isolated database

```ts
// src/lib/storage/progress-queue.ts:39-59
const DB_NAME = "afriklang.progress";
const STORE_NAME = StorageKeys.progressQueueStore;

let cachedStore: UseStore | null = null;
function store(): UseStore {
  if (cachedStore == null) cachedStore = createStore(DB_NAME, STORE_NAME);
  return cachedStore;
}
```

The store is lazy because `createStore` opens an IDB connection — defer until first use to avoid unnecessary connections in code paths that never queue.

### Append-only queue with monotonic seq

```ts
// src/lib/storage/progress-queue.ts:94-130
let seqCounter = Date.now();
function nextSeq(): number {
  seqCounter += 1;       // strictly monotonic within the tab
  return seqCounter;
}

export async function enqueueProgressWrite(args: { ... }) {
  const seq = nextSeq();
  const item: QueuedProgressWrite = {
    v: 2,
    id: `${seq}-${args.cycle}-${args.levelId}-${args.status}`,
    seq,
    /* ... */
  };
  await set(item.id, item, store());  // id doubles as the IDB key
  return item.id;
}
```

`Date.now()` collides when two writes happen in the same tick (the `complete` + `current` pair from `completeLevel()` always do), hence the per-process counter on top.

### FIFO drain

```ts
// src/lib/storage/progress-queue.ts:138-146
export async function listProgressQueued(): Promise<QueuedProgressWrite[]> {
  const rows = await entries<string, unknown>(store());
  const out: QueuedProgressWrite[] = [];
  for (const [, value] of rows) {
    if (isQueuedProgressWrite(value)) out.push(upgradeIfNeeded(value));
  }
  out.sort((a, b) => a.seq - b.seq);   // entries() order is NOT guaranteed
  return out;
}
```

Note `entries()` does not guarantee insertion order across all browsers — sort by `seq` explicitly.

### Schema versioning at the read boundary

```ts
// src/lib/storage/progress-queue.ts:214-233
function upgradeIfNeeded(row: QueuedProgressWrite): QueuedProgressWrite {
  if (row.v === 2) return row;
  // up-convert v1 → v2 in-memory; do NOT persist (id encodes cycle)
  return { v: 2, /* ... */, cycle: 1, /* ... */ };
}
```

`idb-keyval` has no schema migrations of its own. Version your records with a `v` field and up-convert on read. Avoid eager IDB-wide migrations on boot — short-lived rows age out naturally.

### Error handling

Failures (quota exceeded, IDB unavailable in private mode on old Safari, transaction abort) reject the returned promise:

```ts
try {
  await set(id, item, store());
} catch (err) {
  // QuotaExceededError, InvalidStateError, etc.
  console.warn("queue persist failed", err);
}
```

The project's queues swallow `enqueue` failures softly — losing a queued progress write means the local cache gets ahead of the backend, which `boot({ forceRefresh })` reconciles eventually.

## Gotchas

- **Two queues = two databases, not two stores.** `createStore(db, store)` opens at IDB version 1 with exactly that one object store — there is **no migration path** to add another store later. Sharing one DB between progress + audio queues caused `NotFoundError: One of the specified object stores was not found.` See the rationale comment at `src/lib/storage/progress-queue.ts:42-51`.
- **Functions cannot be stored.** Structured-clone rejects them. Strip before persist.
- **Class instances lose their prototype.** What goes in is a plain object on the way out. Re-hydrate via type guards (see `isQueuedProgressWrite()` at `src/lib/storage/progress-queue.ts:187-205`).
- **`get()` returns `undefined` for missing keys, not `null`.** Don't `=== null`.
- **Old Edge can't store `null` as a value.** Wrap or use `undefined`.
- **Private mode browsers** (especially older Safari) may throw `InvalidStateError` on IDB open. Wrap top-level callers in try/catch.
- **`entries()` order is not guaranteed.** Sort explicitly.
- **`update()` is the only atomic read-modify-write.** Don't simulate it with `get` + `set`.
- **Storage quota is shared per origin.** No per-DB limit. Eviction order under pressure: best-effort LRU.
- **No cross-tab notifications.** A second tab's writes are visible only on next read. Use `BroadcastChannel` if you need eventing.
- **Tree-shakeable** — import only what you use; ~295 B brotli'd for `get`+`set` only.

## References

- Local: `node_modules/idb-keyval/README.md`
- Custom stores doc: `node_modules/idb-keyval/custom-stores.md`
- Project usage: `src/lib/storage/progress-queue.ts`, `src/lib/storage/progress-queue-runner.ts`
- Storage keys constants: `src/lib/storage-keys.ts`
- Upstream: https://github.com/jakearchibald/idb-keyval#readme
- Heavier alternative for indexes/cursors: https://www.npmjs.com/package/idb
