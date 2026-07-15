import { useId } from "react";

import { GameColors } from "@/lib/colors";

/**
 * WoodMedallion — the circular carved-wood disc that underpins the
 * kit's round elements (icon buttons, level badges, score badge,
 * resource-counter slots).
 *
 * Pure SVG so the edge can be organically wobbly like the mockup:
 * an irregular "wavy circle" outline (radius modulated by two sine
 * waves), a dark rim, a lit body gradient, a soft top sheen and a
 * couple of grain arcs. Scales losslessly — size it with width/height
 * on the wrapping element (the svg fills its box).
 *
 * Colors are hex from `GameColors` because SVG presentation
 * attributes / gradient stops don't resolve CSS `var()`.
 *
 * Gradient ids are namespaced per instance via `useId` so multiple
 * medallions on one page don't cross-reference each other's defs.
 */

/** Deterministic wobbly-circle path (module-level — computed once). */
function wobblyCircle(
  cx: number,
  cy: number,
  r: number,
  amp: number,
  phase: number,
): string {
  const N = 72;
  let d = "";
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const rr =
      r * (1 + amp * Math.sin(7 * th + phase) + amp * 0.6 * Math.sin(3 * th - phase));
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d + "Z";
}

const RIM_PATH = wobblyCircle(50, 51, 47, 0.035, 0.8);
const BODY_PATH = wobblyCircle(50, 49.2, 42.5, 0.03, 0.8);

export function WoodMedallion({
  className,
  muted = false,
}: {
  className?: string;
  /** Slightly darker/duller wood for locked states. */
  muted?: boolean;
}) {
  const uid = useId();
  const bodyGrad = `wm-body-${uid}`;
  const rimGrad = `wm-rim-${uid}`;
  const sheenGrad = `wm-sheen-${uid}`;

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={className ?? "h-full w-full"}
      style={{
        filter: "drop-shadow(0 4px 3px rgba(0,0,0,0.35))",
      }}
    >
      <defs>
        <linearGradient id={rimGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7d4423" />
          <stop offset="100%" stopColor={GameColors.woodRim} />
        </linearGradient>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          {muted ? (
            <>
              <stop offset="0%" stopColor="#c78a52" />
              <stop offset="55%" stopColor="#a86b39" />
              <stop offset="100%" stopColor="#8a5429" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor={GameColors.woodLight} />
              <stop offset="55%" stopColor={GameColors.woodMid} />
              <stop offset="100%" stopColor={GameColors.woodDark} />
            </>
          )}
        </linearGradient>
        <radialGradient id={sheenGrad} cx="0.5" cy="0.32" r="0.55">
          <stop offset="0%" stopColor="rgba(255,238,210,0.4)" />
          <stop offset="100%" stopColor="rgba(255,238,210,0)" />
        </radialGradient>
      </defs>

      {/* Dark carved rim (slightly taller than the body → 3D lip). */}
      <path d={RIM_PATH} fill={`url(#${rimGrad})`} />
      {/* Lit wood face. */}
      <path d={BODY_PATH} fill={`url(#${bodyGrad})`} />
      {/* Soft top sheen. */}
      <ellipse cx="50" cy="34" rx="30" ry="18" fill={`url(#${sheenGrad})`} />
      {/* Grain arcs. */}
      <g
        fill="none"
        stroke="rgba(110,60,29,0.35)"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M28 62 Q50 70 72 61" />
        <path d="M33 73 Q50 79 67 72" />
      </g>
      <path
        d="M30 27 Q50 19 70 27"
        fill="none"
        stroke="rgba(255,235,205,0.35)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
