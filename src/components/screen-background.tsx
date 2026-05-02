import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Shared screen background used by onboarding, consent, home, level,
 * level-complete, leaderboard, notifications and profile.
 *
 * Mirrors the Flutter widget tree:
 *   Stack(
 *     fit: StackFit.expand,
 *     children: [
 *       Image.asset('assets/images/bg.png', fit: BoxFit.cover),
 *       Container(color: Color(overlay)),  // 0x99 or 0xCC
 *       SafeArea(child: ...screen body...),
 *     ],
 *   );
 *
 * `overlay` defaults to 60% black to match the onboarding/profile/
 * leaderboard scrim. Pass `overlay="strong"` (80% black) for the level
 * and level-complete screens, where the background needs to recede
 * harder behind the question card / celebration confetti.
 */
export function ScreenBackground({
  children,
  overlay = "soft",
}: {
  children: ReactNode;
  overlay?: "soft" | "strong";
}) {
  const overlayColor =
    overlay === "strong"
      ? "var(--color-bg-overlay-80)"
      : "var(--color-bg-overlay-60)";

  return (
    <div className="relative isolate flex min-h-dvh flex-1 flex-col overflow-hidden">
      {/* The cover photo. `priority` so it doesn't pop in on first paint. */}
      <Image
        src="/images/bg.png"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        className="object-cover -z-20"
      />
      {/* Darkening scrim. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ backgroundColor: overlayColor }}
      />
      {/* Body — safe-area aware so notched devices look right. */}
      <div className="relative flex flex-1 flex-col" style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {children}
      </div>
    </div>
  );
}
