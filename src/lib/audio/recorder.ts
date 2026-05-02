"use client";

/**
 * Browser equivalent of Flutter's `record` plugin: produces 16 kHz
 * mono PCM16 WAV blobs ready for the Sayari upload pipeline.
 *
 * Why not `MediaRecorder`?
 *   `MediaRecorder` only emits compressed formats (webm/opus on
 *   Chromium, mp4/aac on Safari). The Sayari ingest expects
 *   uncompressed WAV PCM16 16 kHz mono — same shape Flutter produces.
 *   We have to capture raw frames ourselves through an AudioWorklet.
 *
 * Pipeline:
 *
 *     getUserMedia ──► MediaStreamAudioSourceNode
 *                  ──► AudioWorkletNode('pcm-recorder')
 *                       │ on each render quantum (128 frames)
 *                       └─► port.onmessage(Float32Array)
 *                              │ collected into `_chunks`
 *                              ▼
 *                       on stop():
 *                           concat → resample to 16k if needed
 *                                  → floatToPCM16
 *                                  → encodeWav
 *                                  → Blob('audio/wav')
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

import {
  concatFloat32,
  encodeWav,
  floatToPCM16,
  resampleLinear,
  WAV_TARGET_SAMPLE_RATE,
} from "./wav-encoder";

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

/** Quick browser capability probe — call before opening the level screen. */
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
}

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private starting: Promise<void> | null = null;
  private isRecording = false;

  /**
   * Acquires the mic, sets up the pipeline, and starts buffering. On
   * second + subsequent calls within the same instance, returns the
   * in-flight promise rather than re-opening the device.
   */
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.isRecording) return;
    this.starting = this.startInternal().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startInternal(): Promise<void> {
    if (!isAudioRecordingSupported()) {
      throw new RecorderError(
        "Audio recording is not supported in this browser.",
        "unsupported",
      );
    }

    // Acquire mic. Most permission errors land here.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: WAV_TARGET_SAMPLE_RATE, // hint; iOS ignores
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new RecorderError("Microphone permission denied.", "permission-denied");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new RecorderError("No usable microphone found.", "no-mic");
      }
      throw new RecorderError(
        `getUserMedia failed: ${(e as Error).message}`,
        "internal",
      );
    }

    let ctx: AudioContext;
    try {
      // The constructor `sampleRate` option is honoured on Chromium /
      // Firefox but ignored on Safari. We read back `ctx.sampleRate`
      // before encoding and resample if needed — see `stop()`.
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

    this.chunks = [];
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      // Worklet posts a fresh Float32Array each quantum; just keep them.
      if (e.data instanceof Float32Array) this.chunks.push(e.data);
    };

    source.connect(node);
    // Do NOT connect the node to `ctx.destination` — that would feed
    // the user's voice back into their speakers (echo). The worklet is
    // a sink, the connection above is enough to drive `process()`.

    this.ctx = ctx;
    this.stream = stream;
    this.source = source;
    this.node = node;
    this.isRecording = true;
  }

  /**
   * Stops the pipeline and returns the encoded WAV. Always cleans up
   * the mic stream and AudioContext before resolving, even on error.
   */
  async stop(): Promise<RecordingResult> {
    if (!this.isRecording) {
      throw new RecorderError("stop() called before start().", "internal");
    }

    // Snapshot state, then tear down.
    const ctx = this.ctx;
    const node = this.node;
    const source = this.source;
    const stream = this.stream;
    const chunks = this.chunks;

    this.isRecording = false;
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.chunks = [];

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

    if (chunks.length === 0) {
      throw new RecorderError("No audio captured.", "internal");
    }

    // Concat → optional resample → PCM16 → WAV.
    const raw = concatFloat32(chunks);
    const inputRate = ctx?.sampleRate ?? WAV_TARGET_SAMPLE_RATE;
    const downsampled =
      inputRate === WAV_TARGET_SAMPLE_RATE
        ? raw
        : resampleLinear(raw, inputRate, WAV_TARGET_SAMPLE_RATE);

    const pcm = floatToPCM16(downsampled);
    const blob = encodeWav(pcm, WAV_TARGET_SAMPLE_RATE);
    const durationSec = downsampled.length / WAV_TARGET_SAMPLE_RATE;

    return { blob, durationSec };
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
    this.chunks = [];
  }

  get recording(): boolean {
    return this.isRecording;
  }
}
