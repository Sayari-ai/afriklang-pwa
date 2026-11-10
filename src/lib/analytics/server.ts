import { PostHog } from "posthog-node";

import { getPostHogConfig } from "./config";

let instance: PostHog | null = null;

/**
 * Lazily created server-side PostHog client (one per server), or null outside a production
 * server or when PostHog is turned off (then server errors are simply not reported): a
 * developer's `next dev` never reports to the shared project.
 *
 * `flushAt: 1` / `flushInterval: 0` send every event at once: the server may be frozen right
 * after the response, and a batch would be lost.
 */
export function getPostHogServer(): PostHog | null {
  if (process.env.NODE_ENV !== "production") return null;
  const config = getPostHogConfig();
  if (!config) return null;
  instance ??= new PostHog(config.token, { host: config.host, flushAt: 1, flushInterval: 0 });
  return instance;
}
