import { describe, expect, it } from "vitest";
import { AUDIO_SCHEMA_VERSION, buildAudioMetadata, parseDevice, varietyFor } from "./audio-metadata";
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
const capture = { recordedAt: new Date("2026-10-12T09:00:00Z"), submittedAt: new Date("2026-10-12T09:00:05Z"), inputSampleRate: 48000, processing: { echoCancellation: true }, sizeBytes: 204844, paddingS: 1.2, quietHintShown: false, advice: null, sentAnyway: false, takeNumber: 2, sessionId: "s1", indexInSession: 3, appLocale: "fr", utcOffsetMin: 0, device: { label: "Android Chrome", os: "Android", browser: "Chrome" }, appVersion: "0.1.0", appBuild: "107836e1a2b3" };
const build = (m: Mission, over: Partial<typeof capture> = {}) =>
  buildAudioMetadata({
    card,
    mission: m,
    contributor,
    analysis: { duration_s: 6.4, level_dbfs: -22, peak_dbfs: -3, silence_before_s: 1.2, silence_after_s: 1.3, sample_rate: 16000, channels: 1 },
    rules: { durationMinS: 3, durationMaxS: 15, minLevelDbfs: -35, silenceMarginS: 1 },
    sha256: "a".repeat(64),
    filename: "f.wav",
    capture: { ...capture, ...over },
  });

describe("audio metadata document", () => {
  it("describes a read take completely, with no name or email", () => {
    const d = build(mission());
    expect(d.schema_version).toBe(AUDIO_SCHEMA_VERSION);
    expect(d.prompt.role).toBe("transcript_reference");
    expect(d.quality).toMatchObject({ app_checks_passed: true, advice: null, sent_anyway: false });
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
  it("names the build that recorded the take, and the clipping ratio Sayari judges (APP2-26, APP2-01)", () => {
    const d = build(mission());
    expect(d.app).toEqual({ name: "afriklang-pwa", version: "0.1.0", build: "107836e1a2b3" });
    expect(d.quality.clipping_ratio).toBeNull();
  });
  it("reads OS and browser coarsely", () => {
    expect(parseDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/129 Mobile Safari")).toEqual({ os: "Android", browser: "Chrome" });
  });
  it("tells the truth about the app's checks: an advice sent anyway is not a pass", () => {
    const d = build(mission(), { advice: "noisy", sentAnyway: true });
    expect(d.quality).toMatchObject({ app_checks_passed: false, advice: "noisy", sent_anyway: true });
    expect(build(mission(), { advice: null, sentAnyway: false }).quality.app_checks_passed).toBe(true);
    // The keys are additive: the schema version does not move.
    expect(d.schema_version).toBe("afriklang.audio/2.0");
  });
});

describe("variety per campaign (APP-015)", () => {
  const card = (code: string, varieties: string[]) => ({ language: { code, name: code, varieties } });
  const who = (nativeLanguage: string | null, variety: string | null) => ({ profile: { values: { nativeLanguage, variety } } }) as unknown as Parameters<typeof varietyFor>[1];
  it("labels the audio only with a variety of the campaign's language", () => {
    expect(varietyFor(card("wol", ["Dakar", "Saloum"]), who("wol", "Dakar"))).toBe("Dakar");
    // Profile last saved from a Pulaar campaign: not a Wolof variety.
    expect(varietyFor(card("wol", ["Dakar", "Saloum"]), who("fuc", "Fuuta Tooro"))).toBeNull();
    expect(varietyFor(card("wol", []), who("wol", "Dakar"))).toBe("Dakar");
    expect(varietyFor(card("wol", []), who("fuc", "Fuuta Tooro"))).toBeNull();
    expect(varietyFor(card("wol", ["Dakar"]), who("wol", null))).toBeNull();
  });
  it("labels a qualification test with the test's own variety, else today's rule (A5)", () => {
    const test = (variety: string | null | undefined) => ({ ...card("fuc", []), kind: "qualification" as const, qualification: { attempt_no: 1, stage: "recording" as const, decision: null, accepted: null, total: 10, retry_after: null, ...(variety === undefined ? {} : { variety }) } });
    // The speaker's profile variety is a Wolof one: the Pulaar test is labelled with the attempt's.
    expect(varietyFor(test("Fuuta Tooro"), who("wol", "Dakar"))).toBe("Fuuta Tooro");
    // Without a test variety (an older dashboard): the profile rule, which refuses another language's variety.
    expect(varietyFor(test(undefined), who("wol", "Dakar"))).toBeNull();
    expect(varietyFor(test(null), who("fuc", "Fuuta Jalon"))).toBe("Fuuta Jalon");
    // The field is checked, not trusted by type: only a trimmed name of at most 80 characters (the dashboard's column) labels the audio.
    expect(varietyFor(test({ x: 1 } as unknown as string), who("wol", "Dakar"))).toBeNull();
    expect(varietyFor(test(42 as unknown as string), who("fuc", "Fuuta Jalon"))).toBe("Fuuta Jalon");
    expect(varietyFor(test("  Fuuta Tooro  "), who("wol", "Dakar"))).toBe("Fuuta Tooro");
    expect(varietyFor(test("   "), who("wol", "Dakar"))).toBeNull();
    expect(varietyFor(test("x".repeat(81)), who("wol", "Dakar"))).toBeNull();
    expect(varietyFor(test("x".repeat(80)), who("wol", "Dakar"))).toBe("x".repeat(80));
    // A collection campaign ignores the field.
    expect(varietyFor({ ...card("wol", ["Dakar"]), kind: "collection" as const, qualification: { attempt_no: 1, stage: "recording" as const, decision: null, accepted: null, total: 10, retry_after: null, variety: "Saloum" } }, who("wol", "Dakar"))).toBe("Dakar");
  });
});
