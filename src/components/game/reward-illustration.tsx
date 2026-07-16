import { useId } from "react";

import { GameColors } from "@/lib/colors";

/**
 * RewardIllustration hero artwork for the onboarding "Get rewarded"
 * page, replacing the old flat Dollar-Coin PNG.
 *
 * Glossy game-icon style (matches `glossy-icons.tsx`): a big gold
 * coin with an embossed star, two smaller coins floating behind,
 * a ground shadow, and twinkling sparkles (one purple, per the
 * pack's accent). Pure SVG scalable, no binary asset, ~2 KB.
 *
 * Motion: the whole piece bobs gently and the sparkles twinkle with
 * staggered delays both gated behind `motion-safe:` so
 * reduced-motion users get a static illustration.
 *
 * Colors are hex from `GameColors` because SVG presentation
 * attributes / gradient stops don't resolve CSS `var()`.
 */

/** 5-point star polygon path (outer radius R, inner radius r). */
function starPath(cx: number, cy: number, R: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + rad * Math.cos(a);
    const y = cy + rad * Math.sin(a);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d + "Z";
}

const MAIN_STAR = starPath(110, 99, 27, 12.5);

/** 4-point diamond sparkle centered on (0,0), size s. */
function sparklePath(s: number): string {
  const w = s * 0.28;
  return `M0 ${-s} L${w} ${-w} L${s} 0 L${w} ${w} L0 ${s} L${-w} ${w} L${-s} 0 L${-w} ${-w} Z`;
}

const SPARKLES: ReadonlyArray<{
  x: number;
  y: number;
  s: number;
  fill: string;
  delay: number;
}> = [
  { x: 36, y: 36, s: 9, fill: "#FFE08A", delay: 0 },
  { x: 66, y: 16, s: 5, fill: "#FFF6E0", delay: 0.5 },
  { x: 150, y: 16, s: 6, fill: GameColors.purpleLight, delay: 0.9 },
  { x: 188, y: 44, s: 7, fill: "#FFF6E0", delay: 0.3 },
  { x: 20, y: 126, s: 6, fill: "#FFF6E0", delay: 1.2 },
  { x: 198, y: 134, s: 8, fill: "#FFE08A", delay: 0.7 },
];

export function RewardIllustration({ className }: { className?: string }) {
  const uid = useId();
  const face = `rw-face-${uid}`;
  const faceSm = `rw-face-sm-${uid}`;

  /** Small satellite coin (no star). */
  const smallCoin = (cx: number, cy: number, r: number) => (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={GameColors.coinRim}
        stroke={GameColors.goldOutline}
        strokeWidth="2"
      />
      <circle cx={cx} cy={cy - r * 0.06} r={r * 0.82} fill={`url(#${faceSm})`} />
      <circle
        cx={cx}
        cy={cy - r * 0.06}
        r={r * 0.58}
        fill="none"
        stroke="rgba(217,142,43,0.8)"
        strokeWidth="2"
      />
      <ellipse
        cx={cx - r * 0.32}
        cy={cy - r * 0.45}
        rx={r * 0.3}
        ry={r * 0.17}
        transform={`rotate(-28 ${cx - r * 0.32} ${cy - r * 0.45})`}
        fill="rgba(255,255,255,0.55)"
      />
    </g>
  );

  return (
    <svg
      viewBox="0 0 220 200"
      aria-hidden="true"
      className={`motion-safe:animate-[afk-bob_2.4s_ease-in-out_infinite_alternate] ${className ?? ""}`}
    >
      <defs>
        <linearGradient id={face} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GameColors.goldLight} />
          <stop offset="48%" stopColor={GameColors.starGold} />
          <stop offset="100%" stopColor={GameColors.goldDeep} />
        </linearGradient>
        <linearGradient id={faceSm} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GameColors.goldLight} />
          <stop offset="100%" stopColor={GameColors.goldDeep} />
        </linearGradient>
      </defs>

      {/* Ground shadow. */}
      <ellipse cx="110" cy="176" rx="64" ry="9" fill="rgba(0,0,0,0.3)" />

      {/* Satellite coins (behind the hero coin). */}
      {smallCoin(48, 116, 30)}
      {smallCoin(174, 106, 26)}

      {/* Hero coin. */}
      <g style={{ filter: "drop-shadow(0 4px 4px rgba(0,0,0,0.3))" }}>
        <circle
          cx="110"
          cy="100"
          r="56"
          fill={GameColors.coinRim}
          stroke={GameColors.goldOutline}
          strokeWidth="3"
        />
        <circle cx="110" cy="97" r="47" fill={`url(#${face})`} />
        <circle
          cx="110"
          cy="97"
          r="36.5"
          fill="none"
          stroke="rgba(217,142,43,0.85)"
          strokeWidth="3"
        />
        {/* Embossed star. */}
        <path
          d={MAIN_STAR}
          fill={GameColors.goldDeep}
          stroke={GameColors.goldOutline}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d={starPath(109, 97, 24, 11)}
          fill="none"
          stroke="rgba(255,224,138,0.55)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {/* Gloss crescent + spark. */}
        <path
          d="M74 74 C82 62 96 55 110 55"
          fill="none"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="132" cy="66" r="3.4" fill="rgba(255,255,255,0.7)" />
      </g>

      {/* Twinkling sparkles. Position lives on the <g> (attribute
          transform) because the CSS twinkle animation on the <path>
          would override an attribute transform on the same node. */}
      {SPARKLES.map((sp, i) => (
        <g key={i} transform={`translate(${sp.x} ${sp.y})`}>
          <path
            d={sparklePath(sp.s)}
            fill={sp.fill}
            className="motion-safe:animate-[afk-twinkle_1.9s_ease-in-out_infinite]"
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              animationDelay: `${sp.delay}s`,
            }}
          />
        </g>
      ))}
    </svg>
  );
}
