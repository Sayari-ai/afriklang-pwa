"use client";

/**
 * Sayari audio-upload client.
 *
 * Mirrors `lib/core/api/audio_api.dart`. Single endpoint:
 *   POST {NEXT_PUBLIC_SAYARI_BASE_URL}/api/audio/upload
 *   multipart/form-data
 *     fields:
 *       language            (required)  ISO 639-1/-3 code
 *       consent_recorded    (required)  'true' | 'false'
 *       dialect             (optional)
 *       english_description (optional)
 *       speaker_id          (optional)
 *     files:
 *       files               (required)  binary, content-type audio/wav
 *
 * The schema field name is `files` (plural array) — the backend
 * accepts an array of binaries even when we only ever send one. Don't
 * rename it without coordinating with the Sayari team.
 *
 * Errors are surfaced as `AudioUploadError` so the level screen can
 * show the existing `levelUploadFailedSnack` ICU message.
 */

const DEFAULT_BASE_URL =
  "https://sayari-labeling-aitool-backend-f910.up.railway.app";

const BASE_URL =
  process.env.NEXT_PUBLIC_SAYARI_BASE_URL?.replace(/\/+$/, "") ?? DEFAULT_BASE_URL;

export class AudioUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number = 0,
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
  /** ISO 639-1 / 639-3 — the user's chosen learning language. */
  languageIso: string;
  /** Whether consent has been granted and recorded for this clip. */
  consentRecorded: boolean;
  dialect?: string;
  /** English prompt shown to the speaker; useful as ground truth. */
  englishDescription?: string;
  /** Stable speaker UUID — same as our `device_id`. */
  speakerId?: string;
  /** Optional `AbortSignal` for cancel-on-unmount. */
  signal?: AbortSignal;
}

export async function uploadAudio(args: UploadAudioArgs): Promise<void> {
  const url = `${BASE_URL}/api/audio/upload`;

  const form = new FormData();
  form.append("language", args.languageIso);
  form.append("consent_recorded", String(args.consentRecorded));
  if (args.dialect != null) form.append("dialect", args.dialect);
  if (args.englishDescription != null) {
    form.append("english_description", args.englishDescription);
  }
  if (args.speakerId != null) form.append("speaker_id", args.speakerId);

  // Wrap the blob in a File so the multipart part carries the filename
  // (browsers drop bare Blob filenames otherwise).
  const wavFile = new File([args.file], args.filename, { type: "audio/wav" });
  form.append("files", wavFile);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: args.signal,
      // Do NOT set `Content-Type` manually — fetch needs to add the
      // multipart boundary itself.
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AudioUploadError(`Network error: ${msg}`);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new AudioUploadError(
      `Upload failed (${response.status}): ${body || response.statusText}`,
      response.status,
    );
  }

  // Drain to allow connection reuse (keepalive).
  await response.arrayBuffer().catch(() => undefined);
}
