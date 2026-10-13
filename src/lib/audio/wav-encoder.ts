/**
 * WAV PCM16 encoder.
 *
 * The Sayari ingest pipeline expects 16 kHz mono PCM16 WAV. The browser
 * doesn't ship a WAV encoder `MediaRecorder` only emits compressed
 * formats so we capture Float32 frames via an AudioWorklet (see
 * `public/audio/pcm-recorder.worklet.js`) and run them through this
 * module to produce a `Blob` ready for `uploadAudio()`.
 *
 * Format reference: http://soundfile.sapp.org/doc/WaveFormat/
 *
 *   Offset  Size  Field           Value
 *   ------  ----  --------------  ----------------------------
 *      0     4    ChunkID         "RIFF"
 *      4     4    ChunkSize       36 + Subchunk2Size
 *      8     4    Format          "WAVE"
 *     12     4    Subchunk1ID     "fmt "
 *     16     4    Subchunk1Size   16  (PCM)
 *     20     2    AudioFormat     1   (PCM)
 *     22     2    NumChannels     1   (mono)
 *     24     4    SampleRate      16000
 *     28     4    ByteRate        SampleRate * NumChannels * BitsPerSample/8
 *     32     2    BlockAlign      NumChannels * BitsPerSample/8
 *     34     2    BitsPerSample   16
 *     36     4    Subchunk2ID     "data"
 *     40     4    Subchunk2Size   numSamples * NumChannels * BitsPerSample/8
 *     44   ...    Data            PCM16 little-endian samples
 */

const TARGET_SAMPLE_RATE = 16_000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/** Concatenates the Float32 chunks emitted by the worklet into one buffer. */
export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Float32 [-1, 1] → Int16 [-32768, 32767], little-endian, with hard
 * clipping. We round-trip through `Math.max/min` rather than relying
 * on `DataView.setInt16` to truncate, because saturation matters: a
 * peaky speaker should clip to 0x7FFF, not wrap to a negative.
 */
export function floatToPCM16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Wraps PCM16 samples in a WAV container. Caller is responsible for
 * having already resampled to 16 kHz (we don't trust the browser's
 * AudioContext rate here see recorder.ts for the rate negotiation).
 */
