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
 *     headers:
 *       X-Campaign-Ticket   (campaign takes, when the dashboard issues tickets) passed through
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
 *   - Refuse to send when `navigator.onLine === false`. Surfaces as
 *     `AudioUploadError(isNetwork=true)`.
 *   - Abort a request that has stopped moving (APP-001). The timeout is
 *     **idle-based**, not a wall clock: on a slow uplink a 10 MB take may
 *     need many minutes, and that is fine as long as bytes keep flowing.
 *     The body goes through `XMLHttpRequest`, the only browser API with
 *     upload progress: no progress for `IDLE_TIMEOUT_MS` aborts, and once
 *     the last byte is sent the server has `RESPONSE_TIMEOUT_MS` to answer
 *     (the proxy forwards to Sayari, which may be cold). A timeout *is* one
 *     of the request states that could leave a half-written file on the
 *     server; the outbox sends again and the dashboard dedupes on sha-256.
 *   - Report progress (`onProgress`) so the screens can show "34 %".
 *   - Map low-level network failures to a friendlier message so the
 *     snackbar isn't a stack trace.
 */

const DEFAULT_BASE_URL = "";

// We always POST to a same-origin proxy. The actual Sayari URL is
// configured server-side via `SAYARI_BASE_URL` (see
// `src/app/api/audio-upload/route.ts`). Keeping the proxy in front
// avoids Sayari's CORS allowlist, which only includes
// `http://localhost:3000` and would otherwise make the deployed PWA
// see successful uploads as `TypeError: Failed to fetch`.
const BASE_URL = DEFAULT_BASE_URL;

/** Abort when no upload bytes have moved for this long (a dead link, not a slow one). */
export const IDLE_TIMEOUT_MS = 30_000;
/** Once the whole body is sent: how long the proxy (and Sayari behind it) may take to answer. */
export const RESPONSE_TIMEOUT_MS = 90_000;

export class AudioUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number = 0,
    /** True if the failure happened before any HTTP response i.e. the
     *  user is offline, DNS failed, CORS blocked the preflight, or the
     *  socket timed out. Useful for callers that want to show a
     *  reconnect prompt rather than a generic upload error. */
    public readonly isNetwork: boolean = false,
    /** Seconds the server asked to wait (`Retry-After` on 429/503), when it said. */
    public readonly retryAfterS: number | null = null,
    /** The machine code the proxy names in its JSON `error` (`server_misconfigured`, `ticket_required`…), when it does. */
    public readonly code: string | null = null,
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
  /** The signed-in contributor's Supabase access token: the upload proxy refuses uploads without one. */
  accessToken?: string;
  /**
   * The dashboard's signed upload ticket for this file (docs/contracts/README.md §1), sent as
   * `X-Campaign-Ticket`. Passed through untouched; without one the upload goes as before.
   */
  ticket?: string;
  /** Upload progress in bytes (the multipart body, so a little more than the file). */
  onProgress?: (sent: number, total: number) => void;
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
  // *is* false we know the request will fail: surface the offline
  // state immediately (`isNetwork`).
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

  let response: RawResponse;
  try {
    response = await send(url, form, args);
  } catch (e) {
    // Caller cancelled propagate as cancellation.
    if (args.signal?.aborted) {
      throw new AudioUploadError("Upload cancelled.", 0, false);
    }
    const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
    throw new AudioUploadError(
      isTimeout
        ? "The connection stopped moving. We will try again."
        : "Couldn't reach the server. Check your connection and try again.",
      0,
      true,
    );
  }

  if (response.status >= 200 && response.status < 300) {
    // The id is optional: the dashboard identifies a recording by the file's sha-256.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      // not JSON
    }
    return { recordingId: recordingIdFromResponse(parsed) };
  }

  throw new AudioUploadError(
    `Upload failed (${response.status}): ${response.text.slice(0, 500) || response.statusText}`,
    response.status,
    false,
    parseRetryAfter(response.retryAfter),
    errorCodeOf(response.text),
  );
}

/** The `error` code of a JSON error body (`{"error":"server_misconfigured"}`), or null: a message or HTML is not a code. */
export function errorCodeOf(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    const code = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
    return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

type RawResponse = { status: number; statusText: string; text: string; retryAfter: string | null };

/** `Retry-After` in seconds (delta form only; dates are not used by our proxy), capped at 1 h. */
export function parseRetryAfter(v: string | null): number | null {
  if (!v || !/^\d{1,6}$/.test(v.trim())) return null;
  return Math.min(3600, Number(v.trim()));
}

/** POST the form with an idle timeout and progress. Rejects with a TimeoutError DOMException on a stall. */
function send(url: string, form: FormData, args: UploadAudioArgs): Promise<RawResponse> {
  const headers: Record<string, string> = args.accessToken ? { Authorization: `Bearer ${args.accessToken}` } : {};
  if (args.ticket) headers["X-Campaign-Ticket"] = args.ticket;
  if (typeof XMLHttpRequest === "undefined") return sendWithFetch(url, form, headers, args.signal);
  return new Promise<RawResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      args.signal?.removeEventListener("abort", onCallerAbort);
      fn();
    };
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        xhr.abort();
        done(() => reject(new DOMException("No progress", "TimeoutError")));
      }, ms);
    };
    const onCallerAbort = () => {
      xhr.abort();
      done(() => reject(args.signal?.reason ?? new DOMException("Aborted", "AbortError")));
    };

    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      arm(IDLE_TIMEOUT_MS);
      if (e.lengthComputable) args.onProgress?.(e.loaded, e.total);
    };
    // The whole body is out: now the server has a while to answer.
    xhr.upload.onload = () => arm(RESPONSE_TIMEOUT_MS);
    xhr.onload = () =>
      done(() => resolve({ status: xhr.status, statusText: xhr.statusText, text: typeof xhr.responseText === "string" ? xhr.responseText : "", retryAfter: xhr.getResponseHeader("retry-after") }));
    xhr.onerror = () => done(() => reject(new TypeError("Failed to fetch")));
    xhr.onabort = () => done(() => reject(new DOMException("Aborted", "AbortError")));
    xhr.ontimeout = () => done(() => reject(new DOMException("No progress", "TimeoutError")));
    args.signal?.addEventListener("abort", onCallerAbort, { once: true });
    arm(IDLE_TIMEOUT_MS);
    xhr.send(form);
  });
}

/** Without XMLHttpRequest (not a browser): plain fetch, no progress, a generous overall timeout. */
async function sendWithFetch(url: string, form: FormData, headers: Record<string, string>, signal?: AbortSignal): Promise<RawResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("No progress", "TimeoutError")), RESPONSE_TIMEOUT_MS + IDLE_TIMEOUT_MS);
  const onCallerAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  try {
    const res = await fetch(url, { method: "POST", body: form, signal: ctrl.signal, headers });
    const text = await res.text().catch(() => "");
    return { status: res.status, statusText: res.statusText, text, retryAfter: res.headers.get("retry-after") };
  } catch (e) {
    throw ctrl.signal.reason instanceof DOMException && ctrl.signal.reason.name === "TimeoutError" ? ctrl.signal.reason : e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
