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
 * Layout mirrors the leaderboard's `EmptyState` (centered icon, bold
 * white title, muted subtitle) for cross-tab consistency. Bottom
 * padding reserves room for the bottom-nav bar
 * (`BOTTOM_NAV_RESERVED_PX`).
 */

import { useTranslations } from "next-intl";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import {
  GameEnvelope,
  GameIconHalo,
} from "@/components/game/glossy-icons";

export default function NotificationsPage() {
  const t = useTranslations();

  return (
    <ScreenBackground overlay="strong">
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{ paddingBottom: BOTTOM_NAV_RESERVED_PX + 16 }}
      >
        <h1 className="text-outline px-1 font-game text-[30px] tracking-wide text-cream">
          {t("notificationsTitle")}
        </h1>
        <div className="flex flex-col items-center px-8 pt-20 text-center">
          <GameIconHalo size={132}>
            <GameEnvelope className="h-[66%] w-[66%]" />
          </GameIconHalo>
          <div className="h-3" />
          <h2 className="text-outline font-game text-[24px] tracking-wide text-cream">
            {t("notificationsEmptyTitle")}
          </h2>
          <div className="h-1.5" />
          <p className="text-[14px] font-medium text-cream/80">
            {t("notificationsEmptySubtitle")}
          </p>
        </div>
      </div>
    </ScreenBackground>
  );
}
