import { PostHog } from "posthog-node";

import { getPostHogConfig } from "./config";

let instance: PostHog | null = null;

/**
 * Lazily created server-side PostHog client (one per server), or null when no project token is
 * set (then server errors are simply not reported).
 *
 * `flushAt: 1` / `flushInterval: 0` send every event at once: the server may be frozen right
 * after the response, and a batch would be lost.
 */
export function getPostHogServer(): PostHog | null {
  const config = getPostHogConfig();
  if (!config) return null;
  instance ??= new PostHog(config.token, { host: config.host, flushAt: 1, flushInterval: 0 });
  return instance;
}
