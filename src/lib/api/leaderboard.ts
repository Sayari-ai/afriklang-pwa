"use client";

/**
 * Leaderboard endpoint.
 *
 * Mirrors `lib/core/api/leaderboard_api.dart`. Single GET that returns
 * `{ top: LeaderboardEntry[], me: LeaderboardMe | null }`.
 */

import { invokeEdge } from "./edge";
import {
  type LeaderboardSnapshot,
  parseLeaderboardSnapshot,
} from "../content/leaderboard-models";

export async function getLeaderboard(
  deviceId: string,
): Promise<LeaderboardSnapshot> {
  const data = await invokeEdge<unknown>("leaderboard_get", {
    method: "GET",
    query: { device_id: deviceId },
  });
  return parseLeaderboardSnapshot(data);
}
