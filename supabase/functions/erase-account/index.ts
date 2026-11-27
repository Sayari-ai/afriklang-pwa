// POST /functions/v1/erase-account   { "user_id": "<auth uid>" }
//
// The dashboard's full erasure of a contributor (shared contract docs/contracts/README.md §8;
// afriklang-landing-page docs/CONTRIBUTOR_ERASURE_DECISIONS.md): deletes the person's sign-in
// account here (auth.users; identities and sessions go with it). This project holds no audio,
// consent or profile of its own: uploads go to Sayari, consents and profiles to the dashboard.
//
// Called by the dashboard, not the app: deploy with JWT verification OFF
//   supabase functions deploy erase-account --no-verify-jwt --project-ref elosonbrvmsfgrxemtso
// and the caller proves itself with its own secret (not the campaign bridge's, so a leak of that
// one cannot delete accounts):
//   ERASE_SECRET   same value as PWA_ERASE_SECRET in the dashboard (at least 32 characters)
//
// Answers 200 {deleted: true}, or 200 {deleted: false, reason: "not_found"} for an account that
// is already gone (a repeat). Nothing from the request is logged except the outcome.
//
// One self-contained file (no ../_shared import), so it can be pasted as is into the Supabase
// dashboard editor (Edge Functions → Deploy a new function → Via Editor, name "erase-account",
// then turn Verify JWT OFF in its settings).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const errorResponse = (code: string, message: string, status: number) => jsonResponse({ error: code, message }, status);

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sameSecret(a: string, b: string): boolean {
  // Constant time for equal lengths; lengths are not secret.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("method_not_allowed", "POST required", 405);
  const secret = (Deno.env.get("ERASE_SECRET") ?? "").trim();
  if (secret.length < 32) return errorResponse("server_misconfigured", "Account erasure is not configured.", 500);

  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!given || !sameSecret(given, secret)) return errorResponse("unauthorized", "Wrong or missing secret.", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "The request body is not valid JSON.", 422);
  }
  const userId = body && typeof body === "object" ? (body as Record<string, unknown>).user_id : undefined;
  if (!isUuid(userId)) return errorResponse("invalid", "user_id must be the account's uuid.", 422);

  try {
    const { error } = await serviceClient().auth.admin.deleteUser(userId);
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 404 || /not.?found/i.test(error.message ?? "")) return jsonResponse({ deleted: false, reason: "not_found" });
      console.error(`erase-account: delete refused (${status ?? "no status"})`);
      return errorResponse("delete_failed", "The account could not be deleted; try again.", 502);
    }
    console.info("erase-account: an account was deleted");
    return jsonResponse({ deleted: true });
  } catch {
    return errorResponse("auth_unavailable", "Supabase Auth did not answer; try again.", 502);
  }
});
