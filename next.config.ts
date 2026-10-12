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
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    // Keep the previous service worker until clients have reloaded so
    // open tabs don't break mid-session on deploy.
    skipWaiting: false,
    // Don't try to cache the Next.js dev/HMR assets.
    disableDevLogs: true,
  },
});

// Security headers on every response. The CSP only sets directives that cannot break the app
// (no script-src: Next's inline bootstrap scripts would need nonces first).
//   - frame-ancestors / X-Frame-Options: no framing, so no clickjacking of the record/consent
//     buttons and no "paste this into the page" tricks inside a look-alike frame.
//   - base-uri / object-src / form-action: close the classic injection footholds.
//   - Permissions-Policy: the microphone for this origin only; camera and location off.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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
