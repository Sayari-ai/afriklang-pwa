"use client";

/**
 * Bottom navigation bar for the protected `(app)` route group.
 *
 * Visual port of `_BottomNav` in
 * `lib/features/home/home_screen.dart:966-1019`:
 *   - White pill (radius 40) with soft shadow.
 *   - 4 items: Home / Leaderboard / Notifications / Profile.
 *   - Selected item: 56×56 brand-blue circle, white icon, slight
 *     scale-up (1.12).
 *   - Unselected: grey icon (#9E9E9E), no background.
 *   - 250 ms `easeOutBack`-ish transition between states.
 *
 * We figure out the active tab from the current pathname so the nav
 * stays in sync with browser back/forward and deep links — there's
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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-3"
    >
      <div
        className="pointer-events-auto mx-auto flex h-[72px] max-w-md items-center justify-between rounded-[40px] bg-white px-3"
        style={{ boxShadow: "0 6px 16px rgba(0,0,0,0.2)" }}
      >
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
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-out"
              style={{
                backgroundColor: active ? "var(--color-brand-primary)" : "transparent",
                transform: active ? "scale(1.06)" : "scale(1)",
              }}
            >
              <Icon
                size={28}
                strokeWidth={2.25}
                color={active ? "#FFFFFF" : "#9E9E9E"}
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
