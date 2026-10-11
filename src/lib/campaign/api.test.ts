import { describe, expect, it } from "vitest";
import { toResult } from "./api";
import { ERROR_KEY, isRetryable, needsSignIn } from "./errors";
import type { CampaignErrorCode } from "./types";

describe("toResult", () => {
  it("a 2xx is the data", () => {
    expect(toResult(200, { signed_version: "v1", already: false })).toEqual({ ok: true, data: { signed_version: "v1", already: false } });
  });

  it("a dashboard failure keeps its code, its message and the next step", () => {
    expect(toResult(403, { error: "Sign it first.", code: "account_consent", next_step: "account_consent" })).toEqual({ ok: false, status: 403, code: "account_consent", message: "Sign it first.", nextStep: "account_consent" });
    expect(toResult(422, { error: "Too short", code: "recording_rejected", reason: "duration" })).toMatchObject({ code: "recording_rejected", reason: "duration", message: "Too short" });
    expect(toResult(403, { error: "Sign in with the Google account for a***@gmail.com.", code: "email_mismatch" })).toMatchObject({ code: "email_mismatch", message: expect.stringContaining("a***@gmail.com") });
  });

  it("an Edge Function failure carries its code in `error`", () => {
    expect(toResult(401, { error: "unauthorized", message: "Sign in first." })).toMatchObject({ code: "unauthorized", message: "Sign in first." });
    expect(toResult(502, { error: "The campaign service is not reachable right now.", code: "bridge_unreachable" })).toMatchObject({ code: "bridge_unreachable" });
    expect(toResult(502, { error: "bridge_error", message: "x" })).toMatchObject({ code: "bridge_error" });
  });

  it("rate limits and unknown answers are named, with Retry-After", () => {
    expect(toResult(429, { error: "slow down" }, "12")).toMatchObject({ code: "rate_limited", retryAfterS: 12 });
    expect(toResult(500, null)).toMatchObject({ code: "unknown", message: "" });
    expect(toResult(418, { code: "made_up", error: "teapot" })).toMatchObject({ code: "unknown" });
    expect(toResult(429, {}, "soon")).not.toHaveProperty("retryAfterS");
  });
});

describe("error table", () => {
  it("has a message key for every code, none empty", () => {
    const codes: CampaignErrorCode[] = Object.keys(ERROR_KEY) as CampaignErrorCode[];
    expect(codes.length).toBeGreaterThanOrEqual(26);
    for (const c of codes) expect(ERROR_KEY[c]).toMatch(/^[a-zA-Z]+$/);
  });

  it("knows which failures mean sign in again and which are worth a retry", () => {
    expect(needsSignIn("unauthorized")).toBe(true);
    expect(needsSignIn("not_linked")).toBe(false);
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("email_mismatch")).toBe(false);
    expect(isRetryable("blocked")).toBe(false);
  });
});
