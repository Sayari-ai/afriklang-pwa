import { useId, type CSSProperties } from "react";

import { GameColors } from "@/lib/colors";

/**
 * Hearts the mockup's glossy lives row: shiny red hearts with a
 * dark rim, and chocolate-dark "spent" hearts. Colors are hex from
 * `GameColors` (SVG attributes don't resolve CSS `var()`).
 *
 * No lives mechanic is wired into the app yet this ships as part
 * of the game kit so future features (attempt limits, streak
 * shields...) can drop it in without redesign work.
 */

const HEART_PATH =
  "M16 28.5 C7 21.5 2.2 15.6 2.2 10.2 C2.2 5.6 5.9 2 10.4 2 C12.8 2 15 3.2 16 5.1 C17 3.2 19.2 2 21.6 2 C26.1 2 29.8 5.6 29.8 10.2 C29.8 15.6 25 21.5 16 28.5 Z";

export function GameHeart({
  filled = true,
  className,
  style,
}: {
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const grad = `gh-${useId()}`;
  return (
    <svg
      viewBox="0 0 32 31"
      aria-hidden="true"
      className={className}
      style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.35))", ...style }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          {filled ? (
            <>
              <stop offset="0%" stopColor="#ff8d9b" />
              <stop offset="45%" stopColor={GameColors.heartRed} />
              <stop offset="100%" stopColor="#c22b40" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#4d2f22" />
              <stop offset="100%" stopColor={GameColors.heartEmpty} />
            </>
          )}
        </linearGradient>
      </defs>
      <path
        d={HEART_PATH}
        fill={`url(#${grad})`}
        stroke={filled ? "#7a1a26" : "#2b1812"}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {filled && (
        <ellipse
          cx="10.5"
          cy="9"
          rx="4.2"
          ry="3"
          transform="rotate(-24 10.5 9)"
          fill="rgba(255,255,255,0.55)"
        />
      )}
    </svg>
  );
}

export function Hearts({
  total = 3,
  filled,
  size = 26,
  className,
}: {
  total?: number;
  filled: number;
  /** Heart width in px. */
  size?: number;
  className?: string;
}) {
  const n = Math.max(0, Math.min(total, filled));
  return (
    <div
      className={`flex items-center gap-1 ${className ?? ""}`}
      role="img"
      aria-label={`${n}/${total}`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <GameHeart
          key={i}
          filled={i < n}
          style={{ width: size, height: size * (31 / 32) }}
        />
      ))}
    </div>
  );
}
