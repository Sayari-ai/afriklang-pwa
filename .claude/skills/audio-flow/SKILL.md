---
name: audio-flow
description: The recording → review → submit pipeline (getUserMedia → AudioWorklet → PCM16 WAV → Sayari upload via Next API proxy) and its iOS gesture-token + at-most-once invariants. USE FOR: changing mic capture / WavRecorder, adding/changing the 3-2-1 countdown, debugging "permission denied silently" on iOS Safari, modifying uploadAudio / AudioUploadError, the /api/audio-upload Next route, the Sayari multipart contract, the pcm-recorder AudioWorklet, sample-rate/resampling logic, recording filename slugs, OS mic indicator not clearing, duplicate uploads, retry/queue logic. Trigger phrases: "recorder", "WavRecorder", "AudioWorklet", "getUserMedia", "ios mic", "user gesture", "mic permission", "wav upload", "Sayari", "audio-upload route", "duplicate upload", "AudioUploadError", "pcm-recorder.worklet". DO NOT USE FOR: backend audio storage (handled by Sayari, not this repo), generic Web Audio synthesis, audio playback unrelated to the review step, or speech recognition / transcription (not implemented).
---

# Audio recording & upload pipeline

The full pipeline:

```
user tap (gesture)
   │
   ▼
beginCountdown() ─── synchronously calls acquireMicStream() ───► OS prompt
   │                              │
   │                              ▼
   │                      Promise<MediaStream> stashed on pendingStreamRef
   ▼
3-2-1 countdown (setInterval)
   │
   ▼
startRecording() ── adopts pendingStreamRef stream ──► WavRecorder.start(stream)
                                                          │
   AudioContext (ctx.sampleRate may be 44100 or 48000) ◄──┤
   AudioWorklet('pcm-recorder') ──► Float32Array chunks ◄─┤
   chunks pushed into recorderRef.current.chunks         │
                                                          │
user tap stop                                             │
   │                                                      │
   ▼                                                      │
stopRecording() ──► WavRecorder.stop() ◄──────────────────┘
                       │
                       ├─► concat Float32 chunks
                       ├─► resample to 16000 Hz (if needed)
                       ├─► floatToPCM16
                       ├─► encodeWav  → Blob('audio/wav')
                       └─► tear down stream + ctx
   │
   ▼
review phase: Listen / Retake / Submit
   │
   ▼ (Submit)
buildRecordingFilename() ─► `${iso}_${uuid}_${stamp}_${topic}.wav`
   │
   ▼
uploadAudio({ file, filename, ... })
   │
   ▼
fetch('/api/audio-upload', { method: 'POST', body: FormData })
   │
   ▼
src/app/api/audio-upload/route.ts (Node runtime, duplex: 'half')
   │
   ▼
Sayari Railway endpoint /api/audio/upload
```

The two non-obvious invariants **iOS gesture preservation** and **at-most-once submit** are the source of almost every bug in this area. Read them in full before changing anything.

## INVARIANT 1: iOS Safari user-gesture preservation

iOS Safari (≤17 at time of writing) only honours `navigator.mediaDevices.getUserMedia()` if it's invoked from a **synchronously reachable code path of the user gesture handler**. Any of these break the gesture token and the OS permission prompt is silently suppressed:

- `await` before the call inside the click handler
- `setTimeout` / `setInterval` callbacks
- `requestAnimationFrame` callbacks
- `Promise.then` callbacks (after the synchronous portion finishes)
- React state-update batched effects

The level screen has a 3-2-1 countdown between tap and recording, which is exactly the "setInterval before getUserMedia" anti-pattern. The fix:

