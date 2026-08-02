"use client";

/**
 * UI feedback sound effects (the "Duolingo chimes").
 *
 * All sounds are synthesized at runtime with the Web Audio API
 * (oscillators + gain envelopes) instead of shipping audio assets:
 *
 *   - zero network / precache weight, works offline by definition;
 *   - no licensing exposure the melodies are our own;
 *   - swappable later: callers only know sound *names*, so replacing
 *     a recipe with a decoded file keeps every call site intact.
 *
 * Architecture
 * ------------
 * One lazily-created singleton `AudioContext` feeding a master
 * `GainNode`. This context is *separate* from the recorder's per-take
 * 16 kHz context (`src/lib/audio/recorder.ts`) browsers allow
 * multiple contexts, and the recorder closes its own after every
 * take. By design nothing here plays during the recording phase, so
 * chimes can never bleed into the mic capture.
 *
 * iOS unlock strategy
 * -------------------
 * Autoplay policy: an AudioContext only produces sound after being
 * created/resumed inside a user gesture. Our most important chime
 * (submission success) fires *after an async upload*, i.e. outside
 * any gesture so `initSfx()` installs a permanent capture-phase
 * `pointerdown`/`keydown` listener that creates + resumes the context
 * on every gesture where it isn't running. Permanent (not `once`)
 * because iOS re-suspends the context after audio-session
 * interruptions (e.g. a `getUserMedia` recording session); the next
 * tap SUBMIT, CONTINUE, anything re-arms it before the out-of-gesture
 * play. The listener is passive and never touches the event, so it
 * cannot disturb the level page's synchronous getUserMedia gesture
 * path (see `acquireMicStream`).
 *
 * Every entry point is fire-and-forget and never throws: sound is
 * garnish, not load-bearing. `playSfx` no-ops when the user disabled
 * sounds (`useSoundSettings`), on the server, or while the context
 * is locked.
 */

import { useSoundSettings } from "@/stores/sound-settings";

export type SfxName =
  | "success"
  | "levelComplete"
  | "cycleComplete"
  | "error"
  | "locked";

/** Overall output level. Chimes should sit well under speech volume. */
const MASTER_GAIN = 0.25;

/** Linear attack ramp, seconds. Avoids the click of a hard 0→peak step. */
const ATTACK = 0.012;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let listenersInstalled = false;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  if (typeof AudioContext === "undefined") return null;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/**
 * Install the gesture unlock listeners. Idempotent; called once from
 * `<AppHydration>`. Deliberately does NOT create the AudioContext up
 * front creating one outside a gesture would start it suspended on
 * iOS and burn an audio-session slot for users who never hear a chime
 * (sounds disabled).
 */
export function initSfx(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;

  const unlock = () => {
    // Don't spin up an AudioContext at all while sounds are off.
    if (!useSoundSettings.getState().enabled) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") {
      void c.resume().catch(() => {
        /* best-effort; next gesture retries */
      });
      // Legacy-iOS belt-and-braces: playing a (silent) buffer inside
      // the gesture unlocks the output channel on WebKit versions
      // where resume() alone isn't enough. Harmless elsewhere.
      try {
        const buf = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
    }
  };

  window.addEventListener("pointerdown", unlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

/**
 * Play a named sound effect. Fire-and-forget: never throws, silently
 * no-ops when sounds are disabled or the context hasn't been unlocked
 * by a gesture yet.
 */
export function playSfx(name: SfxName): void {
  try {
    if (!useSoundSettings.getState().enabled) return;
    const c = ensureContext();
    if (!c || !master) return;
    if (c.state === "running") {
      schedule(name, c, master);
      return;
    }
    if (c.state === "suspended") {
      // Resolves ~immediately when we're inside (or right after) a
      // gesture; otherwise the sound is dropped better silence than
      // a chime firing seconds later out of context.
      const m = master;
      void c
        .resume()
        .then(() => {
          if (c.state === "running") schedule(name, c, m);
        })
        .catch(() => {
          /* locked; drop */
        });
    }
  } catch {
    /* sound is garnish never propagate */
  }
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

interface ToneSpec {
  /** Frequency in Hz at note start. */
  freq: number;
  /** Offset from the sound's start, seconds. */
  at: number;
  /** Note length including decay tail, seconds. */
  dur: number;
  /** Waveform. Triangle reads "chime"; sine reads "soft". */
  type?: OscillatorType;
  /** Peak envelope gain (pre-master). */
  peak?: number;
  /** Optional exponential pitch glide target (kick-drum style thud). */
  glideTo?: number;
}

function tone(c: AudioContext, dest: AudioNode, t0: number, spec: ToneSpec) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  const start = t0 + spec.at;
  const end = start + spec.dur;

  osc.type = spec.type ?? "triangle";
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.glideTo, end);
  }

  const peak = spec.peak ?? 0.5;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + ATTACK);
  gain.gain.exponentialRampToValueAtTime(0.001, end);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(start);
  osc.stop(end + 0.05);
  osc.onended = () => {
    try {
      gain.disconnect();
      osc.disconnect();
    } catch {
      /* already gone */
    }
  };
}

