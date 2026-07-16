/**
 * Nunito the single font family of the Duolingo-inspired redesign.
 *
 * One chunky rounded face for everything (Duolingo uses its
 * proprietary "Feather Bold" the same way): body copy at 400-700,
 * headings / buttons / numerals at 800-900. Loaded via
 * `next/font/google` as a variable font so every weight in the
 * 200-1000 range is available without extra requests.
 *
 * Exposed through `--font-nunito`, consumed by globals.css as
 * `--font-sans` (the default and only face).
 */
import { Nunito } from "next/font/google";

export const nunito = Nunito({
  variable: "--font-nunito",
  display: "swap",
  subsets: ["latin", "latin-ext"],
});