```ts
// src/app/(app)/level/[cycleLevel]/page.tsx beginCountdown()
const beginCountdown = useCallback(() => {
  if (phase === "countdown" || phase === "recording") return;
  if (countdownRef.current) return;

  // CRITICAL: synchronous getUserMedia call inside the gesture handler.
  // Don't await just stash the promise on the ref.
  if (!pendingStreamRef.current) {
    pendingStreamRef.current = acquireMicStream();
    pendingStreamRef.current.catch(() => {}); // swallow unhandledrejection; startRecording surfaces snackbar
  }

  setPhase("countdown");
  setCountdown(3);
  countdownRef.current = setInterval(() => {
    setCountdown((n) => {
      if (n === null) return null;
      if (n <= 1) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        queueMicrotask(() => {
          setCountdown(null);
          void startRecording(); // adopts pendingStreamRef.current
        });
        return n;
      }
      return n - 1;
    });
  }, 1000);
}, [phase, startRecording]);
```

Then `startRecording` adopts the pre-acquired stream:

```ts
const pending = pendingStreamRef.current;
pendingStreamRef.current = null;
const stream = pending ? await pending : undefined;
const rec = new WavRecorder();
recorderRef.current = rec;
await rec.start(stream); // WavRecorder.start accepts a preAcquiredStream
```

`acquireMicStream()` is exported from `src/lib/audio/recorder.ts`. It's a thin wrapper around `getUserMedia` that maps `NotAllowedError` / `NotFoundError` to typed `RecorderError`s. **It must be called synchronously from the click handler.** If you find yourself wanting to put any logic between the tap and the call, push that logic AFTER instead.

`WavRecorder.start(preAcquiredStream?)` is the iOS-safe path. The legacy `WavRecorder.start()` with no args still calls `acquireMicStream` internally that path works on Chrome / Firefox / Android, but **breaks silently on iOS Safari**.

## INVARIANT 2: At-most-once submit

`uploadAudio()` performs **exactly one POST per call** and never retries internally. This is intentional after we hit duplicate-write bugs.

The story: `/api/audio-upload` proxies to Sayari, which is non-idempotent successful storage produces a new file. A request that succeeded server-side but had its response truncated (LB timeout after S3 write, connection killed before headers, slow Railway cold start) would, with retry-on-failure, replay the upload and persist the SAME WAV twice. Even though our filenames embed UUID + timestamp, dedupe is the backend's choice.

Concrete consequences for this codebase:

- `uploadAudio` does **one** `fetch()`. No `for (let i = 0; i < retries; i++)` loop. Don't add one.
- **No client-side retry queue** (no IndexedDB persisted-failed-uploads). The user retries by tapping Submit again. This bounds duplicate-write risk to deliberate user action.
- Failure UX: snackbar with the friendly message. The user decides whether to tap Submit again.
- We **do** still apply a 45 s `AbortController` timeout. A timeout *can* technically leave a half-written file on the server it's a known trade-off vs. letting a hung TCP socket spin forever. Documented in `src/lib/api/audio.ts` doc comment.

```ts
// src/lib/api/audio.ts uploadAudio (skeleton)
export async function uploadAudio(args: UploadAudioArgs): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AudioUploadError("You appear to be offline. Reconnect and try again.", 0, true);
  }

  const form = new FormData();
  form.append("language", args.languageIso);
  form.append("consent_recorded", String(args.consentRecorded));
  if (args.dialect != null) form.append("dialect", args.dialect);
  if (args.englishDescription != null) form.append("english_description", args.englishDescription);
  if (args.speakerId != null) form.append("speaker_id", args.speakerId);
  const wavFile = new File([args.file], args.filename, { type: "audio/wav" });
  form.append("files", wavFile);                  // field name is "files" (plural array backend contract)

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException("Request timed out", "TimeoutError")), 45_000);

  let response: Response;
  try {
    response = await fetch("/api/audio-upload", {
      method: "POST",
      body: form,
      signal: ctrl.signal,
      // Do NOT set Content-Type fetch adds the multipart boundary itself.
    });
  } catch (e) {
    clearTimeout(timeoutId);
    // Map TypeError: Failed to fetch / TimeoutError → AudioUploadError(isNetwork=true)
    throw new AudioUploadError(/* friendly message */, 0, true);
  }
  clearTimeout(timeoutId);

  if (response.ok) { await response.arrayBuffer().catch(() => undefined); return; }
  // HTTP-level error: throw with isNetwork=false so caller doesn't show offline snackbar
  throw new AudioUploadError(`Upload failed (${response.status}): ${await response.text()}`, response.status, false);
}
```

