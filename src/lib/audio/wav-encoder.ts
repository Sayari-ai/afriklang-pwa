/**
 * WAV PCM16 encoder.
 *
 * The Sayari ingest pipeline expects 16 kHz mono PCM16 WAV. The browser
 * doesn't ship a WAV encoder — `MediaRecorder` only emits compressed
 * formats — so we capture Float32 frames via an AudioWorklet (see
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
 * AudioContext rate here — see recorder.ts for the rate negotiation).
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

/**
 * Linear interpolating resampler. Fast, lossless enough for speech at
 * 16 kHz (the destination rate is what the ASR backend expects).
 *
 * Used as a fallback when an iOS Safari AudioContext refuses to honour
 * the requested 16 kHz `sampleRate` constructor option — Safari clamps
 * to the device hardware rate (typically 44.1 / 48 kHz) and we have
 * to downsample on the way out.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

export const WAV_TARGET_SAMPLE_RATE = TARGET_SAMPLE_RATE;
