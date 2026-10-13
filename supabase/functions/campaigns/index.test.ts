// Runs the real Edge Function handler under vitest with Deno and the Supabase client faked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("../_shared/util.ts", () => ({
  corsHeaders: { "Access-Control-Allow-Origin": "*" },
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  errorResponse: (code: string, message: string, status: number) => new Response(JSON.stringify({ error: code, message }), { status, headers: { "Content-Type": "application/json" } }),
  serviceClient: () => ({ auth }),
}));

let handler: (req: Request) => Promise<Response>;
const env: Record<string, string> = {};
const fetchMock = vi.fn();

const googleUser = { id: USER, email: "awa@gmail.com", app_metadata: { provider: "google" }, identities: [{ provider: "google", identity_data: { email: "awa@gmail.com", email_verified: true } }] };
const call = (body: unknown, headers: Record<string, string> = { authorization: "Bearer good.token" }, method = "POST") =>
  handler(new Request("https://x.supabase.co/functions/v1/campaigns", { method, headers: { "content-type": "application/json", ...headers }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }));

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  auth.getUser.mockReset().mockResolvedValue({ data: { user: googleUser }, error: null });
  Object.assign(env, { BRIDGE_SECRET: "s".repeat(32), DASHBOARD_URL: "https://dash.example.com/" });
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => void (handler = h) };
  vi.stubGlobal("fetch", fetchMock);
  await import("./index.ts");
});

describe("campaigns Edge Function", () => {
  it("forwards a call with the secret and the VERIFIED identity, ignoring a forged user_id", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ contributor: { contributor_id: "c1" }, campaigns: [] }), { status: 200 }));
    const res = await call({ action: "claim", token: "T".repeat(43), user_id: "99999999-9999-4999-8999-999999999999", email: "evil@x.org", email_verified: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contributor: { contributor_id: "c1" }, campaigns: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dash.example.com/api/pwa/campaigns/claim");
    expect(init.headers.Authorization).toBe(`Bearer ${"s".repeat(32)}`);
    expect(JSON.parse(init.body)).toEqual({ user_id: USER, email: "awa@gmail.com", email_verified: true, token: "T".repeat(43) });
    expect(auth.getUser).toHaveBeenCalledWith("good.token");
  });

  it("upload_ticket forwards to missions/upload-ticket with the verified user and relays { ticket, expires_at } untouched", async () => {
    const answer = { ticket: "eyJ2IjoxfQ.c2ln", expires_at: "2026-10-13T12:30:00.000Z" };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }));
    const res = await call({ action: "upload_ticket", mission_id: CID, source_sha256: "c".repeat(64), duration_s: 9, user_id: "99999999-9999-4999-8999-999999999999" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dash.example.com/api/pwa/campaigns/missions/upload-ticket");
    expect(init.headers.Authorization).toBe(`Bearer ${"s".repeat(32)}`);
    expect(JSON.parse(init.body)).toEqual({ user_id: USER, mission_id: CID, source_sha256: "c".repeat(64), duration_s: 9 });
  });

  it("upload_ticket relays a refusal as it is, and names an old dashboard's missing route", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Not yours.", code: "not_assigned" }), { status: 403 }));
    const refused = await call({ action: "upload_ticket", mission_id: CID, source_sha256: "c".repeat(64), duration_s: 9 });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Not yours.", code: "not_assigned" });
    // An older dashboard without the route: Next's HTML 404, or JSON with no code.
    for (const body of ["<!DOCTYPE html><title>404</title>", JSON.stringify({ error: "Not found" })]) {
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 404 }));
      const missing = await call({ action: "upload_ticket", mission_id: CID, source_sha256: "c".repeat(64), duration_s: 9 });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ error: "route_not_found" });
    }
    // A coded 404 is a refusal and goes through as it is.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Not yours.", code: "not_assigned" }), { status: 404 }));
    expect(await (await call({ action: "upload_ticket", mission_id: CID, source_sha256: "c".repeat(64), duration_s: 9 })).json()).toEqual({ error: "Not yours.", code: "not_assigned" });
  });

  it("upload_ticket with a bad field is a 400 naming it, and never reaches the dashboard", async () => {
    const res = await call({ action: "upload_ticket", mission_id: CID, source_sha256: "nope", duration_s: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors).toEqual({ source_sha256: expect.stringContaining("64 hex"), duration_s: expect.stringContaining("above 0") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the list action goes to the bare /campaigns route", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await call({ action: "campaigns" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://dash.example.com/api/pwa/campaigns");
  });

  it("relays a dashboard failure with its status, body and Retry-After", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Too many", code: "rate" }), { status: 429, headers: { "retry-after": "7" } }));
    const res = await call({ action: "campaigns" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toEqual({ error: "Too many", code: "rate" });
  });

  it("a dashboard 401 (bridge key refused) is a server fault, never 'sign in again'", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 }));
    const res = await call({ action: "campaigns" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "server_misconfigured" });
  });

  it("refuses without a usable session and never calls the dashboard", async () => {
    expect((await call({ action: "campaigns" }, {})).status).toBe(401);
    expect((await call({ action: "campaigns" }, { authorization: "Basic abc" })).status).toBe(401);
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    expect((await call({ action: "campaigns" })).status).toBe(401);
    auth.getUser.mockResolvedValue({ data: { user: { id: "not-a-uuid" } }, error: null });
    expect((await call({ action: "campaigns" })).status).toBe(401);
    auth.getUser.mockRejectedValue(new Error("auth down"));
    expect((await call({ action: "campaigns" })).status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses bad requests: method, JSON, action, fields, size", async () => {
    expect((await call({}, {}, "GET")).status).toBe(405);
    expect((await call("{not json")).status).toBe(400);
    expect((await call({ action: "drop_tables" })).status).toBe(400);
    const bad = await call({ action: "missions", campaign_id: "nope" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid request: campaign_id must be a uuid.", code: "invalid_input", fieldErrors: { campaign_id: "campaign_id must be a uuid" } });
    expect((await call("[1,2]")).status).toBe(400);
    const big = await call({ action: "submit", mission_id: CID, recording: { pad: "x".repeat(50_000) } });
    expect(big.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not configured without a long enough secret or a valid dashboard url", async () => {
    env.BRIDGE_SECRET = "short";
    expect((await call({ action: "campaigns" })).status).toBe(500);
    env.BRIDGE_SECRET = "s".repeat(32);
    env.DASHBOARD_URL = "http://evil.example.com";
    expect((await call({ action: "campaigns" })).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when the dashboard is unreachable or answers with something that is not JSON", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const down = await call({ action: "campaigns" });
    expect(down.status).toBe(502);
    expect((await down.json()).code).toBe("bridge_unreachable");
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const slow = await call({ action: "campaigns" });
    expect(slow.status).toBe(504);
    expect((await slow.json()).code).toBe("bridge_timeout");
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    expect((await call({ action: "campaigns" })).status).toBe(502);
  });

  it("answers the CORS preflight", async () => {
    const res = await handler(new Request("https://x.supabase.co/functions/v1/campaigns", { method: "OPTIONS" }));
    expect(res.status).toBe(200);
  });
});
