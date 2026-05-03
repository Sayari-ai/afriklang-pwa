"use client";

/**
 * Path content endpoints.
 *
 * Mirrors `lib/core/api/paths_api.dart`:
 *   - `assignPath`  — POST `paths_assign`,   body `{ device_id }`
 *   - `getPath`     — GET  `paths_get`,      query `?device_id=`
 *
 * Server-side `paths_assign`:
 *   - On a *first* call for a device, returns a freshly-assigned
 *     `(path_id, cycle = 1)` and is rate-limited to one call per
 *     device per 24h.
 *   - On subsequent calls, returns the cached assignment fast-path
 *     UNLESS the previous cycle is fully completed (every level marked
 *     `"completed"` server-side), in which case the server re-issues a
 *     new `(path_id, cycle = N+1)`. This is how `advanceCycle` in the
 *     repo gets a new path bundle.
 *
 * `paths_get` is tolerant: it may return either the legacy single
 * cycle (`{ path_id, cycle, levels[] }`) or the multi-cycle envelope
 * (`{ cycles: [...] }`). We always parse to `PathDefinition[]` —
 * single-cycle responses come back as a one-element array — so
 * downstream code only ever has to handle one shape.
 */

import { invokeEdge } from "./edge";
import {
  type PathAssignment,
  type PathDefinition,
  parsePathAssignment,
  parsePathBundle,
} from "../content/models";

export async function assignPath(deviceId: string): Promise<PathAssignment> {
  const data = await invokeEdge<unknown>("paths_assign", {
    method: "POST",
    body: { device_id: deviceId },
  });
  return parsePathAssignment(data);
}

export async function getPath(deviceId: string): Promise<PathDefinition[]> {
  const data = await invokeEdge<unknown>("paths_get", {
    method: "GET",
    query: { device_id: deviceId },
  });
  return parsePathBundle(data);
}
