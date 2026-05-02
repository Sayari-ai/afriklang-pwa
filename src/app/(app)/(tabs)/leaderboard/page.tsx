"use client";

/**
 * Leaderboard tab — port of `lib/features/leaderboard/leaderboard_screen.dart`.
 *
 * Layout (from the top):
 *   1. Header: trophy + "Leaderboard" title.
 *   2. Podium: rank 2 / rank 1 (centered, taller, with crown) / rank 3.
 *   3. Ranked list rows for ranks 4..50 (or however many `top` returns).
 *   4. Sticky "You" footer card when the caller is *not* in the top
 *      list (i.e. `me != null && !meInTop(snapshot)`).
 *
 * Loading / error / empty mirrors Flutter:
 *   - Loading: white spinner centered.
 *   - Error: cloud-off icon + bold title + message + Retry pill.
 *   - Empty: hourglass icon + "No scores yet" + encourage-CTA copy.
 *
 * Data:
 *   - SWR keyed on `["leaderboard", deviceId]`. The fetcher calls
 *     `getLeaderboard(deviceId)` (Edge Function `leaderboard_get`).
 *   - Pull-to-refresh isn't a thing on web, so we replace it with a
 *     small "refresh" button in the header (Flutter has a real
 *     `RefreshIndicator` because mobile users expect the gesture).
 *   - `revalidateOnFocus: true` keeps the list fresh when the tab
 *     regains focus — the closest desktop equivalent to PTR.
 *
 * Differences from Flutter:
 *   - No `RefreshIndicator`; explicit refresh button + on-focus
 *     revalidation via SWR (web idiom).
 *   - Sticky "You" sits above the bottom-nav (offset by
 *     `BOTTOM_NAV_RESERVED_PX`); Flutter inserts safe-area inset
 *     manually.
 *   - `meInTop` is a free function in our content layer, not a
 *     property of the snapshot.
 */

import { useTranslations } from "next-intl";
import useSWR from "swr";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { getLeaderboard } from "@/lib/api/leaderboard";
import {
  type LeaderboardEntry,
  type LeaderboardMe,
  type LeaderboardSnapshot,
  meInTop,
} from "@/lib/content/leaderboard-models";
import { useDeviceIdentity } from "@/stores/device-identity";

// Brand primary — kept inline rather than imported to avoid a one-shot
// dep on `colors.ts` (the rest of this screen uses tokens that aren't
// in AppColors anyway: gold/silver/bronze).
const PRIMARY = "#00539F";

const GOLD = "#FFD700";
const SILVER = "#C0C0C0";
const BRONZE = "#CD7F32";

export default function LeaderboardPage() {
  const t = useTranslations();

  // Device id is read once on mount. `ensure()` is idempotent and
  // safe to call from a Zustand selector — but we want it reactive
  // so the SWR key updates if the id is rotated.
  const deviceId = useDeviceIdentity((s) => s.deviceId) ?? useDeviceIdentity.getState().ensure();

  const { data, error, isLoading, mutate } = useSWR<LeaderboardSnapshot>(
    deviceId ? ["leaderboard", deviceId] : null,
    ([, id]) => getLeaderboard(id as string),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      // Don't auto-poll. The Flutter version doesn't either; users
      // pull-to-refresh manually.
      refreshInterval: 0,
    },
  );

  const onRefresh = () => {
    void mutate();
  };

  return (
    <ScreenBackground overlay="strong">
      <div className="flex min-h-dvh flex-1 flex-col">
        {isLoading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState
            message={error instanceof Error ? error.message : String(error)}
            onRetry={onRefresh}
            t={t}
          />
        ) : data ? (
          <LoadedView snapshot={data} onRefresh={onRefresh} t={t} />
        ) : (
          // Should never hit; SWR returns at least one of the above.
          <LoadingState />
        )}
      </div>
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <span
        role="progressbar"
        aria-label="Loading"
        className="block h-10 w-10 animate-spin rounded-full border-[3px] border-white/30 border-t-white"
      />
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  t,
}: {
  message: string;
  onRetry: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <CloudOffIcon />
      <div className="h-3" />
      <h2 className="text-[22px] font-black text-white">
        {t("leaderboardErrorTitle")}
      </h2>
      <div className="h-2" />
      <p className="text-[14px] text-white/85">{message}</p>
      <div className="h-4" />
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-white px-6 py-3 text-[16px] font-bold"
        style={{ color: PRIMARY }}
      >
        {t("commonRetry")}
      </button>
    </div>
  );
}

