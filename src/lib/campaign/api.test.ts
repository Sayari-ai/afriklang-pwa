import { describe, expect, it } from "vitest";
import { toResult } from "./api";
import { ERROR_KEY, isRetryable, needsSignIn } from "./errors";
import { canRetryFailed, decideSubmit, decideTicket } from "./outbox-logic";
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
    expect(toResult(500, null)).toMatchObject({ code: "server_error", message: "" });
    expect(toResult(418, { code: "made_up", error: "teapot" })).toMatchObject({ code: "unknown" });
    expect(toResult(429, {}, "soon")).not.toHaveProperty("retryAfterS");
  });
});

describe("toResult: precise failures", () => {
  it("keeps the per-field problems of a 400, ignoring junk entries", () => {
    const r = toResult(400, { error: "Invalid request: variety is required.", code: "invalid_input", fieldErrors: { variety: "variety is required", region: 5, "": " " } });
    expect(r).toMatchObject({ ok: false, code: "invalid_input", message: "Invalid request: variety is required.", fieldErrors: { variety: "variety is required" } });
    expect(toResult(400, { code: "invalid_input", error: "x", fieldErrors: [1] })).not.toHaveProperty("fieldErrors");
  });

  it("maps the Edge Function's own codes", () => {
    expect(toResult(500, { error: "server_misconfigured", message: "x" })).toMatchObject({ code: "misconfigured", message: "x" });
    expect(toResult(502, { error: "auth_unavailable", message: "x" })).toMatchObject({ code: "bridge_unreachable" });
    expect(toResult(504, { error: "late", code: "bridge_timeout" })).toMatchObject({ code: "timeout" });
    expect(toResult(400, { error: "invalid_json", message: "x" })).toMatchObject({ code: "invalid_input" });
    expect(toResult(413, { error: "too_large", message: "x" })).toMatchObject({ code: "invalid_input" });
    expect(toResult(400, { error: "toString" })).toMatchObject({ code: "invalid_input", message: "toString" });
    // A call the backend does not have yet: an older Edge Function, or a dashboard without the route.
    expect(toResult(400, { error: "unknown_action", message: "x" })).toMatchObject({ code: "unsupported" });
    expect(toResult(404, { error: "route_not_found", message: "x" })).toMatchObject({ code: "unsupported" });
    // A coded 404 stays a refusal.
    expect(toResult(404, { error: "Not yours.", code: "not_assigned" })).toMatchObject({ code: "not_assigned" });
  });

  it("guesses the kind of failure from the status when no code is known", () => {
    expect(toResult(401, null)).toMatchObject({ code: "unauthorized" });
    expect(toResult(409, { error: "Conflict" })).toMatchObject({ code: "conflict", message: "Conflict" });
    expect(toResult(503, "<html>")).toMatchObject({ code: "bridge_unreachable" });
    expect(toResult(504, null)).toMatchObject({ code: "timeout" });
    expect(toResult(422, {})).toMatchObject({ code: "invalid_input" });
  });

  it("a success that is not a JSON object is a bad answer, not data", () => {
    expect(toResult(200, null)).toMatchObject({ ok: false, code: "bridge_error" });
    expect(toResult(200, [1])).toMatchObject({ ok: false, code: "bridge_error" });
  });
});

describe("toResult: codes with their own handling (H-8)", () => {
  it("a closed test (403 test_closed) is final for the take, never retried", () => {
    const r = toResult(403, { error: "This test is closed: your recordings are being reviewed.", code: "test_closed" });
    expect(r).toMatchObject({ ok: false, code: "test_closed", message: "This test is closed: your recordings are being reviewed." });
    if (r.ok) return;
    expect(isRetryable(r.code)).toBe(false);
    expect(decideSubmit(r, 0)).toEqual({ kind: "fail", code: "test_closed" });
    expect(decideTicket(r, 0)).toEqual({ kind: "fail", code: "test_closed" });
    expect(canRetryFailed(r.code)).toBe(false);
    expect(ERROR_KEY[r.code]).toBe("testClosed");
  });

  it("a file already sent for another prompt (409 duplicate_audio) offers no useless retry", () => {
    const r = toResult(409, { error: "This recording was already sent for another prompt.", code: "duplicate_audio" });
    expect(r).toMatchObject({ ok: false, code: "duplicate_audio" });
    if (r.ok) return;
    expect(isRetryable(r.code)).toBe(false);
    expect(decideSubmit(r, 0)).toEqual({ kind: "fail", code: "duplicate_audio" });
    expect(canRetryFailed(r.code)).toBe(false);
    expect(ERROR_KEY[r.code]).toBe("duplicateAudio");
  });

  it("other failed takes keep their Try again", () => {
    for (const code of ["invalid_input", "server_error", "conflict", null]) expect(canRetryFailed(code)).toBe(true);
    for (const code of ["tooLarge", "campaign_closed", "not_assigned", "blocked"]) expect(canRetryFailed(code)).toBe(false);
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
    expect(isRetryable("offline")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("invalid_input")).toBe(false);
    expect(isRetryable("email_mismatch")).toBe(false);
    expect(isRetryable("blocked")).toBe(false);
  });
});
