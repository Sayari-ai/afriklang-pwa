"use client";

/**
 * Are the takes waiting on this phone safe from the browser clearing its storage (APP-007)?
 *
 * Takes waiting to be sent are the only copy of the audio. A browser may delete a site's storage
 * as a whole under storage pressure (Chrome, unless the storage is "persistent": granted to
 * installed or much-used sites) or after 7 days without a visit (Safari, unless added to the Home
 * Screen). The app asks for persistent storage once signed in, remembers the answer, and the
 * screens say so when takes wait unprotected; it also checks the free space before saving a take.
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
/** null: not known yet (or the browser has no Storage API). */
let persisted: boolean | null = null;
let asked = false;

/** Ask once per app start; the browser remembers a grant. Never throws. */
export async function askPersistentStorage(): Promise<boolean | null> {
  if (asked || typeof navigator === "undefined" || !navigator.storage) return persisted;
  asked = true;
  try {
    persisted = (await navigator.storage.persisted?.()) ?? null;
    if (!persisted && navigator.storage.persist) persisted = await navigator.storage.persist();
  } catch {
    persisted = null;
  }
  for (const l of [...listeners]) l();
  return persisted;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** true: protected; false: the browser may delete it; null: unknown. */
export const usePersistentStorage = () => useSyncExternalStore(subscribe, () => persisted, () => null);

/** Below this, the speaker is told to free space (a take is up to ~20 MB; the phone needs room too). */
export const LOW_SPACE_BYTES = 50 * 1024 * 1024;

/** Space the site may still use, in bytes, or null when the browser does not say. */
export async function freeSpaceBytes(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || typeof e.quota !== "number" || typeof e.usage !== "number") return null;
    return Math.max(0, e.quota - e.usage);
  } catch {
    return null;
  }
}
