import { describe, expect, it } from "vitest";
import { autoStopAtS, canRecordNow, nextInQueue, paddingS, sessionGoal, sessionQueue, skip } from "./studio-flow";
import type { CampaignCard, Mission } from "./types";

const m = (id: string, position: number, over: Partial<Mission> = {}): Mission => ({
  mission_id: id,
  code: `M${position}`,
  type: "read",
  position,
  status: "todo",
  rejection_reason: null,
  prompt: { id: `P${position}`, text_or_topic: "x", category: null },
  duration_s: { min: 3, max: 15 },
  partner_speaker_id: null,
  partner_ready: false,
  recording: null,
  ...over,
});

const card = (over: Partial<CampaignCard["instructions"]> = {}) =>
  ({ instructions: { recording: { min_level_dbfs: -35, silence_margin_s: 1 }, speech_types: [], ...over } }) as unknown as CampaignCard;

describe("studio queue", () => {
  const list = [m("a", 3), m("b", 1), m("c", 2, { status: "rejected" }), m("d", 4, { status: "submitted" }), m("e", 5, { type: "conversational" })];

  it("puts the missions to redo first, then the rest by position; skips done and partner-blocked", () => {
    expect(sessionQueue(list, new Map(), null)).toEqual(["c", "b", "a"]);
  });
  it("starts on the asked mission when it can be recorded", () => {
    expect(sessionQueue(list, new Map(), "a")).toEqual(["a", "c", "b"]);
    expect(sessionQueue(list, new Map(), "d")).toEqual(["c", "b", "a"]);
  });
  it("leaves out missions with a take waiting on the phone, but not a failed one", () => {
    expect(canRecordNow(m("a", 1), new Map([["a", "pending"]]))).toBe(false);
    expect(canRecordNow(m("a", 1), new Map([["a", "failed"]]))).toBe(true);
  });
  it("finds the next open one, wrapping round to skipped ones", () => {
    const open = new Set(["b", "c"]);
    expect(nextInQueue(["a", "b", "c"], "a", (id) => open.has(id))).toBe("b");
    expect(nextInQueue(["a", "b", "c"], "c", (id) => open.has(id))).toBe("b");
    expect(nextInQueue(["a"], "a", () => true)).toBeNull();
    expect(skip(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
  });
  it("takes the session goal and silence padding from the campaign", () => {
    expect(sessionGoal(card())).toBeNull();
    expect(sessionGoal(card({ speech_types: [{ type: "read", duration_min_s: 3, duration_max_s: 15, missions_per_session: { min: 20, max: 50 } }, { type: "spontaneous", duration_min_s: 3, duration_max_s: 15, missions_per_session: { min: 10, max: 20 } }] }))).toBe(10);
    expect(paddingS(card())).toBe(1.2);
    expect(paddingS(card({ recording: { min_level_dbfs: -35, silence_margin_s: 0 } }))).toBe(1.2);
  });
});

describe("auto-stop (APP-005)", () => {
  it("timed takes stop at their maximum, tail included", () => {
    expect(autoStopAtS(true, 60, 1.2)).toBeCloseTo(58.8);
  });
  it("a read take stops 1 s past its maximum", () => {
    expect(autoStopAtS(false, 15, 1.2)).toBe(16);
  });
  it("nothing runs past 10 minutes", () => {
    expect(autoStopAtS(true, 3600, 1)).toBe(599);
    expect(autoStopAtS(false, 3600, 1)).toBe(599);
    expect(autoStopAtS(false, 0, 1)).toBe(599);
  });
});
