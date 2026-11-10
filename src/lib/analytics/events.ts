/**
 * The speaker app's product events, in one place (snake_case names, small property sets).
 *
 * Never put free text in an event: no name, email, phone, prompt text, speaker answer or audio.
 * Every property is a code, a number or a flag; `track` drops anything else and cuts long strings,
 * so a slip cannot send a sentence.
 *
 * `track` is a no-op when PostHog is not running (turned off, localhost, server render, tests).
 * This module never loads the SDK: init.ts registers the started client here.
 */

import type { PostHog } from "posthog-js";

export type CampaignKind = "collection" | "qualification";
export type MicErrorCode = "permission-denied" | "no-mic" | "unsupported" | "internal" | "startTimeout" | "inApp" | "stopFailed";
export type TakeCheckResult = "ok" | "advice" | "problem";

/** Each event and the properties it may carry. */
export type AnalyticsEvents = {
  app_opened: { display_mode: "standalone" | "browser"; in_app_browser: boolean; online: boolean };
  sign_in_started: { in_app_browser: boolean; has_invitation: boolean };
  sign_in_completed: Record<string, never>;
  sign_in_failed: { reason: string };
  profile_saved: { first_time: boolean };
  consent_signed: { kind: "account" | "campaign"; campaign_kind?: CampaignKind };
  campaign_opened: { campaign_kind: CampaignKind; language: string; dispatch: "planned" | "pool"; next_step: string };
  studio_opened: { campaign_kind: CampaignKind; language: string; to_record: number; focused: boolean };
  record_started: { campaign_kind: CampaignKind; mission_type: string; take_number: number };
  record_mic_error: { code: MicErrorCode; in_app_browser: boolean };
  take_checked: { result: TakeCheckResult; problem?: string; duration_s: number; mission_type: string };
  take_submitted: { take_number: number; mission_type: string; campaign_kind: CampaignKind; sent_anyway: boolean; offline: boolean };
  take_skipped: { mission_type: string; campaign_kind: CampaignKind };
  /** `has_sayari_id` false: the upload answer carried no recording id, so no verdict can find this take (X-09). */
  upload_succeeded: { mission_type: string; duplicate: boolean; attempts: number; has_sayari_id: boolean };
  upload_failed: { code: string; reason?: string; mission_type: string; attempts: number };
  test_completed: { language: string; prompts: number; attempt_no?: number };
  app_update_applied: Record<string, never>;
};

export type AnalyticsEventName = keyof AnalyticsEvents;

/** Every event name, for tests and dashboards. */
export const ANALYTICS_EVENTS = [
  "app_opened",
  "sign_in_started",
  "sign_in_completed",
  "sign_in_failed",
  "profile_saved",
  "consent_signed",
  "campaign_opened",
  "studio_opened",
  "record_started",
  "record_mic_error",
  "take_checked",
  "take_submitted",
  "take_skipped",
  "upload_succeeded",
  "upload_failed",
  "test_completed",
  "app_update_applied",
] as const satisfies readonly AnalyticsEventName[];

/** Longest string property kept: codes and language tags are short; anything longer is cut. */
export const MAX_PROP_LENGTH = 40;

type Primitive = string | number | boolean;

/** Only primitives survive; strings are cut to MAX_PROP_LENGTH; NaN/Infinity and undefined are dropped. */
export function cleanProps(props: Record<string, unknown> | undefined): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string") out[key] = value.length > MAX_PROP_LENGTH ? value.slice(0, MAX_PROP_LENGTH) : value;
    else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** What this app uses of the SDK (init.ts registers the real one). */
export type AnalyticsClient = Pick<PostHog, "capture" | "captureException" | "identify" | "reset" | "get_property" | "sessionRecordingStarted" | "startSessionRecording"> & { __loaded?: boolean };

let client: AnalyticsClient | null = null;

/** Register the started SDK (init.ts), or null to stop sending. */
export function setAnalyticsClient(c: AnalyticsClient | null): void {
  client = c;
}

/** The PostHog client when it has started in this browser, else null. */
export function activePostHog(): AnalyticsClient | null {
  return typeof window !== "undefined" && client && client.__loaded !== false ? client : null;
}

type TrackOptions = {
  /** Send at once rather than with the next batch: for events just before the page goes away. */
  instant?: boolean;
};

/** Send a product event. Never throws; a no-op without PostHog. */
export function track<E extends AnalyticsEventName>(
  ...[name, props, options]: AnalyticsEvents[E] extends Record<string, never> ? [name: E, props?: AnalyticsEvents[E], options?: TrackOptions] : [name: E, props: AnalyticsEvents[E], options?: TrackOptions]
): void {
  const ph = activePostHog();
  if (!ph) return;
  try {
    ph.capture(name, cleanProps(props as Record<string, unknown> | undefined), options?.instant ? { send_instantly: true } : undefined);
  } catch {
    // Analytics must never break the app.
  }
}