The level screen's `onSubmit` distinguishes network vs. HTTP failures:

```ts
const isNetwork = e instanceof AudioUploadError && e.isNetwork;
useSnackbar.getState().show(
  isNetwork ? t("levelOfflineSubmitSnack") : t("levelUploadFailedSnack", { error: message }),
  4000,
);
```

`isNetwork=true` → offlineSubmitSnack (friendly "you're offline" copy). `isNetwork=false` (5xx, CORS rejection from upstream proxy → 502, etc.) → generic uploadFailedSnack with the upstream message. **Don't conflate these.** A 5xx is not "you're offline".

## The Next API proxy why it exists

`src/app/api/audio-upload/route.ts` is a same-origin proxy. Sayari's CORS allowlist only includes `http://localhost:3000`. Any other browser origin POSTing the multipart form directly gets:

1. The WAV is written successfully server-side.
2. The browser strips the response (CORS).
3. `fetch` rejects with `TypeError: Failed to fetch`.
4. Our client maps this to `isNetwork=true` and shows "you're offline" **wrong**, the upload worked.

Server-to-server has no CORS. So we proxy. Important properties of the proxy:

- `runtime = "nodejs"` Edge runtime's fetch doesn't support streaming request bodies properly.
- `dynamic = "force-dynamic"` never cache.
- Streams `request.body` straight to upstream (`duplex: "half"` is required by the fetch spec when the body is a stream).
- Forwards only `content-type` (carries the multipart boundary REQUIRED) and `content-length`. Strips host, cookies, auth.
- `request.signal` is plumbed through so client `AbortController` cancels upstream too.
- Upstream unreachable → return 502 with `{error:"upstream_fetch_failed"}`. The client treats `status !== 0` as `isNetwork=false`, so this won't show the misleading offline snackbar.

`SAYARI_BASE_URL` env var configures upstream; defaults to the Railway URL. Don't put the Sayari URL in `NEXT_PUBLIC_*` client config the proxy is the only thing that should know it.

## Sample-rate quirks

```ts
// src/lib/audio/recorder.ts
ctx = new AudioContext({ sampleRate: WAV_TARGET_SAMPLE_RATE });   // 16000
await ctx.audioWorklet.addModule("/audio/pcm-recorder.worklet.js");
```

The `sampleRate` constructor option is **honoured on Chromium and Firefox, ignored on Safari** (clamps to device hardware rate, usually 48000). We always read back `ctx.sampleRate` after creation and resample on the way out:

```ts
const inputRate = ctx?.sampleRate ?? WAV_TARGET_SAMPLE_RATE;
const downsampled = inputRate === WAV_TARGET_SAMPLE_RATE
  ? raw
  : resampleLinear(raw, inputRate, WAV_TARGET_SAMPLE_RATE);
```

Don't trust the constructor. Don't hard-code 48000 either Android can be 44100, some headsets 16000 already.

## AudioWorklet path

The worklet code lives at `public/audio/pcm-recorder.worklet.js` (NOT bundled by webpack served as a static file because the AudioWorklet spec requires a URL). Loaded via `await ctx.audioWorklet.addModule("/audio/pcm-recorder.worklet.js")`. If you change the worklet:

- Edit `public/audio/pcm-recorder.worklet.js` directly.
- The worklet posts `Float32Array` per render quantum (128 frames). The recorder concatenates these in `chunks: Float32Array[]`.
- The worklet has no inputs as outputs (we don't connect to `ctx.destination` that would echo the user's voice into their speakers).

## Filename slugs

