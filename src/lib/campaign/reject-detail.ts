/**
 * The detail of a refused take: what the automatic check measured, and the words the speaker reads
 * about it. Pure (tested). The sentences themselves live in the message files under
 * `campaign.common.rejectDetail`, the same table as the dashboard's "to record again" email (E09).
 */

import { REJECT_CHECKS, type RejectCheck, type RejectDetail } from "./types";

const UNITS: ReadonlySet<string> = new Set(["s", "dB", "dBFS", "ratio"]);
const BOUNDS: ReadonlySet<string> = new Set(["min", "max"]);

const finiteOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));

/**
 * A `RejectDetail` when `v` is one (an object whose check is known, whose numbers are finite or
 * null, whose unit and bound are among the allowed values or null), else null. A hand-written
 * guard: the app bundle has no schema library, and a dashboard or Sayari newer than the app may
 * send a check this version does not know, which must not break the screen.
 */
export function rejectDetailOf(v: unknown): RejectDetail | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { check, measured, limit, unit, bound } = v as Record<string, unknown>;
  if (typeof check !== "string" || !(REJECT_CHECKS as readonly string[]).includes(check)) return null;
  if (!finiteOrNull(measured) || !finiteOrNull(limit)) return null;
  if (!(unit === null || (typeof unit === "string" && UNITS.has(unit)))) return null;
  if (!(bound === null || (typeof bound === "string" && BOUNDS.has(bound)))) return null;
  return { check: check as RejectCheck, measured, limit, unit: unit as RejectDetail["unit"], bound: bound as RejectDetail["bound"] };
}

/** Checks whose "what we measured" sentence quotes the measured value and the limit. */
const NUMERIC: ReadonlySet<RejectCheck> = new Set(["too_short", "too_long", "low_snr", "background_noise", "clipping", "long_silence"]);

/**
 * A number as the sentence shows it, by hand and without `Intl`, as the dashboard's email does
 * (doc 10 E09 "Number formatting": browser and server ICU versions differ in their spaces and
 * minus signs). Seconds, dB and dBFS with one decimal, an ASCII minus and no digit grouping. A
 * ratio as a percentage: no decimal once the value rounded to one decimal is 10 or more, else one
 * decimal with a trailing .0 dropped (0.014 → "1.4%", 0.01 → "1%", 0.0999 → "10%"). French puts a
 * decimal comma and a no-break space (U+00A0) before %; any other locale reads as English.
 */
export function formatMeasure(n: number, unit: RejectDetail["unit"], locale: string): string {
  const fr = /^fr(?![a-z])/i.test(locale);
  let s: string;
  if (unit === "ratio") {
    const pct = Number(fixed(n * 100, 1));
    s = Math.abs(pct) >= 10 ? fixed(pct, 0) : fixed(pct, 1).replace(/\.0$/, "");
  } else s = fixed(n, 1);
  if (fr) s = s.replace(".", ",");
  return unit === "ratio" ? `${s}${fr ? "\u00a0" : ""}%` : s;
}

/** `toFixed`, but plain digits for very large values (no exponent) and never a negative zero. */
function fixed(x: number, digits: 0 | 1): string {
  if (!Number.isFinite(x)) return String(x);
  const s = Math.abs(x) < 1e21 ? x.toFixed(digits) : `${BigInt(x)}${digits ? ".0" : ""}`;
  return /^-0(\.0)?$/.test(s) ? s.slice(1) : s;
}

export type RejectDetailMessage = {
  /** Under `campaign.common`: the one-line title of the check. */
  titleKey: string;
  /** Under `campaign.common`: how to fix it. */
  fixKey: string;
  /** Under `campaign.common`: the "what we measured" sentence, or null when it needs numbers the detail does not carry. */
  measuredKey: string | null;
  /** The placeholders of `measuredKey`, already formatted. */
  values: { measured: string; limit: string };
};

/**
 * Which messages say what was measured and how to fix it, with the numbers formatted for
 * `locale`. The caller translates the keys (they sit under `campaign.common`).
 */
export function rejectDetailMessage(d: RejectDetail, locale: string): RejectDetailMessage {
  const base = `rejectDetail.${d.check}`;
  const needsNumbers = NUMERIC.has(d.check);
  const hasNumbers = d.measured !== null && d.limit !== null;
  return {
    titleKey: `${base}.title`,
    fixKey: `${base}.fix`,
    measuredKey: needsNumbers && !hasNumbers ? null : `${base}.measured`,
    values: {
      measured: d.measured === null ? "" : formatMeasure(d.measured, d.unit, locale),
      limit: d.limit === null ? "" : formatMeasure(d.limit, d.unit, locale),
    },
  };
}