export function encodeWav(
  samples: Int16Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
): Blob {
  const dataSize = samples.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");

  // fmt chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size for PCM
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Samples: little-endian PCM16 directly into the buffer.
  const pcm = new DataView(buffer, 44);
  for (let i = 0; i < samples.length; i++) {
    pcm.setInt16(i * 2, samples[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** The 44-byte header of a PCM16 mono WAV holding `dataBytes` bytes of samples. */
export function wavHeader(dataBytes: number, sampleRate: number = TARGET_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return buffer;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * A WAV Blob made of the PCM16 blocks as they are, without joining them into one big buffer first
 * (APP-005: a long take never exists twice in memory). WAV is little-endian, like every phone.
 */
export function wavBlobFromChunks(chunks: readonly Int16Array[], sampleRate: number = TARGET_SAMPLE_RATE): Blob {
  let bytes = 0;
  for (const c of chunks) bytes += c.byteLength;
  const parts: BlobPart[] = [wavHeader(bytes, sampleRate)];
  for (const c of chunks) {
    if (LITTLE_ENDIAN) {
      parts.push(c as Int16Array<ArrayBuffer>);
    } else {
      const v = new DataView(new ArrayBuffer(c.byteLength));
      for (let i = 0; i < c.length; i++) v.setInt16(i * 2, c[i], true);
      parts.push(v.buffer);
    }
  }
  return new Blob(parts, { type: "audio/wav" });
}

// ── Resampling to 16 kHz (APP-013) ───────────────────────────────────────
//
// Phones often capture at 44.1 or 48 kHz. Going down to 16 kHz without a low-pass filter folds
// everything above 8 kHz (sibilants, hiss) back into the speech band. This is a polyphase FIR
// resampler: a Kaiser-windowed sinc low-pass (-6 dB at 7.4 kHz, about 80 dB down from 8 kHz) and
// the exact rational ratio between the two rates (48 k → 16 k is 1/3, 44.1 k → 16 k is 160/441).
// It runs on blocks as they arrive, so a take is downsampled while it is recorded.

const CUTOFF_HZ = 7_400;
const KAISER_BETA = 8;
/** Half-length of the filter in milliseconds of input (240 taps at 48 kHz). */
const HALF_WIDTH_MS = 2.5;
/** Ratios needing more phases than this (exotic rates) use a coarser phase grid. */
const MAX_PHASES = 1_024;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export type Downsampler = {
  /** Feed input samples; returns the output samples now ready. */
  push(input: Float32Array): Float32Array;
  /** The last output samples (the filter's tail). Call once at the end. */
  flush(): Float32Array;
};

/** A streaming resampler from `inRate` to `outRate` (outRate < inRate filters; equal rates pass through). */
export function createDownsampler(inRate: number, outRate: number = TARGET_SAMPLE_RATE): Downsampler {
  if (inRate === outRate) return { push: (x) => x, flush: () => new Float32Array(0) };
  const ir = Math.round(inRate);
  const or = Math.round(outRate);
  const g = gcd(ir, or);
  let up = or / g; // L: phases
  let down = ir / g; // M
  if (up > MAX_PHASES) {
    // Approximate the ratio on a finer-than-needed grid (rates like 44056 Hz).
    down = Math.round((ir / or) * MAX_PHASES);
    up = MAX_PHASES;
  }
  const fc = Math.min(CUTOFF_HZ, or * 0.4625) / ir; // cycles per input sample
  const half = Math.max(8, Math.ceil((ir / 1000) * HALF_WIDTH_MS));
  const taps = 2 * half;
  const i0b = besselI0(KAISER_BETA);
  // table[p][k]: weight of input (center + k - half + 1) for output phase p, normalised to unit gain.
  const table: Float32Array[] = [];
  for (let p = 0; p < up; p++) {
    const frac = p / up;
    const row = new Float32Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - half + 1 - frac; // distance from the output instant, in input samples
      const r = x / half;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / i0b;
      const arg = 2 * fc * x;
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      row[k] = 2 * fc * sinc * w;
      sum += row[k];
    }
    for (let k = 0; k < taps; k++) row[k] /= sum;
    table.push(row);
  }

  // `buf` holds the input not yet fully used; buf[0] is input sample number `base`.
  let buf = new Float32Array(half - 1); // zeros before the first sample
  let base = -(half - 1);
  let outIndex = 0; // next output sample number
  let inTotal = 0;

  const produce = (limit: number): Float32Array => {
    const out: number[] = [];
    for (;;) {
      const num = outIndex * down; // output instant = num / up input samples
      const center = Math.floor(num / up);
      if (center + half >= base + buf.length || outIndex >= limit) break;
      const row = table[num % up];
      const start = center - half + 1 - base;
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += buf[start + k] * row[k];
      out.push(acc);
      outIndex++;
    }
    // Drop input no later output needs.
    const keepFrom = Math.floor((outIndex * down) / up) - half + 1 - base;
    if (keepFrom > 0) {
      buf = buf.slice(keepFrom);
      base += keepFrom;
    }
    return Float32Array.from(out);
  };

  const expected = () => Math.floor((inTotal * up) / down);
  return {
    push(input) {
      const next = new Float32Array(buf.length + input.length);
      next.set(buf);
      next.set(input, buf.length);
      buf = next;
      inTotal += input.length;
      return produce(expected());
    },
    flush() {
      const next = new Float32Array(buf.length + half + 1);
      next.set(buf);
      buf = next;
      return produce(expected());
    },
  };
}

/** Resample a whole buffer (tests and short clips; the recorder streams through createDownsampler). */
export function resample(input: Float32Array, inputRate: number, outputRate: number = TARGET_SAMPLE_RATE): Float32Array {
  if (inputRate === outputRate) return input;
  const ds = createDownsampler(inputRate, outputRate);
  const a = ds.push(input);
  const b = ds.flush();
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export const WAV_TARGET_SAMPLE_RATE = TARGET_SAMPLE_RATE;
