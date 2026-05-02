"use client";

/**
 * Progress endpoints.
 *
 * Mirrors `lib/core/api/progress_api.dart`:
 *   - `getProgress`  — GET  `progress_get`,  query `?device_id=`
 *   - `setProgress`  — POST `progress_set`,  body `{ device_id, level_id, status }`
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
    query: { device_id: deviceId },
  });
  return parseProgressVector(data);
}

export async function setProgress(args: {
  deviceId: string;
  levelId: number;
  status: LevelProgressStatus;
}): Promise<ProgressEntry> {
  const data = await invokeEdge<unknown>("progress_set", {
    method: "POST",
    body: {
      device_id: args.deviceId,
      level_id: args.levelId,
      status: args.status,
    },
  });
  return parseProgressEntry(data);
}
