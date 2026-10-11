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

/** Turn an HTTP answer into a result. Exported for tests. */
export function toResult<T>(status: number, json: unknown, retryAfter?: string | null): CampaignResult<T> {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) return { ok: true, data: body as T };
  // The Edge Function names its own errors in `error` (a code); the dashboard sends `code` + `error` (a message).
  const rawCode = typeof body.code === "string" ? body.code : typeof body.error === "string" && KNOWN.has(body.error) ? body.error : "";
  const code: CampaignErrorCode = status === 429 ? "rate_limited" : KNOWN.has(rawCode) ? (rawCode as CampaignErrorCode) : "unknown";
  const failure: CampaignFailure = {
    ok: false,
    status,
    code,
    message: typeof body.message === "string" ? body.message : typeof body.error === "string" && !KNOWN.has(body.error) ? body.error : "",
    ...(typeof body.next_step === "string" ? { nextStep: body.next_step as NextStep } : {}),
    ...(typeof body.reason === "string" ? { reason: body.reason as CampaignFailure["reason"] } : {}),
    ...(retryAfter && Number.isFinite(Number(retryAfter)) ? { retryAfterS: Number(retryAfter) } : {}),
  };
  // A dashboard failure carries its human message in `error`; keep it for codes whose text is built server-side.
  if (typeof body.code === "string" && typeof body.error === "string") failure.message = body.error;
  return failure;
}

async function call<T>(action: string, fields: Record<string, unknown> = {}): Promise<CampaignResult<T>> {
  let token: string | undefined;
  try {
    token = (await getCampaignAuth().auth.getSession()).data.session?.access_token;
  } catch {
    token = undefined;
  }
  if (!token) return { ok: false, status: 401, code: "unauthorized", message: "" };

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
  } catch {
    return { ok: false, status: 0, code: "network", message: "" };
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
