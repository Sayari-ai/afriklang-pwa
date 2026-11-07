import { describe, expect, it } from "vitest";
import { NO_SESSION_YET, rememberSession, type SessionMemory } from "./session-memory";

const run = (start: SessionMemory, steps: ["waiting" | "signedOut" | "signedIn", boolean][]) => steps.reduce((m, [s, p]) => rememberSession(m, s, p), start);

describe("why a screen asks for sign-in", () => {
  it("no session at all is a plain sign-in, not an expired one", () => {
    expect(run(NO_SESSION_YET, [["waiting", false], ["signedOut", false]]).lost).toBe(false);
  });

  it("signed out on purpose, then a link opened: a plain sign-in", () => {
    // In this visit (the sign-out event), and after the reload that follows (nothing saved any more).
    expect(run(NO_SESSION_YET, [["signedIn", false], ["signedOut", true]]).lost).toBe(false);
    expect(run(NO_SESSION_YET, [["signedOut", false]]).lost).toBe(false);
  });

  it("a session refused while the app was open: expired", () => {
    expect(run(NO_SESSION_YET, [["signedIn", false], ["signedOut", false]]).lost).toBe(true);
  });

  it("a session saved on the phone that Auth refuses when the app opens: expired", () => {
    expect(run({ held: true, lost: false }, [["signedOut", false]]).lost).toBe(true);
  });

  it("signing in again clears it; a later sign-out on purpose stays a plain sign-in", () => {
    const expired = run(NO_SESSION_YET, [["signedIn", false], ["signedOut", false]]);
    expect(run(expired, [["signedIn", false]])).toEqual({ held: true, lost: false });
    expect(run(expired, [["signedIn", false], ["signedOut", true]]).lost).toBe(false);
    // A second signed-out answer keeps what the first one said.
    expect(run(expired, [["signedOut", true]]).lost).toBe(true);
  });
});
