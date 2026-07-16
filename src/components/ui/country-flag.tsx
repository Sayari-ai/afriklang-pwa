import { useId } from "react";

import type { LearningLanguage } from "@/stores/learning-language";

/**
 * CountryFlag premium hand-drawn SVG country flags.
 *
 * Replaces the emoji flags (🇬🇭 🇧🇯 🇸🇳), which render as bare letter
 * pairs ("GH") on Windows and vary in art style per OS. These are
 * drawn from the official flag geometry/colors, presented in the
 * app's flat language: 3:2 rounded rectangle with a hairline
 * brand-ink ring so light stripes hold their edge on white surfaces.
 *
 * Coverage matches the learning-language catalogue (`tw` → Ghana,
 * `fon` → Benin, `wo` → Senegal) plus a brand-blue globe tile for
 * the not-yet-selected state. Decorative by design (`aria-hidden`):
 * every call site pairs the flag with the language/country name.
 *
 * All colors are hex SVG presentation attributes don't resolve
 * CSS `var()`.
 */

/** 5-point star, center (0,0), outer radius 10 scale to size. */
const STAR_PATH =
  "M0,-10 L2.245,-3.09 L9.511,-3.09 L3.633,1.18 L5.878,8.09 L0,3.82 L-5.878,8.09 L-3.633,1.18 L-9.511,-3.09 L-2.245,-3.09 Z";

export function CountryFlag({
  iso,
  size = 30,
  className,
}: {
  /** Learning-language ISO; `null`/`undefined` renders the globe tile. */
  iso: LearningLanguage["iso"] | null | undefined;
  /** Rendered width in px (height = width × 2/3). */
  size?: number;
  className?: string;
}) {
  const uid = useId();
  const clipId = `flag-clip-${uid}`;

  return (
    <svg
      viewBox="0 0 60 40"
      width={size}
      height={(size * 2) / 3}
      aria-hidden
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width="60" height="40" rx="8" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {iso === "tw" ? (
          <GhanaFaces />
        ) : iso === "fon" ? (
          <BeninFaces />
        ) : iso === "wo" ? (
          <SenegalFaces />
        ) : (
          <GlobeFaces />
        )}
      </g>
      {/* Hairline ring keeps light stripes crisp on white surfaces. */}
      <rect
        x="0.75"
        y="0.75"
        width="58.5"
        height="38.5"
        rx="7.4"
        fill="none"
        stroke="rgba(50,30,83,0.16)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Ghana red / gold / green horizontal stripes, black lodestar. */
function GhanaFaces() {
  return (
    <>
      <rect width="60" height="13.34" fill="#CE1126" />
      <rect y="13.33" width="60" height="13.34" fill="#FCD116" />
      <rect y="26.66" width="60" height="13.34" fill="#006B3F" />
      <path d={STAR_PATH} transform="translate(30 20) scale(0.62)" fill="#000000" />
    </>
  );
}

/** Benin green hoist band, yellow over red fly. */
function BeninFaces() {
  return (
    <>
      <rect width="24" height="40" fill="#008751" />
      <rect x="24" width="36" height="20" fill="#FCD116" />
      <rect x="24" y="20" width="36" height="20" fill="#E8112D" />
    </>
  );
}

/** Senegal green / yellow / red vertical stripes, green star. */
function SenegalFaces() {
  return (
    <>
      <rect width="20" height="40" fill="#00853F" />
      <rect x="20" width="20" height="40" fill="#FDEF42" />
      <rect x="40" width="20" height="40" fill="#E31B23" />
      <path d={STAR_PATH} transform="translate(30 20) scale(0.6)" fill="#00853F" />
    </>
  );
}

/** Fallback tile: brand-blue globe on the light-blue tint. */
function GlobeFaces() {
  return (
    <>
      <rect width="60" height="40" fill="#DCEBF9" />
      <g fill="none" stroke="#00539F" strokeWidth="2.4">
        <circle cx="30" cy="20" r="11.5" />
        <ellipse cx="30" cy="20" rx="5.2" ry="11.5" />
        <path d="M19.5 16 H40.5 M19.5 24 H40.5" />
      </g>
    </>
  );
}
