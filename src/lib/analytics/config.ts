/**
 * PostHog configuration shared by the client (`instrumentation-client.ts`) and the server
 * (`analytics/server.ts`). Every Afriklang app sends to the same PostHog project; this one tags
 * its events with `app: "speaker-app"`.
 *
 * Both values are `NEXT_PUBLIC_*`, inlined into the client bundle at build time (Amplify also
 * copies them into `.env.production`, which the SSR compute reads).
 *
 * The project key is PostHog's public client key: it ships inside every page of every Afriklang
 * site, so it is the built-in default and the app reports without any hosting setup. The env
 * variable overrides it; "off" turns PostHog off (nothing loaded, nothing sent).
 */

export const APP_NAME = "speaker-app";

/** Public project key of the shared Afriklang PostHog project (653233, US). Not a secret. */
export const DEFAULT_POSTHOG_PROJECT_TOKEN = "phc_nhiGG8VPu6FueQpk9GJ3wAZ9suPjoSKqCaWPEAfKdKS3";

/** The reverse proxy the public site uses (it forwards to PostHog US Cloud). */
export const DEFAULT_POSTHOG_HOST = "https://d.afriklang.com";
/** Where links from the SDK (toolbar, replay) open: the PostHog app itself, not the proxy. */
export const POSTHOG_UI_HOST = "https://us.posthog.com";

export type PostHogConfig = { token: string; host: string; debug: boolean };

type Env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?: string; NEXT_PUBLIC_POSTHOG_HOST?: string; NEXT_PUBLIC_POSTHOG_DEBUG?: string };

// Each variable is named in full so Next inlines it into the client bundle.
const fromProcess = (): Env => ({
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_POSTHOG_DEBUG: process.env.NEXT_PUBLIC_POSTHOG_DEBUG,
});

/** The configuration, or null when PostHog is turned off (`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=off`). */
export function getPostHogConfig(env: Env = fromProcess()): PostHogConfig | null {
  const set = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (set?.toLowerCase() === "off") return null;
  const token = set || DEFAULT_POSTHOG_PROJECT_TOKEN;
  return {
    token,
    host: (env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/+$/, ""),
    debug: env.NEXT_PUBLIC_POSTHOG_DEBUG === "1",
  };
}

/** A development machine: PostHog stays off there unless NEXT_PUBLIC_POSTHOG_DEBUG=1. */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h === "0.0.0.0" || h.endsWith(".localhost");
}

/** Whether the browser SDK should start on this page. */
export function shouldRunInBrowser(config: PostHogConfig | null, hostname: string): config is PostHogConfig {
  return config !== null && (config.debug || !isLocalHostname(hostname));
}
