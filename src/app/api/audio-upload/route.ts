import { NextRequest, NextResponse } from "next/server";

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

export async function POST(request: NextRequest) {
  const upstreamUrl = `${BASE_URL}/api/audio/upload`;

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
        ...(request.headers.get("content-length")
          ? { "content-length": request.headers.get("content-length")! }
          : {}),
      },
      body: request.body,
      // Required when streaming a request body via fetch.
      // Type-cast: `RequestInit.duplex` isn't in the lib.dom yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      duplex: "half" as any,
      signal: request.signal,
    } as RequestInit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Upstream unreachable from the server (DNS, refused, etc.) surface as
    // 502 so the client treats it as a real failure rather than an offline
    // state. The client's `isNetwork` flag keys off `status === 0`, not 502.
    return NextResponse.json(
      { error: "upstream_fetch_failed", message: msg },
      { status: 502 },
    );
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