/**
 * The sound recipes. Original melodies (C-major language, nothing
 * sampled or copied). Frequencies are equal-temperament note pitches.
 */
function schedule(name: SfxName, c: AudioContext, dest: AudioNode): void {
  const t0 = c.currentTime;
  const notes: ToneSpec[] = RECIPES[name];
  for (const n of notes) tone(c, dest, t0, n);
}

// Note pitches (Hz): C4 261.63 / E4 329.63 / Bb3 233.08 / C5 523.25 /
// E5 659.25 / G5 783.99 / A5 880 / C6 1046.5 / E6 1318.51 /
// G6 1567.98 / A6 1760.
const RECIPES: Record<SfxName, ToneSpec[]> = {
  /** Submission accepted: quick ascending major-sixth "du-ding!". */
  success: [
    { freq: 523.25, at: 0, dur: 0.14, peak: 0.45 },
    { freq: 880, at: 0.085, dur: 0.32, peak: 0.5 },
    { freq: 1760, at: 0.085, dur: 0.32, type: "sine", peak: 0.12 },
  ],

  /** End-of-level fanfare: C-major arpeggio climb with a shimmer top. */
  levelComplete: [
    { freq: 523.25, at: 0, dur: 0.12, peak: 0.42 },
    { freq: 659.25, at: 0.09, dur: 0.12, peak: 0.42 },
    { freq: 783.99, at: 0.18, dur: 0.12, peak: 0.42 },
    { freq: 1046.5, at: 0.27, dur: 0.5, peak: 0.5 },
    { freq: 1567.98, at: 0.27, dur: 0.5, type: "sine", peak: 0.1 },
    { freq: 261.63, at: 0.27, dur: 0.5, type: "sine", peak: 0.18 },
  ],

  /** Whole-cycle fanfare: the level fanfare, extended a third higher. */
  cycleComplete: [
    { freq: 523.25, at: 0, dur: 0.11, peak: 0.4 },
    { freq: 659.25, at: 0.085, dur: 0.11, peak: 0.4 },
    { freq: 783.99, at: 0.17, dur: 0.11, peak: 0.4 },
    { freq: 1046.5, at: 0.255, dur: 0.16, peak: 0.45 },
    { freq: 1318.51, at: 0.34, dur: 0.16, peak: 0.45 },
    { freq: 1567.98, at: 0.425, dur: 0.7, peak: 0.5 },
    { freq: 1046.5, at: 0.425, dur: 0.7, peak: 0.22 },
    { freq: 523.25, at: 0.425, dur: 0.7, type: "sine", peak: 0.15 },
  ],

  /** Upload failed: soft descending tritone "uh-oh", deliberately mild. */
  error: [
    { freq: 329.63, at: 0, dur: 0.12, type: "sine", peak: 0.38 },
    { freq: 233.08, at: 0.1, dur: 0.28, type: "sine", peak: 0.42 },
  ],

  /** Locked node tap: single dull thud (fast downward pitch glide). */
  locked: [
    { freq: 150, glideTo: 90, at: 0, dur: 0.15, type: "sine", peak: 0.5 },
  ],
};
