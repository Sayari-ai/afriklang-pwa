"use client";

/**
 * Browser equivalent of Flutter's `record` plugin: produces 16 kHz
 * mono PCM16 WAV blobs ready for the Sayari upload pipeline.
 *
 * Why not `MediaRecorder`?
 *   `MediaRecorder` only emits compressed formats (webm/opus on
 *   Chromium, mp4/aac on Safari). The Sayari ingest expects
 *   uncompressed WAV PCM16 16 kHz mono same shape Flutter produces.
 *   We have to capture raw frames ourselves through an AudioWorklet.
 *
 * Pipeline (memory bounded: APP-005):
 *
 *     getUserMedia ──► MediaStreamAudioSourceNode
 *                  ──► AudioWorkletNode('pcm-recorder')
 *                       │ blocks of ~50 ms at the context's rate
 *                       └─► port.onmessage(Float32Array)
 *                              │ downsampled to 16 kHz with an anti-alias filter (as it arrives)
 *                              │ → PCM16, kept in 1 s blocks (32 KB a second, nothing else)
 *                              │ → measured as it goes (level, peak, silence: analyze.ts)
 *                              ▼
 *                       on stop(): Blob('audio/wav') made of the blocks, plus the analysis
 *
 * Browser quirks handled:
 *   - iOS Safari ignores the `sampleRate` AudioContext option (clamps
 *     to device hardware rate, usually 48 kHz). We always read back
 *     `ctx.sampleRate` and resample on the way out if it's not 16 k.
 *   - Echo cancellation / noise suppression are left enabled by
 *     default; the prompts are read aloud, not sung, and the labelling
 *     team prefers the cleaner audio.
 *   - Some Chromium versions throw `InvalidStateError` if you try to
 *     resume a context before it's been suspended; we always check
 *     `ctx.state` first.
 *
 * Lifecycle: instantiate → `start()` → `stop()` → `dispose()`. Calling
 * `start()` twice is a no-op; `stop()` is safe to call from cleanup.
 */

import { analysisFromStats, createTakeMeter, type FullAnalysis } from "./analyze";
import { createDownsampler, wavBlobFromChunks, WAV_TARGET_SAMPLE_RATE, type Downsampler } from "./wav-encoder";

/** PCM16 samples kept per block while recording (one second at 16 kHz). */
const BLOCK_SAMPLES = WAV_TARGET_SAMPLE_RATE;

const WORKLET_URL = "/audio/pcm-recorder.worklet.js";
const WORKLET_NAME = "pcm-recorder";

export class RecorderError extends Error {
  constructor(message: string, public readonly code: RecorderErrorCode) {
    super(message);
    this.name = "RecorderError";
  }
}

export type RecorderErrorCode =
  | "permission-denied"
  | "no-mic"
  | "unsupported"
  | "internal";

/** Quick browser capability probe call before opening the level screen. */
export function isAudioRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  // Defensive checks: older browsers / locked-down WebViews can ship
  // partial implementations. We treat the *combination* of mic capture
  // + AudioWorklet as the minimum bar; falling back to ScriptProcessor
  // would be possible but is deprecated and quirky.
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return Boolean(
    md &&
      typeof md.getUserMedia === "function" &&
      typeof window.AudioContext === "function" &&
      typeof window.AudioWorkletNode === "function",
  );
}

export interface RecordingResult {
  /** WAV PCM16 16 kHz mono blob, ready for `uploadAudio()`. */
  blob: Blob;
  /** Total recorded duration in seconds (post-resample). */
  durationSec: number;
  /** Measured while recording: no second pass over the audio is needed. */
  analysis: FullAnalysis;
  /** Rate the microphone delivered before the resample to 16 kHz (often 48000 on phones). */
  inputSampleRate: number;
  /** What the browser applied to the microphone (from the track's settings), when it says. */
  processing: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean };
}

/**
 * Acquire a microphone `MediaStream` *synchronously inside a user
 * gesture*. This is split out from `WavRecorder.start()` because iOS
 * Safari (≤17 at the time of writing) only honours `getUserMedia` if
 * it's invoked from a synchronously-reachable code path of a user
 * gesture handler. Any `setTimeout` / `setInterval` / `await` in
 * between loses the gesture token and the native permission prompt
 * is silently suppressed.
 *
 * Pattern:
 *   onClick = () => {
 *     const streamP = acquireMicStream();   // gesture preserved
 *     startCountdown(() => {
 *       streamP.then((s) => recorder.startWithStream(s));
 *     });
 *   };
 *
 * Returns a Promise so callers can keep the synchronous call shape
 * but await the actual permission decision later. On rejection, the
 * error matches the shape thrown by `WavRecorder.start()` so the
 * existing snackbar copy keeps working.
 */
