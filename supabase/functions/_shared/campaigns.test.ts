import { describe, expect, it } from "vitest";
import { ACTIONS, bearerToken, buildForward, dashboardBase, identityFrom, type Identity } from "./campaigns";

const WHO: Identity = { userId: "11111111-1111-4111-8111-111111111111", email: "awa@gmail.com", emailVerified: true };
const CID = "22222222-2222-4222-8222-222222222222";

describe("buildForward", () => {
  it("takes the user from the verified identity and drops anything the browser claims", () => {
    const r = buildForward("missions", { user_id: "99999999-9999-4999-8999-999999999999", email: "evil@x.org", email_verified: true, campaign_id: CID, extra: 1 }, WHO);
    expect(r).toEqual({ ok: true, path: "missions", body: { user_id: WHO.userId, campaign_id: CID } });
  });

  it("sends the verified email only for claim, from the identity not the body", () => {
    const r = buildForward("claim", { token: "  tok  ", device_id: "d", email: "evil@x.org", email_verified: true }, WHO);
    expect(r).toEqual({ ok: true, path: "claim", body: { user_id: WHO.userId, email: "awa@gmail.com", email_verified: true, token: "tok", device_id: "d" } });
    const unverified = buildForward("claim", { token: "t" }, { ...WHO, emailVerified: false });
    expect(unverified).toMatchObject({ ok: true, body: { email_verified: false } });
    for (const a of ["campaigns", "profile", "consent", "withdraw", "missions", "submit"]) {
      const f = buildForward(a, { campaign_id: CID, mission_id: CID, type: "account", version: "v1", recording: {} }, WHO);
      expect(f.ok && "email" in f.body).toBe(false);
    }
  });

  it("refuses unknown actions, including inherited object keys", () => {
    for (const a of ["", "nope", "__proto__", "constructor", "toString", undefined, 5]) expect(buildForward(a, {}, WHO)).toEqual({ ok: false, error: "unknown_action" });
  });

  it("requires and validates fields", () => {
    expect(buildForward("claim", {}, WHO)).toEqual({ ok: false, error: "token_required" });
    expect(buildForward("claim", { token: 5 }, WHO)).toEqual({ ok: false, error: "token_invalid" });
    expect(buildForward("missions", { campaign_id: "nope" }, WHO)).toEqual({ ok: false, error: "campaign_id_invalid" });
    expect(buildForward("submit", { mission_id: CID, recording: [] }, WHO)).toEqual({ ok: false, error: "recording_invalid" });
    expect(buildForward("submit", { mission_id: CID }, WHO)).toEqual({ ok: false, error: "recording_required" });
    expect(buildForward("claim", { token: "x".repeat(500) }, WHO)).toMatchObject({ ok: true, body: { token: "x".repeat(128) } });
  });

  it("the campaigns list needs no fields and tolerates a junk body", () => {
    expect(buildForward("campaigns", null, WHO)).toEqual({ ok: true, path: "", body: { user_id: WHO.userId } });
    expect(buildForward("campaigns", [1, 2], WHO)).toMatchObject({ ok: true });
  });

  it("every action maps to a real dashboard route", () => {
    expect(Object.values(ACTIONS).map((a) => a.path).sort()).toEqual(["", "claim", "consent", "consent/withdraw", "missions", "missions/submit", "profile"]);
  });
});

describe("identityFrom", () => {
  const google = (over: Record<string, unknown> = {}) => ({
    id: WHO.userId,
    email: "Awa@Gmail.com",
    app_metadata: { provider: "google" },
    user_metadata: {},
    identities: [{ provider: "google", identity_data: { email_verified: true } }],
    ...over,
  });

  it("a Google account with a provider-verified email is verified, and the email is lowercased", () => {
    expect(identityFrom(google())).toEqual({ userId: WHO.userId, email: "awa@gmail.com", emailVerified: true });
    expect(identityFrom(google({ identities: [], user_metadata: { email_verified: true } }))).toMatchObject({ emailVerified: true });
  });

  it("is not verified when Google does not say so, for other providers, or without an email", () => {
    expect(identityFrom(google({ identities: [{ provider: "google", identity_data: { email_verified: false } }] }))).toMatchObject({ emailVerified: false });
    expect(identityFrom(google({ identities: [{ provider: "email", identity_data: { email_verified: true } }], app_metadata: { provider: "email" }, user_metadata: { email_verified: true } }))).toMatchObject({ emailVerified: false });
    expect(identityFrom(google({ email: undefined }))).toMatchObject({ email: null, emailVerified: false });
    expect(identityFrom(google({ email: "no-at-sign" }))).toMatchObject({ email: null, emailVerified: false });
    // "confirmed" by Supabase is not enough on its own
    expect(identityFrom({ id: WHO.userId, email: "a@b.org", email_confirmed_at: "2026-01-01", app_metadata: { provider: "email" } })).toMatchObject({ emailVerified: false });
  });

  it("needs a real user id", () => {
    expect(identityFrom(null)).toBeNull();
    expect(identityFrom({ id: "nope", email: "a@b.org" })).toBeNull();
  });
});

describe("bearerToken and dashboardBase", () => {
  it("parses a bearer header strictly", () => {
    expect(bearerToken("Bearer abc.def-ghi_jkl")).toBe("abc.def-ghi_jkl");
    for (const h of [null, "", "Bearer", "Basic abc", "Bearer a b", "bearer abc"]) expect(bearerToken(h)).toBeNull();
  });

  it("accepts an https origin (or localhost over http), nothing else", () => {
    expect(dashboardBase("https://afriklang.com/")).toBe("https://afriklang.com");
    expect(dashboardBase("https://afriklang.com/admin-secret/x")).toBe("https://afriklang.com");
    expect(dashboardBase("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["http://afriklang.com", "ftp://x.org", "https://user:pw@x.org", "not a url", "", undefined, null]) expect(dashboardBase(bad as string)).toBeNull();
  });
});
