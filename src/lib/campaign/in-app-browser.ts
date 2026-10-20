/**
 * Pages opened inside another app (Facebook, Instagram, Messenger, an Android WebView such as
 * some WhatsApp or mail apps use) cannot do Google sign-in: Google refuses embedded browsers
 * ("disallowed_useragent"). The sign-in card then says to open the page in Chrome or Safari.
 */
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|WhatsApp|Line\/|MicroMessenger|; wv\)/i;

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && IN_APP.test(userAgent));
}
