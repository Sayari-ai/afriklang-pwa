import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLength, clearSessionCache, clientIp, precheckJwt, RateLimiter, readBearer, verifySession } from "./upload-guard";

const URL_ = "https://proj.supabase.co";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p: object) => `${b64({ alg: "HS256" })}.${b64(p)}.c2lnbmF0dXJl`;
const NOW_S = 1_760_000_000;
const good = { sub: "user-1", exp: NOW_S + 600, role: "authenticated", iss: `${URL_}/auth/v1` };

afterEach(() => clearSessionCache());

describe("readBearer", () => {
  it("reads a bearer token and refuses everything else", () => {
    expect(readBearer(`Bearer ${"a".repeat(30)}`)).toBe("a".repeat(30));
    expect(readBearer(null)).toBeNull();
    expect(readBearer("Basic abc")).toBeNull();
    expect(readBearer("Bearer short")).toBeNull();
    expect(readBearer(`Bearer ${"a".repeat(30)} extra`)).toBeNull();
  });
});

describe("precheckJwt", () => {
  it("accepts a live token of this project", () => {
    expect(precheckJwt(jwt(good), URL_, NOW_S)).toEqual({ ok: true, sub: "user-1", exp: good.exp });
  });
  it.each([
    ["expired", { ...good, exp: NOW_S - 1 }],
    ["another project", { ...good, iss: "https://other.supabase.co/auth/v1" }],
    ["the anon key", { ...good, role: "anon" }],
    ["no subject", { ...good, sub: "" }],
  ])("refuses %s", (_, p) => {
    expect(precheckJwt(jwt(p), URL_, NOW_S).ok).toBe(false);
  });
  it("refuses what is not a JWT", () => {
    expect(precheckJwt("abc.def", URL_, NOW_S).ok).toBe(false);
    expect(precheckJwt("a.%%%.c", URL_, NOW_S).ok).toBe(false);
  });
});

describe("verifySession", () => {
  const cfg = { supabaseUrl: URL_, anonKey: "anon" };
  const now = () => NOW_S * 1000;
  const authSays = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("asks Auth once, then serves the cache", async () => {
    const fetch = authSays(200, { id: "user-1" });
    expect(await verifySession(jwt(good), cfg, { now, fetch })).toEqual({ userId: "user-1" });
    expect(await verifySession(jwt(good), cfg, { now, fetch })).toEqual({ userId: "user-1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`${URL_}/auth/v1/user`);
  });

  it("never calls Auth for a token that fails the precheck", async () => {
    const fetch = authSays(200, { id: "user-1" });
    expect(await verifySession(jwt({ ...good, exp: NOW_S - 5 }), cfg, { now, fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null when Auth refuses the token, or names another user", async () => {
    expect(await verifySession(jwt(good), cfg, { now, fetch: authSays(401) })).toBeNull();
    expect(await verifySession(jwt(good), cfg, { now, fetch: authSays(403, { error_code: "bad_jwt" }) })).toBeNull();
    expect(await verifySession(jwt(good), cfg, { now, fetch: authSays(400) })).toBeNull();
    expect(await verifySession(jwt(good), cfg, { now, fetch: authSays(200, { id: "someone-else" }) })).toBeNull();
  });

  it("throws when Auth is down, so the caller says 'retry' and not 'sign in'", async () => {
    await expect(verifySession(jwt(good), cfg, { now, fetch: authSays(502) })).rejects.toThrow();
    await expect(verifySession(jwt(good), cfg, { now, fetch: authSays(429) })).rejects.toThrow();
  });

  it("throws without calling Auth when the lookup budget is spent", async () => {
    const fetch = authSays(200, { id: "user-1" });
    await expect(verifySession(jwt(good), cfg, { now, fetch, beforeLookup: () => false })).rejects.toThrow("auth_busy");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not cache past the token's expiry", async () => {
    const fetch = authSays(200, { id: "user-1" });
    const short = { ...good, exp: NOW_S + 10 };
    await verifySession(jwt(short), cfg, { now, fetch });
    expect(await verifySession(jwt(short), cfg, { now: () => (NOW_S + 11) * 1000, fetch })).toBeNull();
  });
});

describe("checkLength", () => {
  it("needs a declared length within the cap", () => {
    expect(checkLength("1000")).toEqual({ ok: true, bytes: 1000 });
    expect(checkLength(null)).toEqual({ ok: false, status: 411 });
    expect(checkLength("-1")).toEqual({ ok: false, status: 411 });
    expect(checkLength("12abc")).toEqual({ ok: false, status: 411 });
    expect(checkLength(String(25 * 1024 * 1024 + 1))).toEqual({ ok: false, status: 413 });
  });
});

describe("RateLimiter", () => {
  it("allows the limit, then refuses until the window ends", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 10).ok).toBe(true);
    expect(rl.take("a", 20)).toEqual({ ok: false, retryAfterS: 1 });
    expect(rl.blocked("a", 30)).toBe(true);
    expect(rl.take("b", 30).ok).toBe(true);
    expect(rl.take("a", 1000).ok).toBe(true);
  });
  it("stays bounded under a flood of keys", () => {
    const rl = new RateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1000; i++) rl.take(`k${i}`, 0);
    expect((rl as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(100);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
