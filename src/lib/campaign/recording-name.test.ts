import { describe, expect, it } from "vitest";
import { buildCampaignFilename, sanitizePart } from "./recording-name";

const now = new Date(Date.UTC(2026, 4, 1, 14, 30, 5));

describe("buildCampaignFilename", () => {
  it("follows lang_speaker_stamp_code.wav", () => {
    expect(buildCampaignFilename({ languageCode: "wo", speakerId: "f47ac10b-58cc", missionCode: "R-012", now })).toBe("wo_f47ac10b-58cc_20260501T143005Z_R-012.wav");
  });
  it("removes path and odd characters", () => {
    const name = buildCampaignFilename({ languageCode: "../wo", speakerId: "a/b\\c d.e", missionCode: "x?*:y", now });
    expect(name).toMatch(/^[A-Za-z0-9_-]+\.wav$/);
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
  it("caps the length at 120", () => {
    const name = buildCampaignFilename({ languageCode: "w".repeat(50), speakerId: "s".repeat(200), missionCode: "m".repeat(300), now });
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(".wav")).toBe(true);
    expect(name).toContain("20260501T143005Z");
  });
  it("falls back when a part is empty", () => {
    expect(sanitizePart("???", 10, "x")).toBe("x");
    expect(buildCampaignFilename({ languageCode: "", speakerId: "", missionCode: "", now })).toBe("xx_unknown_20260501T143005Z_mission.wav");
  });
});
