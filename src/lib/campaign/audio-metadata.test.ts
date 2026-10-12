import { describe, expect, it } from "vitest";
import { AUDIO_SCHEMA_VERSION, buildAudioMetadata, parseDevice } from "./audio-metadata";
import type { CampaignCard, ContributorView, Mission } from "./types";

const card = {
  campaign_id: "c1",
  code: "WOL_FIN_PILOT_01",
  title: "Wolof mobile money pilot",
  language: { code: "wol", name: "Wolof", varieties: ["Baol-Baol"] },
  topic: { domain: "Banking and Fintech", sub_domain: null },
  deadline: "2027-01-29",
  consents: { account: { signed_version: "v2" }, campaign: { signed_version: "v1" } },
} as unknown as CampaignCard;
const contributor = {
  speaker_id: "SPK-7Q2M9X4D",
  profile: { values: { nativeLanguage: "wol", variety: "Baol-Baol", country: "SN", region: "Thiès", gender: "female", ageBand: "30-44", device: "Samsung A14" } },
} as unknown as ContributorView;
const mission = (over: Partial<Mission> = {}) =>
  ({ mission_id: "m1", code: "M0007", type: "read", position: 7, status: "todo", rejection_reason: null, prompt: { id: "P007", text_or_topic: "Dama bëgg…", category: null }, duration_s: { min: 3, max: 15 }, partner_speaker_id: null, partner_ready: false, recording: null, ...over }) as Mission;
const build = (m: Mission) =>
  buildAudioMetadata({
    card,
    mission: m,
    contributor,
    analysis: { duration_s: 6.4, level_dbfs: -22, peak_dbfs: -3, silence_before_s: 1.2, silence_after_s: 1.3, sample_rate: 16000, channels: 1 },
    rules: { durationMinS: 3, durationMaxS: 15, minLevelDbfs: -35, silenceMarginS: 1 },
    sha256: "a".repeat(64),
    filename: "f.wav",
    capture: { recordedAt: new Date("2026-10-12T09:00:00Z"), submittedAt: new Date("2026-10-12T09:00:05Z"), inputSampleRate: 48000, processing: { echoCancellation: true }, sizeBytes: 204844, paddingS: 1.2, quietHintShown: false, takeNumber: 2, sessionId: "s1", indexInSession: 3, appLocale: "fr", utcOffsetMin: 0, device: { label: "Android Chrome", os: "Android", browser: "Chrome" }, appVersion: "0.1.0" },
  });

describe("audio metadata document", () => {
  it("describes a read take completely, with no name or email", () => {
    const d = build(mission());
    expect(d.schema_version).toBe(AUDIO_SCHEMA_VERSION);
    expect(d.prompt.role).toBe("transcript_reference");
    expect(d.audio).toMatchObject({ capture_sample_rate: 48000, resampled: true, processing: { echo_cancellation: true, noise_suppression: null } });
    expect(d.speaker).toEqual({ speaker_id: "SPK-7Q2M9X4D", native_language: "wol", variety: "Baol-Baol", country: "SN", region: "Thiès", gender: "female", age_band: "30-44", declared_device: "Samsung A14" });
    expect(d.consent).toEqual({ recorded: true, account_version: "v2", campaign_version: "v1" });
    expect(d.conversation).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/@|email|name":"[A-Z][a-z]+ [A-Z]/);
  });
  it("marks a redo and a conversation", () => {
    const d = build(mission({ type: "conversational", status: "rejected", rejection_reason: "Radio in the background", partner_speaker_id: "SPK-4H8K2P9W" }));
    expect(d.recording).toMatchObject({ is_redo: true, previous_rejection_reason: "Radio in the background", take_number: 2 });
    expect(d.prompt.role).toBe("scenario");
    expect(d.conversation).toEqual({ partner_speaker_id: "SPK-4H8K2P9W", recorded_by: "SPK-7Q2M9X4D", both_credited: true, channels_per_speaker: false });
  });
  it("reads OS and browser coarsely", () => {
    expect(parseDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/129 Mobile Safari")).toEqual({ os: "Android", browser: "Chrome" });
  });
});
