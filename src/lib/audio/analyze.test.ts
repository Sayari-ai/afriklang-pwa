import { describe, expect, it } from "vitest";
import { analyzeSamples, checkTake, parseWav, sha256Hex } from "./analyze";
import { encodeWav, floatToPCM16 } from "./wav-encoder";

const RATE = 16_000;
const tone = (seconds: number, amp: number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / RATE));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("analyzeSamples", () => {
  it("measures duration, margins, level and peak of speech between two silences", () => {
    const a = analyzeSamples(join(silence(1.2), tone(3, 0.1), silence(1.1)), RATE);
    expect(a.duration_s).toBeCloseTo(5.3, 1);
    expect(a.silence_before_s).toBeCloseTo(1.2, 1);
    expect(a.silence_after_s).toBeCloseTo(1.1, 1);
    // a 0.1-amplitude sine has RMS 0.0707 = -23 dBFS, peak -20 dBFS; silence must not drag the average down
    expect(a.level_dbfs).toBeCloseTo(-23, 0);
    expect(a.peak_dbfs).toBeCloseTo(-20, 0);
  });

  it("a recording that is all silence has no level and silence everywhere", () => {
    const a = analyzeSamples(silence(2), RATE);
    expect(a).toMatchObject({ level_dbfs: -120, silence_before_s: 2, silence_after_s: 2 });
  });

  it("a full-scale take reaches 0 dBFS", () => {
    expect(analyzeSamples(tone(1, 1), RATE).peak_dbfs).toBeGreaterThanOrEqual(-0.1);
  });
});

describe("checkTake", () => {
  const rules = { durationMinS: 3, durationMaxS: 15, minLevelDbfs: -35, silenceMarginS: 1 };
  const good = { duration_s: 8, level_dbfs: -22, peak_dbfs: -3, silence_before_s: 1.1, silence_after_s: 1 };

  it("accepts a good take and names the first problem otherwise", () => {
    expect(checkTake(good, rules)).toBeNull();
    expect(checkTake({ ...good, duration_s: 2 }, rules)).toBe("too_short");
    expect(checkTake({ ...good, duration_s: 2.6 }, rules)).toBeNull(); // within the 0.5 s tolerance
    expect(checkTake({ ...good, duration_s: 16 }, rules)).toBe("too_long");
    expect(checkTake({ ...good, level_dbfs: -50 }, rules)).toBe("too_quiet");
    expect(checkTake({ ...good, peak_dbfs: 0 }, rules)).toBe("clipped");
    expect(checkTake({ ...good, silence_before_s: 0.2 }, rules)).toBe("silence");
    expect(checkTake({ ...good, silence_after_s: 0.4 }, rules)).toBe("silence");
    // nothing above the silence threshold: said as "silent", before any length problem
    expect(checkTake(analyzeSamples(new Float32Array(16000 * 2), 16000), rules)).toBe("silent");
    expect(checkTake({ ...good, silence_before_s: 0.5 }, rules)).toBeNull(); // half the margin is enough
  });
});

describe("parseWav and sha256Hex", () => {
  it("reads back what the recorder's encoder wrote", async () => {
    const samples = tone(0.5, 0.25);
    const blob = encodeWav(floatToPCM16(samples), RATE);
    const wav = parseWav(await blob.arrayBuffer());
    expect(wav.sampleRate).toBe(RATE);
    expect(wav.channels).toBe(1);
    expect(wav.samples.length).toBe(samples.length);
    expect(wav.samples[100]).toBeCloseTo(samples[100], 3);
    expect(await sha256Hex(blob)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses files that are not 16-bit PCM WAV", () => {
    expect(() => parseWav(new ArrayBuffer(10))).toThrow("Not a WAV");
    const notWav = new Uint8Array(64);
    expect(() => parseWav(notWav.buffer)).toThrow("Not a WAV");
  });

  it("sha256 matches the known digest of 'abc'", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
