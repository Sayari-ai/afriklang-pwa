import { describe, expect, it, vi } from "vitest";
import { retryAction } from "./error-recovery";

describe("retryAction (error screens' Retry button)", () => {
  it("calls retry, the prop Next 16.3+ passes", () => {
    const retry = vi.fn();
    const reset = vi.fn();
    const reload = vi.fn();
    retryAction({ retry, reset }, reload)();
    expect(retry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("works with the props Next 16.4 really passes (no unstable_retry)", () => {
    // What node_modules/next/dist/client/components/error-boundary.js hands the component.
    const props: Record<string, unknown> = { error: new Error("x"), reset: vi.fn(), retry: vi.fn() };
    expect(() => retryAction(props)()).not.toThrow();
    expect(props.retry).toHaveBeenCalledOnce();
  });

  it("falls back to unstable_retry, then reset", () => {
    const unstable_retry = vi.fn();
    retryAction({ unstable_retry }, vi.fn())();
    expect(unstable_retry).toHaveBeenCalledOnce();
    const reset = vi.fn();
    retryAction({ reset }, vi.fn())();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("reloads the page when Next passed nothing usable", () => {
    const reload = vi.fn();
    retryAction({ retry: undefined, reset: "not a function" }, reload)();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never throws, even when the reload throws too", () => {
    const boom = () => {
      throw new Error("boom");
    };
    expect(() => retryAction({ retry: boom }, boom)()).not.toThrow();
    expect(() => retryAction({}, boom)()).not.toThrow();
  });

  it("reloads the page when the retry itself throws", () => {
    const reload = vi.fn();
    retryAction(
      {
        retry: () => {
          throw new Error("boom");
        },
      },
      reload,
    )();
    expect(reload).toHaveBeenCalledOnce();
  });
});
