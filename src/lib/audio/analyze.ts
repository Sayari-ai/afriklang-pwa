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
  /** Sayari's own QC measurements of this file (see sayariQc). Absent on a take saved by an older version. */
  qc?: SayariQc;
};

/**
 * What Sayari's automatic check measures on the uploaded file, computed the same way (Sayari
 * backend app/services/qc_service.py, run_qc with inner_silence_only for campaign audio), so the
 * advice on the review screen matches what is really refused (APP2-01, X-05).
 */
export type SayariQc = {
  /** Mean RMS of the loudest half of the frames over the mean of the quietest tenth, dB. */
  snr_db: number;
  /** Mean RMS of the quietest tenth of the frames, dBFS. */
  background_noise_db: number;
  /** Share of frames more than 30 dB below the loudest, between the first and the last speech frame. */
  silence_ratio: number;
  /** Share of samples at full scale (|x| >= 0.99). */
  clipping_ratio: number;
};

/** The four limits of Sayari's automatic check the advice follows. */
export type QcLimits = { minSnrDb: number; maxBackgroundNoiseDb: number; maxClippingRatio: number; maxSilenceRatio: number };

/**
 * Sayari's default QC limits (backend app/core/config.py and qc_service.py). Sayari refuses a take
 * outside them; the app only advises, the speaker may send anyway. The campaign card's `qc_limits`
 * (Sayari's live settings, through the dashboard) take precedence when present (TakeRules.qc).
 */
export const SAYARI_QC: QcLimits = {
  /** MIN_SNR_DB */
  minSnrDb: 10,
  /** MAX_BACKGROUND_NOISE_DB */
  maxBackgroundNoiseDb: -20,
  /** MAX_CLIPPING_RATIO */
  maxClippingRatio: 0.01,
  /** MAX_SILENCE_RATIO */
  maxSilenceRatio: 0.5,
};
/** A sample this close to full scale counts as clipped (qc_service._clipping_ratio). */
const CLIP_THRESHOLD = 0.99;
/** Sayari's frame: 2048 samples every 512 (qc_service._frames), on the 16 kHz file. */
const QC_HOP = 512;
const QC_FRAME_HOPS = 4;

