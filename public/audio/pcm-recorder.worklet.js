// PCM recorder AudioWorkletProcessor.
//
// Runs in the AudioWorkletGlobalScope (a separate realtime audio
// thread). We can't import TypeScript or bundler modules here this
// file is loaded verbatim by `audioContext.audioWorklet.addModule()`
// at runtime.
//
// Behaviour:
//   * On every render quantum (128 frames at the AudioContext's rate),
//     we copy the first input channel's Float32 samples and post them
//     to the main thread as a transferable ArrayBuffer.
//   * We never produce output (the node is a sink), so we always
//     return `true` from `process()` to keep the node alive until the
//     main thread tears it down.
//
// Wiring on the main thread (see `src/lib/audio/recorder.ts`):
//
//     await ctx.audioWorklet.addModule('/audio/pcm-recorder.worklet.js');
//     const node = new AudioWorkletNode(ctx, 'pcm-recorder');
//     node.port.onmessage = (e) => chunks.push(e.data);

class PCMRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    // `inputs` is `Float32Array[][]`: inputs[port][channel][frame].
    // We only ever connect a single mono source (forced by
    // `mediaStream.getAudioTracks()[0]`'s constraints), so we read
    // input 0 / channel 0.
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Copy: the underlying buffer is reused by the engine each quantum,
    // so we cannot transfer it directly without losing data on the
    // next callback. Slicing produces a fresh ArrayBuffer that's safe
    // to transfer.
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    this.port.postMessage(copy, [copy.buffer]);

    return true;
  }
}

registerProcessor('pcm-recorder', PCMRecorderProcessor);
