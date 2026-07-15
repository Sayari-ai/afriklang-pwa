import { useId, type CSSProperties } from "react";

import { GameColors } from "@/lib/colors";

/**
 * Small hand-drawn glyphs from the game kit that lucide doesn't cover
 * in the right style: the gold coin, the energy bolt chip, and the
 * green padlock that marks locked levels.
 *
 * Colors are hex from `GameColors` (SVG presentation attributes /
 * gradient stops don't resolve CSS `var()`).
 */

/** Gold coin with rim + gloss (resource counters, score displays). */
export function CoinIcon({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const grad = `coin-${useId()}`;
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden="true"
      className={className}
      style={{ filter: "drop-shadow(0 1.5px 1px rgba(0,0,0,0.3))", ...style }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe491" />
          <stop offset="55%" stopColor={GameColors.coinGold} />
          <stop offset="100%" stopColor="#f0ab2e" />
        </linearGradient>
      </defs>
      {/* Rim */}
      <circle cx="18" cy="18" r="16.5" fill={GameColors.coinRim} />
      {/* Face */}
      <circle cx="18" cy="17" r="14" fill={`url(#${grad})`} />
      {/* Inner ring */}
      <circle
        cx="18"
        cy="17"
        r="10"
        fill="none"
        stroke="rgba(217,142,43,0.8)"
        strokeWidth="2.5"
      />
      {/* Gloss */}
      <ellipse
        cx="13"
        cy="10.5"
        rx="5"
        ry="3"
        transform="rotate(-28 13 10.5)"
        fill="rgba(255,255,255,0.6)"
      />
    </svg>
  );
}

/** Energy bolt on a gold chip (secondary resource counter). */
export function EnergyIcon({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden="true"
      className={className}
      style={{ filter: "drop-shadow(0 1.5px 1px rgba(0,0,0,0.3))", ...style }}
    >
      <circle cx="18" cy="18" r="16.5" fill={GameColors.coinRim} />
      <circle cx="18" cy="17" r="14" fill="#3f2a18" />
      <path
        d="M20.5 6.5 L11 19.5 L17 20 L14.8 29.5 L25 16.2 L18.8 15.6 Z"
        fill={GameColors.starGold}
        stroke={GameColors.starRim}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Glossy padlock — locked level marker. Gold body + purple shackle,
 *  matching the "2D game icons" pack style. */
export function PadlockIcon({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const uid = useId();
  const bodyGrad = `lockb-${uid}`;
  const shackleGrad = `locks-${uid}`;
  return (
    <svg
      viewBox="0 0 32 38"
      aria-hidden="true"
      className={className}
      style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.4))", ...style }}
    >
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GameColors.goldLight} />
          <stop offset="45%" stopColor={GameColors.starGold} />
          <stop offset="100%" stopColor={GameColors.goldDeep} />
        </linearGradient>
        <linearGradient id={shackleGrad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={GameColors.purpleLight} />
          <stop offset="55%" stopColor={GameColors.purple} />
          <stop offset="100%" stopColor={GameColors.purpleDark} />
        </linearGradient>
      </defs>
      {/* Shackle — purple, with a dark edge and a top highlight. */}
      <path
        d="M9.5 17 V11.5 C9.5 7.4 12.4 4.5 16 4.5 C19.6 4.5 22.5 7.4 22.5 11.5 V17"
        fill="none"
        stroke={GameColors.purpleDeep}
        strokeWidth="5.6"
        strokeLinecap="round"
      />
      <path
        d="M9.5 17 V11.5 C9.5 7.4 12.4 4.5 16 4.5 C19.6 4.5 22.5 7.4 22.5 11.5 V17"
        fill="none"
        stroke={`url(#${shackleGrad})`}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M10.6 12 C10.6 8.2 13 6 16 6"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Body — gold slab with bevel + gloss. */}
      <rect
        x="4"
        y="15.5"
        width="24"
        height="19"
        rx="5.5"
        fill={`url(#${bodyGrad})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2"
      />
      <rect
        x="6.5"
        y="18"
        width="19"
        height="4"
        rx="2"
        fill="rgba(255,255,255,0.45)"
      />
      {/* Keyhole — dark bronze. */}
      <circle cx="16" cy="24" r="3" fill="#8E5410" />
      <path d="M14.4 25.5 L17.6 25.5 L18.6 31 L13.4 31 Z" fill="#8E5410" />
      <circle cx="15" cy="23" r="0.9" fill="rgba(255,255,255,0.5)" />
    </svg>
  );
}
