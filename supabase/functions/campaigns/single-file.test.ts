// The generated one-file build (deploy/campaigns-single-file.ts) behaves like the multi-file function.
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({ createClient: () => ({ auth }) }));

let handler: (req: Request) => Promise<Response>;
const fetchMock = vi.fn();
const env: Record<string, string> = { BRIDGE_SECRET: "s".repeat(32), DASHBOARD_URL: "https://dash.example.com", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" };
const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer good.token" }) =>
  handler(new Request("https://x/functions/v1/campaigns", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: USER, email: "awa@gmail.com", app_metadata: { provider: "google" }, identities: [{ provider: "google", identity_data: { email: "awa@gmail.com", email_verified: true } }] } }, error: null });
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => void (handler = h) };
  vi.stubGlobal("fetch", fetchMock);
  await import("../../../deploy/campaigns-single-file.ts");
});

describe("single-file build", () => {
  it("is up to date with its sources", () => {
    expect(() => execFileSync("node", ["scripts/build-campaigns-single-file.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("forwards with the secret and the verified identity", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ campaigns: [] }), { status: 200 }));
    const res = await post({ action: "claim", token: "T".repeat(43), user_id: "99999999-9999-4999-8999-999999999999" });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dash.example.com/api/pwa/campaigns/claim");
    expect(init.headers.Authorization).toBe(`Bearer ${"s".repeat(32)}`);
    expect(JSON.parse(init.body)).toEqual({ user_id: USER, email: "awa@gmail.com", email_verified: true, token: "T".repeat(43) });
  });

  it("refuses without a session and for unknown actions", async () => {
    expect((await post({ action: "campaigns" }, {})).status).toBe(401);
    expect((await post({ action: "drop_tables" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
