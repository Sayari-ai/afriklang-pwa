import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { formatMeasure, rejectDetailOf, rejectDetailMessage } from "./reject-detail";
import { REJECT_CHECKS, type RejectDetail } from "./types";
import en from "../../messages/campaign/common.en.json";
import fr from "../../messages/campaign/common.fr.json";

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

describe("the words of a refused take (E09 check copy)", () => {
  /** The three lines as the screens build them (useRejectDetailText in CampaignHubParts). */
  const lines = (d: RejectDetail, locale: "en" | "fr") => {
    const t = createTranslator({ locale, messages: { common: locale === "en" ? en : fr }, namespace: "common" });
    const m = rejectDetailMessage(d, locale);
    return { title: t(m.titleKey), measured: m.measuredKey ? t(m.measuredKey, m.values) : null, fix: t(m.fixKey) };
  };
  const SAMPLE: Record<RejectDetail["check"], RejectDetail> = {
    too_short: { check: "too_short", measured: 2.14, limit: 3, unit: "s", bound: "min" },
    too_long: { check: "too_long", measured: 33.9, limit: 30, unit: "s", bound: "max" },
    low_snr: { check: "low_snr", measured: 7.3, limit: 10, unit: "dB", bound: "min" },
    background_noise: { check: "background_noise", measured: -38.2, limit: -45, unit: "dBFS", bound: "max" },
    clipping: { check: "clipping", measured: 0.014, limit: 0.005, unit: "ratio", bound: "max" },
    long_silence: { check: "long_silence", measured: 0.42, limit: 0.3, unit: "ratio", bound: "max" },
    wrong_format: { check: "wrong_format", measured: null, limit: null, unit: null, bound: null },
    processing_failed: { check: "processing_failed", measured: null, limit: null, unit: null, bound: null },
  };

  it("renders every check in English and French with the numbers in, and no placeholder left", () => {
    for (const check of REJECT_CHECKS) {
      for (const locale of ["en", "fr"] as const) {
        const l = lines(SAMPLE[check], locale);
        expect(l.title, `${check} ${locale}`).toMatch(/\S/);
        expect(l.fix, `${check} ${locale}`).toMatch(/\S/);
        expect(l.measured, `${check} ${locale}`).toMatch(/\S/);
        for (const s of [l.title, l.measured, l.fix]) expect(s, `${check} ${locale}`).not.toMatch(/[{}]|rejectDetail\./);
      }
    }
  });

  it("says exactly what the email says", () => {
    expect(lines(SAMPLE.too_short, "en")).toEqual({
      title: "Too short",
      measured: "It lasted 2.1 s; this prompt needs at least 3.0 s.",
      fix: "Watch the timer on screen and keep speaking until you reach the length it shows.",
    });
    expect(lines(SAMPLE.too_short, "fr").measured).toBe("Il durait 2,1 s ; cette consigne demande au moins 3,0 s.");
    expect(lines(SAMPLE.low_snr, "fr")).toEqual({
      title: "Votre voix ne ressortait pas assez du bruit de fond",
      measured: "Votre voix dépassait le bruit de fond de 7,3 dB ; il faut au moins 10,0 dB.",
      fix: "Installez-vous dans une pièce calme, éteignez ventilateur, télévision et musique, et tenez le téléphone à environ 20 cm de la bouche.",
    });
    expect(lines(SAMPLE.clipping, "en").measured).toBe("1.4% of the sound was saturated; the limit is 0.5%.");
    expect(lines(SAMPLE.clipping, "fr").measured).toMatch(/^1,4\s% du son était saturé ; la limite est de 0,5\s%\.$/);
    expect(lines(SAMPLE.long_silence, "en").measured).toBe("42% of the recording was silence between your first and last word; the limit is 30%.");
    expect(lines(SAMPLE.wrong_format, "fr").measured).toBe("L'enregistrement n'était pas au format attendu.");
    expect(lines(SAMPLE.processing_failed, "en")).toEqual({ title: "We could not process this recording", measured: "Our system could not read this recording. This is not your fault.", fix: "Please record it once more." });
  });
});
