import { Palette } from "@/lib/colors";

/**
 * GameMapBackdrop + CycleDecor the home dashboard's joyful game-map
 * scene, drawn entirely from the brand ramp (sunrise over the
 * savanna: blue sky warming to an orange horizon, layered purple
 * hills, drifting clouds, a soft sun glow, twinkling sparks).
 *
 * Two layers with a parallax feel:
 *   - `GameMapBackdrop` is PINNED to the home viewport (absolute,
 *     behind the scroller): sky, sun, hills, ambient clouds.
 *   - `CycleDecor` scrolls WITH the path one instance per cycle
 *     band, scattering a hot-air balloon, birds and sparkles at
 *     deterministic positions (flipped on alternate cycles) along
 *     the serpentine's empty flanks.
 *
 * Design constraints honored:
 *   - Pastel tints only under content areas so nodes, the START
 *     bubble and the unit banner keep their contrast; saturation
 *     lives in small decorative shapes.
 *   - Everything `aria-hidden` + `pointer-events-none`; all motion
 *     `motion-safe:` gated.
 *   - Colors are hex (SVG attributes don't resolve CSS var()); scene
 *     tints are local derivations of the brand palette.
 */

// Scene tints (derived from brand blue/orange/purple).
const SKY_TOP = "#C7E2FA";
const SKY_MID = "#E9F4FE";
const HORIZON = "#FDEBD7";
const HILL_BACK = "#DDD3F0";
const HILL_MID = "#C9B9E8";
const HILL_FRONT = "#B29BDC";

export function GameMapBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Sky: cool blue up top warming toward the horizon. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${SKY_TOP} 0%, ${SKY_MID} 42%, ${HORIZON} 74%, #FBDDBE 100%)`,
        }}
      />

      {/* Sun glow rising behind the hills. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(46% 26% at 50% 76%, rgba(248,141,67,0.4) 0%, rgba(248,141,67,0) 100%)",
        }}
      />

      {/* Ambient sparkles in the sky. */}
      {[
        { left: "12%", top: "16%", size: 5, delay: "0s" },
        { left: "84%", top: "11%", size: 4, delay: "0.7s" },
        { left: "68%", top: "27%", size: 6, delay: "1.3s" },
        { left: "24%", top: "36%", size: 4, delay: "0.4s" },
        { left: "90%", top: "44%", size: 5, delay: "1.9s" },
      ].map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full motion-safe:animate-[afk-twinkle_2.4s_ease-in-out_infinite]"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            background: i % 2 ? "#FFFFFF" : Palette.orange,
            opacity: 0.7,
            animationDelay: s.delay,
          }}
        />
      ))}

      {/* Ambient clouds different speeds for depth. */}
      <Cloud
        className="absolute left-[6%] top-[9%] w-[88px] opacity-90 motion-safe:animate-[afk-drift_11s_ease-in-out_infinite_alternate]"
      />
      <Cloud
        className="absolute right-[8%] top-[21%] w-[64px] opacity-75 motion-safe:animate-[afk-drift_15s_ease-in-out_infinite_alternate-reverse]"
      />
      <Cloud
        className="absolute left-[14%] top-[46%] w-[56px] opacity-60 motion-safe:animate-[afk-drift_13s_ease-in-out_infinite_alternate]"
      />

      {/* Rolling hills purple ranges catching the sunrise. */}
      <svg
        viewBox="0 0 480 160"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-[22%] w-full"
      >
        <path
          d="M0 62 Q60 30 132 54 T268 48 T392 58 T480 42 V160 H0 Z"
          fill={HILL_BACK}
        />
        <path
          d="M0 96 Q84 62 176 86 T348 82 T480 92 V160 H0 Z"
          fill={HILL_MID}
        />
        <path
          d="M0 126 Q96 100 208 120 T480 116 V160 H0 Z"
          fill={HILL_FRONT}
        />
      </svg>
    </div>
  );
}

/**
 * Per-cycle scenery scrolls with the path. Rendered inside each
 * cycle's relative container; positions are percentages of the band
 * and flip sides on alternate cycles so a long journey stays varied.
 * Kept to the serpentine's flanks (dx < 0.2 / > 0.8) to never crowd
 * the nodes.
 */
export function CycleDecor({ index }: { index: number }) {
  const flip = index % 2 === 1;
  const side = (pct: string, mirror: boolean) =>
    mirror ? { right: pct } : { left: pct };

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {/* Hot-air balloon gently bobbing. */}
      <div
        className="absolute motion-safe:animate-[afk-bob_2.6s_ease-in-out_infinite_alternate]"
        style={{ ...side("4%", flip), top: "14%" }}
      >
        <Balloon />
      </div>

      {/* A small flock heading somewhere better. */}
      <svg
        viewBox="0 0 64 24"
        className="absolute w-[56px] opacity-50"
        style={{ ...side("6%", !flip), top: "44%" }}
        fill="none"
        stroke={Palette.purpleDeep}
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M4 12 Q9 6 14 12 Q19 6 24 12" />
        <path d="M32 8 Q36 3 40 8 Q44 3 48 8" />
        <path d="M44 18 Q47 14 50 18 Q53 14 56 18" />
      </svg>

      {/* Sparkle pair on the opposite flank. */}
      <span
        className="absolute h-[6px] w-[6px] rounded-full motion-safe:animate-[afk-twinkle_2.2s_ease-in-out_infinite]"
        style={{
          ...side("10%", flip),
          top: "64%",
          background: Palette.orange,
          opacity: 0.75,
        }}
      />
      <span
        className="absolute h-[4px] w-[4px] rounded-full motion-safe:animate-[afk-twinkle_2.2s_ease-in-out_infinite]"
        style={{
          ...side("15%", flip),
          top: "70%",
          background: "#FFFFFF",
          opacity: 0.8,
          animationDelay: "0.9s",
        }}
      />

      {/* Drifting band cloud. */}
      <Cloud
        className="absolute w-[60px] opacity-70 motion-safe:animate-[afk-drift_12s_ease-in-out_infinite_alternate]"
        style={{ ...side("5%", !flip), top: "82%" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene pieces
// ---------------------------------------------------------------------------

function Cloud({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 64 26" className={className} style={style} aria-hidden>
      <g fill="#FFFFFF">
        <ellipse cx="18" cy="17" rx="14" ry="8" />
        <ellipse cx="34" cy="12" rx="13" ry="9" />
        <ellipse cx="48" cy="17" rx="12" ry="7" />
      </g>
    </svg>
  );
}

/** Tiny brand hot-air balloon orange canopy, purple basket. */
function Balloon() {
  return (
    <svg viewBox="0 0 40 54" width="42" height="57" aria-hidden>
      {/* Canopy. */}
      <path
        d="M20 2 C31 2 37 10 37 19 C37 28 28 36 20 40 C12 36 3 28 3 19 C3 10 9 2 20 2 Z"
        fill={Palette.orange}
        stroke={Palette.orangeDeep}
        strokeWidth="2"
      />
      {/* Center gore highlight. */}
      <path
        d="M20 2 C24.5 8 24.5 32 20 40 C15.5 32 15.5 8 20 2 Z"
        fill="#FFC08D"
      />
      {/* Strings. */}
      <path
        d="M14 38 L16 45 M26 38 L24 45"
        stroke={Palette.purpleDeep}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* Basket. */}
      <rect
        x="14.5"
        y="45"
        width="11"
        height="7"
        rx="2"
        fill={Palette.purple}
        stroke={Palette.purpleDeep}
        strokeWidth="1.6"
      />
    </svg>
  );
}
