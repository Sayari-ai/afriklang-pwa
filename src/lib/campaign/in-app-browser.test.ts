import { describe, expect, it } from "vitest";
import { isInAppBrowser } from "./in-app-browser";

describe("isInAppBrowser", () => {
  it("spots the in-app browsers Google refuses", () => {
    for (const ua of [
      "Mozilla/5.0 (Linux; Android 12; SM-A125F Build/SP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]",
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36 Instagram 309.0",
    ])
      expect(isInAppBrowser(ua), ua).toBe(true);
  });
  it("leaves real browsers alone", () => {
    for (const ua of [
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "",
    ])
      expect(isInAppBrowser(ua), ua).toBe(false);
    expect(isInAppBrowser(null)).toBe(false);
  });
  it("spots iPhone in-app web views (TikTok, Telegram, LinkedIn…) but not the app on the Home Screen (APP2-23)", () => {
    const wkwebview = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(isInAppBrowser(wkwebview, { standalone: false })).toBe(true);
    expect(isInAppBrowser(wkwebview, { standalone: true })).toBe(false);
    expect(isInAppBrowser(`${wkwebview} LinkedInApp`, { standalone: false })).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36 trill_310 BytedanceWebview/d8a21c6")).toBe(true);
    // Chrome, Firefox and Edge on iPhone carry Safari/: real browsers
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.109 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/119.0 Mobile/15E148 Safari/605.1.15",
    ])
      expect(isInAppBrowser(ua, { standalone: false }), ua).toBe(false);
  });
});
