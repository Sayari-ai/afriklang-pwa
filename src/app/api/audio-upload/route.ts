import { NextRequest, NextResponse } from "next/server";
import { checkLength, clientIp, RateLimiter, readBearer, verifySession } from "@/lib/server/upload-guard";

/**
 * Server-side proxy for the Sayari audio-upload endpoint.
 *
 * Why this exists
 * ---------------
 * Sayari's CORS allowlist does not include the deployed PWA origin. When
 * the browser POSTs the multipart form directly, it strips the response and
 * the `fetch` call rejects with `TypeError: Failed to fetch` even though
 * the WAV was successfully written server-side. Proxying through this
 * Route Handler means the browser only ever talks to its own origin, the
 * response is fully visible, and we get accurate success/failure signals.
 *
 * Auth (added 2026)
 * -----------------
 * Sayari's `/api/audio/upload` is no longer public: it requires an
 * `X-Upload-Key` header (or a Firebase Bearer token). This proxy injects the
 * key from the server-side `SAYARI_UPLOAD_KEY` env var it is NEVER exposed
 * to the browser (do not use a NEXT_PUBLIC_ variable for it). The `SAYARI_`
 * prefix also matters: amplify.yml only copies NEXT_PUBLIC_* and SAYARI_*
 * vars into .env.production for the SSR compute.
 *
 * Who may upload (added 2026-10-13)
 * ---------------------------------
 * Because this route adds the upload key, it is the door to Sayari. It forwards only for a
 * signed-in contributor: `Authorization: Bearer <Supabase access token>`, checked against
 * Supabase Auth (src/lib/server/upload-guard.ts). It also refuses bodies over 25 MB (or with
 * no declared length) and rate-limits per person, plus a ceiling on failed sign-in checks so
 * forged tokens cannot be used to flood Supabase Auth. Limits live in this instance's memory.
 *
 * Streaming + memory
 * ------------------
 * The recorder produces ~1–2 MB WAVs (16 kHz mono PCM16, ~30 s). We forward
 * the request body as-is (`request.body` is a `ReadableStream`).
 * `duplex: "half"` is required by the fetch spec when sending a stream. We do
 * NOT parse multipart here the boundary stays intact, so Sayari sees the
 * exact bytes the browser built. Status code, body and error responses are
 * tunnelled back verbatim so the existing client error-handling still applies.
 */

// Sayari backend migrated off Railway to AWS EC2 (api.sayari.afriklang.com).
const DEFAULT_BASE_URL = "https://api.sayari.afriklang.com";

const BASE_URL = (
  process.env.SAYARI_BASE_URL ??
  process.env.NEXT_PUBLIC_SAYARI_BASE_URL ??
  DEFAULT_BASE_URL
).replace(/\/+$/, "");

// Shared upload key for the independent mobile collector. Server-side only.
// Set this in Amplify → App settings → Environment variables (SAYARI_UPLOAD_KEY).
//
// `.trim()` guards against copy-paste whitespace/newlines in the env
// value undici rejects invalid header bytes with a TypeError whose
// message can embed the header value, which the 502 path would echo.
const UPLOAD_KEY = process.env.SAYARI_UPLOAD_KEY?.trim() ?? "";

if (!UPLOAD_KEY) {
  // Also flag the misconfiguration at module load (server boot logs),
  // not just per-request uploads cannot succeed without the key.
  console.warn(
    "[audio-upload] SAYARI_UPLOAD_KEY is not set; uploads will be rejected.",
  );
}

// Force the Node runtime the Edge runtime's fetch doesn't support
// streaming request bodies the same way and has tighter limits.
export const runtime = "nodejs";
// Don't try to cache this; it's a one-shot mutation.
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

// Per signed-in person: a speaker sending a backlog after being offline stays well under this.
const perUser = new RateLimiter(120, 10 * 60_000);
// The header carrying the client address that the platform sets (see clientIp). Empty: use the last
// X-Forwarded-For hop only.
const CLIENT_IP_HEADER = (process.env.SAYARI_UPLOAD_CLIENT_IP_HEADER ?? "cloudfront-viewer-address").trim().toLowerCase();
// Failed sign-in checks per client address.
const badTokenPerIp = new RateLimiter(20, 10 * 60_000);
// Supabase Auth lookups this instance may make (cache misses only): forged tokens that pass the
// local precheck cannot turn into a flood of Auth calls, whatever address they claim.
const authLookups = new RateLimiter(600, 60_000);

