"use client";

/**
 * Progress endpoints.
 *
 * Mirrors `lib/core/api/progress_api.dart`:
 *   - `getProgress` GET  `progress_get?multicycle=1`, query `?device_id=`
 *   - `setProgress` POST `progress_set`, body `{ device_id, cycle, level_id, status }`
 *
 * `getProgress` always opts into `?multicycle=1` so we get a flat row
 * list tagged with `cycle`. The PWA needs cross-cycle visibility (home
 * map, leaderboard totals); the legacy single-cycle shape would lose
 * historical entries once the user advances past cycle 1.
 *
 * `setProgress` always sends `cycle` explicitly. The server tolerates a
 * missing `cycle` (defaults to top cycle) for the deployed Flutter app
 * but the PWA NEVER relies on that `completeLevel` always knows which
 * cycle it's mutating.
 *
 * `setProgress` returns the single ProgressEntry that was written, NOT
 * the full vector. The repository layer is responsible for splicing it
 * back into the cached vector and re-deriving `total_points`.
 */

import { invokeEdge } from "./edge";
import {
  type LevelProgressStatus,
  type ProgressEntry,
  type ProgressVector,
  parseProgressEntry,
  parseProgressVector,
} from "../content/models";

export async function getProgress(deviceId: string): Promise<ProgressVector> {
  const data = await invokeEdge<unknown>("progress_get", {
    method: "GET",
    query: { device_id: deviceId, multicycle: "1" },
  });
  return parseProgressVector(data);
}

export async function setProgress(args: {
  deviceId: string;
  cycle: number;
  levelId: number;
  status: LevelProgressStatus;
}): Promise<ProgressEntry> {
  const data = await invokeEdge<unknown>("progress_set", {
    method: "POST",
    body: {
      device_id: args.deviceId,
      cycle: args.cycle,
      level_id: args.levelId,
      status: args.status,
    },
  });
  return parseProgressEntry(data);
}
