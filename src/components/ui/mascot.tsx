import { Palette } from "@/lib/colors";

/**
 * Mascot Afriklang's talking parrot, flat edition.
 *
 * Why a parrot: the app teaches African languages by *speaking* 
 * listen, repeat, record. The African Grey parrot (native to Ghana,
 * home of Twi) is the world's most famous talking animal.
 *
 * Drawn entirely from the brand ramp: mid-purple body with deep
 * brand-purple (#321E53) wing/strokes, orange (#F88D43) chest, beak,
 * feet and tail feathers, white face. Two little orange sound waves
 * at the beak it's mid-sentence, obviously.
 *
 * Motion: gentle bob + twinkling sound waves, both `motion-safe:`
 * gated. Colors are hex from `Palette` (SVG attributes don't resolve
 * CSS `var()`).
 */
export function Mascot({
  size = 110,
  className,
  animated = true,
}: {
  /** Rendered width in px (intrinsic ratio 110:120). */
  size?: number;
  className?: string;
  /** Disable the idle bob (e.g. static hero placements). */
  animated?: boolean;
}) {
  return (
    <div
      className={`${
        animated
          ? "motion-safe:animate-[afk-bob_1.8s_ease-in-out_infinite_alternate]"
          : ""
      } ${className ?? ""}`}
    >
      <svg
        viewBox="0 0 110 120"
        width={size}
        height={Math.round((size * 120) / 110)}
        aria-hidden
      >
        {/* Sound waves it's talking! (twinkle with stagger) */}
        <g
          fill="none"
          stroke={Palette.yellow}
          strokeWidth="3"
          strokeLinecap="round"
        >
          <path
            d="M12 51 Q7 58 12 65"
            className="motion-safe:animate-[afk-twinkle_1.6s_ease-in-out_infinite]"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
          <path
            d="M6 45 Q0.5 58 6 71"
            className="motion-safe:animate-[afk-twinkle_1.6s_ease-in-out_infinite]"
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              animationDelay: "0.55s",
            }}
          />
        </g>

        {/* Tail feathers (behind the body) brand orange plumage. */}
        <path
          d="M72 92 C84 98 90 106 90 114 C80 112 70 104 66 96 Z"
          fill={Palette.orangeSoft}
          stroke={Palette.orangeDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M64 96 C74 104 80 112 78 119 C68 116 60 108 58 100 Z"
          fill={Palette.orange}
          stroke={Palette.orangeDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Head tuft. */}
        <path
          d="M50 17 C46 8 50 3 57 3 C55 9 56 14 57 17 Z"
          fill={Palette.purple}
          stroke={Palette.purpleDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M60 16 C62 8 68 6 72 9 C67 12 64 15 63 18 Z"
          fill={Palette.purple}
          stroke={Palette.purpleDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Body flat purple. */}
        <path
          d="M55 18 C77 18 88 40 85 68 C82 94 70 108 54 108 C36 108 24 92 26 64 C28 38 37 18 55 18 Z"
          fill={Palette.purple}
          stroke={Palette.purpleDeep}
          strokeWidth="2.5"
        />

        {/* Wing (right flank) with feather scallops. */}
        <path
          d="M60 52 Q84 58 80 84 Q72 98 58 94 Q64 74 60 52 Z"
          fill={Palette.purpleDeep}
        />
        <g
          fill="none"
          stroke="#55407D"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M62 76 Q69 79 74 74" />
          <path d="M64 88 Q70 90 74 86" />
        </g>

        {/* Yellow chest patch. */}
        <ellipse
          cx="46"
          cy="86"
          rx="15"
          ry="13"
          fill={Palette.yellow}
          stroke={Palette.yellowDeep}
          strokeWidth="2"
        />

        {/* White face mask. */}
        <ellipse
          cx="42"
          cy="52"
          rx="18"
          ry="21"
          transform="rotate(-8 42 52)"
          fill="#FFFFFF"
        />

        {/* Eye. */}
        <circle
          cx="41"
          cy="48"
          r="9.5"
          fill="#FFFFFF"
          stroke={Palette.text}
          strokeWidth="2"
        />
        <circle cx="38.5" cy="49" r="4.6" fill={Palette.text} />
        <circle cx="36.8" cy="46.2" r="1.9" fill="#FFFFFF" />

        {/* Beak flat orange hook, mid-chirp. */}
        <path
          d="M31 57 C18 55 11 62 14 69 C16 74 24 76 29 72 C32 69 33 62 31 57 Z"
          fill={Palette.orange}
          stroke={Palette.orangeDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M22 74 C25 79 32 80 35 76 C32 72 26 71 22 74 Z"
          fill={Palette.orangeDeep}
        />

        {/* Feet. */}
        <ellipse
          cx="45"
          cy="107"
          rx="5"
          ry="3.2"
          fill={Palette.orange}
          stroke={Palette.orangeDeep}
          strokeWidth="1.6"
        />
        <ellipse
          cx="59"
          cy="108"
          rx="5"
          ry="3.2"
          fill={Palette.orange}
          stroke={Palette.orangeDeep}
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}
