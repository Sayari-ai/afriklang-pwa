import type { Instrumentation } from "next";

export function register() {
  // No-op: the server client is created lazily in lib/analytics/server.ts.
}

/**
 * Report errors thrown in Server Components, Route Handlers (e.g. /api/audio-upload) and Server
 * Actions to PostHog error tracking. Without a project token: nothing.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const [{ getPostHogServer }, { APP_NAME }] = await Promise.all([import("@/lib/analytics/server"), import("@/lib/analytics/config")]);
    const posthog = getPostHogServer();
    if (!posthog) return;

    // Tie the error to the browser's PostHog id when its cookie is there.
    let distinctId: string | undefined;
    const rawCookie = request.headers.cookie;
    const cookie = Array.isArray(rawCookie) ? rawCookie.join("; ") : rawCookie;
    const match = cookie?.match(/ph_phc_.*?_posthog=([^;]+)/);
    if (match?.[1]) {
      try {
        distinctId = JSON.parse(decodeURIComponent(match[1])).distinct_id;
      } catch {
        // malformed cookie: reported as anonymous
      }
    }

    await posthog.captureExceptionImmediate(err, distinctId, {
      app: APP_NAME,
      app_build: process.env.NEXT_PUBLIC_APP_BUILD,
      // The path only: no query (a sign-in code) reaches PostHog.
      path: request.path.split("?")[0],
      method: request.method,
      route_path: context.routePath,
      route_type: context.routeType,
      router_kind: context.routerKind,
      digest: (err as { digest?: string }).digest,
    });
  } catch {
    // Error reporting must never throw out of the request-error hook.
  }
};
