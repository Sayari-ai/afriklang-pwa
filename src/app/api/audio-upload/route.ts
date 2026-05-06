import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for the Sayari audio-upload endpoint.
 *
 * Why this exists
 * ---------------
 * Sayari's CORS allowlist only includes `http://localhost:3000`. When
 * the deployed PWA (any other origin) POSTs the multipart form
 * directly, the browser strips the response and the `fetch` call
 * rejects with `TypeError: Failed to fetch` — even though the WAV
 * was successfully written server-side. Our client maps that to
 * `AudioUploadError(isNetwork=true)` and shows the offline snackbar,
 * which is wrong: the upload actually worked.
 *
 * Server-to-server calls have no CORS. By proxying the multipart
 * stream through this Next.js Route Handler, the browser only ever
 * talks to its own origin, the response is fully visible, and we get
 * accurate success/failure signals back to the recorder UI.
 *
 * Streaming + memory
 * ------------------
 * The recorder produces ~1–2 MB WAVs (16 kHz mono PCM16, ~30 s).
 * We forward the request body as-is (`request.body` is a
 * `ReadableStream`). `duplex: "half"` is required by the fetch spec
 * when sending a stream. We do NOT parse multipart on this side —
 * boundary stays intact, so Sayari sees the exact bytes the browser
 * built. Status code, body, and error responses are tunnelled back
 * verbatim so the existing client error-handling still applies.
 *
 * We rely on the platform's request timeout (Vercel: 10 s on hobby,
 * up to 300 s on Pro). The client has its own 45 s `AbortController`
 * which will fire first on slow Railway cold starts; that aborts
 * the proxy fetch via the linked signal below.
 */

const DEFAULT_BASE_URL =
  "https://sayari-labeling-aitool-backend-f910.up.railway.app";

const BASE_URL = (
  process.env.SAYARI_BASE_URL ??
  process.env.NEXT_PUBLIC_SAYARI_BASE_URL ??
  DEFAULT_BASE_URL
).replace(/\/+$/, "");

// Force the Node runtime — the Edge runtime's fetch doesn't support
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

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      // Forward only the headers Sayari needs. Specifically we MUST
      // forward the original `content-type` because it carries the
      // multipart boundary; without it the upstream parser fails.
      // We deliberately do NOT forward `host`, `cookie`, or auth
      // headers — Sayari is a public endpoint and the request from
      // the browser carries our origin's cookies which are
      // irrelevant (and a leak risk) upstream.
      headers: {
        "content-type": contentType,
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
    // Upstream unreachable from the server (DNS, refused, etc.) —
    // surface as 502 so the client treats it as a real failure
    // rather than an offline state. The client's `isNetwork` flag
    // keys off `status === 0`, not 502, so this won't show the
    // misleading "you're offline" snackbar.
    return NextResponse.json(
      { error: "upstream_fetch_failed", message: msg },
      { status: 502 },
    );
  }

  // Tunnel the upstream response back. We pass `upstream.body`
  // straight through so the response streams without buffering.
  // Strip hop-by-hop and CORS-related headers — Next will set
  // appropriate same-origin defaults.
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
