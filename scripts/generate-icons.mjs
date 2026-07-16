/**
 * Generate PWA raster icons from the brand logo.
 *
 * Why: the manifest previously shipped SVG-only icons. iOS ignores
 * SVG entirely (home-screen icon fell back to a screenshot), and
 * Chromium's installability heuristics want real 192px + 512px
 * bitmaps. This script rasterizes `public/icons/Logo.svg` (white
 * tile, deep-purple sound bars its artwork already sits inside the
 * maskable 80% safe zone) into every size the platforms need.
 *
 * Run:  node scripts/generate-icons.mjs
 * Deps: sharp (already present transitively via Next).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/icons/Logo.svg");
const OUT = path.join(ROOT, "public/icons");

/** [filename, size] all rendered from the same source. */
const TARGETS = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  // Same artwork works for the maskable slot: the bars stay inside
  // the centered 80% circle, the white tile provides the bleed.
  ["icon-maskable-192.png", 192],
  ["icon-maskable-512.png", 512],
  // iOS home-screen icon (apple-touch-icon must be opaque PNG).
  ["apple-touch-icon.png", 180],
];

const svg = await readFile(SRC);

for (const [name, size] of TARGETS) {
  // density: scale librsvg's 72dpi default so the 512-unit viewBox
  // rasterizes at the target size without a blurry upscale.
  const density = (72 * size) / 512;
  await sharp(svg, { density })
    .resize(size, size)
    .flatten({ background: "#FFFFFF" }) // guarantee opacity (iOS)
    .png()
    .toFile(path.join(OUT, name));
  console.log(`✓ ${name} (${size}x${size})`);
}
