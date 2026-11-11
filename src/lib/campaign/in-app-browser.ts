/**
 * Pages opened inside another app (Facebook, Instagram, Messenger, an Android WebView such as
 * some WhatsApp or mail apps use) cannot do Google sign-in: Google refuses embedded browsers
 * ("disallowed_useragent"). The sign-in card then says to open the page in Chrome or Safari.
 */
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|WhatsApp|Line\/|MicroMessenger|; wv\)|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Snapchat|Twitter|Telegram/i;

/**
 * iPhone and iPad apps (TikTok, Telegram, LinkedIn, X…) open links in a web view whose user agent
 * has no "Safari/" token, unlike Safari, Chrome, Firefox and Edge on iOS (APP2-23). The app added
 * to the Home Screen has none either: `standalone` leaves it out.
 */
const IOS_WEBVIEW = (ua: string) => /iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua);

function runningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** `standalone`: the app runs from the Home Screen (read from the browser when not given). */
export function isInAppBrowser(userAgent: string | null | undefined, opts: { standalone?: boolean } = {}): boolean {
  if (!userAgent) return false;
  if (IN_APP.test(userAgent)) return true;
  return IOS_WEBVIEW(userAgent) && !(opts.standalone ?? runningStandalone());
}
