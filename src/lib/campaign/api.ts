"use client";

/**
 * Calls to the dashboard's campaign bridge, through the `campaigns` Edge Function.
 *
 * The browser sends only the user's own session token; who they are is decided by the
 * Edge Function from that session. Every function returns a CampaignResult: failures are
 * values (with the dashboard's code), never exceptions, so screens can branch on `code`.
 */

import { getCampaignAuth } from "./auth-client";
import type {
  CampaignCard,
  CampaignErrorCode,
  CampaignFailure,
  CampaignResult,
  ContributorView,
  Mission,
  NextStep,
  ProfileInput,
  RecordingMetadata,
} from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TIMEOUT_MS = 30_000;

const KNOWN: ReadonlySet<string> = new Set<CampaignErrorCode>([
  "invalid_input", "not_linked", "not_assigned", "invalid_link", "link_expired", "campaign_closed", "email_unverified", "email_mismatch",
  "account_conflict", "consent_version_changed", "already_submitted", "recording_rejected", "profile_incomplete", "blocked", "account_consent",
  "campaign_consent", "partner_consent", "campaign_paused", "campaign_not_open", "server_error", "unauthorized", "bridge_unreachable", "bridge_error",
]);

/** The Edge Function's own codes (sent in `error`), as the app's codes. */
const EDGE_CODES: Record<string, CampaignErrorCode> = {
  unauthorized: "unauthorized",
  auth_unavailable: "bridge_unreachable",
  server_misconfigured: "misconfigured",
  invalid_json: "invalid_input",
  invalid_body: "invalid_input",
  unknown_action: "invalid_input",
  too_large: "invalid_input",
  method_not_allowed: "invalid_input",
  bridge_timeout: "timeout",
  bridge_unreachable: "bridge_unreachable",
  bridge_error: "bridge_error",
};

/** A code nobody named, guessed from the HTTP status so the message still says what kind of failure it was. */
function codeFromStatus(status: number): CampaignErrorCode {
  if (status === 400 || status === 413 || status === 422) return "invalid_input";
  if (status === 401) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 504) return "timeout";
  if (status === 502 || status === 503) return "bridge_unreachable";
  if (status >= 500) return "server_error";
  return "unknown";
}

/** `fieldErrors` when it is an object of strings, else undefined. Anything else in it is ignored. */
function fieldErrorsOf(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, m] of Object.entries(v as Record<string, unknown>)) if (typeof m === "string" && m.trim()) out[k] = m.trim();
  return Object.keys(out).length ? out : undefined;
}

/** Turn an HTTP answer into a result. Exported for tests. */
export function toResult<T>(status: number, json: unknown, retryAfter?: string | null): CampaignResult<T> {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    // A success must carry a JSON object; anything else (an HTML page from a proxy) is not usable.
    if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, status, code: "bridge_error", message: "" };
    return { ok: true, data: body as T };
  }
  // The Edge Function names its own errors in `error` (a code); the dashboard sends `code` + `error` (a message).
  const rawCode = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "";
  const edgeCode = (c: unknown): c is string => typeof c === "string" && Object.prototype.hasOwnProperty.call(EDGE_CODES, c);
  const named: CampaignErrorCode | null = KNOWN.has(rawCode) ? (rawCode as CampaignErrorCode) : edgeCode(rawCode) ? EDGE_CODES[rawCode] : null;
  const code: CampaignErrorCode = status === 429 ? "rate_limited" : (named ?? codeFromStatus(status));
  const isCodeInError = typeof body.error === "string" && (KNOWN.has(body.error) || edgeCode(body.error));
  const fieldErrors = fieldErrorsOf(body.fieldErrors);
  const failure: CampaignFailure = {
    ok: false,
    status,
    code,
    message: typeof body.message === "string" ? body.message : typeof body.error === "string" && !isCodeInError ? body.error : "",
    ...(typeof body.next_step === "string" ? { nextStep: body.next_step as NextStep } : {}),
    ...(typeof body.reason === "string" ? { reason: body.reason as CampaignFailure["reason"] } : {}),
    ...(retryAfter && Number.isFinite(Number(retryAfter)) && Number(retryAfter) >= 0 ? { retryAfterS: Number(retryAfter) } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
  // A dashboard failure carries its human message in `error`; keep it for codes whose text is built server-side.
  if (typeof body.code === "string" && typeof body.error === "string") failure.message = body.error;
  return failure;
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

async function call<T>(action: string, fields: Record<string, unknown> = {}): Promise<CampaignResult<T>> {
  let token: string | undefined;
  try {
    token = (await getCampaignAuth().auth.getSession()).data.session?.access_token;
  } catch {
    token = undefined;
  }
  if (!token) return { ok: false, status: 401, code: "unauthorized", message: "" };
  // Fail at once when the device says it has no network, rather than after the timeout.
  if (isOffline()) return { ok: false, status: 0, code: "offline", message: "" };

  const first = await send<T>(token, action, fields);
  if (first.ok || first.code !== "unauthorized") return first;

  // "Unauthorized" while holding a session. Showing the sign-in screen now would loop for ever
  // when the session is fine and the refusal comes from further down (the dashboard rejecting
  // the Edge Function's key): Google sign-in succeeds, the same call fails, sign-in again...
  // So renew the session once. If that fails the session really is dead: drop it, and the
  // screens show sign-in. If it works and the call is still refused, report a service fault.
  const auth = getCampaignAuth().auth;
  let fresh: string | undefined;
  try {
    const { data, error } = await auth.refreshSession();
    fresh = error ? undefined : data.session?.access_token;
  } catch {
    fresh = undefined;
  }
  if (!fresh) {
    await auth.signOut({ scope: "local" }).catch(() => undefined);
    return first;
  }
  const second = await send<T>(fresh, action, fields);
  if (second.ok || second.code !== "unauthorized") return second;
  return { ...second, code: "misconfigured" };
}

async function send<T>(token: string, action: string, fields: Record<string, unknown>): Promise<CampaignResult<T>> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: ANON },
      body: JSON.stringify({ ...fields, action }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // not JSON
    }
    return toResult<T>(res.status, json, res.headers.get("retry-after"));
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, status: 0, code: "timeout", message: "" };
    return { ok: false, status: 0, code: isOffline() ? "offline" : "network", message: "" };
  }
}

export type CampaignList = { contributor: ContributorView; campaigns: CampaignCard[] };
export type MissionList = { campaign: CampaignCard; missions: Mission[]; rewards: { accepted: number } };

/** The invitation link: bind this account to the contributor it was sent to. */
export const claimLink = (token: string, deviceId?: string) => call<CampaignList>("claim", { token, ...(deviceId ? { device_id: deviceId } : {}) });
export const listCampaigns = () => call<CampaignList>("campaigns");
export const saveProfile = (p: ProfileInput) => call<{ contributor: ContributorView; blocked: unknown[] }>("profile", { ...p });
export const signConsent = (a: { type: "account" | "campaign"; campaignId?: string; version: string; locale: "en" | "fr" }) =>
  call<{ signed_version: string; already: boolean }>("consent", { type: a.type, campaign_id: a.campaignId, version: a.version, locale: a.locale });
export const withdrawConsent = (campaignId: string) => call<{ withdrawn: true }>("withdraw", { campaign_id: campaignId });
export const getMissions = (campaignId: string) => call<MissionList>("missions", { campaign_id: campaignId });
export const submitRecording = (missionId: string, recording: RecordingMetadata) =>
  call<{ recording_id: string; mission_status: string; duplicate: boolean }>("submit", { mission_id: missionId, recording });
