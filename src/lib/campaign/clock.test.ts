import { describe, expect, it } from "vitest";
import { skewFrom } from "./clock";

describe("clock skew (APP-011)", () => {
  const t = Date.parse("2026-10-13T10:00:00Z");
  it("measures a phone three days ahead", () => {
    const phone = t + 3 * 86_400_000;
    expect(skewFrom(new Date(t).toUTCString(), null, phone, phone + 200)).toBeCloseTo(-3 * 86_400_000, -4);
  });
  it("adds a CDN's Age to its cached Date", () => {
    expect(skewFrom(new Date(t - 3_600_000).toUTCString(), "3600", t + 86_400_000, t + 86_400_000)).toBeCloseTo(-86_400_000, -4);
  });
  it("ignores noise and unusable headers", () => {
    expect(skewFrom(new Date(t).toUTCString(), null, t + 30_000, t + 30_000)).toBe(0);
    expect(skewFrom(null, null, t, t)).toBeNull();
    expect(skewFrom("yesterday", null, t, t)).toBeNull();
  });
});
