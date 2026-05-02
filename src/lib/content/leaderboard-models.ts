/**
 * Leaderboard models.
 *
 * Mirrors `lib/core/leaderboard/leaderboard_models.dart` and the JSON
 * shape returned by the `leaderboard_get` Edge Function.
 */

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  points: number;
  isMe: boolean;
}

export interface LeaderboardMe {
  rank: number;
  nickname: string;
  points: number;
  totalDevices: number;
}

export interface LeaderboardSnapshot {
  top: LeaderboardEntry[];
  me: LeaderboardMe | null;
}

function asObject(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new TypeError(`Expected object at ${field}, got ${typeof v}`);
  }
  return v as Record<string, unknown>;
}

function asArray(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new TypeError(`Expected array at ${field}, got ${typeof v}`);
  }
  return v;
}

export function parseLeaderboardEntry(raw: unknown): LeaderboardEntry {
  const o = asObject(raw, "leaderboard.entry");
  return {
    rank: Number(o.rank),
    nickname: String(o.nickname ?? ""),
    points: Number(o.points ?? 0),
    isMe: Boolean(o.is_me ?? false),
  };
}

export function parseLeaderboardMe(raw: unknown): LeaderboardMe {
  const o = asObject(raw, "leaderboard.me");
  return {
    rank: Number(o.rank),
    nickname: String(o.nickname ?? ""),
    points: Number(o.points ?? 0),
    totalDevices: Number(o.total_devices ?? 0),
  };
}

export function parseLeaderboardSnapshot(raw: unknown): LeaderboardSnapshot {
  const o = asObject(raw, "leaderboard");
  return {
    top: asArray(o.top, "leaderboard.top").map(parseLeaderboardEntry),
    me: o.me == null ? null : parseLeaderboardMe(o.me),
  };
}

/**
 * True iff the caller's row is already present in the top list — in
 * which case the UI doesn't need to render a separate "You" footer.
 */
export function meInTop(snapshot: LeaderboardSnapshot): boolean {
  if (!snapshot.me) return false;
  return snapshot.top.some(
    (e) => e.rank === snapshot.me!.rank && e.isMe === true,
  );
}
