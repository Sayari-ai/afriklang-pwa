import { describe, expect, it } from "vitest";
import { ACTIONS, bearerToken, buildForward, dashboardBase, identityFrom, type Identity } from "./campaigns";

const WHO: Identity = { userId: "11111111-1111-4111-8111-111111111111", email: "awa@gmail.com", emailVerified: true };
const CID = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const TOKEN = "T".repeat(43);
const PROFILE = { native_language: "wol", variety: "Baol-Baol", country: "SN", region: "Thiès", gender: "female", age_band: "30-44", device: "Android" };
const RECORDING = { format: "wav", sample_rate: 16000, channels: 1, duration_s: 8.2, level_dbfs: -22, source_sha256: "a".repeat(64), peak_dbfs: -1.5, silence_before_s: 1.1, silence_after_s: 1, device: "Android Chrome" };

describe("buildForward", () => {
  it("takes the user from the verified identity and drops anything the browser claims", () => {
    const r = buildForward("missions", { user_id: "99999999-9999-4999-8999-999999999999", email: "evil@x.org", email_verified: true, campaign_id: CID, extra: 1 }, WHO);
    expect(r).toEqual({ ok: true, path: "missions", body: { user_id: WHO.userId, campaign_id: CID } });
  });

  it("sends the verified email only for claim, from the identity not the body", () => {
    const r = buildForward("claim", { token: `  ${TOKEN}  `, device_id: DEVICE.toUpperCase(), email: "evil@x.org", email_verified: true }, WHO);
    expect(r).toEqual({ ok: true, path: "claim", body: { user_id: WHO.userId, email: "awa@gmail.com", email_verified: true, token: TOKEN, device_id: DEVICE } });
    const unverified = buildForward("claim", { token: TOKEN }, { ...WHO, emailVerified: false });
    expect(unverified).toMatchObject({ ok: true, body: { email_verified: false } });
    const valid: Record<string, Record<string, unknown>> = {
      campaigns: {},
      profile: PROFILE,
      consent: { type: "account", version: "v1", locale: "en" },
      withdraw: { campaign_id: CID },
      missions: { campaign_id: CID },
      submit: { mission_id: CID, recording: RECORDING },
      upload_ticket: { mission_id: CID, source_sha256: "a".repeat(64), duration_s: 8.2 },
      draw: { campaign_id: CID },
      return: { campaign_id: CID, mission_ids: [DEVICE] },
    };
    for (const [a, fields] of Object.entries(valid)) {
      const f = buildForward(a, fields, WHO);
      expect(f.ok, a).toBe(true);
      expect(f.ok && "email" in f.body).toBe(false);
    }
  });

  it("refuses unknown actions, including inherited object keys", () => {
    for (const a of ["", "nope", "__proto__", "constructor", "toString", undefined, 5]) expect(buildForward(a, {}, WHO)).toMatchObject({ ok: false, code: "unknown_action" });
  });

  it("names every missing or malformed field at once", () => {
    expect(buildForward("claim", {}, WHO)).toMatchObject({ ok: false, code: "invalid_input", fieldErrors: { token: "token is required" } });
    expect(buildForward("claim", { token: 5 }, WHO)).toMatchObject({ fieldErrors: { token: "token must be text" } });
    expect(buildForward("claim", { token: "x".repeat(500) }, WHO)).toMatchObject({ fieldErrors: { token: expect.stringContaining("too long") } });
    expect(buildForward("claim", { token: "short" }, WHO)).toMatchObject({ fieldErrors: { token: expect.stringContaining("43-character") } });
    expect(buildForward("claim", { token: TOKEN, device_id: "phone" }, WHO)).toMatchObject({ fieldErrors: { device_id: "device_id must be a uuid" } });
    expect(buildForward("missions", { campaign_id: "nope" }, WHO)).toMatchObject({ fieldErrors: { campaign_id: "campaign_id must be a uuid" } });
    expect(buildForward("submit", { mission_id: CID, recording: [] }, WHO)).toMatchObject({ fieldErrors: { recording: expect.stringContaining("object") } });
    expect(buildForward("submit", { mission_id: CID }, WHO)).toMatchObject({ fieldErrors: { recording: "recording is required" } });
    const r = buildForward("profile", { native_language: "Wolof", variety: " ", country: "Senegal", region: "x".repeat(81), gender: "f", age_band: "17", device: "!!!" }, WHO);
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["age_band", "country", "device", "gender", "native_language", "region", "variety"]);
    expect(!r.ok && r.error).toContain("variety is required");
  });

  it("normalises what it forwards and drops unknown fields", () => {
    const r = buildForward("profile", { ...PROFILE, country: " sn ", region: "  Thiès ", nickname: "x" }, WHO);
    expect(r).toEqual({ ok: true, path: "profile", body: { user_id: WHO.userId, ...PROFILE, country: "SN", region: "Thiès" } });
  });

  it("checks consent type, locale and the campaign id a campaign consent needs", () => {
    expect(buildForward("consent", { type: "partner", version: "v1", locale: "de" }, WHO)).toMatchObject({ fieldErrors: { type: expect.any(String), locale: expect.any(String) } });
    expect(buildForward("consent", { type: "campaign", version: "v1", locale: "fr" }, WHO)).toMatchObject({ fieldErrors: { campaign_id: expect.stringContaining("required") } });
    expect(buildForward("consent", { type: "account", campaign_id: CID, version: "v1", locale: "fr" }, WHO)).toEqual({ ok: true, path: "consent", body: { user_id: WHO.userId, type: "account", version: "v1", locale: "fr" } });
    expect(buildForward("consent", { type: "account", version: "v".repeat(21), locale: "fr" }, WHO)).toMatchObject({ fieldErrors: { version: expect.stringContaining("too long") } });
  });

  it("checks each recording field and strips the rest", () => {
    const ok = buildForward("submit", { mission_id: CID, recording: { ...RECORDING, source_sha256: RECORDING.source_sha256.toUpperCase(), extra: "x" } }, WHO);
    expect(ok).toEqual({ ok: true, path: "missions/submit", body: { user_id: WHO.userId, mission_id: CID, recording: RECORDING } });
    const bad = buildForward("submit", { mission_id: CID, recording: { format: "mp3", sample_rate: 44_100.5, channels: 3, duration_s: 0, level_dbfs: 3, source_sha256: "abc", peak_dbfs: "loud" } }, WHO);
    expect(!bad.ok && Object.keys(bad.fieldErrors ?? {}).sort()).toEqual([
      "recording.channels", "recording.duration_s", "recording.format", "recording.level_dbfs", "recording.peak_dbfs", "recording.sample_rate", "recording.source_sha256",
    ]);
    // a clipped take is well formed: the dashboard refuses it as recording_rejected (422)
    expect(buildForward("submit", { mission_id: CID, recording: { ...RECORDING, peak_dbfs: 0.4 } }, WHO).ok).toBe(true);
  });

  it("upload_ticket: mission uuid, 64-hex sha-256, duration in (0, 3600]; user from the session only", () => {
    const sha = "AB".repeat(32);
    expect(buildForward("upload_ticket", { mission_id: ` ${CID.toUpperCase()} `, source_sha256: ` ${sha} `, duration_s: 12.5, user_id: DEVICE, ticket: "x", campaign_id: CID }, WHO)).toEqual({
      ok: true,
      path: "missions/upload-ticket",
      body: { user_id: WHO.userId, mission_id: CID, source_sha256: sha.toLowerCase(), duration_s: 12.5 },
    });
    expect(buildForward("upload_ticket", { duration_s: 3_600, mission_id: CID, source_sha256: "0".repeat(64) }, WHO).ok).toBe(true);
    const missing = buildForward("upload_ticket", {}, WHO);
    expect(!missing.ok && missing.fieldErrors).toEqual({ mission_id: "mission_id is required", source_sha256: "source_sha256 is required", duration_s: "duration_s is required" });
    for (const [field, value] of [
      ["mission_id", "M7"],
      ["mission_id", 5],
      ["source_sha256", "a".repeat(63)],
      ["source_sha256", "g".repeat(64)],
      ["source_sha256", 123],
      ["duration_s", 0],
      ["duration_s", -1],
      ["duration_s", 3_600.5],
      ["duration_s", "8"],
      ["duration_s", Number.NaN],
      ["duration_s", Number.POSITIVE_INFINITY],
    ] as const) {
      const r = buildForward("upload_ticket", { mission_id: CID, source_sha256: "a".repeat(64), duration_s: 8, [field]: value }, WHO);
      expect(r.ok, `${field}=${String(value)}`).toBe(false);
      expect(!r.ok && Object.keys(r.fieldErrors ?? {})).toEqual([field]);
    }
  });

  it("the campaigns list needs no fields and tolerates a junk body", () => {
    expect(buildForward("campaigns", null, WHO)).toEqual({ ok: true, path: "", body: { user_id: WHO.userId } });
    expect(buildForward("campaigns", [1, 2], WHO)).toMatchObject({ ok: true });
  });

  it("pool calls: draw needs the campaign, return a list of mission ids (deduplicated, at most 200)", () => {
    expect(buildForward("draw", { campaign_id: CID.toUpperCase(), user_id: DEVICE }, WHO)).toEqual({ ok: true, path: "missions/draw", body: { user_id: WHO.userId, campaign_id: CID } });
    expect(buildForward("draw", {}, WHO)).toMatchObject({ fieldErrors: { campaign_id: "campaign_id is required" } });
    expect(buildForward("return", { campaign_id: CID, mission_ids: [DEVICE.toUpperCase(), ` ${DEVICE} `] }, WHO)).toEqual({
      ok: true,
      path: "missions/return",
      body: { user_id: WHO.userId, campaign_id: CID, mission_ids: [DEVICE] },
    });
    expect(buildForward("return", { campaign_id: CID }, WHO)).toMatchObject({ fieldErrors: { mission_ids: "mission_ids is required" } });
    expect(buildForward("return", { campaign_id: CID, mission_ids: [] }, WHO)).toMatchObject({ fieldErrors: { mission_ids: expect.stringContaining("at least one") } });
    expect(buildForward("return", { campaign_id: CID, mission_ids: DEVICE }, WHO)).toMatchObject({ fieldErrors: { mission_ids: expect.stringContaining("list") } });
    expect(buildForward("return", { campaign_id: CID, mission_ids: [DEVICE, "nope"] }, WHO)).toMatchObject({ fieldErrors: { mission_ids: expect.stringContaining("uuids only") } });
    expect(buildForward("return", { campaign_id: CID, mission_ids: [DEVICE, 5] }, WHO)).toMatchObject({ fieldErrors: { mission_ids: expect.stringContaining("uuids only") } });
    expect(buildForward("return", { campaign_id: CID, mission_ids: Array(201).fill(DEVICE) }, WHO)).toMatchObject({ fieldErrors: { mission_ids: expect.stringContaining("at most 200") } });
  });

  it("every action maps to a real dashboard route", () => {
    expect(Object.values(ACTIONS).map((a) => a.path).sort()).toEqual(["", "claim", "consent", "consent/withdraw", "missions", "missions/draw", "missions/return", "missions/submit", "missions/upload-ticket", "profile"]);
  });
});

