import type { ReactNode } from "react";

/**
 * Shared screen background used by onboarding, consent, path-setup,
 * level, level-complete, leaderboard, notifications and profile.
 *
 * Game-kit reskin: every screen sits on a dark maroon "game board" —
 * a warm surface lit softly from the top, sprinkled with faint cream
 * polka dots (candy-game texture), and darkened at the corners by a
 * radial vignette.
 *
 * The `overlay` prop is kept for API compatibility with the previous
 * scrim variants:
 *   - "soft"   → standard board (#3E2B28)
 *   - "strong" → deeper board (#332220) for screens where content
 *                must pop harder (level gameplay, celebration).
 */

/**
 * Just the decorative board layers (glow + dots + vignette),
 * absolutely positioned. For screens that manage their own
 * scroll/stacking context (e.g. the home map) and can't nest inside
 * <ScreenBackground>. Parent must be `relative`.
 */
export function GameBoardBackdrop() {
  return (
    <>
      {/* Warm light falling from the top. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 85% at 50% 0%, rgba(233,160,91,0.1) 0%, rgba(233,160,91,0) 60%)",
        }}
      />
      {/* Soft cream polka dots — two offset grids for a diamond lay. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle, rgba(255,246,224,0.05) 0 5px, rgba(255,246,224,0) 10px),
            radial-gradient(circle, rgba(255,246,224,0.035) 0 3.5px, rgba(255,246,224,0) 8px)
          `,
          backgroundSize: "112px 112px, 112px 112px",
          backgroundPosition: "0 0, 56px 56px",
        }}
      />
      {/* Radial vignette — darkens corners, keeps the center lively. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 100% at 50% 38%, transparent 55%, rgba(0,0,0,0.38) 100%)",
        }}
      />
    </>
  );
}

export function ScreenBackground({
  children,
  overlay = "soft",
}: {
  children: ReactNode;
  overlay?: "soft" | "strong";
}) {
  const base =
    overlay === "strong"
      ? "var(--color-surface-deep)"
      : "var(--color-surface)";

  return (
    <div
      className="relative isolate flex min-h-dvh flex-1 flex-col overflow-hidden"
      style={{ backgroundColor: base }}
    >
      <div className="absolute inset-0 -z-10">
        <GameBoardBackdrop />
      </div>
      {/* Body — safe-area aware so notched devices look right. */}
      <div
        className="relative flex flex-1 flex-col"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
