/**
 * Start PostHog in the browser (called by instrumentation-client.ts, before React hydrates).
 * The only module that loads the SDK: everything else goes through the registered client
 * (events.ts), so tests and server renders never evaluate posthog-js.
 *
 * Decisions (owner, 2026-11):
 *   - Session replay only around errors: off at start; the first exception of a page load
 *     (window error, unhandled rejection, error boundary, microphone failure) starts it for the
 *     rest of the session. Every input and every text is masked; no network bodies or headers.
 *   - Profiles for identified people only (client.ts identifies with the contributor id).
 *   - No cookie banner (legitimate interest; the privacy notice says so).
 */

import posthog from "posthog-js";
import { isInAppBrowser } from "@/lib/campaign/in-app-browser";
import { consumeSignInReturn } from "./client";
import { APP_NAME, POSTHOG_UI_HOST, getPostHogConfig, shouldRunInBrowser } from "./config";
import { activePostHog, setAnalyticsClient, track } from "./events";
import { sanitizeEvent, sanitizeUrl } from "./sanitize";

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

let replayAsked = false;

/** Start recording the rest of this session, once (after an exception). */
function startErrorReplay(): void {
  if (replayAsked) return;
  replayAsked = true;
  // Out of the capture call that saw the exception: never re-enter the SDK from before_send.
  setTimeout(() => {
    try {
      const ph = activePostHog();
      // `true`: the project's sampling and linked-flag settings must not skip this recording.
      if (ph && !ph.sessionRecordingStarted()) ph.startSessionRecording(true);
    } catch {
      // never break the page for a replay
    }
  }, 0);
}

/** Start PostHog in the browser. Without a token, or on localhost (unless debugging): nothing. */
export function initPostHog(): void {
  if (typeof window === "undefined") return;
  const config = getPostHogConfig();
  if (!shouldRunInBrowser(config, window.location.hostname)) return;
  try {
    posthog.init(config.token, {
      api_host: config.host,
      ui_host: POSTHOG_UI_HOST,
      defaults: "2026-05-30",
      debug: config.debug,
      person_profiles: "identified_only",
      // Errors: window.onerror + unhandledrejection (error boundaries report through reportException).
      capture_exceptions: true,
      // Product analytics. Autocapture keeps clicks but never their text or attributes: a prompt
      // or a speaker's answer must not travel in an $autocapture event.
      autocapture: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_performance: { web_vitals: true, network_timing: true },
      disable_surveys: true,
      // Replay: off until an exception (startErrorReplay), then fully masked.
      disable_session_recording: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        recordHeaders: false,
        recordBody: false,
        // The replay's network list keeps the address only, without query or fragment.
        maskCapturedNetworkRequestFn: (request) => {
          try {
            const url = new URL(request.name);
            url.search = "";
            url.hash = "";
            return { ...request, name: url.toString(), requestBody: null, responseBody: null };
          } catch {
            return { ...request, name: sanitizeUrl(request.name), requestBody: null, responseBody: null };
          }
        },
      },
      before_send: (event) => {
        if (!event) return event;
        sanitizeEvent(event);
        event.properties = { ...event.properties, app: event.properties?.app ?? APP_NAME };
        if (event.event === "$exception") startErrorReplay();
        return event;
      },
      loaded: (ph) => {
        ph.register({ app: APP_NAME, app_version: APP_VERSION, ...(APP_BUILD ? { app_build: APP_BUILD } : {}) });
      },
    });
  } catch {
    return;
  }
  setAnalyticsClient(posthog);
  trackAppOpened();
  consumeSignInReturn();
}

function trackAppOpened(): void {
  let standalone = false;
  try {
    standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    // old browser: a browser tab
  }
  track("app_opened", { display_mode: standalone ? "standalone" : "browser", in_app_browser: isInAppBrowser(navigator.userAgent), online: navigator.onLine !== false });
}
