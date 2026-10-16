import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const SUPA = "https://proj.supabase.co";
const SAYARI = "https://sayari.test";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenFor = (sub: string) => `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", iss: `${SUPA}/auth/v1` })}.c2ln`;

let POST: (r: NextRequest) => Promise<Response>;
let upstream: { url: string; headers: Record<string, string> }[] = [];
let sayariReply: () => Response = () => new Response(JSON.stringify({ results: [{ id: 7 }] }), { status: 200, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SAYARI_BASE_URL = SAYARI;
  process.env.SAYARI_UPLOAD_KEY = "secret-upload-key";
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
});

beforeEach(() => {
  upstream = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === `${SUPA}/auth/v1/user`) {
      const auth = new Headers(init.headers).get("authorization") ?? "";
      const sub = JSON.parse(Buffer.from(auth.split(".")[1] ?? "", "base64url").toString() || "{}").sub;
      return sub?.startsWith("user-") ? new Response(JSON.stringify({ id: sub }), { status: 200 }) : new Response("{}", { status: 401 });
    }
    upstream.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    return sayariReply();
  }));
});
afterEach(() => vi.unstubAllGlobals());

const TICKET = `${b64({ v: 1, mission_id: "m" })}.${"A".repeat(43)}`;

/** An upload as the app sends it: with a ticket, unless `ticket: null`. */
function req(opts: { token?: string; length?: string | null; ip?: string; ticket?: string | null; extra?: Record<string, string> } = {}): NextRequest {
  const body = "--b\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nwol\r\n--b--\r\n";
  const headers = new Headers({ "content-type": "multipart/form-data; boundary=b", "x-forwarded-for": opts.ip ?? "9.9.9.9" });
  if (opts.ticket !== null) headers.set("x-campaign-ticket", opts.ticket ?? TICKET);
  if (opts.length !== null) headers.set("content-length", opts.length ?? String(Buffer.byteLength(body)));
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  for (const [k, v] of Object.entries(opts.extra ?? {})) headers.set(k, v);
  return new Request("http://localhost/api/audio-upload", { method: "POST", headers, body, duplex: "half" } as RequestInit) as unknown as NextRequest;
}

