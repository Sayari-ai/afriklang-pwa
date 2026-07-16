import type { MetadataRoute } from "next";

/**
 * Web app manifest served at `/manifest.webmanifest`.
 *
 * Colors match the flat light theme (white surface see --color-bg
 * in globals.css). Icons reference the placeholder set under
 * `public/icons`; replace those PNGs with the real Afriklang artwork
 * when assets land.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
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
      // Afriklang brand logo. SVG is fully scalable so a single asset
      // covers every install surface (home screen, app switcher, etc.).
      {
        src: "/icons/Logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      // Reuse the same logo for the maskable slot. Note: Android masks
      // crop the outer ~10% of maskable icons, so if the Logo lacks a
      // safe-zone padding, swap this to a padded export when available.
      {
        src: "/icons/Logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
