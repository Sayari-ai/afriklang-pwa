"use client";

/**
 * Calls to the dashboard's campaign bridge, through the `campaigns` Edge Function.
 *
 * The browser sends only the user's own session token; who they are is decided by the
 * Edge Function from that session. Every function returns a CampaignResult: failures are
 * values (with the dashboard's code), never exceptions, so screens can branch on `code`.
 */

import { filledCard } from "./card-fill";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { getCampaignAuth, storedCampaignUser } from "./auth-client";
import type {
  CampaignCard,
  CampaignErrorCode,
  CampaignFailure,
  CampaignResult,
  ContributorView,
  Mission,
  NextStep,
  PoolView,
  ProfileInput,
  RecordingMetadata,
  Rewards,
} from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TIMEOUT_MS = 30_000;

const KNOWN: ReadonlySet<string> = new Set<CampaignErrorCode>([
  "invalid_input", "not_linked", "not_assigned", "invalid_link", "link_expired", "campaign_closed", "email_unverified", "email_mismatch",
  "account_conflict", "consent_version_changed", "already_submitted", "recording_rejected", "profile_incomplete", "blocked", "account_consent",
  "campaign_consent", "partner_consent", "campaign_paused", "campaign_not_open", "duplicate_audio", "test_closed", "server_error", "unauthorized",
  "bridge_unreachable", "bridge_error",
]);

/** The Edge Function's own codes (sent in `error`), as the app's codes. */
const EDGE_CODES: Record<string, CampaignErrorCode> = {
  unauthorized: "unauthorized",
  auth_unavailable: "bridge_unreachable",
  server_misconfigured: "misconfigured",
  invalid_json: "invalid_input",
  invalid_body: "invalid_input",
  // An Edge Function older than the app, or a dashboard without the route: the call does not exist yet.
  unknown_action: "unsupported",
  route_not_found: "unsupported",
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
/**
 * AbortSignal.timeout is missing on iOS 15 Safari (iPhone 6s/7/SE): without it every call failed
 * as "could not reach the server" (N-21). The same signal, built by hand there.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

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
  // Fail at once when the device says it has no network, rather than after the timeout. Checked
  // before the session: offline, an expired token cannot be renewed, and that is not "signed out".
  if (isOffline()) return { ok: false, status: 0, code: "offline", message: "" };
  let token: string | undefined;
  try {
    token = (await getCampaignAuth().auth.getSession()).data.session?.access_token;
  } catch {
    token = undefined;
  }
  if (!token) {
    // A session is still saved: its renewal failed on the network (APP-003). Not "sign in again".
    if (storedCampaignUser()) return { ok: false, status: 0, code: isOffline() ? "offline" : "network", message: "" };
    return { ok: false, status: 401, code: "unauthorized", message: "" };
  }

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
    // The renewal itself failed on the network: nothing says the session is dead, keep it.
    if (error && isAuthRetryableFetchError(error)) return { ok: false, status: 0, code: isOffline() ? "offline" : "network", message: "" };
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
      signal: timeoutSignal(TIMEOUT_MS),
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
/** A claim answers with the ONE campaign the invitation was for, not the whole list. */
export type ClaimResult = { contributor: ContributorView; campaign: CampaignCard };
export type MissionList = { campaign: CampaignCard; missions: Mission[]; rewards: Rewards };
/** A draw answers with the NEW missions only, and the speaker's pool state. */
export type DrawResult = { missions: Mission[]; pool: PoolView };
export type ReturnResult = { returned: number; pool: Pick<PoolView, "open" | "refill_below"> };

/** The invitation link: bind this account to the contributor it was sent to. */
export const claimLink = (token: string, deviceId?: string) =>
  call<ClaimResult>("claim", { token, ...(deviceId ? { device_id: deviceId } : {}) }).then((r) => (r.ok ? { ...r, data: { ...r.data, campaign: filledCard(r.data.campaign) } } : r));
export const listCampaigns = () => call<CampaignList>("campaigns").then((r) => (r.ok ? { ...r, data: { ...r.data, campaigns: r.data.campaigns.map(filledCard) } } : r));
export const saveProfile = (p: ProfileInput) => call<{ contributor: ContributorView; blocked: unknown[] }>("profile", { ...p });
export const signConsent = (a: { type: "account" | "campaign"; campaignId?: string; version: string; locale: "en" | "fr" }) =>
  call<{ signed_version: string; already: boolean }>("consent", { type: a.type, campaign_id: a.campaignId, version: a.version, locale: a.locale });
export const withdrawConsent = (campaignId: string) => call<{ withdrawn: true }>("withdraw", { campaign_id: campaignId });
export const getMissions = (campaignId: string) =>
  call<MissionList>("missions", { campaign_id: campaignId }).then((r) => (r.ok ? { ...r, data: { ...r.data, campaign: filledCard(r.data.campaign) } } : r));
export const submitRecording = (missionId: string, recording: RecordingMetadata) =>
  call<{ recording_id: string; mission_status: string; duplicate: boolean }>("submit", { mission_id: missionId, recording });
/** A signed upload ticket, passed through untouched (docs/contracts/README.md §1). */
export type UploadTicket = { ticket: string; expires_at: string };
/**
 * Ask the dashboard for a ticket for ONE file of one mission. The app never reads or checks the
 * ticket (it has no secret): it hands it to the upload proxy in `X-Campaign-Ticket`. A failure
 * coded `unsupported` means the dashboard (or the Edge Function) does not issue tickets yet.
 */
export const requestUploadTicket = (missionId: string, sourceSha256: string, durationS: number) =>
  call<UploadTicket>("upload_ticket", { mission_id: missionId, source_sha256: sourceSha256, duration_s: durationS });
/** Pool campaigns: draw a leased batch. Safe to repeat: the dashboard never draws beyond the batch size. */
export const drawMissions = (campaignId: string) => call<DrawResult>("draw", { campaign_id: campaignId });
/** Pool campaigns: give back open missions the speaker will not record (at most 200 per call). */
export const returnMissions = (campaignId: string, missionIds: string[]) => call<ReturnResult>("return", { campaign_id: campaignId, mission_ids: missionIds });
