// Runs the real Edge Function handler under vitest with Deno and the Supabase client faked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const SECRET = "e".repeat(40);
const admin = vi.hoisted(() => ({ deleteUser: vi.fn() }));

const created = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: (...args: unknown[]) => {
    created.args = args;
    return { auth: { admin } };
  },
}));

let handler: (req: Request) => Promise<Response>;
const env: Record<string, string> = {};

const call = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, method = "POST") =>
  handler(new Request("https://x.supabase.co/functions/v1/erase-account", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  }));

beforeEach(async () => {
  vi.resetModules();
  admin.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { ERASE_SECRET: SECRET, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" });
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => void (handler = h) };
  await import("./index.ts");
});

describe("erase-account Edge Function", () => {
  it("deletes the account named by user_id", async () => {
    const res = await call({ user_id: USER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(admin.deleteUser).toHaveBeenCalledWith(USER);
    expect(created.args.slice(0, 2)).toEqual(["https://x.supabase.co", "service-role"]);
  });

  it("imports nothing but supabase-js, so the file can be pasted into the dashboard editor", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["https://esm.sh/@supabase/supabase-js@2.45.0"]);
  });

  it("answers not_found for an account already gone, so a repeat is fine", async () => {
    admin.deleteUser.mockResolvedValue({ data: null, error: { status: 404, message: "User not found" } });
    const res = await call({ user_id: USER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: false, reason: "not_found" });
  });

  it("refuses a wrong, missing or bridge-style secret before touching anything", async () => {
    for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: SECRET }, { authorization: `Bearer ${SECRET}x` }]) {
      const res = await call({ user_id: USER }, headers);
      expect(res.status).toBe(401);
    }
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it("is off until a long enough secret is set", async () => {
    env.ERASE_SECRET = "short";
    const res = await call({ user_id: USER }, { authorization: "Bearer short" });
    expect(res.status).toBe(500);
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a malformed id or body, and anything but POST", async () => {
    for (const body of [{}, { user_id: "abc" }, { user_id: 12 }, "not json", []]) {
      expect((await call(body)).status).toBe(422);
    }
    expect((await call(null, undefined, "GET")).status).toBe(405);
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it("reports a missing service key as retryable, not as success", async () => {
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await call({ user_id: USER })).status).toBe(502);
  });

  it("reports a Supabase failure as retryable", async () => {
    admin.deleteUser.mockResolvedValue({ data: null, error: { status: 500, message: "database error" } });
    expect((await call({ user_id: USER })).status).toBe(502);
    admin.deleteUser.mockRejectedValue(new Error("network"));
    expect((await call({ user_id: USER })).status).toBe(502);
  });
});
