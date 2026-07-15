"use client";

/**
 * Notifications tab.
 *
 * Renders an honest empty state until a real notifications backend
 * exists. The previous version showed three hard-coded *sample*
 * notifications (level unlocked / badge / rank climb) ported from the
 * Flutter PoC — fabricated content presented as real activity, which
 * erodes trust. Until the Phase-2 feed (streak reminders, rank
 * changes, new-cycle alerts) ships, an empty state is the truthful
 * render.
 *
 * Layout mirrors the leaderboard's `EmptyState` (centered icon, bold
 * white title, muted subtitle) for cross-tab consistency. Bottom
 * padding reserves room for the bottom-nav bar
 * (`BOTTOM_NAV_RESERVED_PX`).
 */

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";

export default function NotificationsPage() {
  const t = useTranslations();

  return (
    <ScreenBackground overlay="strong">
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{ paddingBottom: BOTTOM_NAV_RESERVED_PX + 16 }}
      >
        <h1
          className="px-1 text-[32px] font-black text-white"
          style={{ letterSpacing: "-0.5px" }}
        >
          {t("notificationsTitle")}
        </h1>
        <div className="flex flex-col items-center px-8 pt-28 text-center">
          <Bell size={44} className="text-white/60" aria-hidden />
          <div className="h-3" />
          <h2 className="text-[22px] font-black text-white">
            {t("notificationsEmptyTitle")}
          </h2>
          <div className="h-1.5" />
          <p className="text-[14px] text-white/70">
            {t("notificationsEmptySubtitle")}
          </p>
        </div>
      </div>
    </ScreenBackground>
  );
}
