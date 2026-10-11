import { describe, expect, it } from "vitest";
import { clearToken, savedToken, saveToken, tokenFromHash } from "./link-token";

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
