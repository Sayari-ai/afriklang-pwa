"use client";

/**
 * Path content endpoints.
 *
 * Mirrors `lib/core/api/paths_api.dart`:
 *   - `assignPath`     — POST `paths_assign`,   body `{ device_id }`
 *   - `advanceCycleApi` — POST `paths_assign`,  body `{ device_id, advance: true }`
 *   - `getPath`        — GET  `paths_get?multicycle=1`, query `?device_id=`
 *
 * Server-side `paths_assign`:
 *   - Without `advance`: idempotent — returns the device's TOP cycle's
 *     `(path_id, cycle)`. Used on first boot (cycle 1) and on every
 *     subsequent boot to re-confirm the current top cycle.
 *   - With `advance: true`: invokes the `advance_path()` SQL RPC. Picks
 *     the next path_id off `paths_rotation` and writes a new row at
 *     `(device_id, top_cycle + 1)`. Returns the freshly-assigned pair.
 *     Server returns 409 with code `cycle_incomplete` if the current
 *     top cycle isn't fully completed yet.
 *
 * `paths_get?multicycle=1` always returns the multi-cycle envelope
 * (`{ cycles: [...], top_cycle }`). The PWA opts in unconditionally
 * because it's the only client that needs cross-cycle visibility (the
 * deployed Flutter mobile app sticks to legacy single-cycle for
 * backwards-compat). Parsed down to `PathDefinition[]` regardless.
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

/**
 * Re-issue the device's path with `cycle = top_cycle + 1`. Throws on
 * 409 (`cycle_incomplete`) if the user hasn't finished their current
 * cycle yet — `path-repo.advanceCycle` catches and surfaces a snackbar.
 */
export async function advanceCycleApi(
  deviceId: string,
): Promise<PathAssignment> {
  const data = await invokeEdge<unknown>("paths_assign", {
    method: "POST",
    body: { device_id: deviceId, advance: true },
  });
  return parsePathAssignment(data);
}

export async function getPath(deviceId: string): Promise<PathDefinition[]> {
  const data = await invokeEdge<unknown>("paths_get", {
    method: "GET",
    query: { device_id: deviceId, multicycle: "1" },
  });
  return parsePathBundle(data);
}
