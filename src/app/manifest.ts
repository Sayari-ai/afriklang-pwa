import type { MetadataRoute } from "next";

/**
 * Web app manifest served at `/manifest.webmanifest`.
 *
 * Colors match the tinted light canvas (--color-bg-subtle in
 * globals.css). Icons are rasterized from the brand logo by
 * `scripts/generate-icons.mjs` real 192/512 PNGs because Chromium's
 * installability heuristics want bitmaps and iOS ignores SVG icons
 * entirely. The SVG stays as a scalable extra for browsers that
 * prefer it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Stable app identity: keeps the installed app tied to this
    // manifest even if start_url gains query params later.
    id: "/",
    name: "Afriklang",
    short_name: "Afriklang",
    description:
      "Learn African languages through bite-sized, gamified speaking lessons.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F5FB",
    theme_color: "#F7F5FB",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Maskable pair: the logo's sound bars sit inside the centered
      // 80% safe circle, the white tile provides the mask bleed.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // Scalable brand mark for engines that support SVG manifest icons.
      {
        src: "/icons/Logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
