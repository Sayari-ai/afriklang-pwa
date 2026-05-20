// GET /functions/v1/leaderboard_get?device_id=<uuid>
//
// Returns the top 50 devices by total points + the caller's own rank,
// even if they're outside the top 50.
//
// Display name resolution per row:
//   1. If `device_nicknames` has a row for that device_id, use the
//      stored (user-chosen) nickname.
//   2. Otherwise fall back to the deterministic nicknameFor(device_id).
//
// Response shape:
//   {
//     top: [{ rank, nickname, points, is_me }, ...up to 50],
//     me:  { rank, nickname, points, total_devices } | null,
//   }

import {
  corsHeaders,
  errorResponse,
  isUuid,
  jsonResponse,
  nicknameFor,
  serviceClient,
} from "../_shared/util.ts";

const TOP_N = 50;

interface LeaderboardRow {
  device_id: string;
  points: number;
  rank: number;
}

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

  const supabase = serviceClient();

  // Top N rows.
  const { data: topData, error: topErr } = await supabase
    .from("leaderboard_top")
    .select("device_id, points, rank")
    .order("rank", { ascending: true })
    .limit(TOP_N);

  if (topErr) {
    console.error("leaderboard_top top-N query failed", topErr);
    return errorResponse("query_failed", topErr.message, 500);
  }

  const topRows = (topData ?? []) as LeaderboardRow[];

  // Caller's own row (may or may not be inside the top N).
  const { data: meData, error: meErr } = await supabase
    .from("leaderboard_top")
    .select("device_id, points, rank")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (meErr) {
    console.error("leaderboard_top me query failed", meErr);
    return errorResponse("query_failed", meErr.message, 500);
  }

  // Total device count for the "you are #N of M" affordance.
  const { count: totalDevices, error: countErr } = await supabase
    .from("leaderboard_top")
    .select("device_id", { count: "exact", head: true });

  if (countErr) {
    console.error("leaderboard_top count failed", countErr);
    return errorResponse("query_failed", countErr.message, 500);
  }

  // Resolve display names. Fetch user-chosen nicknames for every device
  // we need to render in one query (top-N union with caller).
  const idsToResolve = new Set<string>(topRows.map((r) => r.device_id));
  if (meData) idsToResolve.add(deviceId!);
  let nicknameMap = new Map<string, string>();
  if (idsToResolve.size > 0) {
    const { data: nickData, error: nickErr } = await supabase
      .from("device_nicknames")
      .select("device_id, nickname")
      .in("device_id", Array.from(idsToResolve));
    if (nickErr) {
      // Non-fatal: log and fall back to deterministic nicknames for all.
      console.error("device_nicknames select failed", nickErr);
    } else {
      nicknameMap = new Map(
        (nickData ?? []).map(
          (r: { device_id: string; nickname: string }) =>
            [r.device_id, r.nickname] as const,
        ),
      );
    }
  }

  const resolveName = (id: string): string =>
    nicknameMap.get(id) ?? nicknameFor(id);

  const top = topRows.map((r) => ({
    rank: r.rank,
    nickname: resolveName(r.device_id),
    points: r.points,
    is_me: r.device_id === deviceId,
  }));

  const me = meData
    ? {
      rank: (meData as LeaderboardRow).rank,
      nickname: resolveName(deviceId!),
      points: (meData as LeaderboardRow).points,
      total_devices: totalDevices ?? 0,
    }
    : null;

  return jsonResponse({ top, me });
});
