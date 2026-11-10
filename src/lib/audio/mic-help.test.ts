import { describe, expect, it } from "vitest";
import { micHelpFor } from "./mic-help";

describe("micHelpFor", () => {
  it("sends in-app browsers to Chrome or Safari, whatever the phone", () => {
    expect(micHelpFor("Mozilla/5.0 (Linux; Android 12; SM-A125F; wv) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36 WhatsApp")).toBe("inApp");
    expect(micHelpFor("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]")).toBe("inApp");
  });
  it("tells Android, iPhone and computers apart", () => {
    expect(micHelpFor("Mozilla/5.0 (Linux; Android 13; Infinix X6833B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("android");
    expect(micHelpFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1")).toBe("ios");
    expect(micHelpFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("desktop");
    expect(micHelpFor(undefined)).toBe("desktop");
  });
});
