import { describe, expect, it } from "vitest";
import { DEFAULT_POSTHOG_HOST, DEFAULT_POSTHOG_PROJECT_TOKEN, getPostHogConfig, isLocalHostname, shouldRunInBrowser } from "./config";
import { sanitizeEvent, sanitizeUrl } from "./sanitize";
import { signInErrorCode } from "./client";

describe("sanitizeUrl", () => {
  it("cuts the fragment (the invitation token lives there)", () => {
    expect(sanitizeUrl("https://app.afriklang.com/campaign#t=secret-token")).toBe("https://app.afriklang.com/campaign");
  });

  it("removes sign-in leftovers from the query and keeps the rest", () => {
    expect(sanitizeUrl("https://app.afriklang.com/campaign?code=abc&m=123&error_description=Bad+thing")).toBe("https://app.afriklang.com/campaign?m=123");
  });

  it("leaves non-URLs alone", () => {
    expect(sanitizeUrl("$direct")).toBe("$direct");
    expect(sanitizeUrl("/campaign")).toBe("/campaign");
  });
});

describe("sanitizeEvent", () => {
  it("cleans URL properties and the person properties an event sets", () => {
    const event = sanitizeEvent({
      event: "$pageview",
      properties: { $current_url: "https://a.b/campaign#tok", $referrer: "https://a.b/x?code=1", $pathname: "/campaign", code: "permission-denied", info: { u: "https://a.b/#tok" }, $set_once: { $initial_current_url: "https://a.b/#tok" } },
      $set_once: { $initial_referrer: "https://a.b/?token=t" },
    });
    expect(event.properties?.$current_url).toBe("https://a.b/campaign");
    expect(event.properties?.$referrer).toBe("https://a.b/x");
    expect(event.properties?.$pathname).toBe("/campaign");
    // Non-URLs are untouched; nested objects are cleaned too, whatever their keys.
    expect(event.properties?.code).toBe("permission-denied");
    expect((event.properties?.info as Record<string, string>).u).toBe("https://a.b/");
    expect((event.properties?.$set_once as Record<string, string>).$initial_current_url).toBe("https://a.b/");
    expect(event.$set_once?.$initial_referrer).toBe("https://a.b/");
  });
});

describe("config", () => {
  it("defaults to the public project key; \"off\" turns PostHog off", () => {
    // The public project key is the default; "off" turns PostHog off.
    expect(getPostHogConfig({})?.token).toBe(DEFAULT_POSTHOG_PROJECT_TOKEN);
    expect(getPostHogConfig({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "  " })?.token).toBe(DEFAULT_POSTHOG_PROJECT_TOKEN);
    expect(getPostHogConfig({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "off" })).toBeNull();
  });

  it("defaults to the Afriklang proxy", () => {
    expect(getPostHogConfig({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_x" })).toEqual({ token: "phc_x", host: DEFAULT_POSTHOG_HOST, debug: false });
    expect(getPostHogConfig({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_x", NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com/" })?.host).toBe("https://eu.i.posthog.com");
  });

  it("stays off on localhost unless debugging", () => {
    const cfg = getPostHogConfig({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_x" });
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("app.localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(shouldRunInBrowser(cfg, "localhost")).toBe(false);
    expect(shouldRunInBrowser(cfg, "speak.afriklang.com")).toBe(true);
    expect(shouldRunInBrowser(getPostHogConfig({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_x", NEXT_PUBLIC_POSTHOG_DEBUG: "1" }), "localhost")).toBe(true);
    expect(shouldRunInBrowser(null, "speak.afriklang.com")).toBe(false);
  });
});

describe("signInErrorCode", () => {
  it("reads the code Auth puts in the redirect, never its description", () => {
    expect(signInErrorCode("?error=access_denied&error_code=bad_oauth_state&error_description=Some+text", "")).toBe("bad_oauth_state");
    expect(signInErrorCode("", "#error=server_error&error_description=x")).toBe("server_error");
    expect(signInErrorCode("?error=has%20spaces%20in%20it", "")).toBe("other");
  });

  it("is null without an error", () => {
    expect(signInErrorCode("?m=1", "#t=token")).toBeNull();
    expect(signInErrorCode("", "")).toBeNull();
  });
});
