import { describe, expect, it } from "vitest";
import { checkTake, SAYARI_QC } from "@/lib/audio/analyze";
import { buildMetadata, buildSayariCampaignFields, deviceLabel, draftProblem, formatClock, qcLimitsOf, takeRules } from "./record-flow";
import type { CampaignCard, Mission } from "./types";

const card = (over: Partial<CampaignCard> = {}): CampaignCard =>
  ({
    next_step: "ready",
    instructions: { recording: { min_level_dbfs: -30, silence_margin_s: 2 }, speech_types: [{ type: "spontaneous", duration_min_s: 20, duration_max_s: 60 }] },
    ...over,
  }) as CampaignCard;
const mission = (over: Partial<Mission> = {}): Mission =>
  ({ mission_id: "m1", code: "S-1", type: "spontaneous", position: 1, status: "todo", duration_s: { min: 10, max: 90 }, partner_ready: true, ...over }) as Mission;

describe("takeRules", () => {
  it("uses the speech type and recording settings", () => expect(takeRules(card(), mission())).toEqual({ durationMinS: 20, durationMaxS: 60, minLevelDbfs: -30, silenceMarginS: 2, qc: SAYARI_QC }));
  it("falls back to the mission and defaults", () => {
    const c = card({ instructions: undefined as never });
    expect(takeRules(c, mission())).toEqual({ durationMinS: 10, durationMaxS: 90, minLevelDbfs: -35, silenceMarginS: 1, qc: SAYARI_QC });
  });
});

describe("QC limits from the card (decision B)", () => {
  const live = { min_snr_db: 15, max_background_noise_db: -30, max_clipping_ratio: 0.002, max_silence_ratio: 0.4 };
  it("takes the card's limits, value by value, and Sayari's defaults for what is missing", () => {
    expect(qcLimitsOf(card({ qc_limits: live }))).toEqual({ minSnrDb: 15, maxBackgroundNoiseDb: -30, maxClippingRatio: 0.002, maxSilenceRatio: 0.4 });
    expect(qcLimitsOf(card({ qc_limits: { ...live, min_snr_db: "x" as never } })).minSnrDb).toBe(SAYARI_QC.minSnrDb);
    expect(qcLimitsOf(card())).toEqual(SAYARI_QC);
    expect(qcLimitsOf(card({ qc_limits: null }))).toEqual(SAYARI_QC);
  });
  it("the advice follows the card's limits", () => {
    // 12 dB SNR and 0.5 % clipped samples: fine by the defaults, advised under the card's stricter limits
    const a = { duration_s: 30, level_dbfs: -20, peak_dbfs: 0, silence_before_s: 2, silence_after_s: 2, qc: { snr_db: 12, background_noise_db: -50, silence_ratio: 0.1, clipping_ratio: 0.005 } };
    expect(checkTake(a, takeRules(card(), mission()))).toBeNull();
    expect(checkTake(a, takeRules(card({ qc_limits: live }), mission()))).toEqual({ problem: "clipped", blocking: false });
    expect(checkTake({ ...a, qc: { ...a.qc, clipping_ratio: 0 } }, takeRules(card({ qc_limits: live }), mission()))).toEqual({ problem: "noisy", blocking: false });
  });
});

describe("misc", () => {
  it("deviceLabel", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Chrome/120 Mobile Safari/537")).toBe("Android Chrome");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Mobile Safari/604")).toBe("iOS Safari");
    expect(deviceLabel("")).toBe("unknown");
  });
  it("formatClock", () => expect(formatClock(65)).toBe("1:05"));
  it("buildMetadata includes the Sayari id only when present", () => {
    const a = { duration_s: 5, level_dbfs: -20, peak_dbfs: -3, silence_before_s: 1, silence_after_s: 1, sample_rate: 16000, channels: 1 };
    expect(buildMetadata(a, "x", "d", null)).not.toHaveProperty("sayari_recording_id");
    expect(buildMetadata(a, "x", "d", "id1").sayari_recording_id).toBe("id1");
  });
});

describe("buildSayariCampaignFields", () => {
  const c = card({ campaign_id: "c1", code: "WOL_FIN_PILOT_01", topic: { domain: "Banking", sub_domain: null } });
  const m = mission({ prompt: { id: "P7", text_or_topic: "x", category: null }, partner_speaker_id: null });
  const meta = buildMetadata({ duration_s: 8.2, level_dbfs: -22, peak_dbfs: -1.5, silence_before_s: 1.1, silence_after_s: 1, sample_rate: 16000, channels: 1 }, "a".repeat(64), "Android Chrome", null);
  it("sends identifiers and measurements as strings, leaving absent values out", () => {
    const f = buildSayariCampaignFields(c, m, meta);
    expect(f).toMatchObject({ campaign_code: "WOL_FIN_PILOT_01", mission_code: "S-1", mission_type: "spontaneous", prompt_id: "P7", duration_s: "8.2", channels: "1", domain: "Banking" });
    expect(f).not.toHaveProperty("sub_domain");
    expect(f).not.toHaveProperty("partner_speaker_id");
    expect(f).not.toHaveProperty("prompt_category");
  });
  it("never carries a name, email or user id", () => {
    expect(Object.keys(buildSayariCampaignFields(c, m, meta)).join(" ")).not.toMatch(/name|email|user_id/);
  });
});

describe("draftProblem", () => {
  // A take saved on the phone the moment recording stopped (drafts.ts) comes back on the review
  // screen after a crash. The length check runs again on it: a crash between saving the draft and
  // the check could keep a take that must be recorded again, and it must not come back as checked.
  const fine = { duration_s: 25, level_dbfs: -20, peak_dbfs: -3, silence_before_s: 2, silence_after_s: 2, noise_floor_dbfs: -60 };
  it("names the blocking problem of a saved take, and nothing for one that only gets advice", () => {
    expect(draftProblem({ ...fine, duration_s: 4 }, card(), mission())).toBe("too_short");
    expect(draftProblem({ ...fine, duration_s: 61 }, card(), mission())).toBe("too_long");
    expect(draftProblem(fine, card(), mission())).toBeNull();
    // Too quiet is advice on the review screen, not a reason to drop the take.
    expect(draftProblem({ ...fine, level_dbfs: -40 }, card(), mission())).toBeNull();
    // The rules are the draft's mission's, not another mission's: a read sentence has its own length.
    expect(draftProblem({ ...fine, duration_s: 4 }, card({ instructions: { speech_types: [{ type: "read", duration_min_s: 2, duration_max_s: 10 }] } }), mission({ type: "read" }))).toBeNull();
  });
});
