import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./safe-url";

describe("safeExternalUrl", () => {
  it("keeps http(s) addresses", () => {
    expect(safeExternalUrl("https://afriklang.com/consent/v2")).toBe("https://afriklang.com/consent/v2");
    expect(safeExternalUrl(" http://example.com ")).toBe("http://example.com/");
  });

  it("drops script, data and relative addresses", () => {
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "/consent", "//evil.example", "", null, undefined]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });
});
