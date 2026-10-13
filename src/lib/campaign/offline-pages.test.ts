import { describe, expect, it } from "vitest";
import { offlinePaths } from "./offline-pages";

describe("offline pages", () => {
  it("saves home, history, and each campaign's page and studio once", () => {
    expect(offlinePaths(["c1", "c1", "a b"])).toEqual(["/campaign", "/campaign/history", "/campaign/c1", "/campaign/c1/studio", "/campaign/a%20b", "/campaign/a%20b/studio"]);
  });
  it("caps the number of campaigns", () => {
    expect(offlinePaths(Array.from({ length: 40 }, (_, i) => `c${i}`))).toHaveLength(2 + 2 * 12);
  });
});
