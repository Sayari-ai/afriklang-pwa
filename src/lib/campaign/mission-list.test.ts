import { describe, expect, it } from "vitest";
import { groupMissions, nextMissionId, percentDone, truncate } from "./mission-list";
import type { Mission } from "./types";

const m = (position: number, status: Mission["status"], extra: Partial<Mission> = {}): Mission => ({
  mission_id: `m${position}`, code: `C_M${position}`, type: "read", position, status, rejection_reason: null,
  prompt: { id: `p${position}`, text_or_topic: "t", category: null }, duration_s: { min: 3, max: 15 },
  partner_speaker_id: null, partner_ready: false, recording: null, ...extra,
});

describe("groupMissions", () => {
  it("splits by status in position order", () => {
    const g = groupMissions([m(3, "accepted"), m(2, "rejected"), m(1, "todo"), m(4, "submitted"), m(0, "todo")]);
    expect(g.toRecord.map((x) => x.position)).toEqual([0, 1]);
    expect(g.toRedo.map((x) => x.position)).toEqual([2]);
    expect(g.done.map((x) => x.position)).toEqual([3, 4]);
  });
});

describe("nextMissionId", () => {
  const list = [m(1, "todo"), m(2, "submitted"), m(3, "todo"), m(4, "rejected")];
  it("goes forward, skipping done ones", () => {
    expect(nextMissionId(list, "m1")).toBe("m3");
    expect(nextMissionId(list, "m3")).toBe("m4");
  });
  it("wraps around to earlier ones", () => expect(nextMissionId(list, "m4")).toBe("m1"));
  it("returns null when nothing else is left", () => {
    expect(nextMissionId([m(1, "todo"), m(2, "accepted")], "m1")).toBeNull();
  });
  it("skips conversations whose partner is not ready", () => {
    const l = [m(1, "todo"), m(2, "todo", { type: "conversational", partner_ready: false }), m(3, "todo", { type: "conversational", partner_ready: true })];
    expect(nextMissionId(l, "m1")).toBe("m3");
  });
  it("without a current mission gives the first recordable", () => expect(nextMissionId(list, null)).toBe("m1"));
});

describe("helpers", () => {
  it("percentDone", () => {
    expect(percentDone({ total: 0, submitted: 0, accepted: 0 })).toBe(0);
    expect(percentDone({ total: 10, submitted: 2, accepted: 3 })).toBe(50);
  });
  it("truncate", () => {
    expect(truncate("short")).toBe("short");
    expect(truncate("a".repeat(100), 10)).toHaveLength(10);
  });
});
