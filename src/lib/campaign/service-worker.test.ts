import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAnalyticsClient, type AnalyticsClient } from "@/lib/analytics/events";
import { registerServiceWorker, registrationFailureReason, resetServiceWorkerRegistration } from "./service-worker";

const fake = { __loaded: true, capture: vi.fn() };

describe("registerServiceWorker (GitHub #47 #49 #55 #85 #87)", () => {
  beforeEach(() => {
    resetServiceWorkerRegistration();
    fake.capture.mockReset();
    vi.stubGlobal("window", {});
    setAnalyticsClient(fake as unknown as AnalyticsClient);
  });
  afterEach(() => {
    setAnalyticsClient(null);
    vi.unstubAllGlobals();
  });

  it("registers through next-pwa's workbox", async () => {
    const register = vi.fn().mockResolvedValue({});
    await expect(registerServiceWorker({ register })).resolves.toBe(true);
    expect(register).toHaveBeenCalledOnce();
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it("does nothing without a workbox (dev build, no Service Worker API)", async () => {
    await expect(registerServiceWorker(undefined)).resolves.toBe(false);
  });

  it("registers only once per page load", async () => {
    const register = vi.fn().mockResolvedValue({});
    await registerServiceWorker({ register });
    await registerServiceWorker({ register });
    expect(register).toHaveBeenCalledOnce();
  });

  it("swallows a refusal and sends one event with the error's name only", async () => {
    const refusal = new DOMException("Failed to register a ServiceWorker for scope ('https://collect.afriklang.com/'): The user denied permission to use Service Worker.", "NotSupportedError");
    await expect(registerServiceWorker({ register: () => Promise.reject(refusal) })).resolves.toBe(false);
    expect(fake.capture).toHaveBeenCalledWith("sw_register_failed", { reason: "NotSupportedError" }, undefined);
  });

  it("swallows a synchronous throw and odd rejection values", async () => {
    await expect(
      registerServiceWorker({
        register: () => {
          throw new TypeError("Script https://collect.afriklang.com/sw.js load failed");
        },
      }),
    ).resolves.toBe(false);
    expect(fake.capture).toHaveBeenLastCalledWith("sw_register_failed", { reason: "TypeError" }, undefined);
  });

  it("names failures with a short code, never the message", () => {
    expect(registrationFailureReason(new Error("Rejected"))).toBe("Error");
    expect(registrationFailureReason(Object.assign(new Error("x"), { name: "SecurityError" }))).toBe("SecurityError");
    expect(registrationFailureReason(null)).toBe("empty");
    expect(registrationFailureReason("Rejected")).toBe("other");
    expect(registrationFailureReason({ name: "has spaces and a sentence" })).toBe("other");
  });
});
