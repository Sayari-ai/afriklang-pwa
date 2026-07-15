/**
 * Brand color tokens — single source of truth for the PWA.
 *
 * Mirrors `lib/core/theme/app_colors.dart` (which only declares
 * `AppColors.primary = #00539F`) plus the inline ARGB literals used
 * across the Flutter screens (map, level, podium, overlays, etc.).
 *
 * Hex values are quoted verbatim from the Dart source so the visual
 * design stays pixel-identical. Do not "tidy up" colors here without
 * updating Flutter in lockstep.
 */
export const AppColors = {
  /** Brand blue. The only token formally declared in Dart. */
  primary: "#00539F",

  // Map / world view ------------------------------------------------------
  /** Tile background under the level map (cartoony green). */
  mapBackground: "#7BC96F",
  /** Strawberry mascot body color. */
  mascotBody: "#E53935",
  /** Step bar fill / completed-state green. */
  stepBarGreen: "#66BB6A",
  /** Step bar empty track. */
  stepBarTrack: "#CFCFCF",
  /** Locked node fill + lock icon tint. */
  lockedNodeFill: "#6B6B6B",
  lockedNodeIcon: "#B5B5B5",

  // Level review actions --------------------------------------------------
  retakeRed: "#E53935",
  listenBlue: "#2196F3",
  submitGreen: "#66BB6A",

  // Recording states ------------------------------------------------------
  /** Mic idle (between recordings). */
  recordIdle: "#66BB6A",
  /** Mic actively recording. */
  recordActive: "#E53935",

  // Reward / leaderboard --------------------------------------------------
  /** Bright yellow points number on the level-complete screen. */
  pointsReward: "#FFC02E",
  podiumGold: "#FFD700",
  podiumSilver: "#C0C0C0",
  podiumBronze: "#CD7F32",

  // Overlays --------------------------------------------------------------
  /** Onboarding / leaderboard / profile background scrim (60% black). */
  bgOverlay60: "rgba(0, 0, 0, 0.6)",
  /** Level / level-complete background scrim (80% black). */
  bgOverlay80: "rgba(0, 0, 0, 0.8)",

  // Confetti palette ------------------------------------------------------
  confetti: [
    "#E53935",
    "#FFC02E",
    "#66BB6A",
    "#2196F3",
    "#E91E63",
    "#9C27B0",
  ] as const,
} as const;

export type AppColor = keyof typeof AppColors;

/**
 * "Wood & grass" game-kit palette — the visual reskin's source of
 * truth, mirrored 1:1 by the CSS variables in `src/app/globals.css`
 * (`--color-wood-*`, `--color-grass-*`, ...). Prefer the CSS vars /
 * Tailwind tokens in components; import this object only where a JS
 * value is required (canvas, SVG gradient stops, manifest).
 */
export const GameColors = {
  // Wood
  woodLight: "#E9A05B",
  woodMid: "#C97B3D",
  woodDark: "#9E5B2C",
  woodRim: "#6E3C1D",
  woodShadow: "#45250F",
  woodPanelLight: "#DD9354",
  woodPanelDark: "#C47737",

  // Grass & ribbon
  grassLight: "#8CC63F",
  grassDark: "#4C8F2F",
  grassDeep: "#3E7A26",
  ribbonLight: "#C9EC6B",
  ribbonMid: "#8DC63F",
  ribbonDark: "#5B9E2D",

  // Collectibles
  starGold: "#FFC93C",
  starOrange: "#F2A03D",
  starRim: "#B36A24",
  starEmpty: "#5C3A24",
  heartRed: "#E84357",
  heartEmpty: "#40261C",
  coinGold: "#FFCF4D",
  coinRim: "#D98E2B",

  // Glossy "2D game icon" accents (lock shackle, shield face, wizard
  // hat, hourglass glass, halo discs) — gold+purple pack style.
  goldLight: "#FFE08A",
  goldDeep: "#E8941F",
  goldOutline: "#A85F14",
  purpleLight: "#B18CEB",
  purple: "#8E5BD9",
  purpleDark: "#6B3FB8",
  purpleDeep: "#53309E",
  glassLight: "#C9F0FF",
  glassBlue: "#4FB3EE",
  glassDeep: "#2E86C1",
  halo: "#EDE7FB",

  // Board surface & text
  surface: "#3E2B28",
  surfaceDeep: "#332220",
  cream: "#FFF6E0",
  ink: "#5C3018",

  /** Celebration confetti — greens, golds and wood oranges. */
  confetti: [
    "#8CC63F",
    "#FFC93C",
    "#F2A03D",
    "#C9EC6B",
    "#E84357",
    "#FFF6E0",
  ] as const,
} as const;

export type GameColor = keyof typeof GameColors;
