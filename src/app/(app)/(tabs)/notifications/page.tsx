"use client";

/**
 * Notifications tab — port of `lib/features/notifications/notifications_screen.dart`.
 *
 * Pure static placeholder: 3 hard-coded samples (level unlocked,
 * first-recording badge, leaderboard climb) until a real
 * notifications backend exists. Each row is a white pill with a
 * coloured circular icon avatar (lock-open green / premium amber /
 * trending-up blue), a bold title, and a muted body.
 *
 * Differences from Flutter: none meaningful. Inline SVGs replace
 * Material icons; bottom padding reserves room for the bottom-nav
 * bar (`BOTTOM_NAV_RESERVED_PX`) instead of the `100` magic number
 * Flutter uses.
 */

import { useTranslations } from "next-intl";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";

interface NotifSample {
  /** Inline SVG element rendered inside the avatar circle. */
  icon: React.ReactNode;
  /** Avatar accent (`backgroundColor` is rendered at 18% opacity). */
  color: string;
  title: string;
  body: string;
}

export default function NotificationsPage() {
  const t = useTranslations();

  const samples: NotifSample[] = [
    {
      icon: <LockOpenIcon />,
      color: "#66BB6A",
      title: t("notificationsSampleLevelUnlockedTitle"),
      body: t("notificationsSampleLevelUnlockedBody"),
    },
    {
      icon: <PremiumIcon />,
      color: "#FFC02E",
      title: t("notificationsSampleBadgeTitle"),
      body: t("notificationsSampleBadgeBody"),
    },
    {
      icon: <TrendingUpIcon />,
      color: "#2196F3",
      title: t("notificationsSampleRankTitle"),
      body: t("notificationsSampleRankBody"),
    },
  ];

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
        <div className="h-4" />
        <ul className="flex flex-col gap-2.5">
          {samples.map((n, i) => (
            <li key={i}>
              <NotifTile notif={n} />
            </li>
          ))}
        </ul>
      </div>
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

function NotifTile({ notif }: { notif: NotifSample }) {
  return (
    <div className="flex items-start rounded-2xl bg-white p-3.5">
      {/* Avatar: 44px circle, accent at 18% alpha. The `2D` hex
          suffix is 18% on a 0..255 scale, matching Flutter's
          `withValues(alpha: 0.18)`. */}
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: `${notif.color}2E` }}
      >
        <span style={{ color: notif.color }} className="block">
          {notif.icon}
        </span>
      </div>
      <div className="w-3" />
      <div className="flex flex-1 flex-col">
        <h3 className="text-[16px] font-extrabold text-black/85">
          {notif.title}
        </h3>
        <div className="h-1" />
        <p className="text-[13px] text-black/70">{notif.body}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function LockOpenIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 17a2 2 0 100-4 2 2 0 000 4zm6-9h-1V6a5 5 0 00-9.9-1h2.02A3 3 0 0115 6v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zm0 12H6V10h12v10z" />
    </svg>
  );
}

function PremiumIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9.68 13.69L12 11.93l2.31 1.76-.88-2.85L15.75 9h-2.84L12 6.19 11.09 9H8.25l2.31 1.84-.88 2.85zM20 10c0-4.42-3.58-8-8-8s-8 3.58-8 8c0 2.03.76 3.87 2 5.28V23l6-2 6 2v-7.72A7.96 7.96 0 0020 10zm-8-6a6 6 0 110 12 6 6 0 010-12zm0 14.18l-4 1.34V16.9c1.18.69 2.54 1.1 4 1.1s2.82-.41 4-1.1v2.62l-4-1.34z" />
    </svg>
  );
}

function TrendingUpIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" />
    </svg>
  );
}
