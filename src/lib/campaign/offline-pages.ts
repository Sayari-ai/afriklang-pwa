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

/** The service worker's cache for the build's own files (next.config.ts), kept across deploys (APP2-10). */
export const KEEP_CACHE = "next-static-keep";

/** The build's own script and style files among these addresses (same origin, /_next/static/), once each. Pure: exported for tests. */
export function buildAssetUrls(urls: Iterable<string>, origin: string): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    try {
      const u = new URL(raw, origin);
      if (u.origin === origin && u.pathname.startsWith("/_next/static/")) out.add(u.origin + u.pathname + u.search);
    } catch {
      // not an address
    }
  }
  return [...out];
}

let kept = false;
/**
 * Copy the running build's script and style files into KEEP_CACHE, from the service worker's
 * precache (no network). The next service worker deletes them from its precache; pages saved by
 * this build still find them here when opened offline right after an update (APP2-10). Once per
 * app start; works offline.
 */
export async function keepBuildAssets(): Promise<void> {
  if (kept || typeof window === "undefined" || typeof caches === "undefined" || !navigator.serviceWorker?.controller) return;
  kept = true;
  try {
    const found = [
      ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"), (e) => e.src),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[href]"), (e) => e.href),
      ...(typeof performance !== "undefined" ? performance.getEntriesByType("resource").map((e) => e.name) : []),
    ];
    const keep = await caches.open(KEEP_CACHE);
    for (const url of buildAssetUrls(found, location.origin)) {
      if (await keep.match(url)) continue;
      const hit = await caches.match(url, { ignoreSearch: true });
      if (hit) await keep.put(url, hit);
    }
  } catch {
    // Cache Storage unavailable or full: the files stay in the precache only.
  }
}

const offline = () => navigator.onLine === false;
let running = false;
const done = new Set<string>();

/**
 * What the saved pages were made with: the build (their HTML names its script files) and the
 * language they were rendered in (APP2-29). A different stamp saves every page again.
 */
export const pagesStamp = (build: string, locale: string) => (locale ? `${build}|${locale}` : build);

export async function saveOfflinePages(campaignIds: readonly string[], locale = ""): Promise<void> {
  if (running || typeof window === "undefined" || typeof caches === "undefined") return;
  void keepBuildAssets();
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
      lastBuild = pagesStamp(BUILD, locale);
    }
    const stamp = pagesStamp(BUILD, locale);
    const newBuild = lastBuild !== stamp;
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
        localStorage.setItem(BUILD_KEY, stamp);
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
