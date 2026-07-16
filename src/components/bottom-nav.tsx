"use client";

/**
 * Bottom navigation bar for the protected `(app)` route group.
 *
 * Flat redesign: a white full-width bar with a 2px top border, four
 * icon-only tabs. Icons are always colored (each tab has its own
 * brand hue); the active tab sits inside a light-blue rounded tile
 * with a blue border the signature active treatment.
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
  /** Brand hue for the glyph (hex lucide sets SVG `stroke`). */
  color: string;
}

const TABS: NavTab[] = [
  {
    href: "/home",
    icon: Home,
    label: "Home",
    matchPrefix: "/home",
    color: "#00539F", // brand blue home is the primary surface
  },
  {
    href: "/leaderboard",
    icon: Trophy,
    label: "Leaderboard",
    matchPrefix: "/leaderboard",
    color: "#F88D43", // brand orange rewards/competition
  },
  {
    href: "/notifications",
    icon: Bell,
    label: "Notifications",
    matchPrefix: "/notifications",
    color: "#6D51A6", // mid brand purple
  },
  {
    href: "/profile",
    icon: User,
    label: "Profile",
    matchPrefix: "/profile",
    color: "#321E53", // deep brand purple
  },
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
      className="fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-t-2 border-border bg-bg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-[64px] items-center justify-around px-2 phone-sm:h-[58px]">
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
              className={`flex h-12 items-center justify-center rounded-xl px-5 transition-colors duration-150 phone-sm:px-4 ${
                active ? "border-2 border-blue-border bg-blue-light" : ""
              }`}
            >
              <Icon
                size={28}
                strokeWidth={2.5}
                // Hex, not var(): lucide's `color` prop becomes the SVG
                // `stroke` attribute, which doesn't resolve CSS vars.
                color={active ? tab.color : "#A9A1BC"}
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
 * screens: 64px bar + breathing room (safe-area inset is handled by
 * the bar itself extending under the home indicator).
 */
export const BOTTOM_NAV_RESERVED_PX = 88;
