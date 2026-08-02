"use client";

/**
 * Bottom navigation bar for the protected `(app)` route group.
 *
 * Flat redesign: a white full-width bar with a 2px top border, four
 * tabs (icon + label). The active tab sits inside a light-blue
 * rounded tile with a blue border, brand-blue glyph and label the
 * signature active treatment. Inactive tabs are muted gray.
 *
 * We figure out the active tab from the current pathname so the nav
 * stays in sync with browser back/forward and deep links there's
 * no separate `currentIndex` state on the web.
 */

import { Home, Trophy, Bell, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Palette } from "@/lib/colors";

interface NavTab {
  href: string;
  icon: LucideIcon;
  /**
   * Message key for the visible label (also the link's accessible
   * name, since the text lives inside the anchor).
   */
  labelKey: string;
  /** Match the tab if the pathname starts with this prefix. */
  matchPrefix: string;
}

/**
 * Glyph colors (JS values, not var(): lucide's `color` prop becomes
 * the SVG `stroke` attribute, which doesn't resolve CSS vars).
 * Active matches the blue active tile (brand blue = `--color-blue`);
 * inactive is the faint purple-tinted neutral (`--color-text-faint`).
 */
const ACTIVE_ICON_COLOR = Palette.blue;
const INACTIVE_ICON_COLOR = Palette.textFaint;

const TABS: NavTab[] = [
  {
    href: "/home",
    icon: Home,
    labelKey: "navHome",
    matchPrefix: "/home",
  },
  {
    href: "/leaderboard",
    icon: Trophy,
    labelKey: "navLeaderboard",
    matchPrefix: "/leaderboard",
  },
  {
    href: "/notifications",
    icon: Bell,
    labelKey: "navNotifications",
    matchPrefix: "/notifications",
  },
  {
    href: "/profile",
    icon: User,
    labelKey: "navProfile",
    matchPrefix: "/profile",
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
  const t = useTranslations();

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
              aria-current={active ? "page" : undefined}
              prefetch
              // Column tile: icon over label. Horizontal padding is
              // deliberately slim ("Notifications" is the sizing
              // worst case; four tabs must fit a 320px frame), with
              // a 44px width floor so short labels ("Home", fr
              // "Profil") can't shrink the hit area below the iOS
              // touch-target minimum.
              className={`flex h-12 flex-col items-center justify-center gap-[3px] rounded-xl border-2 px-3 transition-colors duration-150 phone-sm:min-w-11 phone-sm:px-1.5 ${
                active ? "border-blue-border bg-blue-light" : "border-transparent"
              }`}
            >
              <Icon
                size={22}
                strokeWidth={2.5}
                color={active ? ACTIVE_ICON_COLOR : INACTIVE_ICON_COLOR}
              />
              <span
                className={`whitespace-nowrap text-[10px] font-extrabold leading-none phone-sm:text-[9px] ${
                  active ? "text-blue" : "text-text-faint"
                }`}
              >
                {t(tab.labelKey)}
              </span>
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
