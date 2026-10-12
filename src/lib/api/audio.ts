"use client";

/**
 * Sayari audio-upload client.
 *
 * Mirrors `lib/core/api/audio_api.dart`. Single endpoint:
 *   POST /api/audio-upload   (same-origin Next.js Route Handler that
 *   proxies to Sayari server-side see
 *   `src/app/api/audio-upload/route.ts` for why)
 *   multipart/form-data
 *     fields:
 *       language            (required)  ISO 639-1/-3 code
 *       consent_recorded    (required)  'true' | 'false'
 *       dialect             (optional)
 *       english_description (optional)
 *       speaker_id          (optional)
 *       + campaign fields   (optional, campaign recordings only; docs/SAYARI_UPLOAD_PAYLOAD.json)
 *     files:
 *       files               (required)  binary, content-type audio/wav
 *
 * The schema field name is `files` (plural array) the backend
 * accepts an array of binaries even when we only ever send one. Don't
 * rename it without coordinating with the Sayari team.
 *
 * Errors are surfaced as `AudioUploadError` so the level screen can
 * show the existing `levelUploadFailedSnack` ICU message.
 *
 * At-most-once policy
 * -------------------
 * `uploadAudio()` performs **exactly one HTTP POST per call** and
 * never retries internally. Earlier revisions ran a 3-attempt
 * exponential-backoff loop inside this function, which is unsafe on
 * a non-idempotent endpoint: a request that *succeeded* server-side
 * but had its response truncated (timeout at the LB after S3 wrote,
 * connection killed before headers, etc.) would be replayed and
 * persist the same WAV to storage twice. Even though our filenames
 * embed a UUID + timestamp, dedupe is the backend's choice the
 * client must not assume it. The user-visible retry path is now: the
 * level screen surfaces the failure via snackbar, the user taps
 * Submit again. That keeps the duplicate-write risk strictly bounded
 * to deliberate user action.
 *
 * We still:
 *   - Refuse to send when `navigator.onLine === false` (saves a 45 s
 *     wait for a guaranteed-failure fetch). Surfaces as
 *     `AudioUploadError(isNetwork=true)`.
 *   - Apply a per-call timeout via `AbortController`, since `fetch()`
 *     itself has no built-in timeout and a hung TCP socket would
 *     otherwise spin forever on flaky networks. A timeout *is* one of
 *     the request states that could leave a half-written file on the
 *     server, but the alternative letting the upload hang is
 *     worse UX. The user manually decides whether to retry.
 *   - Map low-level `TypeError: Failed to fetch` (the browser's catch-
 *     all for offline / DNS / CORS / mixed-content) to a friendlier
 *     message so the snackbar isn't a stack trace.
 */

const DEFAULT_BASE_URL = "";

// We always POST to a same-origin proxy. The actual Sayari URL is
// configured server-side via `SAYARI_BASE_URL` (see
// `src/app/api/audio-upload/route.ts`). Keeping the proxy in front
// avoids Sayari's CORS allowlist, which only includes
// `http://localhost:3000` and would otherwise make the deployed PWA
// see successful uploads as `TypeError: Failed to fetch`.
const BASE_URL = DEFAULT_BASE_URL;

/** Per-call timeout. Railway cold starts can take ~20 s, so don't
 *  set this too aggressively. */
const REQUEST_TIMEOUT_MS = 45_000;

export class AudioUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number = 0,
    /** True if the failure happened before any HTTP response i.e. the
     *  user is offline, DNS failed, CORS blocked the preflight, or the
     *  socket timed out. Useful for callers that want to show a
     *  reconnect prompt rather than a generic upload error. */
    public readonly isNetwork: boolean = false,
  ) {
    super(message);
    this.name = "AudioUploadError";
  }
}

export interface UploadAudioArgs {
  /** WAV PCM16 16 kHz mono blob produced by the recorder. */
  file: Blob;
  /** Filename written to disk by the backend (`Lang_Speaker_Date_Topic.wav`). */
  filename: string;
  /** ISO 639-1 / 639-3 the user's chosen learning language. */
  languageIso: string;
  /** Whether consent has been granted and recorded for this clip. */
  consentRecorded: boolean;
  dialect?: string;
  /** English prompt shown to the speaker; useful as ground truth. */
  englishDescription?: string;
  /** Stable speaker UUID same as our `device_id`. */
  speakerId?: string;
  /** Extra text fields appended to the multipart body (campaign context: see docs/SAYARI_UPLOAD_PAYLOAD.json). Never overrides the fields above. */
  extraFields?: Record<string, string>;
  /** Optional `AbortSignal` for cancel-on-unmount. */
  signal?: AbortSignal;
}

