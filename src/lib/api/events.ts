"use client";

/**
 * Product analytics client — fire-and-forget event tracking.
 *
 * Design contract (Phase 0 of the retention roadmap):
 *   * `track()` NEVER throws and NEVER blocks UX — analytics is a
 *     side-channel, not a dependency. Any failure (offline, backend
 *     missing, edge function down) silently drops the event.
 *   * Events are buffered for a short window and sent as one batched
 *     `events_log` call, so bursts (app_open + level_start on a deep
 *     link) cost one request instead of N.
 *   * Identity is the same anonymous device UUID every other backend
 *     call uses — no cookies, no fingerprinting, no PII in props.
 *     `user_id` attribution arrives with the auth project, server-side.
 *   * Timestamps are assigned server-side; offline events are dropped
 *     rather than queued (replayed events with wrong clocks would
 *     poison retention metrics — absence is more honest).
 *
 * Event names are a closed union so call sites can't invent
 * unaggregatable one-offs. Add new names here, deliberately.
 */

import { getDeviceIdSync } from "@/stores/device-identity";

import { isSupabaseConfigured } from "../supabase";
import { invokeEdge } from "./edge";

/** Closed set of product events. Keep names snake_case, past-tense-ish. */
export type AnalyticsEvent =
  | "app_open"
  | "onboarding_complete"
  | "consent_granted"
  | "level_start"
  | "recording_submitted"
  | "level_complete"
  | "cycle_advance"
  | "skip_used"
  | "nickname_saved"
  | "storage_persist_result"
  | "install_prompt_shown"
  | "install_prompt_accepted"
  | "install_prompt_dismissed"
  | "app_installed";

/** JSON-safe primitive props only — keeps the payload flat and queryable. */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

interface BufferedEvent {
  event: AnalyticsEvent;
  props?: AnalyticsProps;
}

// Coalescing buffer: events within this window ship as one request.
const FLUSH_DELAY_MS = 800;
// Mirror of the edge function's per-request cap.
const MAX_BATCH = 20;

let buffer: BufferedEvent[] = [];
let flushTimer: number | null = null;
let hiddenFlushRegistered = false;

/**
 * Record a product event. Safe to call from anywhere client-side
 * (components, stores, API clients); no-ops on the server, when the
 * backend isn't configured, or when offline.
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  try {
    if (typeof window === "undefined") return;
    if (!isSupabaseConfigured) return;
    if (!navigator.onLine) return;

    registerHiddenFlush();

    buffer.push(props ? { event, props } : { event });
    if (buffer.length >= MAX_BATCH) {
      void flush();
      return;
    }
    if (flushTimer === null) {
      flushTimer = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
    }
  } catch {
    // Analytics must never take the app down. Swallow everything.
  }
}

async function flush(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const events = buffer;
  buffer = [];
  if (events.length === 0) return;

  try {
    const deviceId = getDeviceIdSync();
    await invokeEdge("events_log", {
      body: { device_id: deviceId, events },
    });
  } catch {
    // Fire-and-forget: dropped events are acceptable; retry queues are
    // not worth the complexity (and replays would skew timestamps).
  }
}

/**
 * Best-effort flush when the tab goes hidden so buffered events from
 * the last interaction aren't lost to the coalescing window. In-flight
 * fetches usually complete within the browser's grace period; anything
 * that doesn't is an accepted loss.
 */
function registerHiddenFlush(): void {
  if (hiddenFlushRegistered) return;
  hiddenFlushRegistered = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
