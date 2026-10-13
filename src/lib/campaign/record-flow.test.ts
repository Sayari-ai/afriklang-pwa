import { describe, expect, it } from "vitest";
import { buildMetadata, buildSayariCampaignFields, deviceLabel, formatClock, takeRules } from "./record-flow";
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
  it("uses the speech type and recording settings", () => expect(takeRules(card(), mission())).toEqual({ durationMinS: 20, durationMaxS: 60, minLevelDbfs: -30, silenceMarginS: 2 }));
  it("falls back to the mission and defaults", () => {
    const c = card({ instructions: undefined as never });
    expect(takeRules(c, mission())).toEqual({ durationMinS: 10, durationMaxS: 90, minLevelDbfs: -35, silenceMarginS: 1 });
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
