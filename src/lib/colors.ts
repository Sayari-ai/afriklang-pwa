/**
 * Color tokens single source of truth for the PWA's JS-side colors.
 *
 * Mirrors the CSS variables in `src/app/globals.css` 1:1. Prefer the
 * CSS vars / Tailwind tokens in components; import this object only
 * where a JS value is required (SVG presentation attributes, canvas,
 * manifest) SVG `fill`/`stroke` attributes don't resolve `var()`.
 *
 * Brand palette: #00539F (blue primary), #F88D43 (orange reward
 * accent), #321E53 (deep-purple brand ink, tints every neutral),
 * #FFFFFF (surface). Red stays reserved for record/destructive
 * (color-as-affordance). Every family ships a `Deep` shade the
 * hard bottom edge of 3D-pressed buttons and path nodes.
 */
export const Palette = {
  // Brand blue primary
  primary: "#00539F",
  primaryDeep: "#003C74",
  primaryLight: "#DCEBF9",
  primaryText: "#00539F",

  // Blue aliases (selection system; same ramp as primary)
  blue: "#00539F",
  blueDeep: "#003C74",
  blueLight: "#DCEBF9",
  blueBorder: "#93BFE6",

  // Red (semantic: record/stop, destructive)
  red: "#FF4B4B",
  redDeep: "#EA2B2B",
  redLight: "#FFDFE0",

  // Brand orange reward accent. (`yellow*` names kept for
  // compatibility; there is no yellow in the brand kit.)
  yellow: "#F88D43",
  yellowDeep: "#DB6F26",
  yellowLight: "#FEEDDD",
  orange: "#F88D43",
  orangeDeep: "#DB6F26",
  orangeSoft: "#FFAF7E",

  // Brand purple (mascot, unit banners, decorative accents)
  purple: "#6D51A6",
  purpleDeep: "#321E53",

  // Neutrals purple-tinted from #321E53
  text: "#321E53",
  textMuted: "#6E6285",
  textFaint: "#A9A1BC",
  border: "#E8E4F0",
  bgSubtle: "#F7F5FB",
  bg: "#FFFFFF",
  white: "#FFFFFF",

  // Leaderboard medals metallic stays metallic (universal meaning
  // beats brand purity for rank 1-3).
  medalGold: "#FFC800",
  medalSilver: "#C0C0C0",
  medalBronze: "#CD7F32",

  /** Celebration confetti brand blue/orange/purple mix + tints. */
  confetti: [
    "#00539F",
    "#F88D43",
    "#6D51A6",
    "#321E53",
    "#93BFE6",
    "#FFAF7E",
  ] as const,
} as const;

export type PaletteColor = keyof typeof Palette;

/**
 * Legacy affordance tokens gameplay logic where color IS the
 * affordance (record red, submit = primary). Values point at the
 * brand palette; the names keep intent readable at call sites.
 */
export const AppColors = {
  retakeRed: Palette.red,
  listenAccent: Palette.orange,
  submitPrimary: Palette.primary,
  recordIdle: Palette.primary,
  recordActive: Palette.red,
} as const;

export type AppColor = keyof typeof AppColors;
