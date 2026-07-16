import { useId, type CSSProperties } from "react";

import { GameColors } from "@/lib/colors";

/**
 * GameStar + StarRating the mockup's chunky bevelled stars.
 *
 * Filled: gold→orange gradient body with a darker orange rim and a
 * white gloss wedge. Empty: dark chocolate silhouette (the mockup's
 * "unearned" state). Rounded joins come from stroking the same path
 * with a fat round-join stroke, so no hand-rounded path is needed.
 * Colors are hex from `GameColors` (SVG attributes don't resolve
 * CSS `var()`).
 *
 * <StarRating /> lays out the classic 3-star arc: bigger raised
 * middle star, slight overlap, side stars tilted inward.
 */

const STAR_PATH =
  "M24 3.5 L29.8 15.6 L43 17.1 L33.2 26.2 L35.9 39.3 L24 32.7 L12.1 39.3 L14.8 26.2 L5 17.1 L18.2 15.6 Z";

/** Intrinsic aspect ratio of the star viewBox (48 × 44). */
const STAR_RATIO = 44 / 48;

export function GameStar({
  filled = true,
  className,
  style,
}: {
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const grad = `gs-${useId()}`;
  return (
    <svg
      viewBox="0 0 48 44"
      aria-hidden="true"
      className={className}
      style={{
        filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.35))",
        ...style,
      }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          {filled ? (
            <>
              <stop offset="0%" stopColor="#ffe08a" />
              <stop offset="45%" stopColor={GameColors.starGold} />
              <stop offset="100%" stopColor={GameColors.starOrange} />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#6b4429" />
              <stop offset="100%" stopColor={GameColors.starEmpty} />
            </>
          )}
        </linearGradient>
      </defs>
      {/* Rim (fat round-join stroke behind the body). */}
      <path
        d={STAR_PATH}
        fill="none"
        stroke={filled ? GameColors.starRim : "#3a2315"}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      {/* Body. */}
      <path
        d={STAR_PATH}
        fill={`url(#${grad})`}
        stroke={`url(#${grad})`}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Gloss wedges (filled only). */}
      {filled && (
        <path
          d="M24 8.5 L27.5 16 L21 16.5 Z M13.5 19.5 L19 18.6 L15.8 23 Z"
          fill="rgba(255,255,255,0.5)"
        />
      )}
    </svg>
  );
}

export function StarRating({
  filled,
  size = 28,
  className,
}: {
  /** Number of earned stars, 0–3. */
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
      <GameStar
        filled={n >= 1}
        className="relative z-0"
        style={{
          width: size,
          height: size * STAR_RATIO,
          marginRight: -overlap,
          transform: "rotate(-14deg) translateY(-12%)",
        }}
      />
      <GameStar
        filled={n >= 2}
        className="relative z-10"
        style={{
          width: mid,
          height: mid * STAR_RATIO,
          transform: "translateY(-8%)",
        }}
      />
      <GameStar
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
