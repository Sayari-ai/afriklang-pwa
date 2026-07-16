import type { CSSProperties } from "react";

import { GameColors } from "@/lib/colors";

/**
 * Grass decorations for the wood-and-grass game kit.
 *
 * Every wooden element in the mockup (buttons, medallions, panels)
 * sits in a little bush: two-tone grass clumps poke out from behind
 * the wood. We recreate that with a single hand-drawn SVG clump
 * (dark blades behind, light blades in front) that gets positioned,
 * rotated, and scaled by two arrangement helpers:
 *
 *   - <GrassRing />  clumps around a circle (medallions, icon buttons)
 *   - <GrassEdge />  clumps along the edges of a pill/panel
 *
 * Colors are hex from `GameColors` (not CSS vars) because SVG
 * presentation attributes don't resolve `var()`.
 *
 * All grass layers are decorative: aria-hidden + pointer-events-none.
 * Place them *before* the wood layers inside a `relative isolate`
 * container so the wood body covers the blade roots.
 */

export function GrassClump({
  className,
  style,
  flip = false,
}: {
  className?: string;
  style?: CSSProperties;
  /** Mirror horizontally for variety. */
  flip?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 40 26"
      aria-hidden="true"
      className={className}
      style={{
        ...style,
        transform: `${style?.transform ?? ""}${flip ? " scaleX(-1)" : ""}`,
      }}
    >
      {/* Dark blades (behind) */}
      <g fill={GameColors.grassDark}>
        <path d="M4 26 C3 17 5.5 9.5 12 4 C9.5 11 8.5 18 9.5 26 Z" />
        <path d="M29 26 C30 15 33.5 9 39 5.5 C35.5 12 34 19 33.5 26 Z" />
        <path d="M17 26 C16.5 16 18 8 21 2.5 C22.5 9 21.5 18 20.5 26 Z" />
      </g>
      {/* Light blades (front) */}
      <g fill={GameColors.grassLight}>
        <path d="M8.5 26 C8.5 18 10.5 12 15 8 C13.5 14 12.5 20 12.5 26 Z" />
        <path d="M13.5 26 C13 14.5 15.5 6.5 19.5 0 C21 7.5 19.5 17 18 26 Z" />
        <path d="M22 26 C23 16 26.5 10 31.5 6.5 C28.5 13 26.5 20 25.5 26 Z" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Circle arrangement                                                 */
/* ------------------------------------------------------------------ */

/**
 * Hand-tuned irregular angles (deg, 0 = up) + per-clump scale so the
 * ring doesn't look mechanical. Rendered by rotating a full-size
 * wrapper and pinning the clump at its top edge, pointing outward.
 */
const RING_TUFTS: ReadonlyArray<{ angle: number; h: string; flip?: boolean }> =
  [
    { angle: -144, h: "30%" },
    { angle: -85, h: "34%", flip: true },
    { angle: -32, h: "30%" },
    { angle: 18, h: "33%" },
    { angle: 64, h: "29%", flip: true },
    { angle: 116, h: "33%" },
    { angle: 168, h: "30%", flip: true },
  ];

export function GrassRing({
  className,
  inset = "6%",
}: {
  className?: string;
  /** How far the ring sits inside the container (roots stay hidden). */
  inset?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute -z-10 ${className ?? ""}`}
      style={{ inset }}
    >
      {RING_TUFTS.map((t, i) => (
        <div
          key={i}
          className="absolute inset-0"
          style={{ transform: `rotate(${t.angle}deg)` }}
        >
          <GrassClump
            flip={t.flip}
            className="absolute left-1/2 top-0 w-auto"
            style={{ height: t.h, transform: "translate(-50%, -55%)" }}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pill / panel edge arrangement                                      */
/* ------------------------------------------------------------------ */

interface EdgeTuft {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  rot: number;
  h: string;
  flip?: boolean;
}

/** Buttons: clumps burst out above, below and at both ends. */
const PILL_TUFTS: ReadonlyArray<EdgeTuft> = [
  { left: "6%", top: "-32%", rot: -16, h: "52%" },
  { left: "27%", top: "-42%", rot: 6, h: "58%", flip: true },
  { left: "60%", top: "-36%", rot: -6, h: "52%" },
  { left: "82%", top: "-28%", rot: 18, h: "48%", flip: true },
  { left: "-3.5%", top: "26%", rot: -74, h: "50%" },
  { right: "-3.5%", top: "24%", rot: 74, h: "50%", flip: true },
  { left: "10%", bottom: "-26%", rot: 192, h: "48%", flip: true },
  { left: "42%", bottom: "-32%", rot: 176, h: "54%" },
  { left: "72%", bottom: "-24%", rot: 188, h: "46%" },
];

/** Panels: sparser clumps hugging the corners + mid edges. */
const PANEL_TUFTS: ReadonlyArray<EdgeTuft> = [
  { left: "4%", top: "-2.5%", rot: -18, h: "7%" },
  { left: "34%", top: "-3%", rot: 4, h: "7.5%", flip: true },
  { left: "70%", top: "-2.5%", rot: 12, h: "7%" },
  { left: "-3%", top: "16%", rot: -70, h: "7%", flip: true },
  { right: "-3%", top: "22%", rot: 70, h: "7%" },
  { left: "-3%", top: "62%", rot: -102, h: "7%" },
  { right: "-3%", top: "58%", rot: 104, h: "7%", flip: true },
  { left: "8%", bottom: "-2.5%", rot: 196, h: "7.5%" },
  { left: "38%", bottom: "-3%", rot: 178, h: "8%", flip: true },
  { left: "66%", bottom: "-2.5%", rot: 186, h: "7.5%" },
  { left: "88%", bottom: "-2%", rot: 168, h: "6.5%", flip: true },
];

export function GrassEdge({
  variant = "pill",
  className,
}: {
  variant?: "pill" | "panel";
  className?: string;
}) {
  const tufts = variant === "pill" ? PILL_TUFTS : PANEL_TUFTS;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 ${className ?? ""}`}
    >
      {tufts.map((t, i) => (
        <GrassClump
          key={i}
          flip={t.flip}
          className="absolute w-auto"
          style={{
            left: t.left,
            right: t.right,
            top: t.top,
            bottom: t.bottom,
            height: t.h,
            transform: `rotate(${t.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
