/**
 * Satoshi font family matches the Flutter app's `assets/fonts/`.
 *
 * Loaded via `next/font/local` so Next.js self-hosts and preloads the
 * weights we use, and exposes the font-family through the CSS variable
 * `--font-satoshi` (consumed by globals.css `@theme` block).
 *
 * We declare every weight + italic combo the mobile app ships with,
 * so future screens can use w300..w900 without revisiting this file.
 */
import { Lilita_One } from "next/font/google";
import localFont from "next/font/local";

export const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    { path: "../../public/fonts/Satoshi-Light.otf",       weight: "300", style: "normal" },
    { path: "../../public/fonts/Satoshi-LightItalic.otf", weight: "300", style: "italic" },
    { path: "../../public/fonts/Satoshi-Regular.otf",     weight: "400", style: "normal" },
    { path: "../../public/fonts/Satoshi-Italic.otf",      weight: "400", style: "italic" },
    { path: "../../public/fonts/Satoshi-Medium.otf",      weight: "500", style: "normal" },
    { path: "../../public/fonts/Satoshi-MediumItalic.otf", weight: "500", style: "italic" },
    { path: "../../public/fonts/Satoshi-Bold.otf",        weight: "700", style: "normal" },
    { path: "../../public/fonts/Satoshi-BoldItalic.otf",  weight: "700", style: "italic" },
    { path: "../../public/fonts/Satoshi-Black.otf",       weight: "900", style: "normal" },
    { path: "../../public/fonts/Satoshi-BlackItalic.otf", weight: "900", style: "italic" },
  ],
});

/**
 * Lilita One the chunky rounded "game" display face used by the
 * wood-and-grass UI kit (button labels, level numerals, scores,
 * ribbon titles). Single weight (400) by design: the glyphs are
 * already fat, and the outlined look comes from the `text-outline`
 * utility in globals.css, not from font weight.
 *
 * Exposed as `--font-lilita`, mapped to the Tailwind `font-game`
 * utility via the `--font-game` @theme token.
 */
export const lilita = Lilita_One({
  variable: "--font-lilita",
  display: "swap",
  weight: "400",
  subsets: ["latin", "latin-ext"],
});
