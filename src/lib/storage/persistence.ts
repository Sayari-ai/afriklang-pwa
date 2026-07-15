"use client";

/**
 * Durable-storage request (Phase 1 of the retention roadmap).
 *
 * Why this exists: the app's entire identity is a localStorage UUID
 * plus localStorage/IndexedDB caches (see `device-identity.ts` —
 * "clearing site data == new user"). Browsers treat that storage as
 * *best-effort* by default:
 *
 *   * Safari's ITP evicts all script-writable storage after ~7 days
 *     without interaction for non-installed websites — a lapsed iOS
 *     user who comes back on day 8 silently loses ALL progress.
 *   * Chromium may evict best-effort storage under disk pressure,
 *     LRU-first — again hitting exactly the lapsed users a retention
 *     strategy tries to win back.
 *
 * `navigator.storage.persist()` upgrades the origin's storage bucket
 * from "best-effort" to "persistent". Chromium grants it silently
 * based on engagement heuristics (or always when installed); Firefox
 * may show a permission prompt; Safari ignores the API for tab
 * browsing (its durable path is A2HS install — which is what the
 * Phase-1 install prompt is for) but the call is harmless there.
 *
 * We ask at the first *celebration* moment (level complete), not on
 * first load: by then the user has invested real effort worth
 * protecting, and prior engagement raises Chromium's grant rate.
 */

import { track } from "@/lib/api/events";

// Session guard: `requestPersistentStorage` is called from a screen
// that can mount many times; one attempt per session is plenty (the
// browser remembers a grant across sessions anyway).
let attemptedThisSession = false;

/**
 * Best-effort upgrade to persistent storage. Never throws; resolves
 * quietly whatever the outcome. The grant/deny result is tracked so we
 * can measure how exposed the user base is to storage eviction.
 */
export async function requestPersistentStorage(): Promise<void> {
  if (attemptedThisSession) return;
  attemptedThisSession = true;

  try {
    if (
      typeof navigator === "undefined" ||
      !("storage" in navigator) ||
      typeof navigator.storage?.persist !== "function"
    ) {
      return;
    }

    // Already persistent (previous grant, or installed PWA)? Nothing
    // to do — skip the event so the metric only counts real attempts.
    if (typeof navigator.storage.persisted === "function") {
      const already = await navigator.storage.persisted();
      if (already) return;
    }

    const granted = await navigator.storage.persist();
    track("storage_persist_result", { granted });
  } catch {
    // Storage APIs can throw in exotic privacy modes. Non-fatal by
    // design — this is an opportunistic upgrade, not a dependency.
  }
}
