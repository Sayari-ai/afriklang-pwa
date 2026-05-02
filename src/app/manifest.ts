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
    description:
      "Learn African languages through bite-sized, gamified speaking lessons.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#00539F",
    theme_color: "#00539F",
    icons: [
      // SVG placeholders — fully scalable, replace with real PNG/ICO
      // exports of the Afriklang logo at 192/512 once artwork lands.
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
