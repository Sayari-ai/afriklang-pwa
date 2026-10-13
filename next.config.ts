import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin: defaults to picking up `./src/i18n/request.ts`.
// We pass the path explicitly so the relationship is greppable.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// PWA wrapper: only emits the service worker + workbox runtime in
// production builds. `dev` keeps Fast Refresh fast and predictable.
//
// Service worker is written to `public/sw.js`; the manifest lives at
// `src/app/manifest.ts` (Next will serve it at `/manifest.webmanifest`).
//
// Offline launch (APP-002). The speaker app is used where the network is
// absent for days, so documents must open from the cache long after the
// last online visit:
//   - Navigations: NetworkFirst with a 4 s network timeout (so "lie-fi"
//     falls back quickly), no age limit, and one cache entry per path
//     (the query is dropped from the key: `/studio?m=X` reads `m` in the
//     browser, so any saved copy of the studio serves every mission).
//   - The campaign shell saves the speaker's pages ahead of time
//     (src/lib/campaign/offline-pages.ts), so a campaign never opened
//     online still opens offline. Those fetches carry `X-Afk-Warm: 1`.
//   - A page that was never saved falls back to `/~offline`, which links
//     to the saved missions.
//   - No special start-url cache: `/campaign` (the manifest's start_url) is
//     a navigation like the others. Precaching it would freeze its HTML
//     (and its language) until the next deploy.
//   - `reloadOnOnline: false`: next-pwa would otherwise reload the page
//     when the network comes back, killing a take being recorded.
const navigationCacheKey = {
  // Inlined into the generated sw.js: must not use anything from this file's scope.
  cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    url.search = "";
    url.hash = "";
    return url.href;
  },
};
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  cacheStartUrl: false,
  dynamicStartUrl: false,
  reloadOnOnline: false,
  fallbacks: { document: "/~offline" },
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    // Keep the previous service worker until clients have reloaded so
    // open tabs don't break mid-session on deploy.
    skipWaiting: false,
    // Don't try to cache the Next.js dev/HMR assets.
    disableDevLogs: true,
    runtimeCaching: [
      // Other origins (Supabase Auth, the campaign bridge): never cached. The default caches
      // cross-origin GETs for an hour, which would keep account answers on the phone.
      { urlPattern: ({ sameOrigin }) => !sameOrigin, handler: "NetworkOnly", options: { cacheName: "cross-origin" } },
      // Client navigations (React Server Component payloads). On failure Next falls back to a
      // full page load, which the "pages" cache below serves.
      {
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          sameOrigin && request.headers.get("RSC") === "1" && request.headers.get("Next-Router-Prefetch") === "1" && !pathname.startsWith("/api/"),
        handler: "NetworkFirst",
        options: { cacheName: "pages-rsc-prefetch", networkTimeoutSeconds: 4, expiration: { maxEntries: 32, maxAgeSeconds: 7 * 86400 } },
      },
      {
        urlPattern: ({ request, url: { pathname }, sameOrigin }) => sameOrigin && request.headers.get("RSC") === "1" && !pathname.startsWith("/api/"),
        handler: "NetworkFirst",
        options: { cacheName: "pages-rsc", networkTimeoutSeconds: 4, expiration: { maxEntries: 32, maxAgeSeconds: 7 * 86400 } },
      },
      // Documents: page loads, and the shell's ahead-of-time saves.
      {
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          sameOrigin && !pathname.startsWith("/api/") && request.headers.get("RSC") !== "1" && (request.mode === "navigate" || request.headers.get("X-Afk-Warm") === "1"),
        handler: "NetworkFirst",
        options: { cacheName: "pages", networkTimeoutSeconds: 4, expiration: { maxEntries: 64 }, plugins: [navigationCacheKey] },
      },
    ],
  },
});

// Changes with every build: the shell refreshes its saved pages when it changes (their HTML names
// the build's script files, which the new service worker replaces).
const APP_BUILD = (process.env.AWS_COMMIT_ID ?? "").slice(0, 12) || String(Date.now());

// Security headers on every response. The CSP only sets directives that cannot break the app
// (no script-src: Next's inline bootstrap scripts would need nonces first).
//   - frame-ancestors / X-Frame-Options: no framing, so no clickjacking of the record/consent
//     buttons and no "paste this into the page" tricks inside a look-alike frame.
//   - base-uri / object-src / form-action: close the classic injection footholds.
//   - Permissions-Policy: the microphone for this origin only; camera and location off.
//   - Strict-Transport-Security, Cross-Origin-Opener-Policy (APP-023). A nonce-based script-src
//     (as the dashboard has) is still to do.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  // HTTPS only, for two years, subdomains included (ignored by browsers on plain-http localhost).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // No other site's window keeps a handle on ours (Google sign-in is a redirect, not a popup).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_BUILD: APP_BUILD },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The retired learning app's addresses (APP-010) lead to the speaker app. Temporary (307), so a
  // browser does not keep them for ever; the query (a sign-in ?code=) is passed on.
  async redirects() {
    const old = ["/home", "/leaderboard", "/notifications", "/profile", "/login", "/onboarding", "/consent", "/path-setup", "/level/:path*"];
    return old.map((source) => ({ source, destination: "/campaign", permanent: false }));
  },
  // LAN dev access: when running `next dev` and hitting the dev
  // server from another device on the local network (phone, tablet)
  // Next 15+ rejects the request unless the origin is allow-listed.
  // Keep this list small and only for local dev production
  // deployments don't go through this path.
  //
  // (Previously this was set via a stray `module.exports = { ... }`
  // block above the real config. That assignment ran at load time
  // and clobbered the module's exports *before* the wrapped
  // `export default` below could attach the next-intl plugin 
  // which manifested as `Couldn't find next-intl config file` at
  // request time. Folding the option into the real config fixes it.)
  allowedDevOrigins: ["192.168.100.17"],
  // Allow the network image cells served from the Supabase storage
  // bucket. Same domain set the Flutter app fetches from.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

// Order matters: i18n inner, PWA outer. PWA needs to wrap the final
// resolved config so its webpack plugin sees all transformations.
export default withPWA(withNextIntl(nextConfig));
