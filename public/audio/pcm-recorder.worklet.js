// PCM recorder AudioWorkletProcessor.
//
// Runs in the AudioWorkletGlobalScope (a separate realtime audio
// thread). We can't import TypeScript or bundler modules here this
// file is loaded verbatim by `audioContext.audioWorklet.addModule()`
// at runtime.
//
// Behaviour:
//   * Each render quantum (128 frames at the AudioContext's rate) is
//     copied into a block of about 50 ms; full blocks are posted to the
//     main thread as transferable Float32Arrays. Posting every quantum
//     (375 messages a second at 48 kHz) cost one small array per message
//     on the main thread (APP-005).
//   * We never produce output (the node is a sink), so we always
//     return `true` from `process()` to keep the node alive until the
//     main thread tears it down.
//
// Wiring on the main thread (see `src/lib/audio/recorder.ts`):
//
//     await ctx.audioWorklet.addModule('/audio/pcm-recorder.worklet.js');
//     const node = new AudioWorkletNode(ctx, 'pcm-recorder');
//     node.port.onmessage = (e) => handle(e.data);

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global of the AudioWorkletGlobalScope.
    this.size = Math.max(128, Math.round(sampleRate * 0.05));
    this.block = new Float32Array(this.size);
    this.fill = 0;
  }

  process(inputs) {
    // `inputs` is `Float32Array[][]`: inputs[port][channel][frame].
    // We only ever connect a single mono source, so we read input 0 / channel 0.
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Copy: the engine reuses `channel` on the next quantum.
    let from = 0;
    while (from < channel.length) {
      const n = Math.min(channel.length - from, this.size - this.fill);
      this.block.set(channel.subarray(from, from + n), this.fill);
      this.fill += n;
      from += n;
      if (this.fill === this.size) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PCMRecorderProcessor);
