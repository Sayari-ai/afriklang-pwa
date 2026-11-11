/** Pure helpers of the recording studio: the take's rules, its metadata, and the fields sent to Sayari. */

import { checkTake, SAYARI_QC, type QcLimits, type TakeAnalysis, type TakeProblem, type TakeRules } from "@/lib/audio/analyze";
import type { CampaignCard, Mission, RecordingMetadata, SpeechType } from "./types";

export const isTimed = (type: SpeechType) => type !== "read";

export function takeRules(card: CampaignCard, mission: Mission): TakeRules {
  const entry = card.instructions?.speech_types?.find((s) => s.type === mission.type);
  const rec = card.instructions?.recording;
  const num = (...c: (number | null | undefined)[]) => c.find((n): n is number => typeof n === "number" && Number.isFinite(n));
  return {
    durationMinS: num(entry?.duration_min_s, mission.duration_s.min) ?? 0,
    durationMaxS: num(entry?.duration_max_s, mission.duration_s.max) ?? 600,
    minLevelDbfs: num(rec?.min_level_dbfs) ?? -35,
    silenceMarginS: num(rec?.silence_margin_s) ?? 1,
    qc: qcLimitsOf(card),
  };
}

/**
 * The QC limits the advice follows: the card's (Sayari's live settings) when it sends them, each
 * value checked; Sayari's defaults for anything missing or unusable (decision B, X-05).
 */
export function qcLimitsOf(card: Pick<CampaignCard, "qc_limits">): QcLimits {
  const q = card.qc_limits;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  if (!q || typeof q !== "object") return { ...SAYARI_QC };
  return {
    minSnrDb: num(q.min_snr_db, SAYARI_QC.minSnrDb),
    maxBackgroundNoiseDb: num(q.max_background_noise_db, SAYARI_QC.maxBackgroundNoiseDb),
    maxClippingRatio: num(q.max_clipping_ratio, SAYARI_QC.maxClippingRatio),
    maxSilenceRatio: num(q.max_silence_ratio, SAYARI_QC.maxSilenceRatio),
  };
}

/**
 * The blocking problem of a take brought back from the phone's storage (drafts.ts), or null when
 * it may go to the review screen. The length check runs again on it, with its own mission's rules:
 * a crash between saving the draft and the check could keep a take that must be recorded again,
 * and it must not come back as a checked take (its metadata would say the app's checks passed).
 * Advice (quiet, noisy, short pause) is not blocking: the review screen shows it, as always.
 */
export function draftProblem(analysis: TakeAnalysis, card: CampaignCard, mission: Mission): TakeProblem | null {
  const c = checkTake(analysis, takeRules(card, mission));
  return c?.blocking ? c.problem : null;
}

/** Short device label from the user agent, e.g. "Android Chrome". */
export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [os, browser].filter(Boolean).join(" ").slice(0, 60) || "unknown";
}

export function buildMetadata(a: TakeAnalysis & { sample_rate: number; channels: number }, sha: string, device: string, sayariId: string | null): RecordingMetadata {
  return {
    format: "wav",
    sample_rate: a.sample_rate,
    channels: a.channels,
    duration_s: a.duration_s,
    level_dbfs: a.level_dbfs,
    source_sha256: sha,
    peak_dbfs: a.peak_dbfs,
    silence_before_s: a.silence_before_s,
    silence_after_s: a.silence_after_s,
    device,
    ...(sayariId ? { sayari_recording_id: sayariId } : {}),
  };
}

/**
 * The campaign fields sent to Sayari with the audio, as multipart text fields (all values are strings,
 * absent values are left out). The same list is documented in docs/SAYARI_UPLOAD_PAYLOAD.json.
 * Never a name, email or user id: the speaker ID is the only identity.
 */
export function buildSayariCampaignFields(card: CampaignCard, mission: Mission, metadata: RecordingMetadata): Record<string, string> {
  const fields: Record<string, string | number | null | undefined> = {
    campaign_id: card.campaign_id,
    campaign_code: card.code,
    domain: card.topic.domain,
    sub_domain: card.topic.sub_domain,
    mission_id: mission.mission_id,
    mission_code: mission.code,
    mission_type: mission.type,
    prompt_id: mission.prompt.id,
    prompt_category: mission.prompt.category,
    partner_speaker_id: mission.partner_speaker_id,
    source_sha256: metadata.source_sha256,
    format: metadata.format,
    sample_rate: metadata.sample_rate,
    channels: metadata.channels,
    duration_s: metadata.duration_s,
    level_dbfs: metadata.level_dbfs,
    peak_dbfs: metadata.peak_dbfs,
    silence_before_s: metadata.silence_before_s,
    silence_after_s: metadata.silence_after_s,
    device: metadata.device,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== "") out[k] = String(v);
  return out;
}

export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
