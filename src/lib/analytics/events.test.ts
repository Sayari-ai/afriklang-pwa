import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_EVENTS, MAX_PROP_LENGTH, cleanProps, setAnalyticsClient, track, type AnalyticsClient } from "./events";

const fake = { __loaded: true, capture: vi.fn() };
const start = () => setAnalyticsClient(fake as unknown as AnalyticsClient);

describe("track", () => {
  beforeEach(() => {
    setAnalyticsClient(null);
    fake.capture.mockReset();
    vi.stubGlobal("window", {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAnalyticsClient(null);
  });

  it("does nothing while PostHog has not started (no token, localhost)", () => {
    track("take_skipped", { mission_type: "read", campaign_kind: "collection" });
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it("does nothing on the server (no window)", () => {
    vi.unstubAllGlobals();
    start();
    track("app_update_applied");
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it("sends the event with its properties once PostHog runs", () => {
    start();
    track("take_checked", { result: "advice", problem: "too_quiet", duration_s: 4.2, mission_type: "read" });
    expect(fake.capture).toHaveBeenCalledWith("take_checked", { result: "advice", problem: "too_quiet", duration_s: 4.2, mission_type: "read" }, undefined);
  });

  it("sends at once when asked (the page is about to go away)", () => {
    start();
    track("app_update_applied", {}, { instant: true });
    expect(fake.capture).toHaveBeenCalledWith("app_update_applied", {}, { send_instantly: true });
  });

  it("never throws, even when the SDK does", () => {
    start();
    fake.capture.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => track("sign_in_completed")).not.toThrow();
  });
});

describe("cleanProps", () => {
  it("keeps strings, finite numbers and booleans", () => {
    expect(cleanProps({ a: "x", b: 2, c: false })).toEqual({ a: "x", b: 2, c: false });
  });

  it("drops undefined, objects, arrays and non-finite numbers", () => {
    expect(cleanProps({ a: undefined, b: { text: "prompt" }, c: ["x"], d: NaN, e: Infinity, f: null })).toEqual({});
  });

  it("cuts long strings so no sentence can travel", () => {
    const long = "a".repeat(200);
    expect(cleanProps({ code: long }).code).toHaveLength(MAX_PROP_LENGTH);
  });

  it("handles no properties", () => {
    expect(cleanProps(undefined)).toEqual({});
  });
});

describe("event names", () => {
  it("are unique snake_case names", () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
    for (const name of ANALYTICS_EVENTS) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});
