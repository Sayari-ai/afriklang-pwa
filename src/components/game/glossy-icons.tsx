import { useId, type CSSProperties, type ReactNode } from "react";

import { GameColors } from "@/lib/colors";

/**
 * Glossy "2D game icons" gold + purple feature icons in the style
 * of the reference pack (lock, key, hourglass, shield, message,
 * trophy): fat bevelled shapes, warm gold gradients with bronze
 * outlines, purple accents, blue glass, white gloss highlights.
 *
 * These are FEATURE icons (empty states, headers, badges) not tiny
 * UI glyphs. Pair them with <GameIconHalo> to reproduce the pack's
 * soft lavender disc.
 *
 * All colors are hex from `GameColors` because SVG presentation
 * attributes / gradient stops don't resolve CSS `var()`. Gradient ids
 * are namespaced per instance via `useId`.
 */

/* ------------------------------------------------------------------ */
/* Halo                                                                */
/* ------------------------------------------------------------------ */

/**
 * Soft radial lavender disc behind a feature icon + a faint ground
 * shadow, like the pack's presentation tiles. Size the icon child
 * relative to the halo (e.g. `className="h-[62%] w-[62%]"`).
 */
export function GameIconHalo({
  children,
  size = 120,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {/* Lavender glow disc. */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(243,237,252,0.95) 0%, rgba(228,217,247,0.75) 52%, rgba(228,217,247,0) 72%)",
        }}
      />
      {/* Ground shadow under the icon. */}
      <span
        className="absolute rounded-full"
        style={{
          left: "26%",
          right: "26%",
          bottom: "16%",
          height: "7%",
          background: "rgba(76,43,143,0.28)",
          filter: "blur(2px)",
        }}
      />
      <span className="relative z-10 flex h-full w-full items-center justify-center">
        {children}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared gradient stops                                               */
/* ------------------------------------------------------------------ */

function GoldStops() {
  return (
    <>
      <stop offset="0%" stopColor={GameColors.goldLight} />
      <stop offset="45%" stopColor={GameColors.starGold} />
      <stop offset="100%" stopColor={GameColors.goldDeep} />
    </>
  );
}

function PurpleStops() {
  return (
    <>
      <stop offset="0%" stopColor={GameColors.purpleLight} />
      <stop offset="50%" stopColor={GameColors.purple} />
      <stop offset="100%" stopColor={GameColors.purpleDark} />
    </>
  );
}

const DROP = "drop-shadow(0 3px 3px rgba(0,0,0,0.35))";

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Key                                                                 */
/* ------------------------------------------------------------------ */

export function GameKey({ className, style }: IconProps) {
  const grad = `key-${useId()}`;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      className={className}
      style={{ filter: DROP, ...style }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <GoldStops />
        </linearGradient>
      </defs>
      <g transform="rotate(35 48 48)">
        {/* Ring head bronze edge, gold body. */}
        <circle
          cx="48"
          cy="20"
          r="13"
          fill="none"
          stroke={GameColors.goldOutline}
          strokeWidth="13.5"
        />
        <circle
          cx="48"
          cy="20"
          r="13"
          fill="none"
          stroke={`url(#${grad})`}
          strokeWidth="10"
        />
        {/* Shaft. */}
        <path
          d="M48 32 V74"
          stroke={GameColors.goldOutline}
          strokeWidth="11.5"
          strokeLinecap="round"
        />
        <path
          d="M48 32 V74"
          stroke={`url(#${grad})`}
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Teeth. */}
        <path
          d="M48 61 H58 M48 71 H56"
          stroke={GameColors.goldOutline}
          strokeWidth="9.5"
          strokeLinecap="round"
        />
        <path
          d="M48 61 H58 M48 71 H56"
          stroke={`url(#${grad})`}
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Gloss. */}
        <path
          d="M38.5 15.5 C40.5 10.5 44.5 8 48 8"
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M45.5 38 V52"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Hourglass                                                           */
/* ------------------------------------------------------------------ */

