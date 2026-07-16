"use client";

/**
 * Nickname endpoint.
 *
 * Backend contract (stub function not yet deployed):
 *   POST `nickname_set`
 *     body: { device_id: string, nickname: string }
 *     200:  { nickname: string }   ← server may normalise (e.g. trim)
 *     4xx/5xx: { message?: string, error?: string } via `EdgeFunctionError`
 *
 * Until the Edge Function exists, calls will fail with
 * `EdgeFunctionError` (status 0 if the network/CORS bounces it,
 * status 404 once Supabase reports the function is missing). The
 * caller's job is to swallow that and show a snackbar the local
 * `useNickname` store has already persisted the value optimistically,
 * so the UI keeps the chosen name visible. A future retry path can
 * re-fire this against the deployed function without changes here.
 *
 * Why no offline queue?
 *   - The leaderboard's `nickname` field is read-only client-side.
 *     A failed write only affects what *other* devices see for this
 *     row; the local UI shows the chosen name regardless.
 *   - Adding a queue would require backend idempotency we don't
 *     have yet. We'll add it (or a simple "Retry" affordance from
 *     profile) once the function is in place.
 */

import { invokeEdge } from "./edge";

interface NicknameSetResponse {
  nickname: string;
}

export async function setNickname(args: {
  deviceId: string;
  nickname: string;
}): Promise<string> {
  const data = await invokeEdge<NicknameSetResponse>("nickname_set", {
    method: "POST",
    body: {
      device_id: args.deviceId,
      nickname: args.nickname,
    },
  });
  // Defensive: if the server omits the field, fall back to the
  // value we sent. Keeps the optimistic local copy correct.
  if (data && typeof data.nickname === "string" && data.nickname.length > 0) {
    return data.nickname;
  }
  return args.nickname;
}
