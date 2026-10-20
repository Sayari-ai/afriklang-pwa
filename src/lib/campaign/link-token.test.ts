import { describe, expect, it } from "vitest";
import { clearToken, dismissTokenFor, isTokenDismissedFor, malformedTokenInHash, savedToken, saveToken, tokenFromHash } from "./link-token";

const TOKEN = "AbCdEf0123456789AbCdEf0123456789AbCdEf01234";
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("tokenFromHash", () => {
  it("reads a well-formed token from the fragment", () => {
    expect(tokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#foo=1&t=${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores anything that is not a 43-character url-safe token", () => {
    for (const h of ["", "#", "#t=", "#t=short", `#t=${TOKEN}x`, `#t=${"a".repeat(42)}`, "#t=../../etc/passwd", `#x=${TOKEN}`, `#t=${TOKEN.slice(0, 42)}%20`]) expect(tokenFromHash(h)).toBeNull();
  });
});

describe("saved token", () => {
  it("round-trips, clears, and refuses junk in storage", () => {
    const s = memory();
    expect(savedToken(s)).toBeNull();
    saveToken(TOKEN, s);
    expect(savedToken(s)).toBe(TOKEN);
    clearToken(s);
    expect(savedToken(s)).toBeNull();
    s.setItem("afriklang.campaign.token.v1", "<script>");
    expect(savedToken(s)).toBeNull();
  });

  it("works without storage and when storage throws", () => {
    expect(() => saveToken(TOKEN, null)).not.toThrow();
    expect(savedToken(null)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => saveToken(TOKEN, broken)).not.toThrow();
    expect(savedToken(broken)).toBeNull();
    expect(() => clearToken(broken)).not.toThrow();
  });
});

describe("malformedTokenInHash", () => {
  it("spots a token cut or altered when copied, and nothing else", () => {
    expect(malformedTokenInHash(`#t=${TOKEN.slice(0, 30)}`)).toBe(true);
    expect(malformedTokenInHash("#t=")).toBe(true);
    expect(malformedTokenInHash(`#t=${TOKEN}`)).toBe(false);
    expect(malformedTokenInHash("")).toBe(false);
    expect(malformedTokenInHash("#section-2")).toBe(false);
  });
});

describe("an invitation this account gave up on (N-1)", () => {
  it("is not claimed again for that account, still is for another, and a clear forgets it", () => {
    const s = memory();
    saveToken(TOKEN, s);
    expect(isTokenDismissedFor(TOKEN, "user-a", s)).toBe(false);
    dismissTokenFor(TOKEN, "user-a", s);
    expect(isTokenDismissedFor(TOKEN, "user-a", s)).toBe(true);
    expect(isTokenDismissedFor(TOKEN, "user-b", s)).toBe(false);
    expect(isTokenDismissedFor(`${TOKEN.slice(0, 42)}Z`, "user-a", s)).toBe(false);
    expect(savedToken(s)).toBe(TOKEN);
    clearToken(s);
    expect(isTokenDismissedFor(TOKEN, "user-a", s)).toBe(false);
  });
  it("survives junk in storage", () => {
    const s = memory();
    s.setItem("afriklang.campaign.token.dismissed.v1", "{not json");
    expect(isTokenDismissedFor(TOKEN, "user-a", s)).toBe(false);
  });
});