export function GameHourglass({ className, style }: IconProps) {
  const uid = useId();
  const gold = `hgg-${uid}`;
  const glass = `hgl-${uid}`;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      className={className}
      style={{ filter: DROP, ...style }}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <GoldStops />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GameColors.glassLight} />
          <stop offset="55%" stopColor="#6EC9F2" />
          <stop offset="100%" stopColor={GameColors.glassBlue} />
        </linearGradient>
      </defs>
      {/* Glass bulbs. */}
      <path
        d="M32 19 H64 C64 33 52 40 48 46 C44 40 32 33 32 19 Z"
        fill={`url(#${glass})`}
        stroke={GameColors.glassDeep}
        strokeWidth="1.6"
      />
      <path
        d="M48 50 C52 56 64 63 64 77 H32 C32 63 44 56 48 50 Z"
        fill={`url(#${glass})`}
        stroke={GameColors.glassDeep}
        strokeWidth="1.6"
      />
      {/* Sand settled top pile, falling stream, bottom pile. */}
      <path
        d="M40 26 H56 C53 32 49 35.5 48 37.5 C47 35.5 43 32 40 26 Z"
        fill={GameColors.starOrange}
      />
      <path
        d="M48 46 V62"
        stroke={GameColors.starOrange}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M37.5 77 C40.5 68 46 63 48 60 C50 63 55.5 68 58.5 77 Z"
        fill={GameColors.starOrange}
        stroke={GameColors.starRim}
        strokeWidth="1"
      />
      {/* Glass gloss. */}
      <path
        d="M36 24 C36.5 30 40 33.5 42.5 36"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M36.5 71 C37.5 65 41 61 43.5 58.5"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Gold caps (over the glass so the joins look seated). */}
      <rect
        x="26"
        y="8"
        width="44"
        height="11"
        rx="5.5"
        fill={`url(#${gold})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2"
      />
      <rect
        x="24"
        y="77"
        width="48"
        height="11"
        rx="5.5"
        fill={`url(#${gold})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2"
      />
      <rect x="30" y="10.5" width="26" height="3" rx="1.5" fill="rgba(255,255,255,0.45)" />
      <rect x="28" y="79.5" width="28" height="3" rx="1.5" fill="rgba(255,255,255,0.45)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Shield                                                              */
/* ------------------------------------------------------------------ */

const SHIELD_PATH =
  "M48 10 C57 16 67 19 75 19 C75 43 68 65 48 84 C28 65 21 43 21 19 C29 19 39 16 48 10 Z";

export function GameShield({ className, style }: IconProps) {
  const uid = useId();
  const gold = `shg-${uid}`;
  const purple = `shp-${uid}`;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      className={className}
      style={{ filter: DROP, ...style }}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <GoldStops />
        </linearGradient>
        <linearGradient id={purple} x1="0" y1="0" x2="0" y2="1">
          <PurpleStops />
        </linearGradient>
      </defs>
      {/* Gold rim. */}
      <path
        d={SHIELD_PATH}
        fill={`url(#${gold})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Purple face (inset copy of the same path). */}
      <g transform="translate(48 47.5) scale(0.76) translate(-48 -47.5)">
        <path
          d={SHIELD_PATH}
          fill={`url(#${purple})`}
          stroke={GameColors.purpleDeep}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </g>
      {/* Gloss wedge + spark. */}
      <path d="M35 28 L47 24 L31 52 Z" fill="rgba(255,255,255,0.32)" />
      <circle cx="39" cy="30" r="2.2" fill="rgba(255,255,255,0.5)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Message (envelope + wizard hat)                                     */
/* ------------------------------------------------------------------ */

export function GameEnvelope({ className, style }: IconProps) {
  const uid = useId();
  const gold = `evg-${uid}`;
  const purple = `evp-${uid}`;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      className={className}
      style={{ filter: DROP, ...style }}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <GoldStops />
        </linearGradient>
        <linearGradient id={purple} x1="0" y1="0" x2="0" y2="1">
          <PurpleStops />
        </linearGradient>
      </defs>
      {/* Envelope body. */}
      <rect
        x="18"
        y="46"
        width="60"
        height="34"
        rx="7"
        fill={`url(#${gold})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2.5"
      />
      {/* Flap fold. */}
      <path
        d="M21 50 L48 68 L75 50"
        fill="none"
        stroke={GameColors.goldOutline}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23 49 L48 65.5 L73 49"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom shade. */}
      <rect x="21" y="72" width="54" height="5" rx="2.5" fill="rgba(168,95,20,0.3)" />
      {/* Wizard hat, tilted, seated on the top edge. */}
      <g transform="rotate(-10 46 30)">
        {/* Brim (behind cone base). */}
        <ellipse
          cx="46"
          cy="34"
          rx="22"
          ry="6.5"
          fill={GameColors.purpleDark}
          stroke={GameColors.purpleDeep}
          strokeWidth="2"
        />
        {/* Cone. */}
        <path
          d="M46 5 L61 33 L31 33 Z"
          fill={`url(#${purple})`}
          stroke={GameColors.purpleDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Gold band. */}
        <path
          d="M34.5 27 H57.5 L60 32 H32 Z"
          fill={`url(#${gold})`}
          stroke={GameColors.goldOutline}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Tip ball. */}
        <circle
          cx="46"
          cy="6"
          r="4.5"
          fill={`url(#${gold})`}
          stroke={GameColors.goldOutline}
          strokeWidth="1.5"
        />
        {/* Cone gloss. */}
        <path
          d="M42.5 14 L38 26"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Trophy                                                              */
/* ------------------------------------------------------------------ */

export function GameTrophy({
  size,
  className,
  style,
}: IconProps & { size?: number }) {
  const uid = useId();
  const gold = `trg-${uid}`;
  const purple = `trp-${uid}`;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ filter: DROP, ...style }}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <GoldStops />
        </linearGradient>
        <linearGradient id={purple} x1="0" y1="0" x2="0" y2="1">
          <PurpleStops />
        </linearGradient>
      </defs>
      {/* Handles. */}
      <path
        d="M30 22 C18 22 16 36 30 40 M66 22 C78 22 80 36 66 40"
        fill="none"
        stroke={GameColors.goldOutline}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M30 22 C18 22 16 36 30 40 M66 22 C78 22 80 36 66 40"
        fill="none"
        stroke={`url(#${gold})`}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      {/* Cup. */}
      <path
        d="M30 14 H66 V33 C66 46 58 53 48 53 C38 53 30 46 30 33 Z"
        fill={`url(#${gold})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect x="33" y="17" width="30" height="4" rx="2" fill="rgba(255,255,255,0.45)" />
      {/* Cup gloss. */}
      <path
        d="M36 24 C36 34 38 42 41 47"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* Purple gem. */}
      <circle
        cx="48"
        cy="33"
        r="5.5"
        fill={`url(#${purple})`}
        stroke={GameColors.purpleDeep}
        strokeWidth="1.8"
      />
      <circle cx="46.2" cy="31.2" r="1.4" fill="rgba(255,255,255,0.6)" />
      {/* Stem + neck. */}
      <path
        d="M44 53 H52 V58 C52 60.5 55 61.5 56.5 63 H39.5 C41 61.5 44 60.5 44 58 Z"
        fill={`url(#${gold})`}
        stroke={GameColors.goldOutline}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Purple base. */}
      <rect
        x="34"
        y="63"
        width="28"
        height="7"
        rx="2.5"
        fill={`url(#${purple})`}
        stroke={GameColors.purpleDeep}
        strokeWidth="2"
      />
      <rect
        x="29"
        y="70"
        width="38"
        height="9"
        rx="3.5"
        fill={GameColors.purpleDark}
        stroke={GameColors.purpleDeep}
        strokeWidth="2"
      />
      <rect x="37" y="65" width="14" height="2.5" rx="1.25" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}