const refuse = (status: number, error: string, extra: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store", ...extra } });

export async function POST(request: NextRequest) {
  const upstreamUrl = `${BASE_URL}/api/audio/upload`;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json(
      { error: "server_misconfigured", message: "Supabase is not configured" },
      { status: 500 },
    );
  }

  // 1. Size, before anything else: no declared length (a chunked body could be endless), or too big.
  const length = checkLength(request.headers.get("content-length"));
  if (!length.ok) return refuse(length.status, length.status === 413 ? "too_large" : "length_required");

  // 2. A signed-in contributor. The token is checked first, so a valid one always passes, even from an
  //    address shared with someone sending junk (mobile carriers put many speakers behind one, APP-014).
  //    Only failures count against the address; Auth lookups have a ceiling in total.
  const token = readBearer(request.headers.get("authorization"));
  let userId: string | null = null;
  if (token) {
    try {
      const who = await verifySession(token, { supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }, { beforeLookup: () => authLookups.take("all").ok });
      userId = who?.userId ?? null;
    } catch {
      // Auth unreachable or this instance at its lookup ceiling: not the speaker's fault, retry.
      return refuse(503, "auth_unavailable", { "retry-after": "30" });
    }
  }
  if (!userId) {
    const ip = clientIp(request.headers, CLIENT_IP_HEADER);
    const bad = badTokenPerIp.take(ip);
    if (!bad.ok) return refuse(429, "rate_limited", { "retry-after": String(bad.retryAfterS) });
    return refuse(401, "unauthorized");
  }

  // 3. Per person.
  const hit = perUser.take(userId);
  if (!hit.ok) return refuse(429, "rate_limited", { "retry-after": String(hit.retryAfterS) });

  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  if (!UPLOAD_KEY) {
    // Fail fast with a clear server error rather than letting the upstream
    // reject with a confusing 401. Signals a misconfigured deployment.
    return NextResponse.json(
      { error: "server_misconfigured", message: "SAYARI_UPLOAD_KEY is not set" },
      { status: 500 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      // Forward only what Sayari needs. We MUST forward the original
      // `content-type` because it carries the multipart boundary, and the
      // `X-Upload-Key` so the hardened endpoint accepts the request. We
      // deliberately do NOT forward `host`, `cookie` or browser auth headers.
      // The `X-Upload-Key` is injected server-side from env, never taken
      // from the incoming request.
      headers: {
        "content-type": contentType,
        "X-Upload-Key": UPLOAD_KEY,
        "content-length": String(length.bytes),
      },
      body: request.body,
      // Required when streaming a request body via fetch.
      // Type-cast: `RequestInit.duplex` isn't in the lib.dom yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      duplex: "half" as any,
      signal: request.signal,
    } as RequestInit);
  } catch (e) {
    // Upstream unreachable from the server (DNS, refused, etc.) surface as
    // 502 so the client treats it as a real failure rather than an offline
    // state. The client's `isNetwork` flag keys off `status === 0`, not 502.
    // The cause is logged here, never sent to the browser.
    console.error("[audio-upload] upstream fetch failed:", e instanceof Error ? e.name : "unknown");
    return refuse(502, "upstream_fetch_failed");
  }

  // Sayari refusing the upload key is our misconfiguration. Answering 401 would tell the app the
  // speaker's session expired (and make it ask them to sign in again), so say what it is.
  if (upstream.status === 401 || upstream.status === 403) {
    await upstream.body?.cancel().catch(() => undefined);
    console.error("[audio-upload] Sayari refused the upload key:", upstream.status);
    return refuse(500, "server_misconfigured");
  }

  // Sayari's own server errors stay on the server: their text can describe internals.
  if (upstream.status >= 500) {
    await upstream.body?.cancel().catch(() => undefined);
    return refuse(upstream.status === 503 ? 503 : 502, "upstream_error", upstream.headers.get("retry-after") ? { "retry-after": upstream.headers.get("retry-after")! } : {});
  }

  // Tunnel the upstream response back. Pass `upstream.body` straight through so
  // the response streams without buffering. Strip hop-by-hop and CORS-related
  // headers Next will set appropriate same-origin defaults.
  const headers = new Headers();
  const passthrough = ["content-type", "content-length", "cache-control"];
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
