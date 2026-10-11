/**
 * Tabs layout wraps the four bottom-nav routes (`/home`,
 * `/leaderboard`, `/notifications`, `/profile`) in the shared bottom
 * navigation bar. Level + celebration screens live under the parent
 * `(app)` group but *outside* this `(tabs)` sub-group, so they stay
 * full-bleed without the nav.
 *
 * The nav itself is `position: fixed`, so this layout doesn't need to
 * reserve space pages add bottom padding via
 * `BOTTOM_NAV_RESERVED_PX` if their content is scrollable behind it.
 */

import type { ReactNode } from "react";

import { BottomNav } from "@/components/bottom-nav";

export default function TabsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
