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