export function acquireMicStream(): Promise<MediaStream> {
  if (!isAudioRecordingSupported()) {
    return Promise.reject(
      new RecorderError(
        "Audio recording is not supported in this browser.",
        "unsupported",
      ),
    );
  }
  return navigator.mediaDevices
    .getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: WAV_TARGET_SAMPLE_RATE, // hint; iOS ignores
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    .catch((e) => {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new RecorderError(
          "Microphone permission denied.",
          "permission-denied",
        );
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new RecorderError("No usable microphone found.", "no-mic");
      }
      throw new RecorderError(
        `getUserMedia failed: ${(e as Error).message}`,
        "internal",
      );
    });
}

/**
 * Prefetch the AudioWorklet module so that the first user tap on the
 * mic button doesn't pay the network + parse cost (200–500 ms on
 * phones). Safe to call multiple times `<link rel="prefetch">` is
 * the lightest-weight primitive that warms the HTTP cache without
 * needing an AudioContext (which would itself require a user
 * gesture on iOS).
 *
 * Call this on the level screen mount.
 */
export function prewarmAudioWorklet(): void {
  if (typeof document === "undefined") return;
  // Avoid duplicate inserts on remount.
  const existing = document.head.querySelector(
    `link[data-afk-prefetch="${WORKLET_URL}"]`,
  );
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "script";
  link.href = WORKLET_URL;
  link.setAttribute("data-afk-prefetch", WORKLET_URL);
  document.head.appendChild(link);
}

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  /** Finished one-second PCM16 blocks at 16 kHz. */
  private blocks: Int16Array[] = [];
  private block = new Int16Array(BLOCK_SAMPLES);
  private fill = 0;
  private outSamples = 0;
  private downsampler: Downsampler | null = null;
  private meter = createTakeMeter(WAV_TARGET_SAMPLE_RATE);
  private starting: Promise<void> | null = null;
  private isRecording = false;
  /** Smoothed RMS of the latest audio (0..1), for a live level meter. */
  private rms = 0;
  private frames = 0;

  /**
   * Acquires the mic, sets up the pipeline, and starts buffering. On
   * second + subsequent calls within the same instance, returns the
   * in-flight promise rather than re-opening the device.
   *
   * If `preAcquiredStream` is provided, skips the internal
   * `getUserMedia` call and adopts the caller's stream. This is the
   * iOS-Safari-safe path: see `acquireMicStream()`.
   */
  async start(preAcquiredStream?: MediaStream): Promise<void> {
    if (this.starting) return this.starting;
    if (this.isRecording) return;
    this.starting = this.startInternal(preAcquiredStream).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startInternal(preAcquiredStream?: MediaStream): Promise<void> {
    if (!isAudioRecordingSupported()) {
      throw new RecorderError(
        "Audio recording is not supported in this browser.",
        "unsupported",
      );
    }

    // Acquire mic if the caller didn't already. Most permission errors
    // land in `acquireMicStream`; this branch handles the legacy
    // direct-`start()` path.
    let stream: MediaStream;
    if (preAcquiredStream) {
      stream = preAcquiredStream;
    } else {
      try {
        stream = await acquireMicStream();
      } catch (e) {
        if (e instanceof RecorderError) throw e;
        throw new RecorderError(
          `getUserMedia failed: ${(e as Error).message}`,
          "internal",
        );
      }
    }

    let ctx: AudioContext;
    try {
      // The constructor `sampleRate` option is honoured on Chromium /
      // Firefox but ignored on Safari. We read back `ctx.sampleRate`
      // before encoding and resample if needed see `stop()`.
      ctx = new AudioContext({ sampleRate: WAV_TARGET_SAMPLE_RATE });
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw new RecorderError(
        `AudioContext setup failed: ${(e as Error).message}`,
        "internal",
      );
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });

    this.resetBuffers(ctx.sampleRate);
    this.rms = 0;
    this.frames = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!(e.data instanceof Float32Array)) return;
      this.frames += e.data.length;
      this.append(this.downsampler!.push(e.data));
      let sum = 0;
      for (let i = 0; i < e.data.length; i++) sum += e.data[i] * e.data[i];
      const now = Math.sqrt(sum / Math.max(1, e.data.length));
      // Fast attack, slow release: the meter jumps with the voice and falls back gently.
      this.rms = now > this.rms ? now : this.rms * 0.92 + now * 0.08;
    };

    source.connect(node);
    // Do NOT connect the node to `ctx.destination` that would feed
    // the user's voice back into their speakers (echo). The worklet is
    // a sink, the connection above is enough to drive `process()`.

    // iOS Safari can hand back a context in "suspended" state when
    // it's constructed inside a Promise chain (we are: getUserMedia
    // already awaited above). The worklet's process() never runs in
    // suspended state, so the recording would silently capture zero
    // chunks and `stop()` would throw "No audio captured." Defensive
    // resume `getUserMedia` itself counts as an extending gesture
    // so this almost always succeeds.
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // best-effort
      }
    }

    this.ctx = ctx;
    this.stream = stream;
    this.source = source;
    this.node = node;
    this.isRecording = true;
  }

  private resetBuffers(inputRate: number) {
    this.blocks = [];
    this.block = new Int16Array(BLOCK_SAMPLES);
    this.fill = 0;
    this.outSamples = 0;
    this.downsampler = createDownsampler(inputRate, WAV_TARGET_SAMPLE_RATE);
    this.meter = createTakeMeter(WAV_TARGET_SAMPLE_RATE);
  }

  /** 16 kHz float samples → PCM16 into the current block, measured on the way. */
  private append(samples: Float32Array) {
    if (!samples.length) return;
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
      pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    this.meter.push(pcm, 1 / 32768);
    this.outSamples += pcm.length;
    let from = 0;
    while (from < pcm.length) {
      const n = Math.min(pcm.length - from, BLOCK_SAMPLES - this.fill);
      this.block.set(pcm.subarray(from, from + n), this.fill);
      this.fill += n;
      from += n;
      if (this.fill === BLOCK_SAMPLES) {
        this.blocks.push(this.block);
        this.block = new Int16Array(BLOCK_SAMPLES);
        this.fill = 0;
      }
    }
  }

  /**
   * Stops the pipeline and returns the encoded WAV. Always cleans up
   * the mic stream and AudioContext before resolving, even on error.
   */
  async stop(opts: { leadS?: number } = {}): Promise<RecordingResult> {
    if (!this.isRecording) {
      throw new RecorderError("stop() called before start().", "internal");
    }

    // Snapshot state, then tear down.
    const ctx = this.ctx;
    const settings = this.stream?.getAudioTracks()[0]?.getSettings?.() ?? {};
    const node = this.node;
    const source = this.source;
    const stream = this.stream;

    this.isRecording = false;
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.stream = null;

    try {
      if (node) {
        node.port.onmessage = null;
        node.disconnect();
      }
      if (source) source.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== "closed") await ctx.close();
    } catch {
      // Best-effort cleanup; swallow.
    }

    if (this.frames === 0 || !this.downsampler) {
      throw new RecorderError("No audio captured.", "internal");
    }

    const inputRate = ctx?.sampleRate ?? WAV_TARGET_SAMPLE_RATE;
    this.append(this.downsampler.flush());
    const blocks = this.fill > 0 ? [...this.blocks, this.block.slice(0, this.fill)] : this.blocks;
    const blob = wavBlobFromChunks(blocks, WAV_TARGET_SAMPLE_RATE);
    const durationSec = this.outSamples / WAV_TARGET_SAMPLE_RATE;
    const analysis = analysisFromStats(this.meter.stats(), opts);
    this.resetBuffers(WAV_TARGET_SAMPLE_RATE);
    this.downsampler = null;

    const flag = (v: unknown) => (typeof v === "boolean" ? v : undefined);
    return {
      blob,
      durationSec,
      analysis,
      inputSampleRate: inputRate,
      processing: { echoCancellation: flag(settings.echoCancellation), noiseSuppression: flag(settings.noiseSuppression), autoGainControl: flag(settings.autoGainControl) },
    };
  }

  /**
   * Force-tears down the pipeline without producing a blob. Safe to
   * call on unmount even if `start()` was never called.
   */
  async dispose(): Promise<void> {
    try {
      if (this.node) {
        this.node.port.onmessage = null;
        this.node.disconnect();
      }
      if (this.source) this.source.disconnect();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    } catch {
      // ignore
    }
    this.isRecording = false;
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.blocks = [];
    this.block = new Int16Array(0);
    this.fill = 0;
    this.downsampler = null;
  }

  get recording(): boolean {
    return this.isRecording;
  }

  /** Live input level in dBFS (about -100 when silent). Read it on an animation frame. */
  get levelDbfs(): number {
    return this.rms > 0 ? Math.max(-100, 20 * Math.log10(this.rms)) : -100;
  }

  /** Seconds of audio captured so far (at the context's rate, before resampling). */
  get capturedSeconds(): number {
    return this.ctx ? this.frames / this.ctx.sampleRate : 0;
  }
}
