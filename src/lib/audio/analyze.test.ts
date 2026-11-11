import { describe, expect, it } from "vitest";
import { analyzeSamples, analyzeStats, checkTake, createTakeMeter, parseWav, sayariQc, sha256Hex } from "./analyze";
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
  const qcOk = { snr_db: 30, background_noise_db: -60, silence_ratio: 0.1, clipping_ratio: 0 };

  const block = (problem: string) => ({ problem, blocking: true });
  const advise = (problem: string) => ({ problem, blocking: false });

  it("accepts a good take; only a wrong length blocks", () => {
    expect(checkTake(good, rules)).toBeNull();
    expect(checkTake({ ...good, duration_s: 2 }, rules)).toEqual(block("too_short"));
    expect(checkTake({ ...good, duration_s: 2.6 }, rules)).toBeNull(); // within the 0.5 s tolerance
    expect(checkTake({ ...good, duration_s: 16 }, rules)).toEqual(block("too_long"));
    expect(checkTake({ ...good, silence_before_s: 0.5 }, rules)).toBeNull(); // half the margin is enough
  });

  it("everything else is advice: the speaker may send anyway", () => {
    expect(checkTake({ ...good, peak_dbfs: 0, qc: { ...qcOk, clipping_ratio: 0.02 } }, rules)).toEqual(advise("clipped"));
    // nothing above the silence threshold: said as "silent"
    expect(checkTake(analyzeSamples(new Float32Array(16000 * 4), 16000), rules)).toEqual(advise("silent"));
    expect(checkTake({ ...good, level_dbfs: -50 }, rules)).toEqual(advise("too_quiet"));
    expect(checkTake({ ...good, silence_before_s: 0.2 }, rules)).toEqual(advise("silence"));
    expect(checkTake({ ...good, silence_after_s: 0.4 }, rules)).toEqual(advise("silence"));
  });

  it("the length is checked first: a silent or clipped take of the wrong length is refused", () => {
    expect(checkTake(analyzeSamples(new Float32Array(16000 * 2), 16000), rules)).toEqual(block("too_short"));
    expect(checkTake({ ...good, peak_dbfs: 0, qc: { ...qcOk, clipping_ratio: 0.5 }, duration_s: 16 }, rules)).toEqual(block("too_long"));
    expect(checkTake({ ...good, level_dbfs: -50, duration_s: 2 }, rules)).toEqual(block("too_short"));
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

describe("background noise (APP-012)", () => {
  const rules = { durationMinS: 3, durationMaxS: 15, minLevelDbfs: -35, silenceMarginS: 1 };
  /** Deterministic noise at about `db` dBFS RMS. */
  const noise = (seconds: number, db: number) => {
    const amp = 10 ** (db / 20) * Math.sqrt(3);
    let x = 12345;
    return Float32Array.from({ length: Math.round(seconds * RATE) }, () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return amp * (2 * (x / 0x7fffffff) - 1);
    });
  };
  const mix = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + (b[i] ?? 0));
  const meter = (samples: Float32Array) => {
    const m = createTakeMeter(RATE);
    m.push(samples);
    return m.stats();
  };

  it("measures the floor in the lead and finds the pause above a -42 dBFS background", () => {
    const take = mix(join(silence(1.2), tone(3, 0.1), silence(1.2)), noise(5.4, -42));
    const a = analyzeStats(meter(take), { leadS: 1.2 });
    expect(a.noise_floor_dbfs).toBeCloseTo(-42, 0);
    expect(a.silence_before_s).toBeCloseTo(1.2, 1);
    expect(checkTake(a, rules)).toBeNull();
  });

  it("names the noise, not the pause, when the voice does not stand out", () => {
    const take = mix(join(silence(1.2), tone(3, 0.02), silence(1.2)), noise(5.4, -38));
    const a = analyzeStats(meter(take), { leadS: 1.2 });
    expect(checkTake({ ...a, level_dbfs: Math.max(a.level_dbfs, -34) }, rules)).toEqual({ problem: "noisy", blocking: false });
    expect(checkTake({ duration_s: 8, level_dbfs: -20, peak_dbfs: -3, silence_before_s: 0, silence_after_s: 1, noise_floor_dbfs: -40 }, rules)).toEqual({ problem: "noisy", blocking: false });
    expect(checkTake({ duration_s: 8, level_dbfs: -20, peak_dbfs: -3, silence_before_s: 0, silence_after_s: 1, noise_floor_dbfs: -70 }, rules)).toEqual({ problem: "silence", blocking: false });
  });

  it("keeps the -50 dBFS rule in a quiet room (the dashboard's numbers do not move)", () => {
    const take = join(silence(1.2), tone(3, 0.1), silence(1.1));
    expect(analyzeStats(meter(take), { leadS: 1.2 })).toMatchObject(analyzeSamples(take, RATE));
  });
});

/**
 * The advice follows Sayari's automatic check (backend app/services/qc_service.py, defaults in
 * app/core/config.py): it must not warn about a take Sayari accepts, and must warn about one it
 * refuses (APP2-01, X-05).
 */