describe("POST /api/audio-upload", () => {
  it("forwards a signed-in upload with the key, and never the speaker's token", async () => {
    const res = await POST(req({ token: tokenFor("user-a") }));
    expect(res.status).toBe(200);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].url).toBe(`${SAYARI}/api/audio/upload`);
    expect(upstream[0].headers["x-upload-key"]).toBe("secret-upload-key");
    expect(upstream[0].headers.authorization).toBeUndefined();
  });

  it("refuses an anonymous upload without reaching Sayari", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(0);
  });

  it("refuses a forged token", async () => {
    const res = await POST(req({ token: tokenFor("forged") }));
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(0);
  });

  it("refuses a body with no declared length, or over 25 MB", async () => {
    expect((await POST(req({ token: tokenFor("user-a"), length: null }))).status).toBe(411);
    expect((await POST(req({ token: tokenFor("user-a"), length: String(26 * 1024 * 1024) }))).status).toBe(413);
    expect(upstream).toHaveLength(0);
  });

  it("slows down an address that keeps sending bad tokens, but never a valid token from it (APP-014)", async () => {
    for (let i = 0; i < 20; i++) expect((await POST(req({ ip: "6.6.6.6" }))).status).toBe(401);
    expect((await POST(req({ ip: "6.6.6.6" }))).status).toBe(429);
    // Someone else behind the same carrier address, signed in: goes through.
    expect((await POST(req({ ip: "6.6.6.6", token: tokenFor("user-z") }))).status).toBe(200);
  });

  it("a forged X-Forwarded-For cannot get another address blocked", async () => {
    for (let i = 0; i < 25; i++) await POST(req({ ip: "7.7.7.7, 5.5.5.5" }));
    expect((await POST(req({ ip: "7.7.7.7" }))).status).toBe(401);
  });

  it("limits one person to 120 uploads per 10 minutes", async () => {
    const t = tokenFor("user-busy");
    for (let i = 0; i < 120; i++) expect((await POST(req({ token: t }))).status).toBe(200);
    const res = await POST(req({ token: t }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("forwards the upload ticket, and no other browser header (cookies, auth, made-up x- headers)", async () => {
    const res = await POST(req({ token: tokenFor("user-t"), extra: { "x-campaign-ticket": TICKET, cookie: "sb=secret", "x-upload-key": "forged", "x-sayari-anything": "1", origin: "https://evil.example" } }));
    expect(res.status).toBe(200);
    expect(upstream[0].headers["x-campaign-ticket"]).toBe(TICKET);
    expect(upstream[0].headers["x-upload-key"]).toBe("secret-upload-key");
    expect(Object.keys(upstream[0].headers).sort()).toEqual(["content-length", "content-type", "x-campaign-ticket", "x-upload-key"]);
  });

  it("refuses an upload without a ticket, without reaching Sayari (C-2)", async () => {
    const res = await POST(req({ token: tokenFor("user-t"), ticket: null }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ticket_required" });
    expect(upstream).toHaveLength(0);
    // Anyone not signed in is still told that first.
    expect((await POST(req({ ticket: null }))).status).toBe(401);
  });

  it("SAYARI_UPLOAD_REQUIRE_TICKET=false lets a bare upload through, as before tickets (an old dashboard)", async () => {
    process.env.SAYARI_UPLOAD_REQUIRE_TICKET = "false";
    try {
      expect((await POST(req({ token: tokenFor("user-t"), ticket: null }))).status).toBe(200);
      expect(Object.keys(upstream[0].headers).sort()).toEqual(["content-length", "content-type", "x-upload-key"]);
    } finally {
      delete process.env.SAYARI_UPLOAD_REQUIRE_TICKET;
    }
    // Any other value keeps it required.
    process.env.SAYARI_UPLOAD_REQUIRE_TICKET = "no";
    try {
      expect((await POST(req({ token: tokenFor("user-t"), ticket: null }))).status).toBe(409);
    } finally {
      delete process.env.SAYARI_UPLOAD_REQUIRE_TICKET;
    }
  });

  it("refuses a header that does not look like a ticket, without reaching Sayari", async () => {
    for (const bad of ["", "no-dot", "a.b c", "a.b.c.d", `a.${"b".repeat(5000)}`, "a.b+c", "a.b=="]) {
      expect((await POST(req({ token: tokenFor("user-t"), extra: { "x-campaign-ticket": bad } }))).status, bad.slice(0, 20)).toBe(400);
    }
    expect(upstream).toHaveLength(0);
  });

  it("a ticket Sayari refuses is a 409 invalid_ticket (ask for a new one), not a key problem", async () => {
    sayariReply = () => new Response(JSON.stringify({ detail: "invalid_ticket" }), { status: 401 });
    const res = await POST(req({ token: tokenFor("user-t"), extra: { "x-campaign-ticket": TICKET } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "invalid_ticket" });
    // Without that code, a 401 is still the upload key being refused.
    sayariReply = () => new Response("Invalid upload key", { status: 401 });
    expect((await POST(req({ token: tokenFor("user-t"), extra: { "x-campaign-ticket": TICKET } }))).status).toBe(500);
    // Sayari's own ticket answers go through: 409 ticket_used, 422 sha_mismatch.
    sayariReply = () => new Response(JSON.stringify({ detail: "sha_mismatch" }), { status: 422, headers: { "content-type": "application/json" } });
    const mismatch = await POST(req({ token: tokenFor("user-t"), extra: { "x-campaign-ticket": TICKET } }));
    expect(mismatch.status).toBe(422);
    sayariReply = () => new Response(JSON.stringify({ results: [{ id: 7 }] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  it("does not pass Sayari's errors or key refusals through", async () => {
    sayariReply = () => new Response("Traceback: db at 10.0.0.5 failed", { status: 500 });
    const res = await POST(req({ token: tokenFor("user-b") }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("10.0.0.5");

    sayariReply = () => new Response("Invalid upload key", { status: 401 });
    const res2 = await POST(req({ token: tokenFor("user-b") }));
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: "server_misconfigured" });
  });
});
