import { describe, expect, it } from "vitest";
import { clearWithdrawn, markWithdrawn, withdrawnHere } from "./withdrawals";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("withdrawals from this app (H-1)", () => {
  it("remembers a withdrawal per user and campaign, until the consent is signed again", () => {
    const s = memory();
    expect(withdrawnHere("u1", "c1", s)).toBe(false);
    markWithdrawn("u1", "c1", s);
    markWithdrawn("u1", "c1", s);
    expect(withdrawnHere("u1", "c1", s)).toBe(true);
    expect(withdrawnHere("u2", "c1", s)).toBe(false);
    expect(withdrawnHere("u1", "c2", s)).toBe(false);
    expect(JSON.parse(s.m.get("afriklang.campaign.withdrawn.v1")!)).toEqual(["u1:c1"]);
    clearWithdrawn("c1", s);
    expect(withdrawnHere("u1", "c1", s)).toBe(false);
  });

  it("a broken or missing store means not withdrawn here (the take is held, never deleted)", () => {
    const s = memory();
    s.setItem("afriklang.campaign.withdrawn.v1", "{oops");
    expect(withdrawnHere("u1", "c1", s)).toBe(false);
    expect(withdrawnHere("u1", "c1", null)).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => markWithdrawn("u1", "c1", full)).not.toThrow();
  });
});
