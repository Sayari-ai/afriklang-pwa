// POST /functions/v1/progress_set
// Body: {
//   device_id: uuid,
//   level_id:  1..8,
//   status:    'locked'|'current'|'completed',
//   cycle?:    int >= 1   // optional; defaults to the device's top cycle
// }
//
// Sets a single level's status. On 'completed' also stamps completed_at
// and (idempotently) awards points via award_points().
//
// `cycle` is optional for backwards compatibility with the deployed
// Flutter mobile app, which does not know about cycles. When omitted,
// the server resolves it to the device's MAX cycle in device_paths.

import {
  corsHeaders,
  errorResponse,
  isUuid,
  jsonResponse,
  serviceClient,
} from "../_shared/util.ts";

const VALID_STATUSES = new Set(["locked", "current", "completed"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405);
  }

  let payload: {
    device_id?: unknown;
    level_id?: unknown;
    status?: unknown;
    cycle?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return errorResponse("bad_json", "Body must be JSON", 400);
  }

  if (!isUuid(payload.device_id)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }
  const levelId = Number(payload.level_id);
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 8) {
    return errorResponse("bad_level_id", "level_id must be 1..8", 400);
  }
  if (typeof payload.status !== "string" || !VALID_STATUSES.has(payload.status)) {
    return errorResponse("bad_status", "status must be locked|current|completed", 400);
  }

  // Optional cycle.
  let cycle: number | undefined;
  if (payload.cycle !== undefined) {
    const n = Number(payload.cycle);
    if (!Number.isInteger(n) || n < 1) {
      return errorResponse("bad_cycle", "cycle must be an integer >= 1", 400);
    }
    cycle = n;
  }

  const supabase = serviceClient();

  // Resolve the cycle if omitted: device's TOP cycle.
  if (cycle === undefined) {
    const { data: dpRows, error: dpErr } = await supabase
      .from("device_paths")
      .select("cycle")
      .eq("device_id", payload.device_id)
      .order("cycle", { ascending: false })
      .limit(1);
    if (dpErr) {
      console.error("device_paths select failed", dpErr);
      return errorResponse("query_failed", dpErr.message, 500);
    }
    if (!dpRows || dpRows.length === 0) {
      return errorResponse(
        "not_assigned",
        "Device has no path assignment; call paths_assign first",
        404,
      );
    }
    cycle = dpRows[0].cycle as number;
  }

  const update: Record<string, unknown> = { status: payload.status };
  if (payload.status === "completed") {
    update.completed_at = new Date().toISOString();
  } else {
    update.completed_at = null;
  }

  const { data, error } = await supabase
    .from("device_progress")
    .update(update)
    .eq("device_id", payload.device_id)
    .eq("cycle", cycle)
    .eq("level_id", levelId)
    .select("device_id, cycle, level_id, status, completed_at, points")
    .maybeSingle();

  if (error) {
    console.error("device_progress update failed", error);
    return errorResponse("update_failed", error.message, 500);
  }
  if (!data) {
    return errorResponse(
      "not_found",
      "No progress row for this (device_id, cycle, level_id)",
      404,
    );
  }

  // Award points on first transition to completed. award_points() is
  // idempotent: replays return the existing points without re-awarding.
  if (payload.status === "completed") {
    const { data: awardedPoints, error: awardErr } = await supabase
      .rpc("award_points", {
        p_device_id: payload.device_id,
        p_level_id: levelId,
        p_cycle: cycle,
      });
    if (awardErr) {
      console.error("award_points failed", awardErr);
      return errorResponse("award_failed", awardErr.message, 500);
    }
    (data as Record<string, unknown>).points = awardedPoints;
  }

  return jsonResponse(data);
});
