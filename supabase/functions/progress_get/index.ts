// GET /functions/v1/progress_get?device_id=<uuid>[&multicycle=1]
//
// Without `multicycle=1` (legacy, mobile-app-friendly):
//   Returns the 8-row progress vector for the device's TOP cycle only.
//     { device_id, levels: [{level_id,status,completed_at,points} x8],
//       total_points: <SUM ACROSS ALL CYCLES> }
//   Note: total_points still pools across cycles even in legacy mode,
//   because the mobile app's "your points" pill expects the lifetime
//   total. Only the per-level vector is single-cycle.
//
// With `multicycle=1`:
//   Returns every progress row across every cycle, each tagged with
//   `cycle`. The PWA uses this to render the stacked map.
//     { device_id,
//       top_cycle: number,
//       levels: [{cycle,level_id,status,completed_at,points}, ...],
//       total_points: number }

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
  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET required", 405);
  }

  const url = new URL(req.url);
  const deviceId = url.searchParams.get("device_id");
  if (!isUuid(deviceId)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }
  const multicycle = url.searchParams.get("multicycle") === "1";

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("device_progress")
    .select("cycle, level_id, status, completed_at, points")
    .eq("device_id", deviceId)
    .order("cycle", { ascending: true })
    .order("level_id", { ascending: true });

  if (error) {
    console.error("device_progress select failed", error);
    return errorResponse("query_failed", error.message, 500);
  }
  if (!data || data.length === 0) {
    return errorResponse(
      "not_assigned",
      "Device has no progress rows; call paths_assign first",
      404,
    );
  }

  const totalPoints = data.reduce(
    (sum: number, r: { points?: number }) => sum + (r.points ?? 0),
    0,
  );
  const topCycle = data.reduce(
    (max: number, r: { cycle: number }) => (r.cycle > max ? r.cycle : max),
    1,
  );

  if (!multicycle) {
    // Legacy: only the top cycle's 8 rows, and strip the `cycle` field
    // so the response is byte-shape-identical to the pre-migration one.
    const topRows = data
      .filter((r: { cycle: number }) => r.cycle === topCycle)
      .map((r: { cycle: number; level_id: number; status: string; completed_at: string | null; points: number }) => ({
        level_id: r.level_id,
        status: r.status,
        completed_at: r.completed_at,
        points: r.points,
      }));
    return jsonResponse({
      device_id: deviceId,
      levels: topRows,
      total_points: totalPoints,
    });
  }

  return jsonResponse({
    device_id: deviceId,
    top_cycle: topCycle,
    levels: data,
    total_points: totalPoints,
  });
});
