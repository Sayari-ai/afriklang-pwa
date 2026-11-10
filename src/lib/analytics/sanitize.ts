/**
 * What must never reach PostHog in a URL.
 *
 *   - The fragment: the invitation link carries its one-time token there (link-token.ts strips it
 *     in a React effect, but the SDK starts before React and its first pageview would carry it).
 *   - Sign-in leftovers in the query: the OAuth `code`, tokens, and the provider's error text.
 *
 * Pure: unit tested.
 */

const SECRET_PARAMS = new Set(["code", "state", "token", "access_token", "refresh_token", "id_token", "provider_token", "provider_refresh_token", "error_description", "email"]);

/** The URL without its fragment and without secret query parameters. Not a URL: unchanged. */
export function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Unparseable: at least cut the fragment.
    return value.split("#")[0];
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (SECRET_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  return url.toString();
}

const isUrlKey = (key: string) => /url|referrer|href/i.test(key);

/** Sanitize, in place, every URL-like string property of a property bag. */
function sanitizeBag(bag: unknown): void {
  if (!bag || typeof bag !== "object") return;
  const record = bag as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) if (typeof value === "string" && isUrlKey(key)) record[key] = sanitizeUrl(value);
}

/** An event as `before_send` gets it (only the parts read here). */
export type EventLike = { event?: string; properties?: Record<string, unknown> | null; $set?: Record<string, unknown> | null; $set_once?: Record<string, unknown> | null };

/** Clean the URLs of an event (its properties and the person properties it sets), in place. */
export function sanitizeEvent<T extends EventLike>(event: T): T {
  sanitizeBag(event.properties);
  sanitizeBag(event.properties?.$set);
  sanitizeBag(event.properties?.$set_once);
  sanitizeBag(event.$set);
  sanitizeBag(event.$set_once);
  return event;
}
