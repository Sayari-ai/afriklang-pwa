/**
 * The `metadata` part sent to Sayari with every campaign recording: one JSON document that
 * describes the audio, its quality, the campaign, mission and prompt, the speaker's declared
 * profile, the consents and the session, so each file can become a complete dataset row.
 *
 * Pure (tested). Never a name, email, phone number or account id: the speaker ID is the identity.
 * The reference for Sayari is docs/SAYARI_UPLOAD_PAYLOAD.json and the shared spec document.
 */

import type { TakeAnalysis, TakeRules } from "@/lib/audio/analyze";
import type { CampaignCard, ContributorView, Mission } from "./types";

export const AUDIO_SCHEMA_VERSION = "afriklang.audio/2.0";

export type CaptureInfo = {
  /** When the take ended (the speaker tapped Stop and the tail silence finished). */
  recordedAt: Date;
  /** When the speaker tapped Submit (the take entered the phone's outbox). */
  submittedAt: Date;
  inputSampleRate: number | null;
  processing: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean };
  sizeBytes: number;
  /** Silence the studio added before "Speak now" and after Stop, seconds. */
  paddingS: number;
  /** The "too quiet" hint was shown during this take. */
  quietHintShown: boolean;
  /** Takes recorded for this mission in this studio session, this one included (failed checks count). */
  takeNumber: number;
  sessionId: string;
  /** 1 for the first take submitted in this session. */
  indexInSession: number;
  appLocale: string;
  /** Minutes east of UTC on the phone (e.g. 0 for Dakar, 60 for Lagos). */
  utcOffsetMin: number;
  device: { label: string; os: string | null; browser: string | null };
  appVersion: string;
};

const nn = <T,>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function buildAudioMetadata(args: {
  card: CampaignCard;
  mission: Mission;
  contributor: ContributorView;
  analysis: TakeAnalysis & { sample_rate: number; channels: number };
  rules: TakeRules;
  sha256: string;
  filename: string;
  capture: CaptureInfo;
}) {
  const { card, mission, contributor, analysis: a, rules, capture: c } = args;
  const p = contributor.profile.values;
  const prompt_role = mission.type === "read" ? "transcript_reference" : mission.type === "spontaneous" ? "topic" : "scenario";
  return {
    schema_version: AUDIO_SCHEMA_VERSION,
    recording: {
      sha256: args.sha256,
      filename: args.filename,
      recorded_at: c.recordedAt.toISOString(),
      submitted_at: c.submittedAt.toISOString(),
      take_number: c.takeNumber,
      is_redo: mission.status === "rejected",
      previous_rejection_reason: mission.status === "rejected" ? nn(mission.rejection_reason) : null,
    },
    audio: {
      format: "wav",
      encoding: "pcm_s16le",
      sample_rate: a.sample_rate,
      bit_depth: 16,
      channels: a.channels,
      duration_s: a.duration_s,
      size_bytes: c.sizeBytes,
      capture_sample_rate: c.inputSampleRate,
      resampled: c.inputSampleRate != null && c.inputSampleRate !== a.sample_rate,
      processing: {
        echo_cancellation: nn(c.processing.echoCancellation),
        noise_suppression: nn(c.processing.noiseSuppression),
        auto_gain_control: nn(c.processing.autoGainControl),
      },
    },
    quality: {
      level_dbfs: a.level_dbfs,
      peak_dbfs: a.peak_dbfs,
      silence_before_s: a.silence_before_s,
      silence_after_s: a.silence_after_s,
      clipped: a.peak_dbfs >= 0,
      noise_floor_dbfs: nn(a.noise_floor_dbfs),
      app_checks_passed: true,
      rules: { duration_min_s: rules.durationMinS, duration_max_s: rules.durationMaxS, min_level_dbfs: rules.minLevelDbfs, silence_margin_s: rules.silenceMarginS },
      studio_padding_s: c.paddingS,
      quiet_hint_shown: c.quietHintShown,
    },
    campaign: {
      id: card.campaign_id,
      code: card.code,
      title: card.title,
      language: { code: card.language.code, name: card.language.name },
      target_varieties: card.language.varieties,
      domain: card.topic.domain,
      sub_domain: nn(card.topic.sub_domain),
      deadline: nn(card.deadline),
    },
    mission: {
      id: mission.mission_id,
      code: mission.code,
      type: mission.type,
      position: mission.position,
      duration_target_s: { min: nn(mission.duration_s.min), max: nn(mission.duration_s.max) },
    },
    prompt: {
      id: mission.prompt.id,
      text: mission.prompt.text_or_topic,
      role: prompt_role,
      category: nn(mission.prompt.category),
    },
    speaker: {
      speaker_id: contributor.speaker_id,
      native_language: nn(p?.nativeLanguage),
      variety: nn(p?.variety),
      country: nn(p?.country),
      region: nn(p?.region),
      gender: nn(p?.gender),
      age_band: nn(p?.ageBand),
      declared_device: nn(p?.device),
    },
    conversation:
      mission.type === "conversational"
        ? { partner_speaker_id: nn(mission.partner_speaker_id), recorded_by: contributor.speaker_id, both_credited: true, channels_per_speaker: false }
        : null,
    consent: {
      recorded: true,
      account_version: nn(card.consents.account.signed_version),
      campaign_version: nn(card.consents.campaign.signed_version),
    },
    device: { label: c.device.label, os: c.device.os, browser: c.device.browser },
    session: {
      id: c.sessionId,
      index_in_session: c.indexInSession,
      app_locale: c.appLocale,
      utc_offset_min: c.utcOffsetMin,
    },
    app: { name: "afriklang-pwa", version: c.appVersion },
  };
}

export type AudioMetadata = ReturnType<typeof buildAudioMetadata>;

/** OS and browser from the user agent (coarse on purpose). */
export function parseDevice(ua: string): { os: string | null; browser: string | null } {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /EdgA?\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : null;
  return { os, browser };
}
