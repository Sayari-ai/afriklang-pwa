// Shared helpers for Afriklang Edge Functions.
//
// All four functions:
//   * accept anon-key invocations from the Flutter app (verified by Supabase
//     gateway via the JWT/anon header — no extra check needed here);
//   * use the SERVICE_ROLE_KEY internally so they can bypass RLS;
//   * return JSON with consistent CORS headers.

import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse({ error: code, message }, status);
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function pointsRewardForLevel(levelId: number): number {
  // 100, 120, 140, 160, 180, 200, 220, 240
  return 80 + 20 * levelId;
}

// Deterministic anonymous nicknames for the leaderboard. Derives from the
// raw UUID hex (no extra DB column needed). 50 adjectives × 50 animals =
// 2,500 base names; appending the last 4 hex chars makes collisions
// effectively impossible while keeping the nickname stable across calls.
const ADJECTIVES = [
  "Brave", "Quiet", "Swift", "Wise", "Bold", "Calm", "Eager", "Fierce",
  "Gentle", "Happy", "Jolly", "Kind", "Lively", "Merry", "Noble", "Proud",
  "Quick", "Royal", "Sly", "True", "Vivid", "Zesty", "Bright", "Clever",
  "Daring", "Mighty", "Nimble", "Patient", "Radiant", "Silent", "Tender",
  "Valiant", "Witty", "Loyal", "Keen", "Steady", "Cheerful", "Curious",
  "Dapper", "Earnest", "Fearless", "Graceful", "Humble", "Inventive",
  "Jovial", "Lucky", "Mellow", "Oaken", "Plucky", "Resolute",
];
const ANIMALS = [
  "Lion", "Eagle", "Falcon", "Tiger", "Wolf", "Otter", "Hawk", "Fox",
  "Bear", "Owl", "Panther", "Lynx", "Jaguar", "Crane", "Heron", "Stag",
  "Buffalo", "Cheetah", "Dolphin", "Elephant", "Gazelle", "Giraffe",
  "Gorilla", "Hyena", "Ibis", "Jackal", "Kestrel", "Koala", "Leopard",
  "Lemur", "Mongoose", "Moose", "Octopus", "Orca", "Oryx", "Panda",
  "Penguin", "Rhino", "Robin", "Salmon", "Seal", "Shark", "Sparrow",
  "Squirrel", "Swallow", "Swan", "Toucan", "Vulture", "Wren", "Zebra",
];

export function nicknameFor(deviceId: string): string {
  // Strip dashes; first 4 hex chars → adjective index, next 4 → animal,
  // last 4 → suffix. All deterministic from the UUID, no storage needed.
  const hex = deviceId.replace(/-/g, "").toLowerCase();
  if (hex.length < 12) return `Player ${hex}`;
  const adjIdx = parseInt(hex.slice(0, 4), 16) % ADJECTIVES.length;
  const aniIdx = parseInt(hex.slice(4, 8), 16) % ANIMALS.length;
  const suffix = hex.slice(-4).toUpperCase();
  return `${ADJECTIVES[adjIdx]} ${ANIMALS[aniIdx]} ${suffix}`;
}
