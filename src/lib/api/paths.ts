"use client";

/**
 * Path content endpoints.
 *
 * Mirrors `lib/core/api/paths_api.dart`:
 *   - `assignPath`  — POST `paths_assign`,   body `{ device_id }`
 *   - `getPath`     — GET  `paths_get`,      query `?device_id=`
 *
 * Server-side `paths_assign` is idempotent and rate-limited to one
 * call per device per 24h on the **first** assignment; subsequent
 * calls return the cached assignment fast-path. We rely on that
 * behaviour rather than caching the assignment ourselves — the path
 * payload (which we *do* cache) is the more expensive object.
 */

import { invokeEdge } from "./edge";
import {
  type PathAssignment,
  type PathDefinition,
  parsePath,
  parsePathAssignment,
} from "../content/models";

export async function assignPath(deviceId: string): Promise<PathAssignment> {
  const data = await invokeEdge<unknown>("paths_assign", {
    method: "POST",
    body: { device_id: deviceId },
  });
  return parsePathAssignment(data);
}

export async function getPath(deviceId: string): Promise<PathDefinition> {
  const data = await invokeEdge<unknown>("paths_get", {
    method: "GET",
    query: { device_id: deviceId },
  });
  return parsePath(data);
}
