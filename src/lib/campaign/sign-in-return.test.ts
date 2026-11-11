import { describe, expect, it } from "vitest";
import { signInReturnProblem } from "./sign-in-return";

describe("signInReturnProblem (APP2-11)", () => {
  it("names closed sign-ups", () => {
    expect(signInReturnProblem("?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance", "")).toBe("signupsClosed");
    expect(signInReturnProblem("", "#error=server_error&error_description=Signups%20not%20allowed")).toBe("signupsClosed");
  });
  it("a flow started in another browser must be started again here", () => {
    expect(signInReturnProblem("?error=invalid_request&error_code=bad_oauth_state", "")).toBe("restart");
    expect(signInReturnProblem("?error_code=flow_state_not_found", "")).toBe("restart");
  });
  it("a cancelled Google screen, and anything else", () => {
    expect(signInReturnProblem("?error=access_denied", "")).toBe("denied");
    expect(signInReturnProblem("?error=server_error&error_description=boom", "")).toBe("failed");
  });
  it("a code that came back is noted; nothing in the address is nothing", () => {
    expect(signInReturnProblem("?code=abc", "")).toBe("code");
    expect(signInReturnProblem("", "#t=invite-token")).toBeNull();
    expect(signInReturnProblem("", "")).toBeNull();
  });
});
