import { describe, expect, it } from "vitest";
import {
  DRAW_BACKOFF_MS,
  DRAW_PAUSE_MS,
  addDrawn,
  earliestLease,
  elsewhereOf,
  hoursLeft,
  isPool,
  leaseOver,
  liveMissions,
  mergeDrawn,
  paidTime,
  refillBelow,
  removeReturned,
  shouldDraw,
  timeParts,
  totalPaidTime,
} from "./pool";
import type { Mission } from "./types";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const m = (id: string, status: Mission["status"], lease: string | null | undefined) => ({ mission_id: id, status, lease_until: lease });
const pool = { dispatch: "pool" as const, refill_below: 5, next_step: "ready" as const };

describe("dispatch", () => {
  it("a card without dispatch (older dashboard) is planned", () => {
    expect(isPool({})).toBe(false);
    expect(isPool({ dispatch: "planned" })).toBe(false);
    expect(isPool({ dispatch: "pool" })).toBe(true);
  });

  it("refill_below falls back to the dashboard default", () => {
    expect(refillBelow({ refill_below: 3 })).toBe(3);
    for (const v of [null, undefined, 0, -1]) expect(refillBelow({ refill_below: v as number })).toBe(5);
  });
});

describe("leases", () => {
  it("an open mission past its lease is over; submitted ones and planned ones never are", () => {
    expect(leaseOver(m("a", "todo", iso(NOW - 1)), NOW)).toBe(true);
    expect(leaseOver(m("a", "rejected", iso(NOW)), NOW)).toBe(true);
    expect(leaseOver(m("a", "todo", iso(NOW + 1)), NOW)).toBe(false);
    expect(leaseOver(m("a", "submitted", iso(NOW - 1)), NOW)).toBe(false);
    expect(leaseOver(m("a", "accepted", iso(NOW - 1)), NOW)).toBe(false);
    expect(leaseOver(m("a", "todo", null), NOW)).toBe(false);
    expect(leaseOver(m("a", "todo", undefined), NOW)).toBe(false);
    expect(leaseOver(m("a", "todo", "not a date"), NOW)).toBe(false);
  });

  it("liveMissions drops lapsed open missions and keeps the same array when nothing lapsed", () => {
    const list = [m("a", "todo", iso(NOW + 5)), m("b", "submitted", iso(NOW - 5)), m("c", "todo", null)];
    expect(liveMissions(list, NOW)).toBe(list);
    const lapsed = [...list, m("d", "todo", iso(NOW - 5))];
    expect(liveMissions(lapsed, NOW).map((x) => x.mission_id)).toEqual(["a", "b", "c"]);
  });

  it("earliestLease looks at open, still-running leases only", () => {
    const list = [m("a", "todo", iso(NOW + 7200_000)), m("b", "rejected", iso(NOW + 3600_000)), m("c", "submitted", iso(NOW + 60_000)), m("d", "todo", iso(NOW - 1))];
    expect(earliestLease(list, NOW)).toBe(NOW + 3600_000);
    expect(earliestLease([m("x", "todo", null)], NOW)).toBeNull();
  });

  it("hoursLeft rounds up and never says 0 before the end", () => {
    expect(hoursLeft(NOW + 60_000, NOW)).toBe(1);
    expect(hoursLeft(NOW + 3.2 * 3600_000, NOW)).toBe(4);
  });
});