function EmptyState({
  t,
}: {
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-32 text-center">
      <HourglassIcon />
      <div className="h-3" />
      <h2 className="text-[22px] font-black text-white">
        {t("leaderboardEmptyTitle")}
      </h2>
      <div className="h-1.5" />
      <p className="text-[14px] text-white/70">
        {t("leaderboardEmptySubtitle")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loaded view
// ---------------------------------------------------------------------------

function LoadedView({
  snapshot,
  onRefresh,
  t,
}: {
  snapshot: LeaderboardSnapshot;
  onRefresh: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const top = snapshot.top;
  if (top.length === 0) {
    return (
      <>
        <Header t={t} onRefresh={onRefresh} />
        <div className="flex-1 overflow-y-auto">
          <EmptyState t={t} />
        </div>
      </>
    );
  }

  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  const me = snapshot.me;
  const showStickyMe = me !== null && !meInTop(snapshot);

  return (
    <>
      <Header t={t} onRefresh={onRefresh} />
      {/* Scrollable body. Bottom padding reserves room for the
          sticky-me card + the bottom-nav so the last list row never
          hides behind either. */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          paddingBottom: showStickyMe
            ? BOTTOM_NAV_RESERVED_PX + 96
            : BOTTOM_NAV_RESERVED_PX + 16,
        }}
      >
        <Podium top={podium} t={t} />
        {rest.length > 0 && (
          <div className="flex flex-col gap-2 px-4 pt-4">
            {rest.map((e) => (
              <RankRow key={e.rank} entry={e} t={t} />
            ))}
          </div>
        )}
      </div>
      {showStickyMe && me && <StickyMe me={me} t={t} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  t,
  onRefresh,
}: {
  t: ReturnType<typeof useTranslations>;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center px-5 pt-4 pb-2">
      <TrophyIcon size={36} color="#FFC107" />
      <div className="w-3" />
      <h1
        className="flex-1 text-[32px] font-black text-white"
        style={{ letterSpacing: "-0.5px" }}
      >
        {t("leaderboardTitle")}
      </h1>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh leaderboard"
        className="flex h-10 w-10 items-center justify-center rounded-full text-white"
      >
        <RefreshIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Podium
// ---------------------------------------------------------------------------

function Podium({
  top,
  t,
}: {
  top: LeaderboardEntry[];
  t: ReturnType<typeof useTranslations>;
}) {
  // Render order on screen: rank 2, rank 1 (center), rank 3 — matches
  // Flutter `_Podium`. We pick by rank rather than array index in
  // case the backend ever returns an unsorted page.
  const p1 = top.find((e) => e.rank === 1) ?? top[0]!;
  const p2 = top.find((e) => e.rank === 2) ?? null;
  const p3 = top.find((e) => e.rank === 3) ?? null;

  return (
    <div className="flex items-end px-4 pt-2 pb-2">
      <div className="flex-1">
        {p2 ? (
          <PodiumColumn entry={p2} medalColor={SILVER} height={110} t={t} />
        ) : null}
      </div>
      <div className="flex-1">
        <PodiumColumn
          entry={p1}
          medalColor={GOLD}
          height={150}
          showCrown
          t={t}
        />
      </div>
      <div className="flex-1">
        {p3 ? (
          <PodiumColumn entry={p3} medalColor={BRONZE} height={90} t={t} />
        ) : null}
      </div>
    </div>
  );
}

function PodiumColumn({
  entry,
  medalColor,
  height,
  showCrown = false,
  t,
}: {
  entry: LeaderboardEntry;
  medalColor: string;
  height: number;
  showCrown?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const monogram = entry.nickname ? entry.nickname[0]!.toUpperCase() : "?";
  const avatarSize = showCrown ? 72 : 60;
  return (
    <div className="flex flex-col items-center">
      {showCrown && (
        <div className="pb-1">
          <TrophyIcon size={28} color={GOLD} />
        </div>
      )}
      <div
        className="flex items-center justify-center rounded-full border-[3px] border-white"
        style={{
          width: avatarSize,
          height: avatarSize,
          backgroundColor: medalColor,
          boxShadow: `0 0 16px 1px ${medalColor}99`,
        }}
      >
        <span
          className="font-black text-black/85"
          style={{ fontSize: showCrown ? 30 : 24 }}
        >
          {monogram}
        </span>
      </div>
      <div className="h-1.5" />
      <p
        className="line-clamp-1 text-center text-[12px] font-bold"
        style={{ color: entry.isMe ? "#FFD740" : "#FFFFFF" }}
      >
        {entry.nickname}
      </p>
      <div className="h-1.5" />
      <div
        className="flex w-full flex-col items-center px-1.5 pt-2"
        style={{
          height,
          background: `linear-gradient(to bottom, ${medalColor}F2, ${medalColor}80)`,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <span className="text-[22px] font-black text-black/85">
          #{entry.rank}
        </span>
        <div className="h-1" />
        <span className="text-[14px] font-bold text-black/85">
          {entry.points}
        </span>
        <span className="text-[10px] text-black/55">
          {t("leaderboardPointsAbbrev")}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rank row
// ---------------------------------------------------------------------------

function RankRow({
  entry,
  t,
}: {
  entry: LeaderboardEntry;
  t: ReturnType<typeof useTranslations>;
}) {
  const me = entry.isMe;
  const monogram = entry.nickname ? entry.nickname[0]!.toUpperCase() : "?";
  return (
    <div
      className="flex items-center rounded-[14px] px-3 py-2.5"
      style={{
        backgroundColor: me ? "#FFFFFF" : "rgba(255,255,255,0.12)",
        border: me
          ? "2px solid #FFD740"
          : "1px solid rgba(255,255,255,0.18)",
        color: me ? PRIMARY : "#FFFFFF",
      }}
    >
      <span
        className="text-[16px] font-black"
        style={{ width: 32, color: me ? PRIMARY : "#FFFFFF" }}
      >
        #{entry.rank}
      </span>
      <div className="w-2" />
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: me ? PRIMARY : "rgba(255,255,255,0.24)" }}
      >
        <span className="text-[16px] font-black text-white">{monogram}</span>
      </div>
      <div className="w-3" />
      <span
        className="line-clamp-1 flex-1 text-[15px]"
        style={{
          color: me ? PRIMARY : "#FFFFFF",
          fontWeight: me ? 800 : 600,
        }}
      >
        {entry.nickname}
      </span>
      <span
        className="text-[16px] font-black"
        style={{ color: me ? PRIMARY : "#FFFFFF" }}
      >
        {entry.points}
      </span>
      <span className="w-1" />
      <span
        className="text-[12px]"
        style={{
          color: me ? `${PRIMARY}B3` : "rgba(255,255,255,0.7)",
        }}
      >
        {t("leaderboardPointsAbbrev")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky "You"
// ---------------------------------------------------------------------------

function StickyMe({
  me,
  t,
}: {
  me: LeaderboardMe;
  t: ReturnType<typeof useTranslations>;
}) {
  const monogram = me.nickname ? me.nickname[0]!.toUpperCase() : "?";
  return (
    <div
      className="absolute inset-x-0 bg-white px-5 py-3.5"
      style={{
        bottom: BOTTOM_NAV_RESERVED_PX,
        boxShadow: "0 -4px 16px rgba(0,0,0,0.25)",
      }}
    >
      <div className="flex items-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: PRIMARY }}
        >
          <span className="text-[20px] font-black text-white">{monogram}</span>
        </div>
        <div className="w-3" />
        <div className="flex flex-1 flex-col">
          <span
            className="line-clamp-1 text-[15px] font-black"
            style={{ color: PRIMARY }}
          >
            {t("leaderboardYouLine", { nickname: me.nickname })}
          </span>
          <span className="text-[13px] font-semibold text-black/85">
            {t("leaderboardYouRankOf", {
              rank: me.rank,
              totalDevices: me.totalDevices,
            })}
          </span>
        </div>
        <div
          className="rounded-[20px] px-3 py-1.5"
          style={{ backgroundColor: PRIMARY }}
        >
          <span className="text-[14px] font-black text-white">
            {t("leaderboardYouPointsPill", { points: me.points })}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons (avoid extra deps for one-shot SVGs)
// ---------------------------------------------------------------------------

function TrophyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden
    >
      <path d="M19 4h-2V2H7v2H5a2 2 0 00-2 2v2c0 2.21 1.79 4 4 4 .57 1.07 1.49 1.93 2.6 2.42L9 18H7v2h10v-2h-2l-.6-3.58A4.99 4.99 0 0017 10c2.21 0 4-1.79 4-4V6a2 2 0 00-2-2zM5 8V6h2v2c0 .35.04.69.1 1.02C5.95 8.65 5 7.42 5 6V8zm14 0c0 1.42-.95 2.65-2.1 3.02.06-.33.1-.67.1-1.02V6h2v2z" />
    </svg>
  );
}

function CloudOffIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="white" aria-hidden>
      <path d="M19.35 10.04A7.49 7.49 0 0012 4c-1.4 0-2.7.39-3.82 1.06l1.49 1.49C10.4 6.2 11.18 6 12 6a5.5 5.5 0 015.5 5.5v.5H19a3 3 0 011.95 5.27l1.42 1.42A4.99 4.99 0 0024 14a5 5 0 00-4.65-3.96zM3 5.27l2.77 2.77A4.99 4.99 0 003 13a5 5 0 005 5h11.73l2 2L23 18.73 4.27 4 3 5.27z" />
    </svg>
  );
}

function HourglassIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="white" aria-hidden>
      <path d="M6 2v6c0 1.79.71 3.42 1.86 4.59L9.36 14H8v6h8v-6h-1.36l1.5-1.41A6.46 6.46 0 0018 8V2H6zm10 6c0 1.34-.53 2.55-1.41 3.41L13 13l1.59 1.59A4.46 4.46 0 0116 18H8c0-1.34.53-2.55 1.41-3.41L11 13l-1.59-1.59A4.46 4.46 0 018 8V4h8v4z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden>
      <path d="M17.65 6.35A8 8 0 1019.46 15h-2.1a6 6 0 11-1.4-6.24L13 12h7V5l-2.35 1.35z" />
    </svg>
  );
}
