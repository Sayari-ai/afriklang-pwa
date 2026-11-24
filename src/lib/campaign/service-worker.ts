/**
 * Registers the service worker (offline launch, APP-002), without ever throwing.
 *
 * next-pwa used to register it by itself (`register: true`): its entry calls
 * `window.workbox.register()` and leaves the promise uncaught. Wherever the browser refuses a
 * service worker (site data blocked, private windows, "Failed to access storage", iOS simulator,
 * sw.js not loading on a bad network, extensions that wrap `register`), every page load raised an
 * unhandled rejection: GitHub issues #47 #49 #55 #85 #87 and the "Rejected" error on Chrome for
 * Windows (about 230 sessions in two weeks). None of them broke the app; they only flooded error
 * tracking. The app now registers it (next.config.ts: `register: false`), catches the refusal and
 * sends one product event with the error's name instead.
 *
 * The app works without a service worker, only not offline.
 */

import { track } from "@/lib/analytics/events";

/** What this module uses of workbox-window's `Workbox` (next-pwa puts one on `window.workbox`). */
export type WorkboxLike = { register: (options?: { immediate?: boolean }) => Promise<unknown> };

let attempted = false;

/** For tests only. */
export function resetServiceWorkerRegistration(): void {
  attempted = false;
}

/** A short code for why registration failed: the error's name only, never its text. */
export function registrationFailureReason(e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name;
  if (typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)) return name;
  return e === null || e === undefined ? "empty" : "other";
}

/**
 * Register once per page load. Resolves true when registered, false when there is nothing to
 * register (dev build, no Service Worker API) or the browser refused. Never rejects.
 */
export async function registerServiceWorker(workbox: WorkboxLike | undefined = typeof window === "undefined" ? undefined : (window as { workbox?: WorkboxLike }).workbox): Promise<boolean> {
  if (attempted || !workbox) return false;
  attempted = true;
  try {
    // Waits for the page's load event, as next-pwa's own registration did.
    await workbox.register();
    return true;
  } catch (e) {
    track("sw_register_failed", { reason: registrationFailureReason(e) });
    return false;
  }
}
