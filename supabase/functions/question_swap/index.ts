// POST /functions/v1/question_swap
// Body: { device_id: uuid, cycle: int, level_id: int, q_index: int }
//
// Swaps the question at slot (cycle, level_id, q_index) for a fresh
// random question drawn from path_questions at the same level_id, never
// before served to this device (across all cycles + prior swaps).
// Persists the swap in device_question_swaps so paths_get returns the
// replacement on subsequent loads.
//
// Returns the replacement question in LevelQuestionData shape:
//   {
//     q_index:    <ORIGINAL q_index, preserved for audio filename slug>,
//     prompt_en:  <replacement's English prompt>,
//     image_url:  <replacement's image URL>,
//     language:   "wo"
//   }
//
// Errors:
//   400 bad_device_id      — device_id not a UUID
//   400 bad_payload        — cycle/level_id/q_index out of range or missing
//   404 cycle_not_assigned — device has no path for this cycle
//   409 swap_pool_exhausted — every question at this level_id has already
//                              been served; client should fall back to
//                              plain skip.
//   500 rpc_failed         — anything else.

import {
  corsHeaders,
  errorResponse,
  isUuid,
  jsonResponse,
  serviceClient,
} from "../_shared/util.ts";

function isInt(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= min &&
    v <= max
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405);
  }

  let payload: {
    device_id?: unknown;
    cycle?: unknown;
    level_id?: unknown;
    q_index?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return errorResponse("bad_json", "Body must be JSON", 400);
  }

  if (!isUuid(payload.device_id)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }
  if (!isInt(payload.cycle, 1, 10_000)) {
    return errorResponse("bad_payload", "cycle must be a positive integer", 400);
  }
  if (!isInt(payload.level_id, 1, 8)) {
    return errorResponse("bad_payload", "level_id must be 1..8", 400);
  }
  if (!isInt(payload.q_index, 1, 7)) {
    return errorResponse("bad_payload", "q_index must be 1..7", 400);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("swap_question", {
    p_device_id: payload.device_id,
    p_cycle: payload.cycle,
    p_level_id: payload.level_id,
    p_q_index: payload.q_index,
  });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("swap_pool_exhausted")) {
      return errorResponse(
        "swap_pool_exhausted",
        "no unseen questions remain at this level",
        409,
      );
    }
    if (msg.includes("cycle_not_assigned")) {
      return errorResponse(
        "cycle_not_assigned",
        "device has no path for this cycle",
        404,
      );
    }
    if (msg.includes("bad_q_index") || msg.includes("bad_level_id")) {
      return errorResponse("bad_payload", error.message, 400);
    }
    console.error("swap_question rpc failed", error);
    return errorResponse("rpc_failed", error.message, 500);
  }

  // Postgres `RETURNS TABLE` over rpc() comes back as an array. The
  // table columns are named `out_*` to avoid colliding with column
  // references inside the function body — see migration 00006 for
  // the full backstory.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return errorResponse("rpc_failed", "swap_question returned no row", 500);
  }

  return jsonResponse({
    // The slot the client should overwrite. We echo the ORIGINAL q_index
    // back so the audio filename slug (pNN-Lx-qy) keeps using the slot's
    // original index, never the replacement's.
    q_index: payload.q_index,
    prompt_en: row.out_prompt_en,
    image_url: row.out_image_url,
    language: "wo",
  });
});
