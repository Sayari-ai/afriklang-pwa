/**
 * Client-side instrumentation. Next.js runs this file after the HTML loads and before React
 * hydrates: the moment to start catching unhandled exceptions. Without a PostHog token (or on
 * localhost, unless NEXT_PUBLIC_POSTHOG_DEBUG=1) nothing starts and nothing is sent.
 */
import { initPostHog } from "@/lib/analytics/init";

try {
  initPostHog();
} catch {
  // Monitoring must never stop the app from starting.
}