const FLOOR_DB = -120;
/** A 20 ms frame quieter than this counts as silence (in a quiet room; see speechThresholdDb). */
export const SILENCE_THRESHOLD_DBFS = -50;
/** Speech starts this far above the background noise (APP-012). */
export const SPEECH_ABOVE_FLOOR_DB = 10;
/** Background noise louder than this is what makes the silence check fail, not the speaker. */
export const NOISY_FLOOR_DBFS = -50;
/** Voice less than this far above the background: the take is too noisy to use (Sayari's MIN_SNR_DB). */
export const MIN_SNR_DB = SAYARI_QC.minSnrDb;
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
  /** Samples at full scale (|x| >= 0.99). */
  clipped: number;
  /** Sum of squares of each complete block of 512 samples, for Sayari's frames (sayariQc). */
  hopSq: number[];
  /** Sum of squares of every sample. */
  sumSq: number;
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
  let clipped = 0;
  const hopSq: number[] = [];
  let hopAcc = 0;
  let inHop = 0;
  let allSq = 0;
  return {
    /** Add samples; `scale` turns them into -1..1 (1/32768 for PCM16). */
    push(x: ArrayLike<number>, scale = 1) {
      for (let i = 0; i < x.length; i++) {
        const v = x[i] * scale;
        const a = v < 0 ? -v : v;
        if (a > frameMax) frameMax = a;
        if (a >= CLIP_THRESHOLD) clipped++;
        sumSq += v * v;
        hopAcc += v * v;
        if (++inHop === QC_HOP) {
          hopSq.push(hopAcc);
          allSq += hopAcc;
          hopAcc = 0;
          inHop = 0;
        }
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
        clipped,
        hopSq: hopSq.slice(),
        sumSq: allSq + hopAcc,
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

/**
 * Sayari's QC measurements (qc_service._frames, _compute_snr, _compute_background_noise_db,
 * _compute_silence_ratio with trim_edges, _clipping_ratio), from the meter's 512-sample blocks.
 * Null for an empty take.
 */
export function sayariQc(st: FrameStats): SayariQc | null {
  const n = st.samples;
  if (n <= 0) return null;
  const frameLen = QC_HOP * QC_FRAME_HOPS;
  let rms: number[];
  if (n < frameLen) rms = [Math.sqrt(st.sumSq / n)];
  else {
    const frames = Math.max(1, Math.floor((n - frameLen) / QC_HOP));
    rms = new Array<number>(frames);
    for (let k = 0; k < frames; k++) {
      let e = 0;
      for (let j = 0; j < QC_FRAME_HOPS; j++) e += st.hopSq[k + j] ?? 0;
      rms[k] = Math.sqrt(Math.max(e, 0) / frameLen);
    }
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const noise = mean(sorted.slice(0, Math.max(1, Math.floor(sorted.length / 10))));
  const signal = mean(sorted.slice(Math.floor(sorted.length / 2)));
  const snr = noise < 1e-10 ? 60 : 20 * Math.log10(signal / noise + 1e-10);
  const background = noise < 1e-10 ? -100 : 20 * Math.log10(noise + 1e-10);

  let silence = 1;
  const top = sorted[sorted.length - 1];
  if (top >= 1e-10) {
    const threshold = top * 10 ** (-30 / 20);
    let first = -1;
    let last = -1;
    for (let k = 0; k < rms.length; k++) {
      if (rms[k] >= threshold) {
        if (first === -1) first = k;
        last = k;
      }
    }
    let quiet = 0;
    for (let k = first; k <= last; k++) if (rms[k] < threshold) quiet++;
    silence = quiet / (last - first + 1);
  }
  return {
    snr_db: round2(snr),
    background_noise_db: round2(background),
    silence_ratio: Math.round(silence * 1e4) / 1e4,
    clipping_ratio: Math.round((st.clipped / n) * 1e6) / 1e6,
  };
}

export function analyzeStats(st: FrameStats, opts: { leadS?: number } = {}): TakeAnalysis {
  const duration = st.samples / st.sampleRate;
  const frames = st.rms.length;
  const floor = noiseFloorDb(st, opts.leadS);
  const threshold = speechThresholdDb(floor);
  const qc = sayariQc(st);
  const withFloor = { ...(floor == null ? {} : { noise_floor_dbfs: round2(floor) }), ...(qc ? { qc } : {}) };
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

// ── Capture checks (the dashboard and Sayari refuse the same blocking problems) ────

export type TakeProblem = "silent" | "too_short" | "too_long" | "too_quiet" | "clipped" | "silence" | "noisy" | "pauses";

export type TakeRules = {
  durationMinS: number;
  durationMaxS: number;
  minLevelDbfs: number;
  silenceMarginS: number;
  /** Sayari's live QC limits from the campaign card; SAYARI_QC when absent. */
  qc?: QcLimits;
};

const DURATION_TOLERANCE_S = 0.5;
const SILENCE_SLACK = 0.5;

/**
 * What is wrong with a take. `blocking`: it cannot be sent, record again. Only the length blocks
 * (2026-10-19, the user's decision: speakers found the other checks too strict); the dashboard and
 * Sayari refuse the same lengths. Everything else is advice shown on the review screen, and the
 * speaker may send anyway. The dashboard no longer refuses a clipped take (2026-11-06); Sayari's
 * automatic check refuses one above 1 % clipped samples, under 10 dB SNR, over -20 dBFS of
 * background or with more than half of the take silent between the first and the last word: the
 * advice uses those same limits (SAYARI_QC), measured the same way (sayariQc), so it neither
 * warns about a take Sayari accepts nor stays quiet about one it refuses (APP2-01, X-05).
 */
export type TakeCheck = { problem: TakeProblem; blocking: boolean };

/** The first thing wrong with a take, or null when it is fine. */
export function checkTake(a: TakeAnalysis, rules: TakeRules): TakeCheck | null {
  const noisyRoom = a.noise_floor_dbfs != null && a.noise_floor_dbfs > NOISY_FLOOR_DBFS;
  const block = (problem: TakeProblem): TakeCheck => ({ problem, blocking: true });
  const advise = (problem: TakeProblem): TakeCheck => ({ problem, blocking: false });
  if (a.duration_s < rules.durationMinS - DURATION_TOLERANCE_S) return block("too_short");
  if (a.duration_s > rules.durationMaxS + DURATION_TOLERANCE_S) return block("too_long");
  // Not one frame above the speech threshold: the microphone heard nothing (muted, covered or not
  // working), or nothing rose above a loud background.
  if (a.level_dbfs <= FLOOR_DB) return advise(noisyRoom ? "noisy" : "silent");
  // A few full-scale samples (a plosive, a cough) are common and accepted; Sayari refuses above 1 %.
  // A take saved by an older version has no ratio: no advice rather than a false alarm.
  const lim = rules.qc ?? SAYARI_QC;
  if (a.qc && a.qc.clipping_ratio > lim.maxClippingRatio) return advise("clipped");
  if (a.level_dbfs < rules.minLevelDbfs) return advise("too_quiet");
  // The voice barely stands out from the background (APP-012), by Sayari's measure when known.
  const snr = a.qc ? a.qc.snr_db : a.noise_floor_dbfs != null ? a.level_dbfs - a.noise_floor_dbfs : null;
  if (snr != null && snr < lim.minSnrDb) return advise("noisy");
  if (a.qc && a.qc.background_noise_db > lim.maxBackgroundNoiseDb) return advise("noisy");
  // Long pauses between the words (Sayari's inner silence ratio).
  if (a.qc && a.qc.silence_ratio > lim.maxSilenceRatio) return advise("pauses");
  const needed = rules.silenceMarginS * SILENCE_SLACK;
  // In a loud place the pause was there but drowned: say what is wrong (the noise), not "leave a pause".
  if (a.silence_before_s < needed || a.silence_after_s < needed) return advise(noisyRoom ? "noisy" : "silence");
  return null;
}
