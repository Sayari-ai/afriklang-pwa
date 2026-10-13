import { describe, expect, it } from "vitest";
import { parseWav } from "./analyze";
import { createDownsampler, resample, wavBlobFromChunks } from "./wav-encoder";

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rmsDb = (x: Float32Array, skip = 400) => {
  let s = 0;
  let n = 0;
  for (let i = skip; i < x.length - skip; i++) {
    s += x[i] * x[i];
    n++;
  }
  return 10 * Math.log10(s / n);
};

describe("resampling to 16 kHz (APP-013)", () => {
  for (const rate of [48_000, 44_100]) {
    it(`${rate} Hz: speech-band tones pass, a 10 kHz tone is filtered out instead of folding into the band`, () => {
      const ref = rmsDb(sine(1000, rate, 1));
      const pass = resample(sine(1000, rate, 1), rate);
      expect(pass.length).toBe(16_000);
      expect(Math.abs(rmsDb(pass) - ref)).toBeLessThan(0.2);
      expect(Math.abs(rmsDb(resample(sine(6000, rate, 1), rate)) - ref)).toBeLessThan(0.5);
      // Without a filter, 10 kHz would come out at 6 kHz with nearly its full level.
      expect(rmsDb(resample(sine(10_000, rate, 1), rate)) - ref).toBeLessThan(-40);
    });
  }

  it("streams in blocks with the same result as one pass", () => {
    const input = sine(440, 48_000, 0.5);
    const whole = resample(input, 48_000);
    const ds = createDownsampler(48_000);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 128) parts.push(...ds.push(input.subarray(i, i + 128)));
    parts.push(...ds.flush());
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i += 97) expect(parts[i]).toBeCloseTo(whole[i], 6);
  });

  it("passes 16 kHz through untouched", () => {
    const x = sine(440, 16_000, 0.1);
    expect(resample(x, 16_000)).toBe(x);
  });
});

describe("wavBlobFromChunks", () => {
  it("writes a valid WAV from blocks without joining them", async () => {
    const blob = wavBlobFromChunks([Int16Array.from([1, -2, 3]), Int16Array.from([32767, -32768])]);
    const wav = parseWav(await blob.arrayBuffer());
    expect(wav.sampleRate).toBe(16_000);
    expect(Array.from(wav.samples, (v) => Math.round(v * 32768))).toEqual([1, -2, 3, 32767, -32768]);
  });
});
