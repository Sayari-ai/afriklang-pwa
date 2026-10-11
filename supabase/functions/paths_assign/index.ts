// POST /functions/v1/paths_assign
// Body: { device_id: uuid, advance?: boolean }
//
// `advance: false` (or omitted) idempotent: returns the device's TOP
// per-device cycle assignment. If the device has no assignment yet,
// issues cycle 1 from the global rotation. This is the legacy contract
// and is what the deployed Flutter mobile app expects.
//
// `advance: true` re-issue. Asserts the device's current top cycle
// has all 8 levels completed; returns the newly issued cycle's
// assignment row. Used by the PWA when the user finishes a cycle and
// taps "Start next path".
//
// Atomicity is enforced inside the SQL functions assign_path() and
// advance_path() via SELECT … FOR UPDATE on paths_rotation.

import {
  corsHeaders,
  errorResponse,
  isUuid,
  jsonResponse,
  serviceClient,
} from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405);
  }

  let payload: { device_id?: unknown; advance?: unknown };
  try {
    payload = await req.json();
  } catch {
    return errorResponse("bad_json", "Body must be JSON", 400);
  }

  if (!isUuid(payload.device_id)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }
  // `advance` is strictly optional and must be a boolean if present.
  const advance = payload.advance === true;
  if (
    payload.advance !== undefined &&
    payload.advance !== true &&
    payload.advance !== false
  ) {
    return errorResponse(
      "bad_advance",
      "advance must be a boolean if present",
      400,
    );
  }

  const supabase = serviceClient();
  const rpcName = advance ? "advance_path" : "assign_path";
  const { data, error } = await supabase.rpc(rpcName, {
    p_device_id: payload.device_id,
  });

  if (error) {
    // advance_path() raises sentinels we want to surface as 4xx.
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("not_assigned")) {
      return errorResponse(
        "not_assigned",
        "Device has no path assignment; call paths_assign first",
        404,
      );
    }
    if (msg.includes("cycle_incomplete")) {
      return errorResponse(
        "cycle_incomplete",
        "Current cycle has unfinished levels; cannot advance",
        409,
      );
    }
    console.error(`${rpcName} rpc failed`, error);
    return errorResponse("rpc_failed", error.message, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return errorResponse("rpc_empty", `${rpcName} returned no row`, 500);
  }

  return jsonResponse({
    device_id: payload.device_id,
    path_id: row.path_id,
    cycle: row.cycle,
    assigned_at: row.assigned_at,
  });
});
