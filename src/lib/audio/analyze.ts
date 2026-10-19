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
  /** Background level measured in the silence before the voice (dBFS), when known (APP-012). */
  noise_floor_dbfs?: number;
};

const FLOOR_DB = -120;
/** A 20 ms frame quieter than this counts as silence (in a quiet room; see speechThresholdDb). */
export const SILENCE_THRESHOLD_DBFS = -50;
/** Speech starts this far above the background noise (APP-012). */
export const SPEECH_ABOVE_FLOOR_DB = 10;
/** Background noise louder than this is what makes the silence check fail, not the speaker. */
export const NOISY_FLOOR_DBFS = -50;
/** Voice less than this far above the background: the take is too noisy to use. */
export const MIN_SNR_DB = 8;
const FRAME_S = 0.02;

const toDb = (x: number) => (x <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(x)));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Measurements per 20 ms frame, gathered as samples arrive (APP-005): the recorder feeds each block
 * as it is captured, so a take is measured without ever holding a second copy of it. Memory is
 * two numbers per frame (100 a second).
 */
export type FrameStats = {
  sampleRate: number;
  frameLen: number;
  /** Samples seen in total. */
  samples: number;
  /** RMS of each frame (0..1); the last frame may be partial. */
  rms: number[];
  /** Largest absolute sample of each frame (0..1). */
  framePeaks: number[];
  peak: number;
};

export function createTakeMeter(sampleRate: number) {
  const frameLen = Math.max(1, Math.round(sampleRate * FRAME_S));
  const rms: number[] = [];
  const framePeaks: number[] = [];
  let sumSq = 0;
  let inFrame = 0;
  let frameMax = 0;
  let peak = 0;
  let total = 0;
  return {
    /** Add samples; `scale` turns them into -1..1 (1/32768 for PCM16). */
    push(x: ArrayLike<number>, scale = 1) {
      for (let i = 0; i < x.length; i++) {
        const v = x[i] * scale;
        const a = v < 0 ? -v : v;
        if (a > frameMax) frameMax = a;
        sumSq += v * v;
        if (++inFrame === frameLen) {
          rms.push(Math.sqrt(sumSq / frameLen));
          framePeaks.push(frameMax);
          if (frameMax > peak) peak = frameMax;
          sumSq = 0;
          inFrame = 0;
          frameMax = 0;
        }
      }
      total += x.length;
    },
    stats(): FrameStats {
      const partial = inFrame > 0;
      return {
        sampleRate,
        frameLen,
        samples: total,
        rms: partial ? [...rms, Math.sqrt(sumSq / inFrame)] : rms.slice(),
        framePeaks: partial ? [...framePeaks, frameMax] : framePeaks.slice(),
        peak: Math.max(peak, frameMax),
      };
    },
  };
}

/**
 * The background noise level, from frames known to be silence: the studio's lead (it records
 * `leadS` seconds before saying "Speak now"). The first 100 ms are skipped (the microphone and its
 * gain control settle), and the median is taken so a cough or a click does not count.
 * Without a lead, the quietest tenth of the take stands in for it. Null when there is too little.
 */
export function noiseFloorDb(st: FrameStats, leadS?: number): number | null {
  const frameS = st.frameLen / st.sampleRate;
  let pool: number[];
  if (leadS && leadS > 0.3) {
    const from = Math.ceil(0.1 / frameS);
    const to = Math.min(st.rms.length, Math.floor((leadS * 0.9) / frameS));
    pool = st.rms.slice(from, to);
  } else {
    const sorted = [...st.rms].sort((a, b) => a - b);
    pool = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 10)));
  }
  if (pool.length < 5) return null;
  const sorted = [...pool].sort((a, b) => a - b);
  return toDb(sorted[Math.floor(sorted.length / 2)]);
}

/** Frames above this are speech: -50 dBFS in a quiet room, higher where the background is louder. */
export const speechThresholdDb = (floor: number | null) => Math.max(SILENCE_THRESHOLD_DBFS, floor == null ? SILENCE_THRESHOLD_DBFS : floor + SPEECH_ABOVE_FLOOR_DB);

export function analyzeStats(st: FrameStats, opts: { leadS?: number } = {}): TakeAnalysis {
  const duration = st.samples / st.sampleRate;
  const frames = st.rms.length;
  const floor = noiseFloorDb(st, opts.leadS);
  const threshold = speechThresholdDb(floor);
  const withFloor = floor == null ? {} : { noise_floor_dbfs: round2(floor) };
  const active = st.rms.map((r) => toDb(r) > threshold);
  const first = active.indexOf(true);
  if (first === -1) {
    return { duration_s: round2(duration), level_dbfs: FLOOR_DB, peak_dbfs: round2(toDb(st.peak)), silence_before_s: round2(duration), silence_after_s: round2(duration), ...withFloor };
  }
  const last = active.lastIndexOf(true);

  let sumSq = 0;
  let n = 0;
  for (let f = 0; f < frames; f++) {
    if (!active[f]) continue;
    sumSq += st.rms[f] * st.rms[f];
    n++;
  }
  const secondsOfFrame = (count: number) => Math.min(duration, count * (st.frameLen / st.sampleRate));
  return {
    duration_s: round2(duration),
    level_dbfs: round2(toDb(Math.sqrt(sumSq / n))),
    peak_dbfs: round2(toDb(st.peak)),
    silence_before_s: round2(secondsOfFrame(first)),
    silence_after_s: round2(Math.max(0, duration - secondsOfFrame(last + 1))),
    ...withFloor,
  };
}

