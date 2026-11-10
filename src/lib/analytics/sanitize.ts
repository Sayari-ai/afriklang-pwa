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

/**
 * Sanitize, in place, every URL string of a property bag, whatever its key, and of the plain
 * objects nested in it (the SDK keeps some, e.g. its initial person info `{ r, u }`).
 */
function sanitizeBag(bag: unknown, depth = 0): void {
  if (!bag || typeof bag !== "object" || depth > 3) return;
  const record = bag as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") record[key] = sanitizeUrl(value);
    else if (value && typeof value === "object" && !Array.isArray(value)) sanitizeBag(value, depth + 1);
  }
}

/** An event as `before_send` gets it (only the parts read here). */
export type EventLike = { event?: string; properties?: Record<string, unknown> | null; $set?: Record<string, unknown> | null; $set_once?: Record<string, unknown> | null };

/** Clean the URLs of an event (its properties and the person properties it sets), in place. */
export function sanitizeEvent<T extends EventLike>(event: T): T {
  sanitizeBag(event.properties);
  sanitizeBag(event.$set);
  sanitizeBag(event.$set_once);
  return event;
}
