/**
 * The server's time, as well as the phone can tell (APP-011). Pool leases (`lease_until`) are the
 * server's clock; a phone whose date is wrong (a reset after a battery swap is common) would see
 * every lease as over, or none. The offset is measured from the `Date` (+ `Age`) header of a
 * same-origin HEAD request, which no service worker route answers from a cache, and kept on the
 * phone so it also applies offline.
 */

const KEY = "afriklang.campaign.clockSkew.v1";
/** Differences under this are measurement noise (the header has a 1 s resolution, plus caching). */
const NOISE_MS = 2 * 60_000;
const MEASURE_EVERY_MS = 6 * 3_600_000;

let skew: number | null = null;
let lastMeasure = 0;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Server time minus phone time (ms); 0 when unknown or negligible. */
export function clockSkewMs(): number {
  if (skew === null) {
    const v = Number(storage()?.getItem(KEY) ?? "0");
    skew = Number.isFinite(v) ? v : 0;
  }
  return skew;
}

/** The server's "now" (ms since epoch). */
export const serverNow = (): number => Date.now() + clockSkewMs();

/**
 * Skew from one answer: `t0`/`t1` the phone's time before and after the request. Null when the
 * headers are unusable; 0 under the noise level. Pure: exported for tests.
 */
export function skewFrom(dateHeader: string | null, ageHeader: string | null, t0: number, t1: number): number | null {
  if (!dateHeader) return null;
  const date = Date.parse(dateHeader);
  if (!Number.isFinite(date)) return null;
  const age = ageHeader && /^\d{1,7}$/.test(ageHeader.trim()) ? Number(ageHeader.trim()) * 1000 : 0;
  // The header is truncated to the second: its middle is 500 ms later.
  const server = date + 500 + age;
  const local = (t0 + t1) / 2;
  const d = server - local;
  return Math.abs(d) < NOISE_MS ? 0 : Math.round(d);
}

export function setClockSkew(ms: number) {
  skew = ms;
  try {
    storage()?.setItem(KEY, String(ms));
  } catch {
    // memory only
  }
}

/** Measure again, at most every few hours, online only. Best effort. */
export async function measureClockSkew(force = false): Promise<void> {
  if (typeof window === "undefined" || navigator.onLine === false) return;
  if (!force && Date.now() - lastMeasure < MEASURE_EVERY_MS && Date.now() >= lastMeasure) return;
  lastMeasure = Date.now();
  try {
    const t0 = Date.now();
    const res = await fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store" });
    const t1 = Date.now();
    // A slow answer says little about the time.
    if (t1 - t0 > 10_000) return;
    const d = skewFrom(res.headers.get("date"), res.headers.get("age"), t0, t1);
    if (d !== null) setClockSkew(d);
  } catch {
    // try again next time
  }
}
