import type { CSSProperties } from "react";

import { Palette } from "@/lib/colors";

/**
 * Star + StarRating flat redraw of the earned-stars widget.
 *
 * Filled: solid yellow with a darker yellow edge stroke. Empty: light
 * gray silhouette with a gray edge. No gradients, no gloss the flat
 * game look. Colors are hex from `Palette` (SVG attributes don't
 * resolve CSS `var()`).
 *
 * <StarRating /> keeps the classic 3-star arc: bigger raised middle
 * star, slight overlap, side stars tilted inward.
 */

const STAR_PATH =
  "M24 3.5 L29.8 15.6 L43 17.1 L33.2 26.2 L35.9 39.3 L24 32.7 L12.1 39.3 L14.8 26.2 L5 17.1 L18.2 15.6 Z";

/** Intrinsic aspect ratio of the star viewBox (48 × 44). */
const STAR_RATIO = 44 / 48;

export function Star({
  filled = true,
  className,
  style,
}: {
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="0 0 48 44" aria-hidden="true" className={className} style={style}>
      {/* Fat round-join edge stroke behind the body. */}
      <path
        d={STAR_PATH}
        fill="none"
        stroke={filled ? Palette.yellowDeep : Palette.textFaint}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path
        d={STAR_PATH}
        fill={filled ? Palette.yellow : Palette.border}
        stroke={filled ? Palette.yellow : Palette.border}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StarRating({
  filled,
  size = 28,
  className,
}: {
  /** Number of earned stars, 0-3. */
  filled: number;
  /** Side-star width in px; the middle star is 1.45× and raised. */
  size?: number;
  className?: string;
}) {
  const n = Math.max(0, Math.min(3, filled));
  const mid = Math.round(size * 1.45);
  const overlap = Math.round(size * 0.16);
  return (
    <div
      className={`flex items-end justify-center ${className ?? ""}`}
      role="img"
      aria-label={`${n}/3`}
    >
      <Star
        filled={n >= 1}
        className="relative z-0"
        style={{
          width: size,
          height: size * STAR_RATIO,
          marginRight: -overlap,
          transform: "rotate(-14deg) translateY(-12%)",
        }}
      />
      <Star
        filled={n >= 2}
        className="relative z-10"
        style={{
          width: mid,
          height: mid * STAR_RATIO,
          transform: "translateY(-8%)",
        }}
      />
      <Star
        filled={n >= 3}
        className="relative z-0"
        style={{
          width: size,
          height: size * STAR_RATIO,
          marginLeft: -overlap,
          transform: "rotate(14deg) translateY(-12%)",
        }}
      />
    </div>
  );
}
