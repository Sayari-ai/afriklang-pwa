import { describe, expect, it } from "vitest";
import { autoStopAtS, canRecordNow, focusQueue, MAX_FOCUS, nextInQueue, paddingS, parseFocus, queueProgress, sessionGoal, sessionQueue, skip } from "./studio-flow";
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

describe("studio link focus (?m=a,b)", () => {
  const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("parses well-formed ids, once each, at most ten, and nothing else", () => {
    expect(parseFocus(null)).toEqual([]);
    expect(parseFocus("")).toEqual([]);
    expect(parseFocus(u(1))).toEqual([u(1)]);
    expect(parseFocus(`${u(1)},${u(2)}`)).toEqual([u(1), u(2)]);
    expect(parseFocus(` ${u(1)} , ${u(2)},`)).toEqual([u(1), u(2)]);
    expect(parseFocus(`${u(1)},${u(1)},${u(2)}`)).toEqual([u(1), u(2)]);
    expect(parseFocus(`${u(1)},m2,../admin,${u(2).slice(0, 35)},${u(3)}x,<b>`)).toEqual([u(1)]);
    // Lowercased: the dashboard writes ids in lowercase and the queue matches them exactly.
    const hex = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    expect(parseFocus(hex.toUpperCase())).toEqual([hex]);
    expect(parseFocus(`${hex.toUpperCase()},${hex},${u(2)}`)).toEqual([hex, u(2)]);
    const many = Array.from({ length: 14 }, (_, i) => u(i + 1));
    expect(parseFocus(many.join(","))).toEqual(many.slice(0, MAX_FOCUS));
  });

  it("a focus of two out of ten open missions is a session of exactly those two, in the link's order", () => {
    const ten = Array.from({ length: 10 }, (_, i) => m(u(i + 1), i + 1, i < 2 ? { status: "rejected" } : {}));
    expect(sessionQueue(ten, new Map(), [u(7), u(2)])).toEqual([u(7), u(2)]);
    expect(focusQueue(ten, new Map(), [u(7), u(2)])).toEqual([u(7), u(2)]);
    // An id that is not a mission here, or one that cannot be recorded, is left out.
    expect(sessionQueue(ten, new Map(), [u(99), u(7)])).toEqual([u(7)]);
    expect(sessionQueue(ten, new Map([[u(7), "pending"]]), [u(7), u(2)])).toEqual([u(2)]);
  });

  it("a focus whose missions were all sent (or wait on the phone) gives the full order instead", () => {
    const ten = Array.from({ length: 10 }, (_, i) => m(u(i + 1), i + 1, i < 2 ? { status: "submitted" } : {}));
    const full = Array.from({ length: 8 }, (_, i) => u(i + 3));
    expect(sessionQueue(ten, new Map(), [u(1), u(2)])).toEqual(full);
    expect(sessionQueue(ten, new Map([[u(3), "pending"]]), [u(3)])).toEqual(full.slice(1));
    expect(focusQueue(ten, new Map(), [u(1), u(2)])).toEqual([]);
  });

  it("the counter of a focus counts its queue, not the whole test", () => {
    // Two refused clips of a ten-clip test: "1 of 2", then "2 of 2" once the first waits on the phone.
    const ten = Array.from({ length: 10 }, (_, i) => m(u(i + 1), i + 1, i < 2 ? { status: "rejected" } : { status: "submitted" }));
    const queue = sessionQueue(ten, new Map(), [u(2), u(1)]);
    const openWith = (onPhone: Map<string, "pending">) => (id: string) => canRecordNow(ten.find((x) => x.mission_id === id)!, onPhone);
    expect(queueProgress(queue, openWith(new Map()))).toEqual({ position: 1, total: 2, left: 2 });
    expect(queueProgress(queue, openWith(new Map([[u(2), "pending"]])))).toEqual({ position: 2, total: 2, left: 1 });
    // Skipping only reorders: the count does not move.
    expect(queueProgress(skip(queue, u(2)), openWith(new Map()))).toEqual({ position: 1, total: 2, left: 2 });
    // All recorded: never past the end.
    expect(queueProgress(queue, () => false)).toEqual({ position: 2, total: 2, left: 0 });
    expect(queueProgress([], () => false)).toEqual({ position: 1, total: 0, left: 0 });
  });

  it("a single id keeps today's order", () => {
    const list = [m("a", 3), m("b", 1), m("c", 2, { status: "rejected" })];
    expect(sessionQueue(list, new Map(), "a")).toEqual(["a", "c", "b"]);
    expect(sessionQueue(list, new Map(), ["a"])).toEqual(["a"]);
  });
});

describe("auto-stop (APP-005)", () => {
  it("timed takes stop at their maximum, tail included", () => {
    expect(autoStopAtS(true, 60, 1.2)).toBeCloseTo(58.8);
  });
  it("a read take also stops at its maximum, so an auto-stopped take is never too long (N-10)", () => {
    expect(autoStopAtS(false, 15, 1.2)).toBeCloseTo(13.8);
  });
  it("nothing runs past 10 minutes", () => {
    expect(autoStopAtS(true, 3600, 1)).toBe(599);
    expect(autoStopAtS(false, 3600, 1)).toBe(599);
    expect(autoStopAtS(false, 0, 1)).toBe(599);
  });
});
