/**
 * Measurements of a finished take, for the campaign capture checks and the metadata the
 * dashboard asks for (duration, average level, peak, silence before/after, sha-256).
 *
 * Works on the WAV the recorder produced (PCM16). Pure apart from `sha256Hex`, which uses
 * Web Crypto. The dashboard repeats the checks; these exist so a contributor finds out
 * right away, not after an upload.
 */

export type WavInfo = { sampleRate: number; channels: number; samples: Float32Array };

/** Decode a 16-bit PCM WAV (mono or stereo; stereo is averaged to mono). */
export function parseWav(buf: ArrayBuffer): WavInfo {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let format = 0;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.byteLength) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    if (id === "fmt ") {
      format = v.getUint16(offset + 8, true);
      channels = v.getUint16(offset + 10, true);
      sampleRate = v.getUint32(offset + 12, true);
      bits = v.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataLength = Math.min(size, buf.byteLength - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || format !== 1 || bits !== 16 || channels < 1 || channels > 2 || sampleRate <= 0) throw new Error("Unsupported WAV (16-bit PCM expected)");

  const frames = Math.floor(dataLength / (2 * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += v.getInt16(dataStart + (i * channels + c) * 2, true);
    samples[i] = sum / channels / 32768;
  }
  return { sampleRate, channels, samples };
}

export type TakeAnalysis = {
  duration_s: number;
  /** Average level of the speech parts (RMS), in dBFS. */
  level_dbfs: number;
  peak_dbfs: number;
  silence_before_s: number;
  silence_after_s: number;
};

const FLOOR_DB = -120;
/** A 20 ms frame quieter than this counts as silence. */
export const SILENCE_THRESHOLD_DBFS = -50;
const FRAME_S = 0.02;

const toDb = (x: number) => (x <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(x)));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function analyzeSamples(samples: Float32Array, sampleRate: number): TakeAnalysis {
  const duration = samples.length / sampleRate;
  const frame = Math.max(1, Math.round(sampleRate * FRAME_S));
  const frames = Math.ceil(samples.length / frame);

  let peak = 0;
  const rms: number[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    let sumSq = 0;
    const start = f * frame;
    const end = Math.min(samples.length, start + frame);
    for (let i = start; i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
      sumSq += samples[i] * samples[i];
    }
    rms[f] = Math.sqrt(sumSq / Math.max(1, end - start));
  }

  const active = rms.map((r) => toDb(r) > SILENCE_THRESHOLD_DBFS);
  const first = active.indexOf(true);
  if (first === -1) {
    return { duration_s: round2(duration), level_dbfs: FLOOR_DB, peak_dbfs: round2(toDb(peak)), silence_before_s: round2(duration), silence_after_s: round2(duration) };
  }
  const last = active.lastIndexOf(true);

  let sumSq = 0;
  let n = 0;
  for (let f = 0; f < frames; f++) {
    if (!active[f]) continue;
    sumSq += rms[f] * rms[f];
    n++;
  }
  const secondsOfFrame = (count: number) => Math.min(duration, count * (frame / sampleRate));
  return {
    duration_s: round2(duration),
    level_dbfs: round2(toDb(Math.sqrt(sumSq / n))),
    peak_dbfs: round2(toDb(peak)),
    silence_before_s: round2(secondsOfFrame(first)),
    silence_after_s: round2(Math.max(0, duration - secondsOfFrame(last + 1))),
  };
}

export async function analyzeWav(blob: Blob): Promise<TakeAnalysis & { sample_rate: number; channels: number }> {
  const wav = parseWav(await blob.arrayBuffer());
  return { ...analyzeSamples(wav.samples, wav.sampleRate), sample_rate: wav.sampleRate, channels: 1 };
}

/** sha-256 (64 hex characters) of the file exactly as it will be uploaded. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Capture checks (the same rules the dashboard applies) ────────────────

export type TakeProblem = "silent" | "too_short" | "too_long" | "too_quiet" | "clipped" | "silence";

export type TakeRules = {
  durationMinS: number;
  durationMaxS: number;
  minLevelDbfs: number;
  silenceMarginS: number;
};

const DURATION_TOLERANCE_S = 0.5;
const SILENCE_SLACK = 0.5;

/** The first thing wrong with a take, or null when it is fine. */
export function checkTake(a: TakeAnalysis, rules: TakeRules): TakeProblem | null {
  // Not one frame above the silence threshold: the microphone heard nothing (muted, covered or not working).
  if (a.level_dbfs <= FLOOR_DB) return "silent";
  if (a.duration_s < rules.durationMinS - DURATION_TOLERANCE_S) return "too_short";
  if (a.duration_s > rules.durationMaxS + DURATION_TOLERANCE_S) return "too_long";
  if (a.level_dbfs < rules.minLevelDbfs) return "too_quiet";
  if (a.peak_dbfs >= 0) return "clipped";
  const needed = rules.silenceMarginS * SILENCE_SLACK;
  if (a.silence_before_s < needed || a.silence_after_s < needed) return "silence";
  return null;
}
