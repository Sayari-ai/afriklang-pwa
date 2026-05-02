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

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
