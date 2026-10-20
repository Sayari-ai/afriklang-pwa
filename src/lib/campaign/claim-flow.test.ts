import { describe, expect, it } from "vitest";
import { acceptedPercent, chipFor, claimOutcome, maskedEmailIn, nextView, type ClaimState } from "./claim-flow";
import type { CampaignErrorCode } from "./types";

const idle: ClaimState = { status: "idle" };
const failed = (code: CampaignErrorCode): ClaimState => ({ status: "failed", failure: { ok: false, status: 400, code, message: "" } });

describe("claimOutcome", () => {
  it.each(["email_mismatch", "email_unverified"] as const)("%s keeps the token, shows the server hint and offers another account", (code) => {
    const o = claimOutcome({ code });
    expect(o).toMatchObject({ clearToken: false, showServerMessage: true, retryable: false, offerOtherAccount: true });
  });

  it.each(["account_conflict", "invalid_link", "link_expired", "campaign_closed"] as const)("%s is terminal", (code) => {
    expect(claimOutcome({ code })).toMatchObject({ clearToken: true, showServerMessage: false, retryable: false, offerOtherAccount: false });
  });

  it.each(["network", "bridge_unreachable", "server_error", "rate_limited", "unknown"] as const)("%s is retryable and keeps the token", (code) => {
    expect(claimOutcome({ code })).toMatchObject({ clearToken: false, retryable: true, showServerMessage: false });
  });

  it("never shows server text for other codes and maps message keys", () => {
    expect(claimOutcome({ code: "link_expired" }).messageKey).toBe("linkExpired");
    expect(claimOutcome({ code: "email_mismatch" }).messageKey).toBe("emailMismatch");
    expect(claimOutcome({ code: "unauthorized" })).toMatchObject({ clearToken: false, retryable: false });
  });
});

describe("nextView", () => {
  it("waits for session and token read", () => {
    expect(nextView({ session: "waiting", hasToken: true, claim: idle })).toBe("waiting");
    expect(nextView({ session: "signedIn", hasToken: null, claim: idle })).toBe("waiting");
  });
  it("signed out shows sign-in, with or without token", () => {
    expect(nextView({ session: "signedOut", hasToken: true, claim: idle })).toBe("signIn");
    expect(nextView({ session: "signedOut", hasToken: false, claim: idle })).toBe("signIn");
  });
  it("signed in with token claims, without goes home", () => {
    expect(nextView({ session: "signedIn", hasToken: true, claim: idle })).toBe("claiming");
    expect(nextView({ session: "signedIn", hasToken: true, claim: { status: "claiming" } })).toBe("claiming");
    expect(nextView({ session: "signedIn", hasToken: false, claim: idle })).toBe("home");
  });
  it("claim result drives the view", () => {
    expect(nextView({ session: "signedIn", hasToken: false, claim: { status: "done" } })).toBe("claimed");
    expect(nextView({ session: "signedIn", hasToken: true, claim: failed("email_mismatch") })).toBe("claimFailed");
    expect(nextView({ session: "signedIn", hasToken: true, claim: failed("unauthorized") })).toBe("signIn");
  });
});

describe("chipFor / acceptedPercent", () => {
  it("maps next steps", () => {
    expect(chipFor("account_consent").key).toBe("consent");
    expect(chipFor("campaign_consent").key).toBe("consent");
    expect(chipFor("profile").key).toBe("profile");
    expect(chipFor("ready")).toEqual({ key: "ready", tone: "good" });
  });
  it("computes a safe percentage", () => {
    expect(acceptedPercent({ total: 0, accepted: 0 })).toBe(0);
    expect(acceptedPercent({ total: 8, accepted: 2 })).toBe(25);
    expect(acceptedPercent({ total: 2, accepted: 5 })).toBe(100);
  });
});

describe("maskedEmailIn", () => {
  it("takes the masked address out of the dashboard's English hint", () => {
    expect(maskedEmailIn("Sign in with the Google account for a***@yahoo.fr, the address this invitation was sent to.")).toBe("a***@yahoo.fr");
    expect(maskedEmailIn("Sign in with the Google account for ***@example.org.")).toBe("***@example.org");
    expect(maskedEmailIn("This contributor has no email on file.")).toBeNull();
    expect(maskedEmailIn(null)).toBeNull();
  });
});
