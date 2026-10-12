/**
 * A small stale-while-revalidate cache for the campaign bridge's reads.
 *
 *  - One request per key at a time: screens that need the same data share the call.
 *  - Answers are kept on the device (localStorage, per signed-in user), so a screen paints
 *    at once from the last answer and still works offline; a fresh copy is fetched behind it.
 *  - A copy younger than FRESH_MS is not fetched again (navigating back and forth is free).
 *  - A failed refresh keeps the last good data and reports the failure next to it.
 *
 * Framework-free on purpose (tested in node); the React hooks live in hooks.ts.
 */

import type { CampaignFailure, CampaignResult } from "./types";

export const FRESH_MS = 20_000;
const PERSIST_PREFIX = "afriklang.campaign.cache.v1:";

export type Entry<T = unknown> = {
  data: T | null;
  /** When `data` was fetched (ms since epoch); 0 when there is none. */
  at: number;
  /** The last refresh's failure, while it is the most recent outcome. */
  failure: CampaignFailure | null;
  refreshing: boolean;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const EMPTY: Entry = Object.freeze({ data: null, at: 0, failure: null, refreshing: false }) as Entry;

export function createCache(opts: { storage?: () => Store | null; now?: () => number } = {}) {
  const storage = opts.storage ?? defaultStorage;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let version = 0;

  const notify = () => {
    version++;
    for (const l of [...listeners]) l();
  };

  /** The entry for `scope|key`, loading the saved copy the first time it is asked for. */
  function read<T>(id: string): Entry<T> {
    const hit = entries.get(id);
    if (hit) return hit as Entry<T>;
    let loaded: Entry = EMPTY;
    try {
      const raw = storage()?.getItem(PERSIST_PREFIX + id);
      if (raw) {
        const saved = JSON.parse(raw) as { data: unknown; at: number };
        // A copy from an earlier visit is shown at once but always refreshed (at: 0 is never fresh).
        if (saved && typeof saved.at === "number" && saved.data != null) loaded = { data: saved.data, at: 0, failure: null, refreshing: false };
      }
    } catch {
      // unreadable copy: start empty
    }
    entries.set(id, loaded);
    return loaded as Entry<T>;
  }

  function write(id: string, next: Entry, persist: boolean) {
    entries.set(id, next);
    if (persist) {
      try {
        if (next.data == null) storage()?.removeItem(PERSIST_PREFIX + id);
        else storage()?.setItem(PERSIST_PREFIX + id, JSON.stringify({ data: next.data, at: next.at }));
      } catch {
        // quota or privacy mode: memory only
      }
    }
    notify();
  }

  /**
   * Fetch `id` unless a fresh copy exists or a fetch is already running (then wait for that one).
   * `force` skips the freshness check (a deliberate reload, or after a write).
   */
  function load<T>(id: string, loader: () => Promise<CampaignResult<T>>, force = false): Promise<void> {
    const running = inflight.get(id);
    if (running) return running;
    const current = read<T>(id);
    if (!force && current.data != null && now() - current.at < FRESH_MS && !current.failure) return Promise.resolve();
    write(id, { ...current, refreshing: true }, false);
    const p = loader()
      .then(
        (res) => {
          const before = read<T>(id);
          if (res.ok) write(id, { data: res.data, at: now(), failure: null, refreshing: false }, true);
          else write(id, { ...before, failure: res, refreshing: false }, false);
        },
        () => {
          const before = read<T>(id);
          write(id, { ...before, failure: { ok: false, status: 0, code: "unknown", message: "" }, refreshing: false }, false);
        },
      )
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  /** Change the cached data in place (an optimistic update). No-op when nothing is cached. */
  function update<T>(id: string, fn: (data: T) => T) {
    const current = read<T>(id);
    if (current.data == null) return;
    write(id, { ...current, data: fn(current.data) }, true);
  }

  /** Seed or replace the data (a write that returned the new state). */
  function put<T>(id: string, data: T) {
    write(id, { data, at: now(), failure: null, refreshing: false }, true);
  }

  /** Mark data as old so the next load fetches it, without dropping what is shown. */
  function invalidate(prefix: string) {
    for (const [id, e] of entries) if (id.startsWith(prefix)) entries.set(id, { ...e, at: 0 });
    notify();
  }

  /** Forget everything, in memory and on the device (sign-out). */
  function clear() {
    entries.clear();
    try {
      const s = storage();
      if (s) {
        const doomed: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k?.startsWith(PERSIST_PREFIX)) doomed.push(k);
        }
        doomed.forEach((k) => s.removeItem(k));
      }
    } catch {
      // nothing more to do
    }
    notify();
  }

  return {
    read,
    load,
    update,
    put,
    invalidate,
    clear,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    version: () => version,
  };
}

function defaultStorage(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export type CampaignCache = ReturnType<typeof createCache>;

/** The app's one cache. */
export const campaignCache = createCache();

/** Cache ids are scoped by the signed-in user so two accounts on one phone never see each other's data. */
export const cacheId = (userId: string, key: string) => `${userId}|${key}`;
