"use client";

/**
 * Leaderboard display-name endpoint.
 *
 * The name other players see on the leaderboard is stored server-side
 * per device (`device_nicknames`, written via the `nickname_set` Edge
 * Function the wire name is kept for backend compatibility). Since
 * Google sign-in became mandatory there is no user-facing nickname
 * flow anymore: `<DisplayNameSync>` pushes the Google account's
 * display name here automatically after sign-in.
 *
 * Backend contract:
 *   POST `nickname_set`
 *     body: { device_id: string, nickname: string }
 *     200:  { nickname: string }   ← server may normalise (e.g. trim)
 *     400:  `bad_nickname_length` when outside 2–20 chars which is
 *           why callers must pass names through `toLeaderboardName()`
 *     4xx/5xx: { message?: string, error?: string } via `EdgeFunctionError`
 *
 * Why no offline queue?
 *   - The leaderboard's `nickname` field is read-only client-side.
 *     A failed write only affects what *other* devices see for this
 *     row; the local UI shows the Google name regardless.
 *   - `<DisplayNameSync>` retries on the next boot (it only records
 *     a name as synced after the server confirms), so eventual
 *     consistency is already covered without a queue.
 */

import { invokeEdge } from "./edge";

/** Server-side CHECK constraint bounds (code points, post-trim). */
export const LEADERBOARD_NAME_MIN = 2;
export const LEADERBOARD_NAME_MAX = 20;

/**
 * Normalises a Google display name into something `nickname_set`
 * accepts: collapse whitespace runs, trim, cap at 20 code points
 * (code points, not UTF-16 units an emoji or composed letter
 * shouldn't burn two slots). Returns `null` when no valid name can
 * be derived (absent name, or fewer than 2 code points) callers
 * should then leave the server-assigned fallback name in place.
 */
export function toLeaderboardName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const codePoints = [...collapsed];
  if (codePoints.length < LEADERBOARD_NAME_MIN) return null;
  // Truncation can leave a trailing space ("John Bartholomew Sm ité"
  // cut mid-name); re-trim, then re-check the floor.
  const cut = codePoints.slice(0, LEADERBOARD_NAME_MAX).join("").trim();
  return [...cut].length >= LEADERBOARD_NAME_MIN ? cut : null;
}

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
  // value we sent. Keeps the caller's bookkeeping correct.
  if (data && typeof data.nickname === "string" && data.nickname.length > 0) {
    return data.nickname;
  }
  return args.nickname;
}