describe("identityFrom", () => {
  const google = (over: Record<string, unknown> = {}) => ({
    id: WHO.userId,
    email: "Awa@Gmail.com",
    app_metadata: { provider: "google" },
    user_metadata: {},
    identities: [{ provider: "google", identity_data: { email: "awa@gmail.com", email_verified: true } }],
    ...over,
  });

  it("a Google account with a provider-verified email is verified, and the email is lowercased", () => {
    expect(identityFrom(google())).toEqual({ userId: WHO.userId, email: "awa@gmail.com", emailVerified: true });
  });

  it("trusts only the Google identity, and only for the email Google verified (APP-020)", () => {
    // user_metadata can be written by the user: not enough.
    expect(identityFrom(google({ identities: [], user_metadata: { email_verified: true } }))).toMatchObject({ emailVerified: false });
    // The account email was changed to another address after the Google sign-in.
    expect(identityFrom(google({ email: "invited@school.org" }))).toMatchObject({ email: "invited@school.org", emailVerified: false });
    expect(identityFrom(google({ identities: [{ provider: "google", identity_data: { email_verified: true } }] }))).toMatchObject({ emailVerified: false });
  });

  it("is not verified when Google does not say so, for other providers, or without an email", () => {
    expect(identityFrom(google({ identities: [{ provider: "google", identity_data: { email: "awa@gmail.com", email_verified: false } }] }))).toMatchObject({ emailVerified: false });
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
