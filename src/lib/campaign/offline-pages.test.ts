import { describe, expect, it } from "vitest";
import { buildAssetUrls, offlinePaths, pagesStamp } from "./offline-pages";

describe("offline pages", () => {
  it("saves home, history, and each campaign's page and studio once", () => {
    expect(offlinePaths(["c1", "c1", "a b"])).toEqual(["/campaign", "/campaign/history", "/campaign/c1", "/campaign/c1/studio", "/campaign/a%20b", "/campaign/a%20b/studio"]);
  });
  it("caps the number of campaigns", () => {
    expect(offlinePaths(Array.from({ length: 40 }, (_, i) => `c${i}`))).toHaveLength(2 + 2 * 12);
  });
  it("keeps only the build's own files, once each (APP2-10)", () => {
    const o = "https://collect.afriklang.com";
    expect(
      buildAssetUrls([`${o}/_next/static/chunks/a.js`, "/_next/static/css/b.css", `${o}/_next/static/chunks/a.js#x`, `${o}/campaign`, "https://d.afriklang.com/_next/static/x.js", "::bad"], o),
    ).toEqual([`${o}/_next/static/chunks/a.js`, `${o}/_next/static/css/b.css`]);
  });
  it("a language change makes the saved pages stale, as a new build does (APP2-29)", () => {
    expect(pagesStamp("b1", "fr")).not.toBe(pagesStamp("b1", "en"));
    expect(pagesStamp("b1", "fr")).not.toBe(pagesStamp("b2", "fr"));
    expect(pagesStamp("b1", "")).toBe("b1");
  });
});