```ts
// src/lib/audio/filename.ts (buildRecordingFilename)
// Returns: `${iso}_${uuid}_${stamp}_${topic}.wav`
// Where:
//   iso    = languageIso (e.g. "wo", "tw")
//   uuid   = speakerId (device UUID)
//   stamp  = ISO 8601 timestamp
//   topic  = `pNN-Lx-qy` slug pathId, levelId, qIndex
//
// The `${slug}` portion is `pNN-Lx-qy` note: NO cycle prefix.
// path_id is globally unique (1..20), so the slug is unambiguous
// across cycles. Don't add cycle to the slug it would silently
// break the Sayari ingest's filename parser.
```

Built at the call site:

```ts
const filename = buildRecordingFilename({
  languageIso: langIso,
  speakerId,
  pathId: owningPathId,        // from usePathRepo bundle
  levelId,
  qIndex: question.qIndex,
});
```

## Cleanup paths releasing the OS mic indicator

Three exit paths must release pending streams or the OS mic indicator (red dot on iOS, mic icon in browser tab) sticks around until tab close:

1. **Unmount cleanup** (back button, route change):
   ```ts
   useEffect(() => () => {
     if (tickerRef.current) clearInterval(tickerRef.current);
     if (countdownRef.current) clearInterval(countdownRef.current);
     const rec = recorderRef.current;
     if (rec) void rec.dispose();
     const pending = pendingStreamRef.current;
     if (pending) {
       pending.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
       pendingStreamRef.current = null;
     }
     if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
   }, []);
   ```

2. **Skip during countdown** (user tapped Skip before recording started stream was acquired but never adopted):
   ```ts
   const pending = pendingStreamRef.current;
   if (pending) {
     pending.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
     pendingStreamRef.current = null;
   }
   ```

3. **Submit success** `WavRecorder.stop()` already tears down its own stream + ctx in a `finally`. Don't double-release.

`WavRecorder.dispose()` is idempotent and safe to call from cleanup even if `start()` was never called.

## "Modify the recording flow" pre-flight checklist

Before you change anything in `src/lib/audio/recorder.ts`, `src/lib/api/audio.ts`, `src/app/api/audio-upload/route.ts`, or the level-screen recording handlers:

- [ ] Does the change preserve the **synchronous `acquireMicStream()` call from the click handler**? If you add an `await` before it, iOS will silently break.
- [ ] Does the change preserve **at-most-once upload semantics**? No retry loops, no IDB queue, no auto-replay.
- [ ] Does it correctly distinguish `isNetwork=true` (offline / DNS / CORS / timeout pre-response) from `isNetwork=false` (HTTP 4xx/5xx)?
- [ ] Does every exit path **stop all `MediaStream` tracks and close the `AudioContext`**? (unmount, skip mid-countdown, skip mid-recording, submit success, submit failure)
- [ ] Does it preserve the multipart field name **`files`** (plural) for the WAV upload? Backend contract.
- [ ] If you touched the API proxy, did you keep `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `duplex: "half"`, and the `content-type` forwarding?
- [ ] If you touched filename generation, did you preserve the `pNN-Lx-qy` slug shape (no cycle prefix)?
- [ ] If you touched sample rates, did you preserve the read-back-and-resample pattern (no hard-coded 48000)?
- [ ] Did you test on **real iOS Safari**, not just Chrome DevTools "iPhone" emulation? Emulation does NOT enforce the gesture-token rule.

## Common bugs and what they actually mean

| Symptom | Real cause |
|---|---|
| iOS: tap mic, nothing happens, no permission prompt | Gesture token lost (await before `getUserMedia`, or call from `setTimeout`) |
| "You appear to be offline" but the upload actually worked | CORS-blocked direct call to Sayari must go through `/api/audio-upload` proxy |
| Two copies of the WAV in the Sayari bucket for one tap | Client-side retry loop reintroduced remove it |
| OS mic indicator stays on after backing out of level | Unmount cleanup didn't release `pendingStreamRef` |
| Recording is double-speed or half-speed | `ctx.sampleRate` mismatch confirm resample step ran |
| `AudioUploadError(status=502)` shown as offline | Wrong 502 is `isNetwork=false`. Check the throw site. |
| Worklet `addModule` 404 | Path is `/audio/pcm-recorder.worklet.js`, served from `public/`. Don't put it under `src/`. |