describe("Sayari's QC limits (APP2-01, X-05)", () => {
  const rules = { durationMinS: 3, durationMaxS: 15, minLevelDbfs: -35, silenceMarginS: 1 };
  const meter = (samples: Float32Array) => {
    const m = createTakeMeter(RATE);
    m.push(samples);
    return m.stats();
  };
  /** Low hiss so Sayari's noise estimate is not digital silence. */
  const hiss = (seconds: number, amp: number) => {
    let x = 777;
    return Float32Array.from({ length: Math.round(seconds * RATE) }, () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return amp * (2 * (x / 0x7fffffff) - 1);
    });
  };
  const mix = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + (b[i] ?? 0));

  it("a few full-scale samples (a plosive) are not 'clipped': Sayari accepts up to 1 %", () => {
    const take = join(silence(1.2), tone(4, 0.3), silence(1.2));
    for (let i = 0; i < 300; i++) take[RATE * 2 + i * 50] = 1; // 300 of 102 400 samples ≈ 0.3 %
    const a = analyzeStats(meter(take), { leadS: 1.2 });
    expect(a.peak_dbfs).toBeGreaterThanOrEqual(0);
    expect(a.qc?.clipping_ratio).toBeCloseTo(300 / take.length, 5);
    expect(checkTake(a, rules)).toBeNull();
  });

  it("a take saturated on more than 1 % of its samples is 'clipped'", () => {
    const a = analyzeStats(meter(join(silence(1.2), tone(4, 1), silence(1.2))), { leadS: 1.2 });
    expect(a.qc!.clipping_ratio).toBeGreaterThan(0.01);
    expect(checkTake(a, rules)).toEqual({ problem: "clipped", blocking: false });
  });

  it("the clipping advice no longer says the take will be refused, in EN and FR", async () => {
    const en = (await import("@/messages/campaign/studio.en.json")).default.advice;
    const fr = (await import("@/messages/campaign/studio.fr.json")).default.advice;
    expect(en.clipped).not.toMatch(/refused/i);
    expect(fr.clipped).not.toMatch(/refusée/i);
    expect(en.pauses).toBeTruthy();
    expect(fr.pauses).toBeTruthy();
  });

  it("measures SNR like Sayari: warns under 10 dB, not only under 8", () => {
    // speech 9 dB above the background (Sayari's measure) must be advised; 12 dB is fine
    const at = (snr: number) => {
      const floor = 0.01;
      return mix(join(silence(1.2), tone(4, floor * 10 ** (snr / 20) * Math.SQRT2), silence(1.2)), hiss(6.4, floor * Math.sqrt(3)));
    };
    const low = analyzeStats(meter(at(8.5)), { leadS: 1.2 });
    expect(low.qc!.snr_db).toBeGreaterThan(8);
    expect(low.qc!.snr_db).toBeLessThan(10);
    expect(checkTake(low, rules)).toEqual({ problem: "noisy", blocking: false });
    const ok = analyzeStats(meter(at(13)), { leadS: 1.2 });
    expect(ok.qc!.snr_db).toBeGreaterThan(10);
    expect(checkTake(ok, rules)).toBeNull();
  });

  it("a background louder than -20 dBFS is 'noisy' even when the voice stands out", () => {
    expect(checkTake({ duration_s: 8, level_dbfs: -5, peak_dbfs: -1, silence_before_s: 1, silence_after_s: 1, qc: { snr_db: 15, background_noise_db: -18, silence_ratio: 0, clipping_ratio: 0 } }, rules)).toEqual({ problem: "noisy", blocking: false });
  });

  it("long pauses between the words are advised (Sayari refuses over half of the take silent)", () => {
    const take = mix(join(silence(1.2), tone(1, 0.2), silence(3), tone(1, 0.2), silence(1.2)), hiss(7.4, 0.0005));
    const a = analyzeStats(meter(take), { leadS: 1.2 });
    expect(a.qc!.silence_ratio).toBeGreaterThan(0.5);
    expect(checkTake(a, rules)).toEqual({ problem: "pauses", blocking: false });
    // the edges (the studio's padding) do not count: one sentence between two long silences is fine
    const edges = analyzeStats(meter(mix(join(silence(3), tone(2, 0.2), silence(3)), hiss(8, 0.0005))), { leadS: 3 });
    expect(edges.qc!.silence_ratio).toBeLessThan(0.1);
    expect(checkTake(edges, rules)).toBeNull();
  });

  it("matches Sayari's frames: 2048 samples every 512, short files as one frame", () => {
    const st = meter(tone(1, 0.5));
    const q = sayariQc(st)!;
    // (16000 - 2048) / 512 = 27 frames of a steady tone: no noise frame, SNR 0 dB
    expect(q.snr_db).toBeCloseTo(0, 1);
    expect(q.background_noise_db).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(sayariQc(meter(tone(0.05, 0.5)))!.background_noise_db).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(sayariQc(meter(silence(2)))).toMatchObject({ snr_db: 60, background_noise_db: -100, silence_ratio: 1 });
  });

  it("a take saved by an older version (no Sayari measures) gets no clipping alarm", () => {
    expect(checkTake({ duration_s: 8, level_dbfs: -22, peak_dbfs: 0, silence_before_s: 1, silence_after_s: 1 }, rules)).toBeNull();
  });
});
