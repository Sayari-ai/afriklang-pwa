"use client";

/**
 * Save the speaker's pages on the phone ahead of time, so the installed app opens offline on any
 * of them, even one never opened online (APP-002).
 *
 * The service worker caches every page load in its "pages" cache (next.config.ts). This adds the
 * pages the speaker will need and has not opened yet: home, history, and each campaign's page
 * and studio. A fetch carrying `X-Afk-Warm: 1` goes through the same service-worker route, so it
 * is stored exactly as a page load would be.
 *
 * Cheap on data: a page already saved is not fetched again, except once after a new version of
 * the app (its HTML names the new build's script files). Nothing is fetched offline, on
 * "data saver", or before a service worker controls the page.
 */

const CACHE = "pages";
const BUILD_KEY = "afriklang.campaign.pagesBuild.v1";
const BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";
/** At most this many campaigns are saved ahead (each is two pages). */
const MAX_CAMPAIGNS = 12;

/** The pages to keep for these campaigns. Pure: exported for tests. */
export function offlinePaths(campaignIds: readonly string[]): string[] {
  const ids = [...new Set(campaignIds)].slice(0, MAX_CAMPAIGNS);
  return ["/campaign", "/campaign/history", ...ids.flatMap((id) => [`/campaign/${encodeURIComponent(id)}`, `/campaign/${encodeURIComponent(id)}/studio`])];
}

const offline = () => navigator.onLine === false;
let running = false;
const done = new Set<string>();

export async function saveOfflinePages(campaignIds: readonly string[]): Promise<void> {
  if (running || typeof window === "undefined" || typeof caches === "undefined") return;
  if (!navigator.serviceWorker?.controller || offline()) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  running = true;
  try {
    let lastBuild: string | null = null;
    try {
      lastBuild = localStorage.getItem(BUILD_KEY);
    } catch {
      // storage blocked: treat as the same build (fetch only what is missing)
      lastBuild = BUILD;
    }
    const newBuild = lastBuild !== BUILD;
    const cache = await caches.open(CACHE);
    let ok = true;
    for (const path of offlinePaths(campaignIds)) {
      if (done.has(path) && !newBuild) continue;
      if (!newBuild && (await cache.match(path))) {
        done.add(path);
        continue;
      }
      if (offline()) return;
      try {
        const res = await fetch(path, { headers: { "X-Afk-Warm": "1", Accept: "text/html" }, credentials: "same-origin", cache: "no-store" });
        if (res.ok) done.add(path);
        else ok = false;
        await res.body?.cancel().catch(() => undefined);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      try {
        localStorage.setItem(BUILD_KEY, BUILD);
      } catch {
        // ignore
      }
    }
  } catch {
    // Cache Storage unavailable: nothing to save into.
  } finally {
    running = false;
  }
}
