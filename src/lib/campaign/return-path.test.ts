import { describe, expect, it } from "vitest";
import { RETURN_PATH_MAX_AGE_MS, isReturnPath, saveReturnPath, studioReturnPath, takeReturnPath } from "./return-path";

const ID = "00000000-0000-4000-8000-0000000000c3";
const M1 = "00000000-0000-4000-8000-e00000000101";
const M2 = "00000000-0000-4000-8000-e00000000102";
const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("return path after sign-in (E09 link)", () => {
  it("a studio path round-trips, with or without a focus, and take clears it", () => {
    const s = memory();
    const path = `/campaign/${ID}/studio?m=${M1},${M2}`;
    saveReturnPath(path, s, 1000);
    expect(takeReturnPath(s, 2000)).toBe(path);
    expect(takeReturnPath(s, 2000)).toBeNull();
    saveReturnPath(`/campaign/${ID}/studio`, s, 1000);
    expect(takeReturnPath(s, 1000)).toBe(`/campaign/${ID}/studio`);
    saveReturnPath(`/campaign/${ID}/studio?m=${M1}`, s, 1000);
    expect(takeReturnPath(s, 1000)).toBe(`/campaign/${ID}/studio?m=${M1}`);
  });

  it("is rebuilt from the campaign id and the parsed focus, never copied from the address", () => {
    // A mail client may encode the link's commas or change the case of the ids: the raw search
    // fails the shape check, and the speaker would lose the focus after sign-in.
    expect(isReturnPath(`/campaign/${ID}/studio?m=${M1}%2C${M2}`)).toBe(false);
    expect(isReturnPath(`/campaign/${ID}/studio?m=${M1.toUpperCase()}`)).toBe(false);
    const path = studioReturnPath(ID, `${M1.toUpperCase()}%2C${M2}`.replace("%2C", ","));
    expect(path).toBe(`/campaign/${ID}/studio?m=${M1},${M2}`);
    expect(studioReturnPath(ID.toUpperCase(), `${M1},${M1},${M2}`)).toBe(`/campaign/${ID}/studio?m=${M1},${M2}`);
    expect(studioReturnPath(ID, null)).toBe(`/campaign/${ID}/studio`);
    expect(studioReturnPath(ID, "")).toBe(`/campaign/${ID}/studio`);
    expect(studioReturnPath(ID, "../admin,<b>")).toBe(`/campaign/${ID}/studio`);
    const s = memory();
    saveReturnPath(path, s, 1000);
    expect(takeReturnPath(s, 2000)).toBe(path);
    // A campaign id that is not a UUID gives a path the guard refuses: nothing is stored.
    saveReturnPath(studioReturnPath("../admin", M1), s, 1000);
    expect(s.m.size).toBe(0);
  });

  it("refuses anything that is not a studio path of this app (never an open redirect)", () => {
    const bad = [
      "https://evil.example/campaign",
      `//evil.example/campaign/${ID}/studio`,
      "/campaign/x/../admin",
      "/campaign",
      `/campaign/${ID}`,
      `/campaign/${ID}/studio/../../admin`,
      `/campaign/${ID}/studio?m=${M1}&next=https://evil.example`,
      `/campaign/${ID}/studio?m=<script>`,
      `/campaign/${ID}/studio?m=${M1}#t=abc`,
      `/campaign/${ID}/studio?m=${"a".repeat(401)}`,
      `/campaign/${ID}/studio?m=abc`,
      "",
    ];
    for (const p of bad) {
      expect(isReturnPath(p), p).toBe(false);
      const s = memory();
      saveReturnPath(p, s);
      expect(s.m.size, p).toBe(0);
      expect(takeReturnPath(s)).toBeNull();
    }
  });

  it("forgets a path older than an hour, or one planted in storage", () => {
    const s = memory();
    saveReturnPath(`/campaign/${ID}/studio`, s, 1000);
    expect(takeReturnPath(s, 1000 + RETURN_PATH_MAX_AGE_MS + 1)).toBeNull();
    saveReturnPath(`/campaign/${ID}/studio`, s, 1000);
    expect(takeReturnPath(s, 1000 + RETURN_PATH_MAX_AGE_MS)).toBe(`/campaign/${ID}/studio`);
    s.setItem("afriklang.campaign.return.v1", JSON.stringify({ path: "https://evil.example", at: 1000 }));
    expect(takeReturnPath(s, 1000)).toBeNull();
    s.setItem("afriklang.campaign.return.v1", JSON.stringify({ path: `/campaign/${ID}/studio`, at: "yesterday" }));
    expect(takeReturnPath(s, 1000)).toBeNull();
    s.setItem("afriklang.campaign.return.v1", "{not json");
    expect(takeReturnPath(s, 1000)).toBeNull();
    expect(s.m.size).toBe(0);
  });

  it("works without storage and when storage throws", () => {
    expect(() => saveReturnPath(`/campaign/${ID}/studio`, null)).not.toThrow();
    expect(takeReturnPath(null)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => saveReturnPath(`/campaign/${ID}/studio`, broken)).not.toThrow();
    expect(takeReturnPath(broken)).toBeNull();
  });
});
