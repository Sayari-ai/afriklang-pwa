// POST /functions/v1/nickname_set
// Body: { device_id: uuid, nickname: string }
//
// Stores a per-device leaderboard display name. Server-side validation
// mirrors the client (trim, collapse internal whitespace, 2..20 chars).
// Returns the cleaned nickname.
//
// Idempotent upsert: sending the same nickname again is a no-op.

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

  let payload: { device_id?: unknown; nickname?: unknown };
  try {
    payload = await req.json();
  } catch {
    return errorResponse("bad_json", "Body must be JSON", 400);
  }

  if (!isUuid(payload.device_id)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }
  if (typeof payload.nickname !== "string") {
    return errorResponse("bad_nickname", "nickname must be a string", 400);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("upsert_nickname", {
    p_device_id: payload.device_id,
    p_nickname: payload.nickname,
  });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("bad_nickname_length")) {
      return errorResponse(
        "bad_nickname_length",
        "nickname must be 2..20 characters after trimming",
        400,
      );
    }
    console.error("upsert_nickname rpc failed", error);
    return errorResponse("rpc_failed", error.message, 500);
  }

  return jsonResponse({
    device_id: payload.device_id,
    nickname: data,
  });
});