describe("shouldDraw", () => {
  const base = { card: pool, open: 0, last: null, now: NOW, online: true };

  it("draws for a ready pool campaign running low, never for a planned one", () => {
    expect(shouldDraw(base)).toBe(true);
    expect(shouldDraw({ ...base, open: 4 })).toBe(true);
    expect(shouldDraw({ ...base, open: 5 })).toBe(false);
    expect(shouldDraw({ ...base, card: { ...pool, dispatch: "planned" } })).toBe(false);
    expect(shouldDraw({ ...base, card: { refill_below: null, next_step: "ready" } })).toBe(false);
  });

  it("not before setup is done, while paused or closed, or offline", () => {
    for (const next_step of ["profile", "blocked", "account_consent", "campaign_consent", "paused", "closed"] as const) expect(shouldDraw({ ...base, card: { ...pool, next_step } })).toBe(false);
    expect(shouldDraw({ ...base, online: false })).toBe(false);
  });

  it("waits a minute after a draw, and longer after a refusal or a failure", () => {
    expect(shouldDraw({ ...base, last: { at: NOW - DRAW_PAUSE_MS + 1, status: "ok", added: 0 } })).toBe(false);
    expect(shouldDraw({ ...base, last: { at: NOW - DRAW_PAUSE_MS, status: "ok", added: 0 } })).toBe(true);
    for (const status of ["cell_full", "campaign_full", "speaker_cap", "quality_hold", "error", "returned"] as const) {
      expect(shouldDraw({ ...base, last: { at: NOW - DRAW_PAUSE_MS, status, added: 0 } })).toBe(false);
      expect(shouldDraw({ ...base, last: { at: NOW - DRAW_BACKOFF_MS, status, added: 0 } })).toBe(true);
    }
    // a clock set back does not block drawing for ever
    expect(shouldDraw({ ...base, last: { at: NOW + 3600_000, status: "cell_full", added: 0 } })).toBe(true);
  });
});

describe("merging a draw", () => {
  it("adds only missions not already listed", () => {
    const r = mergeDrawn([m("a", "todo", null)], [m("a", "todo", null), m("b", "todo", null)]);
    expect(r.added).toBe(1);
    expect(r.missions.map((x) => x.mission_id)).toEqual(["a", "b"]);
  });

  it("moves the progress counts", () => {
    const p = { total: 3, todo: 1, submitted: 1, accepted: 0, rejected: 1 };
    expect(addDrawn(p, 0)).toBe(p);
    expect(addDrawn(p, 4)).toEqual({ ...p, total: 7, todo: 5 });
    expect(removeReturned(p, [{ status: "todo" }, { status: "rejected" }])).toEqual({ total: 1, todo: 0, submitted: 1, accepted: 0, rejected: 0 });
  });

  it("elsewhere skips the current campaign, duplicates and junk", () => {
    const e = elsewhereOf({ elsewhere: [{ campaign_id: "c1", title: "Here", code: null }, { campaign_id: "c2", title: "B", code: "B" }, { campaign_id: "c2", title: "B", code: "B" }, null as never] }, "c1");
    expect(e).toEqual([{ campaign_id: "c2", title: "B", code: "B" }]);
    expect(elsewhereOf(null, "c1")).toEqual([]);
  });
});

describe("pay per hour", () => {
  it("reads paid seconds, null when the dashboard does not send them", () => {
    expect(paidTime({ accepted: 8, accepted_s: 66, pending_s: 40 })).toEqual({ acceptedS: 66, pendingS: 40 });
    expect(paidTime({ accepted: 8, accepted_s: 66 })).toEqual({ acceptedS: 66, pendingS: 0 });
    expect(paidTime({ accepted: 8 })).toBeNull();
    expect(paidTime(undefined)).toBeNull();
  });

  it("adds the cards up, or gives up when one card has no paid time", () => {
    expect(totalPaidTime([{ rewards: { accepted: 1, accepted_s: 60, pending_s: 5 } }, { rewards: { accepted: 0, accepted_s: 30, pending_s: 0 } }])).toEqual({ acceptedS: 90, pendingS: 5 });
    expect(totalPaidTime([{ rewards: { accepted: 1, accepted_s: 60 } }, {}])).toBeNull();
    expect(totalPaidTime([])).toEqual({ acceptedS: 0, pendingS: 0 });
  });

  it("formats as hours and minutes, rounded down", () => {
    expect(timeParts(0)).toEqual({ key: "m", m: 0 });
    expect(timeParts(-5)).toEqual({ key: "m", m: 0 });
    expect(timeParts(Number.NaN)).toEqual({ key: "m", m: 0 });
    expect(timeParts(1)).toEqual({ key: "underMinute" });
    expect(timeParts(59.9)).toEqual({ key: "underMinute" });
    expect(timeParts(60)).toEqual({ key: "m", m: 1 });
    expect(timeParts(3599)).toEqual({ key: "m", m: 59 });
    expect(timeParts(3600)).toEqual({ key: "hm", h: 1, m: 0 });
    expect(timeParts(3600 + 5 * 60 + 59)).toEqual({ key: "hm", h: 1, m: 5 });
    expect(timeParts(1000 * 3600)).toEqual({ key: "hm", h: 1000, m: 0 });
  });
});
