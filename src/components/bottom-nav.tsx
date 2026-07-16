"use client";

/**
 * Bottom navigation bar for the protected `(app)` route group.
 *
 * Game-kit reskin of the original white Flutter pill: a wooden plank
 * bar (dark carved rim + lit face) floating above the board. The
 * active tab glyph glows grass-green inside a soft green well; idle
 * glyphs are carved cream.
 *
 * We figure out the active tab from the current pathname so the nav
 * stays in sync with browser back/forward and deep links there's
 * no separate `currentIndex` state on the web.
 */

import { Home, Trophy, Bell, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavTab {
  href: string;
  icon: LucideIcon;
  /** Used as the accessible label and for `aria-current`. */
  label: string;
  /** Match the tab if the pathname starts with this prefix. */
  matchPrefix: string;
}

const TABS: NavTab[] = [
  { href: "/home", icon: Home, label: "Home", matchPrefix: "/home" },
  {
    href: "/leaderboard",
    icon: Trophy,
    label: "Leaderboard",
    matchPrefix: "/leaderboard",
  },
  {
    href: "/notifications",
    icon: Bell,
    label: "Notifications",
    matchPrefix: "/notifications",
  },
  { href: "/profile", icon: User, label: "Profile", matchPrefix: "/profile" },
];

/**
 * "Level" sub-routes belong to Home conceptually (they're how you
 * complete a mission on the map). We treat /level/* as Home so the
 * Home tab stays selected during gameplay.
 */
function isActive(pathname: string, prefix: string): boolean {
  if (prefix === "/home") {
    return pathname === "/home" || pathname.startsWith("/level");
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function BottomNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Primary"
      // `fixed` is positioned relative to the viewport, not the
      // phone-frame wrapper in the root layout, so we manually clamp
      // the nav to the same max-width and center it horizontally.
      // That keeps the pill anchored to the bottom of the viewport
      // while still sitting inside the mobile-sized column on desktop.
      className="pointer-events-none fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 px-4 pb-3 phone-sm:px-2"
    >
      <div className="pointer-events-auto relative mx-auto flex h-[72px] max-w-md items-center justify-between px-3 phone-sm:h-[64px] phone-sm:px-2">
        {/* Wooden plank: carved rim + lit face. */}
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, #7d4423 0%, #56301a 100%)",
            borderRadius: "38px 34px 37px 35px / 34px 38px 33px 37px",
            boxShadow: "0 8px 16px rgba(0,0,0,0.45)",
          }}
        />
        <span
          aria-hidden="true"
          className="absolute"
          style={{
            inset: "4px 4px 8px 4px",
            background:
              "linear-gradient(180deg, var(--color-wood-light) 0%, var(--color-wood-mid) 55%, var(--color-wood-dark) 100%)",
            borderRadius: "34px 30px 33px 31px / 30px 34px 29px 33px",
            boxShadow:
              "inset 0 3px 0 rgba(255,235,205,0.4), inset 0 -4px 6px rgba(0,0,0,0.18)",
          }}
        />
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.matchPrefix);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              prefetch
              className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-out phone-sm:h-12 phone-sm:w-12"
              style={{
                background: active
                  ? "radial-gradient(circle at 50% 35%, rgba(140,198,63,0.35), rgba(76,143,47,0.18) 68%, transparent 75%)"
                  : "transparent",
                boxShadow: active
                  ? "inset 0 2px 4px rgba(62,122,38,0.45)"
                  : "none",
                transform: active ? "scale(1.06)" : "scale(1)",
              }}
            >
              <Icon
                size={28}
                strokeWidth={2.5}
                // Hex, not var(): lucide's `color` prop becomes the SVG
                // `stroke` attribute, which doesn't resolve CSS vars.
                color={active ? "#8CC63F" : "rgba(255,246,224,0.55)"}
                style={{
                  filter: active
                    ? "drop-shadow(0 1.5px 0 var(--color-grass-deep))"
                    : "drop-shadow(0 1px 0 rgba(92,48,24,0.6))",
                }}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Bottom padding to reserve room for the fixed nav bar in scrollable
 * screens. Mirrors the SafeArea + 72 + 12 + 12 = 96 pt the Flutter
 * Scaffold inserts for `bottomNavigationBar`.
 */
export const BOTTOM_NAV_RESERVED_PX = 96;
