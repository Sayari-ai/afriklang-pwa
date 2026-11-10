/**
 * PostHog configuration shared by the client (`instrumentation-client.ts`) and the server
 * (`analytics/server.ts`). Every Afriklang app sends to the same PostHog project; this one tags
 * its events with `app: "speaker-app"`.
 *
 * Both values are `NEXT_PUBLIC_*`, inlined into the client bundle at build time (Amplify also
 * copies them into `.env.production`, which the SSR compute reads).
 *
 * No token: PostHog is a complete no-op (nothing loaded, nothing sent), in every environment.
 */

export const APP_NAME = "speaker-app";

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

/** The configuration, or null when no project token is set. */
export function getPostHogConfig(env: Env = fromProcess()): PostHogConfig | null {
  const token = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return null;
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
