import { useId } from "react";

import { GameColors } from "@/lib/colors";

/**
 * Mascot — Afriklang's talking parrot.
 *
 * Why a parrot: the app teaches African languages by *speaking* —
 * listen, repeat, record. The African Grey parrot (native to Ghana,
 * home of Twi) is the world's most famous talking animal, so a chibi
 * parrot is the most on-mission mascot possible. It replaces the
 * strawberry inherited from the Flutter PoC.
 *
 * Styling follows the glossy game-icon language (`glossy-icons.tsx`):
 * brand-purple body with deep-purple outlines, gold beak/chest, red
 * tail feathers, white gloss highlights — plus two little gold sound
 * waves at the beak (it's mid-sentence, obviously).
 *
 * Motion: gentle bob + twinkling sound waves, both `motion-safe:`
 * gated. Colors are hex from `GameColors` (SVG attributes don't
 * resolve CSS `var()`).
 *
 * Footprint matches the old mascot (110×120) so the home map's
 * positioning math is untouched.
 */
export function Mascot() {
  const uid = useId();
  const body = `mas-body-${uid}`;
  const gold = `mas-gold-${uid}`;

  return (
    <div className="motion-safe:animate-[afk-bob_1.8s_ease-in-out_infinite_alternate]">
      <svg
        viewBox="0 0 110 120"
        width="110"
        height="120"
        aria-hidden
        style={{ filter: "drop-shadow(0 3px 3px rgba(0,0,0,0.35))" }}
      >
        <defs>
          <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GameColors.purpleLight} />
            <stop offset="55%" stopColor={GameColors.purple} />
            <stop offset="100%" stopColor={GameColors.purpleDark} />
          </linearGradient>
          <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GameColors.goldLight} />
            <stop offset="50%" stopColor={GameColors.starGold} />
            <stop offset="100%" stopColor={GameColors.goldDeep} />
          </linearGradient>
        </defs>

        {/* Sound waves — it's talking! (twinkle with stagger) */}
        <g
          fill="none"
          stroke={GameColors.starGold}
          strokeWidth="2.6"
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

        {/* Tail feathers (behind the body). */}
        <path
          d="M72 92 C84 98 90 106 90 114 C80 112 70 104 66 96 Z"
          fill="#FF6B7C"
          stroke="#7A1A26"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M64 96 C74 104 80 112 78 119 C68 116 60 108 58 100 Z"
          fill={GameColors.heartRed}
          stroke="#7A1A26"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />

        {/* Head tuft. */}
        <path
          d="M50 17 C46 8 50 3 57 3 C55 9 56 14 57 17 Z"
          fill={GameColors.purpleLight}
          stroke={GameColors.purpleDeep}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M60 16 C62 8 68 6 72 9 C67 12 64 15 63 18 Z"
          fill={GameColors.purpleLight}
          stroke={GameColors.purpleDeep}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        {/* Body. */}
        <path
          d="M55 18 C77 18 88 40 85 68 C82 94 70 108 54 108 C36 108 24 92 26 64 C28 38 37 18 55 18 Z"
          fill={`url(#${body})`}
          stroke={GameColors.purpleDeep}
          strokeWidth="2.5"
        />
        {/* Head gloss. */}
        <path
          d="M40 27 C48 21 62 21 70 28"
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="5.5"
          strokeLinecap="round"
        />

        {/* Wing (right flank) with feather scallops. */}
        <path
          d="M60 52 Q84 58 80 84 Q72 98 58 94 Q64 74 60 52 Z"
          fill={GameColors.purpleDark}
          stroke={GameColors.purpleDeep}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <g
          fill="none"
          stroke={GameColors.purpleDeep}
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.6"
        >
          <path d="M62 76 Q69 79 74 74" />
          <path d="M64 88 Q70 90 74 86" />
        </g>

        {/* Gold chest patch. */}
        <ellipse
          cx="46"
          cy="86"
          rx="15"
          ry="13"
          fill={`url(#${gold})`}
          stroke="rgba(168,95,20,0.55)"
          strokeWidth="1.5"
        />

        {/* Cream face mask. */}
        <ellipse
          cx="42"
          cy="52"
          rx="18"
          ry="21"
          transform="rotate(-8 42 52)"
          fill={GameColors.cream}
        />

        {/* Eye. */}
        <circle
          cx="41"
          cy="48"
          r="9.5"
          fill="#FFFFFF"
          stroke={GameColors.purpleDeep}
          strokeWidth="1.8"
        />
        <circle cx="38.5" cy="49" r="4.6" fill="#2B1B4D" />
        <circle cx="36.8" cy="46.2" r="1.9" fill="#FFFFFF" />

        {/* Beak — gold hook, mid-chirp. */}
        <path
          d="M31 57 C18 55 11 62 14 69 C16 74 24 76 29 72 C32 69 33 62 31 57 Z"
          fill={`url(#${gold})`}
          stroke={GameColors.goldOutline}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M22 74 C25 79 32 80 35 76 C32 72 26 71 22 74 Z"
          fill={GameColors.goldDeep}
          stroke={GameColors.goldOutline}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        {/* Feet. */}
        <ellipse
          cx="45"
          cy="107"
          rx="5"
          ry="3.2"
          fill={GameColors.starOrange}
          stroke={GameColors.goldOutline}
          strokeWidth="1.4"
        />
        <ellipse
          cx="59"
          cy="108"
          rx="5"
          ry="3.2"
          fill={GameColors.starOrange}
          stroke={GameColors.goldOutline}
          strokeWidth="1.4"
        />
      </svg>
    </div>
  );
}
