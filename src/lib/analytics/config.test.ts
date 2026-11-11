import { describe, expect, it } from "vitest";
import { environmentFor } from "./config";

describe("environmentFor (APP2-27)", () => {
  it("tags production, previews and local machines apart", () => {
    expect(environmentFor("collect.afriklang.com")).toBe("production");
    expect(environmentFor("COLLECT.afriklang.com")).toBe("production");
    expect(environmentFor("dev.d1abc.amplifyapp.com")).toBe("preview");
    expect(environmentFor("localhost")).toBe("local");
  });
});
