"use client";

/**
 * A new version of the app is installed and waiting (APP-022). The service worker does not take
 * over by itself (skipWaiting: false keeps open tabs on the version they started with), and an
 * installed Android app can stay open for days: without a prompt, fixes reach phones late.
 * The shell offers "Restart"; the studio never shows it, and it waits while a take is being sent.
 */

import { useEffect, useState } from "react";

export function useAppUpdate(): { ready: boolean; apply: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    let reg: ServiceWorkerRegistration | undefined;
    let cancelled = false;
    const check = () => {
      // Only an update: with no controller, this is the first install, nothing to restart.
      if (reg?.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
    };
    const onFound = () => {
      const sw = reg?.installing;
      sw?.addEventListener("statechange", () => sw.state === "installed" && check());
    };
    void navigator.serviceWorker.getRegistration().then((r) => {
      if (cancelled || !r) return;
      reg = r;
      check();
      r.addEventListener("updatefound", onFound);
    });
    // Look for a new version when the app comes back to the foreground.
    const onVisible = () => document.visibilityState === "visible" && void reg?.update().catch(() => undefined);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      reg?.removeEventListener("updatefound", onFound);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const apply = () => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    // The generated sw.js listens for this message (skipWaiting: false).
    waiting.postMessage({ type: "SKIP_WAITING" });
  };
  return { ready: waiting !== null, apply };
}
