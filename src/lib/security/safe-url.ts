/**
 * Returns `raw` only when it is an absolute http(s) URL, else null.
 *
 * For links whose address comes from the server (e.g. a consent text URL typed by an admin on
 * the dashboard): a `javascript:` or `data:` address must never reach an `href`.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