/** What Sayari answered, best effort: the recording's id when the response carries one. */
export interface UploadAudioResult {
  recordingId: string | null;
}

/** Find a recording id in Sayari's upload response (shape is not documented: tolerate a few). */
export function recordingIdFromResponse(body: unknown): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    for (const k of ["audio_id", "id", "recording_id"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  };
  if (Array.isArray(body)) return pick(body[0]);
  const direct = pick(body);
  if (direct) return direct;
  const inner = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  for (const k of ["files", "results", "items", "data", "uploaded"]) {
    const v = inner[k];
    const found = Array.isArray(v) ? pick(v[0]) : pick(v);
    if (found) return found;
  }
  return null;
}

export async function uploadAudio(args: UploadAudioArgs): Promise<UploadAudioResult> {
  // Fail fast when the device reports offline. `navigator.onLine` is
  // not 100% reliable (it only catches "no interface"), but when it
  // *is* false we know the fetch will fail in 45 s with the same
  // outcome better to surface the offline state immediately. The
  // level screen uses `isNetwork` to render an offline-specific
  // snackbar.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AudioUploadError(
      "You appear to be offline. Reconnect and try again.",
      0,
      true,
    );
  }

  const url = `${BASE_URL}/api/audio-upload`;

  // Build the multipart body. We don't reuse this across calls the
  // function is single-shot now, but `FormData` is also single-shot
  // in some engines (Safari < 16) so building locally keeps the
  // contract obvious.
  const form = new FormData();
  form.append("language", args.languageIso);
  form.append("consent_recorded", String(args.consentRecorded));
  if (args.dialect != null) form.append("dialect", args.dialect);
  if (args.englishDescription != null) {
    form.append("english_description", args.englishDescription);
  }
  if (args.speakerId != null) form.append("speaker_id", args.speakerId);
  for (const [k, v] of Object.entries(args.extraFields ?? {})) if (!form.has(k)) form.append(k, v);
  // Wrap the blob in a File so the multipart part carries the
  // filename (browsers drop bare Blob filenames otherwise).
  const wavFile = new File([args.file], args.filename, { type: "audio/wav" });
  form.append("files", wavFile);

  // If the caller already aborted (component unmounted), stop here
  // and don't masquerade the cancellation as a network failure.
  if (args.signal?.aborted) {
    throw new AudioUploadError("Upload cancelled.", 0, false);
  }

  // Per-call timeout. Linked to the caller's signal via a tiny
  // controller so an external abort still wins.
  const ctrl = new AbortController();
  const timeoutId = setTimeout(
    () =>
      ctrl.abort(new DOMException("Request timed out", "TimeoutError")),
    REQUEST_TIMEOUT_MS,
  );
  const onCallerAbort = () => ctrl.abort(args.signal?.reason);
  args.signal?.addEventListener("abort", onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: ctrl.signal,
      // Do NOT set `Content-Type` manually fetch needs to add the
      // multipart boundary itself.
    });
  } catch (e) {
    clearTimeout(timeoutId);
    args.signal?.removeEventListener("abort", onCallerAbort);

    // Caller cancelled propagate as cancellation.
    if (args.signal?.aborted) {
      throw new AudioUploadError("Upload cancelled.", 0, false);
    }

    // Distinguish timeout vs generic network failure so the user
    // sees an actionable message in the snackbar.
    const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
    const rawMsg = e instanceof Error ? e.message : String(e);

    // Browsers throw `TypeError: Failed to fetch` for: offline, DNS
    // miss, CORS block, mixed content, refused TCP, killed by
    // extension. We can't tell them apart from the JS side give one
    // friendly message. With at-most-once semantics, a transient
    // hiccup now requires a manual retry tap from the user; that's
    // intentional.
    const friendly = isTimeout
      ? "The server took too long to respond. Please try again."
      : /failed to fetch|networkerror|load failed/i.test(rawMsg)
        ? "Couldn't reach the server. Check your connection and try again."
        : `Network error: ${rawMsg}`;

    throw new AudioUploadError(friendly, 0, true);
  }

  clearTimeout(timeoutId);
  args.signal?.removeEventListener("abort", onCallerAbort);

  if (response.ok) {
    // Read the body (this also lets the connection be reused). The id is optional: the
    // dashboard identifies a recording by the file's sha-256, so a missing id is fine.
    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { recordingId: recordingIdFromResponse(parsed) };
  }

  // HTTP-level error. Read body once for diagnostics.
  let body = "";
  try {
    body = await response.text();
  } catch {
    // ignore
  }
  throw new AudioUploadError(
    `Upload failed (${response.status}): ${body || response.statusText}`,
    response.status,
    false,
  );
}
