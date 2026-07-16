"use client";

/**
 * Notifications tab.
 *
 * Renders an honest empty state until a real notifications backend
 * exists. The previous version showed three hard-coded *sample*
 * notifications (level unlocked / badge / rank climb) ported from the
 * Flutter PoC fabricated content presented as real activity, which
 * erodes trust. Until the Phase-2 feed (streak reminders, rank
 * changes, new-cycle alerts) ships, an empty state is the truthful
 * render.
 *
 * Layout mirrors the leaderboard's `EmptyState` (centered mascot,
 * bold title, muted subtitle) for cross-tab consistency. Bottom
 * padding reserves room for the bottom-nav bar
 * (`BOTTOM_NAV_RESERVED_PX`).
 */

import { useTranslations } from "next-intl";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { Mascot } from "@/components/ui/mascot";

export default function NotificationsPage() {
  const t = useTranslations();

  return (
    <div
      className="flex h-dvh w-full flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{ paddingBottom: BOTTOM_NAV_RESERVED_PX + 16 }}
      >
        <h1 className="px-1 text-[26px] font-extrabold text-text">
          {t("notificationsTitle")}
        </h1>
        <div className="flex flex-col items-center px-8 pt-16 text-center">
          <Mascot size={110} />
          <div className="h-4" />
          <h2 className="text-[22px] font-extrabold text-text">
            {t("notificationsEmptyTitle")}
          </h2>
          <div className="h-1.5" />
          <p className="text-[14px] font-semibold text-text-muted">
            {t("notificationsEmptySubtitle")}
          </p>
        </div>
      </div>
    </div>
  );
}
