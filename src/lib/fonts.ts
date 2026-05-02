/**
 * Satoshi font family — matches the Flutter app's `assets/fonts/`.
 *
 * Loaded via `next/font/local` so Next.js self-hosts and preloads the
 * weights we use, and exposes the font-family through the CSS variable
 * `--font-satoshi` (consumed by globals.css `@theme` block).
 *
 * We declare every weight + italic combo the mobile app ships with,
 * so future screens can use w300..w900 without revisiting this file.
 */
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
