import { describe, expect, it } from "vitest";
import { formatMeasure, rejectDetailOf, rejectDetailMessage } from "./reject-detail";
import { REJECT_CHECKS, type RejectDetail } from "./types";

const good: RejectDetail = { check: "low_snr", measured: 7.3, limit: 10, unit: "dB", bound: "min" };

describe("rejectDetailOf", () => {
  it("accepts the dashboard's shape, every check, and null numbers", () => {
    expect(rejectDetailOf(good)).toEqual(good);
    for (const check of REJECT_CHECKS) expect(rejectDetailOf({ ...good, check })?.check).toBe(check);
    expect(rejectDetailOf({ check: "wrong_format", measured: null, limit: null, unit: null, bound: null })).toEqual({ check: "wrong_format", measured: null, limit: null, unit: null, bound: null });
    // Extra keys from a newer dashboard are not copied.
    expect(rejectDetailOf({ ...good, extra: 1 })).toEqual(good);
  });

  it("refuses an unknown check, a number as a string, NaN, a missing key, and non-objects", () => {
    expect(rejectDetailOf({ ...good, check: "too_quiet" })).toBeNull();
    expect(rejectDetailOf({ ...good, measured: "7.3" })).toBeNull();
    expect(rejectDetailOf({ ...good, limit: Number.NaN })).toBeNull();
    expect(rejectDetailOf({ ...good, measured: Infinity })).toBeNull();
    const { bound, ...noBound } = good;
    void bound;
    expect(rejectDetailOf(noBound)).toBeNull();
    const { unit, ...noUnit } = good;
    void unit;
    expect(rejectDetailOf(noUnit)).toBeNull();
    expect(rejectDetailOf({ ...good, unit: "ms" })).toBeNull();
    expect(rejectDetailOf({ ...good, bound: "around" })).toBeNull();
    for (const v of [null, undefined, "low_snr", 7, [good], true]) expect(rejectDetailOf(v)).toBeNull();
  });
});

describe("rejectDetailMessage", () => {
  it("names the keys of the check and formats seconds, dB and dBFS with one decimal", () => {
    expect(rejectDetailMessage({ check: "too_short", measured: 2.14, limit: 3, unit: "s", bound: "min" }, "en")).toEqual({
      titleKey: "rejectDetail.too_short.title",
      fixKey: "rejectDetail.too_short.fix",
      measuredKey: "rejectDetail.too_short.measured",
      values: { measured: "2.1", limit: "3.0" },
    });
    expect(rejectDetailMessage(good, "fr").values).toEqual({ measured: "7,3", limit: "10,0" });
    expect(rejectDetailMessage({ check: "background_noise", measured: -38.26, limit: -45, unit: "dBFS", bound: "max" }, "en").values).toEqual({ measured: "-38.3", limit: "-45.0" });
  });

  it("shows a ratio as a percentage: no decimal from 10 %, one below, a decimal comma and a space in French", () => {
    expect(formatMeasure(0.014, "ratio", "en")).toBe("1.4%");
    expect(formatMeasure(0.014, "ratio", "fr")).toMatch(/^1,4\s%$/);
    expect(formatMeasure(0.25, "ratio", "en")).toBe("25%");
    expect(formatMeasure(0.1, "ratio", "fr")).toMatch(/^10\s%$/);
    expect(formatMeasure(0.0999, "ratio", "en")).toBe("10%");
    expect(rejectDetailMessage({ check: "clipping", measured: 0.014, limit: 0.005, unit: "ratio", bound: "max" }, "en").values).toEqual({ measured: "1.4%", limit: "0.5%" });
  });

  it("keeps the measured sentence of the checks that quote no number, and drops it when a needed number is missing", () => {
    for (const check of ["wrong_format", "processing_failed"] as const) {
      expect(rejectDetailMessage({ check, measured: null, limit: null, unit: null, bound: null }, "en").measuredKey).toBe(`rejectDetail.${check}.measured`);
    }
    expect(rejectDetailMessage({ ...good, measured: null }, "en").measuredKey).toBeNull();
    expect(rejectDetailMessage({ ...good, limit: null }, "fr").measuredKey).toBeNull();
  });
});
