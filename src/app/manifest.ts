import type { MetadataRoute } from "next";

/**
 * Web app manifest served at `/manifest.webmanifest`.
 *
 * Brand color matches the Flutter mobile app (#00539F). Icons reference
 * the placeholder set under `public/icons`; replace those PNGs with the
 * real Afriklang artwork when assets land.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Afriklang",
    short_name: "Afriklang",
    description: "Record your language for Afriklang: missions, recording studio and history.",
    start_url: "/campaign",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#00539F",
    theme_color: "#00539F",
    shortcuts: [
      { name: "My missions", short_name: "Missions", url: "/campaign" },
      { name: "My history", short_name: "History", url: "/campaign/history" },
    ],
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