/** `n` bars for a waveform picture from the frame peaks: the loudest frame of each slice, 0..1. */
export function peaksFromStats(st: FrameStats, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  const fp = st.framePeaks;
  if (!fp.length || n <= 0) return out;
  const size = fp.length / n;
  for (let b = 0; b < n; b++) {
    let max = 0;
    const end = Math.min(fp.length, Math.max(Math.floor(b * size) + 1, Math.floor((b + 1) * size)));
    for (let i = Math.floor(b * size); i < end; i++) if (fp[i] > max) max = fp[i];
    out[b] = Math.min(1, max);
  }
  return out;
}

export function analyzeSamples(samples: Float32Array, sampleRate: number): TakeAnalysis {
  const meter = createTakeMeter(sampleRate);
  meter.push(samples);
  return analyzeStats(meter.stats());
}

/** `n` bars for a waveform picture: the loudest sample of each slice, 0..1. */
export function waveformPeaks(samples: Float32Array, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!samples.length || n <= 0) return out;
  const size = samples.length / n;
  for (let b = 0; b < n; b++) {
    let max = 0;
    const end = Math.min(samples.length, Math.floor((b + 1) * size));
    for (let i = Math.floor(b * size); i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > max) max = a;
    }
    out[b] = Math.min(1, max);
  }
  return out;
}

export type FullAnalysis = TakeAnalysis & { sample_rate: number; channels: number; peaks: number[] };

/** The analysis of a take measured while it was recorded. `leadS`: the silence recorded before "Speak now". */
export const analysisFromStats = (st: FrameStats, opts: { leadS?: number } = {}): FullAnalysis => ({ ...analyzeStats(st, opts), sample_rate: st.sampleRate, channels: 1, peaks: peaksFromStats(st, 64) });

export async function analyzeWav(blob: Blob): Promise<FullAnalysis> {
  const wav = parseWav(await blob.arrayBuffer());
  return { ...analyzeSamples(wav.samples, wav.sampleRate), sample_rate: wav.sampleRate, channels: 1, peaks: waveformPeaks(wav.samples, 64) };
}

/** sha-256 (64 hex characters) of the file exactly as it will be uploaded. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Capture checks (the dashboard refuses the same blocking problems) ────

export type TakeProblem = "silent" | "too_short" | "too_long" | "too_quiet" | "clipped" | "silence" | "noisy";

export type TakeRules = {
  durationMinS: number;
  durationMaxS: number;
  minLevelDbfs: number;
  silenceMarginS: number;
};

const DURATION_TOLERANCE_S = 0.5;
const SILENCE_SLACK = 0.5;

/**
 * What is wrong with a take. `blocking`: it cannot be sent, record again. Otherwise it is advice
 * (2026-10-19, speakers found these too strict): a quiet voice, background noise or a short pause
 * is shown on the review screen and the speaker may send anyway; Sayari's QC and the annotator
 * judge. Blocking problems are checked first, so a take that is both quiet and clipped is refused.
 */
export type TakeCheck = { problem: TakeProblem; blocking: boolean };

/** The first thing wrong with a take, or null when it is fine. */
export function checkTake(a: TakeAnalysis, rules: TakeRules): TakeCheck | null {
  const noisyRoom = a.noise_floor_dbfs != null && a.noise_floor_dbfs > NOISY_FLOOR_DBFS;
  const block = (problem: TakeProblem): TakeCheck => ({ problem, blocking: true });
  const advise = (problem: TakeProblem): TakeCheck => ({ problem, blocking: false });
  // Not one frame above the speech threshold: the microphone heard nothing (muted, covered or not
  // working), or nothing rose above a loud background.
  if (a.level_dbfs <= FLOOR_DB) return block(noisyRoom ? "noisy" : "silent");
  if (a.duration_s < rules.durationMinS - DURATION_TOLERANCE_S) return block("too_short");
  if (a.duration_s > rules.durationMaxS + DURATION_TOLERANCE_S) return block("too_long");
  if (a.peak_dbfs >= 0) return block("clipped");
  if (a.level_dbfs < rules.minLevelDbfs) return advise("too_quiet");
  // The voice barely stands out from the background (APP-012).
  if (a.noise_floor_dbfs != null && a.level_dbfs - a.noise_floor_dbfs < MIN_SNR_DB) return advise("noisy");
  const needed = rules.silenceMarginS * SILENCE_SLACK;
  // In a loud place the pause was there but drowned: say what is wrong (the noise), not "leave a pause".
  if (a.silence_before_s < needed || a.silence_after_s < needed) return advise(noisyRoom ? "noisy" : "silence");
  return null;
}
