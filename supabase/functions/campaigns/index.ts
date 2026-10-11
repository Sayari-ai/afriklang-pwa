// POST /functions/v1/campaigns   { action, ...fields }
//
// The app's single door to the dashboard's campaign bridge (see _shared/campaigns.ts and
// afriklang-landing-page/docs/CAMPAIGN_BRIDGE_CONTRACT.md). Deploy with JWT verification ON
// (the default): the caller must be a signed-in user, not just hold the anon key.
//
// Secrets (supabase secrets set ...):
//   BRIDGE_SECRET   same value as PWA_BRIDGE_SECRET in the dashboard
//   DASHBOARD_URL   https origin of the dashboard, e.g. https://afriklang.com (no path)
//
// Nothing from a request body is ever logged: it carries invitation tokens.

import { corsHeaders, errorResponse, jsonResponse, serviceClient } from "../_shared/util.ts";
import { bearerToken, buildForward, dashboardBase, identityFrom, MAX_BODY_BYTES } from "../_shared/campaigns.ts";

const TIMEOUT_MS = 20_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method_not_allowed", "POST required", 405);

  const secret = (Deno.env.get("BRIDGE_SECRET") ?? "").trim();
  const base = dashboardBase(Deno.env.get("DASHBOARD_URL"));
  if (secret.length < 16 || !base) return errorResponse("server_misconfigured", "The campaign bridge is not configured.", 500);

  // Who is calling: the verified session, not the body.
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return errorResponse("unauthorized", "Sign in first.", 401);
  let who;
  try {
    const { data, error } = await serviceClient().auth.getUser(token);
    if (error || !data.user) return errorResponse("unauthorized", "Sign in first.", 401);
    who = identityFrom(data.user);
  } catch {
    return errorResponse("auth_unavailable", "Could not check your session; try again.", 502);
  }
  if (!who) return errorResponse("unauthorized", "Sign in first.", 401);

  // Body: size-capped while reading (a chunked body has no Content-Length to trust).
  const raw = await readCapped(req, MAX_BODY_BYTES);
  if (raw === null) return errorResponse("too_large", "Request too large.", 413);
  let parsed: Record<string, unknown> = {};
  try {
    const j = raw ? JSON.parse(raw) : {};
    if (j && typeof j === "object" && !Array.isArray(j)) parsed = j as Record<string, unknown>;
  } catch {
    return errorResponse("invalid_json", "The request body is not valid JSON.", 400);
  }

  const built = buildForward(parsed.action, parsed, who);
  if (!built.ok) return errorResponse(built.error, "The request is not valid.", 400);

  const url = `${base}/api/pwa/campaigns${built.path ? `/${built.path}` : ""}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON: handled below
    }
    if (json === null || typeof json !== "object") return errorResponse("bridge_error", "The campaign service answered unexpectedly.", 502);
    const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
    const retry = res.headers.get("retry-after");
    if (retry) headers["Retry-After"] = retry;
    return new Response(JSON.stringify(json), { status: res.status, headers });
  } catch {
    return jsonResponse({ error: "The campaign service is not reachable right now.", code: "bridge_unreachable" }, 502);
  }
});

/** The request body as text, or null when it exceeds `max` bytes. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
