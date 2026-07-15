import { useId, type ReactNode } from "react";

import { GameColors } from "@/lib/colors";

/**
 * RibbonBanner — the green ribbon from the mockup (score banner /
 * panel title). Stretchy SVG backdrop (folded tails behind, lit
 * band in front) with real centered text on top so i18n strings of
 * any length keep working.
 *
 * SVG colors are hex from `GameColors` (presentation attributes
 * don't resolve CSS `var()`).
 *
 * Size it from the outside (width/height via className); the SVG
 * stretches to fill. Text uses the game display face with a deep
 * green outline.
 */
export function RibbonBanner({
  children,
  className,
  textClassName,
}: {
  children: ReactNode;
  className?: string;
  textClassName?: string;
}) {
  const bandGrad = `rb-band-${useId()}`;
  return (
    <div className={`relative ${className ?? ""}`}>
      <svg
        viewBox="0 0 260 64"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        style={{ filter: "drop-shadow(0 3px 2px rgba(0,0,0,0.3))" }}
      >
        {/* Tails (behind, darker). */}
        <path d="M32 14 L4 23 L13 33 L5 44 L32 50 Z" fill={GameColors.ribbonDark} />
        <path d="M228 14 L256 23 L247 33 L255 44 L228 50 Z" fill={GameColors.ribbonDark} />
        {/* Fold-back triangles under the band ends. */}
        <path d="M32 51 L32 60 L45 51 Z" fill={GameColors.grassDeep} />
        <path d="M228 51 L228 60 L215 51 Z" fill={GameColors.grassDeep} />
        {/* Main band. */}
        <rect
          x="26"
          y="5"
          width="208"
          height="47"
          rx="11"
          fill={`url(#${bandGrad})`}
        />
        {/* Top gloss + bottom shade. */}
        <rect x="35" y="10" width="190" height="9" rx="4.5" fill="rgba(255,255,255,0.38)" />
        <rect x="31" y="43" width="198" height="7" rx="3.5" fill="rgba(76,143,47,0.35)" />
        <defs>
          <linearGradient id={bandGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GameColors.ribbonLight} />
            <stop offset="100%" stopColor={GameColors.ribbonMid} />
          </linearGradient>
        </defs>
      </svg>
      <span
        className={`text-outline relative z-10 flex h-full w-full items-center justify-center px-[14%] text-center font-game leading-none text-cream ${
          textClassName ?? "text-[18px]"
        }`}
        style={{ "--outline-color": "var(--color-grass-deep)" } as React.CSSProperties}
      >
        {children}
      </span>
    </div>
  );
}
