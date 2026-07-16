"use client";

/**
 * Leaderboard tab league-style ranking list (flat redesign).
 *
 * Layout (from the top):
 *   1. Header: bold title + outline refresh button.
 *   2. Ranked rows for every entry (Duolingo league style): medal
 *      discs for ranks 1-3, plain rank numbers below, colored
 *      monogram avatars, points right-aligned. The caller's row gets
 *      the light-blue highlight treatment.
 *   3. Sticky "You" footer card when the caller is *not* in the top
 *      list (i.e. `me != null && !meInTop(snapshot)`).
 *
 * Loading / error / empty:
 *   - Loading: green spinner centered.
 *   - Error: cloud-off icon + bold title + message + Retry button.
 *   - Empty: mascot + "No scores yet" + encourage-CTA copy.
 *
 * Data:
 *   - SWR keyed on `["leaderboard", deviceId]`. The fetcher calls
 *     `getLeaderboard(deviceId)` (Edge Function `leaderboard_get`).
 *   - Pull-to-refresh isn't a thing on web, so we replace it with a
 *     small "refresh" button in the header.
 *   - `revalidateOnFocus: true` keeps the list fresh when the tab
 *     regains focus the closest desktop equivalent to PTR.
 */

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import useSWR from "swr";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Spinner } from "@/components/ui/icons";
import { Mascot } from "@/components/ui/mascot";
import { Palette } from "@/lib/colors";
import { getLeaderboard } from "@/lib/api/leaderboard";
import {
  type LeaderboardEntry,
  type LeaderboardMe,
  type LeaderboardSnapshot,
} from "@/lib/content/leaderboard-models";
import { useDeviceIdentity } from "@/stores/device-identity";
import { useNickname } from "@/stores/nickname";
import { usePathRepo } from "@/stores/path-repo";

const MEDALS = [Palette.medalGold, Palette.medalSilver, Palette.medalBronze];

/** Avatar hues cycled by rank the brand ramp keeps the list
 *  colorful without leaving the palette. */
const AVATAR_COLORS = [
  Palette.primary,
  Palette.orange,
  Palette.purple,
  Palette.purpleDeep,
  Palette.orangeDeep,
  Palette.primaryDeep,
];

export default function LeaderboardPage() {
  const t = useTranslations();

  // Device id is read once on mount. `ensure()` is idempotent and
  // safe to call from a Zustand selector but we want it reactive
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

  // Refetch the leaderboard whenever the locally-tracked total
  // points change. The home pill is driven by `progress.totalPoints`
  // (sum over completed-level entries, recomputed by `path-repo` on
  // every `completeLevel`), and is treated as the canonical number
  // by the UX. The leaderboard endpoint sometimes lags those writes
  // either because the queue hasn't drained yet, or because the
  // backend's `leaderboard_get` query reads from a different table
  // that isn't immediately consistent. Calling `mutate()` here
  // forces SWR to refetch as soon as the local total moves, which
  // closes most of the gap once the server *has* caught up. The
  // remaining gap (server still stale, or offline) is handled by
  // the per-row `Math.max(server, local)` override applied inside
  // `LoadedView`.
  //
  // Why a ref-guarded effect rather than a deps-array on the SWR
  // key? Folding `localTotalPoints` into the SWR key would force
  // brand-new subscriptions on every change, throwing away the
  // cached snapshot and flashing a loading state. We want to keep
  // the existing data on screen and just trigger a background
  // revalidation.
  const localTotalPoints = usePathRepo((s) => s.progress?.totalPoints ?? null);
  const lastSeenLocalTotal = useRef<number | null>(null);
  useEffect(() => {
    if (localTotalPoints === null) return;
    if (lastSeenLocalTotal.current === null) {
      // First observed value after hydration don't trigger a
      // refetch (SWR's initial fetch is already in flight).
      lastSeenLocalTotal.current = localTotalPoints;
      return;
    }
    if (localTotalPoints !== lastSeenLocalTotal.current) {
      lastSeenLocalTotal.current = localTotalPoints;
      void mutate();
    }
  }, [localTotalPoints, mutate]);

  const onRefresh = () => {
    void mutate();
  };

  return (
    <div
      className="flex h-dvh w-full flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
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
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center text-primary">
      <Spinner className="h-10 w-10" />
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
      <h2 className="text-[22px] font-extrabold text-text">
        {t("leaderboardErrorTitle")}
      </h2>
      <div className="h-2" />
      <p className="text-[14px] font-semibold text-text-muted">{message}</p>
      <div className="h-5" />
      <Button variant="primary" size="md" onClick={onRetry}>
        {t("commonRetry")}
      </Button>
    </div>
  );
}

function EmptyState({
  t,
}: {
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-20 text-center">
      <Mascot size={110} />
      <div className="h-4" />
      <h2 className="text-[22px] font-extrabold text-text">
        {t("leaderboardEmptyTitle")}
      </h2>
      <div className="h-1.5" />
      <p className="text-[14px] font-semibold text-text-muted">
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
  // Local nickname override. The user can choose a display name on
  // first run (`/home` modal) or from `/profile`. Until the backend
  // `nickname_set` Edge Function is deployed, the `nickname_get` /
  // `leaderboard_get` server response still echoes the auto-assigned
  // name we substitute the local value on the caller's row(s) and
  // sticky-me so the user sees their chosen name regardless. Other
  // devices keep showing the server value (cross-device propagation
  // is the backend's job once the function ships).
  const localNickname = useNickname((s) => s.value);

  // Local-points override. The home tab's points counter reads from
  // `progress.totalPoints` (sum over `progress.entries[i].points`,
  // recomputed locally by `path-repo` on every `completeLevel`),
  // and the product's stance is that this number is canonical. The
  // leaderboard endpoint occasionally lags it either because the
  // progress write is still queued (offline), or because the
  // backend's `leaderboard_get` query is read-from-replica /
  // populated by a delayed view. To keep a single visible truth,
  // we lift the caller's `points` on the leaderboard to
  // `max(serverReported, localTotal)`. We never *lower* it: a
  // smaller server-side number could legitimately reflect an
  // anti-cheat correction or a moderation action and we shouldn't
  // mask that.
  const localTotal = usePathRepo((s) => s.progress?.totalPoints ?? null);
  const liftPoints = (serverPoints: number): number =>
    localTotal === null ? serverPoints : Math.max(serverPoints, localTotal);

  // Apply both overrides exactly once at the top of the view, then
  // pass the patched snapshot down. Cheaper than threading the
  // overrides through every leaf component.
  const overriddenTop: LeaderboardEntry[] = snapshot.top.map((e) => {
    if (!e.isMe) return e;
    const points = liftPoints(e.points);
    const nickname = localNickname ?? e.nickname;
    return points === e.points && nickname === e.nickname
      ? e
      : { ...e, points, nickname };
  });
  const overriddenMe: LeaderboardMe | null = snapshot.me
    ? {
        ...snapshot.me,
        points: liftPoints(snapshot.me.points),
        nickname: localNickname ?? snapshot.me.nickname,
      }
    : null;

  // Hide zero-point entries from the top list. A freshly-claimed
  // device row (or a user who hasn't completed a level yet) lands on
  // the leaderboard at 0 pts, which clutters the list with empty
  // monograms and pushes real climbers down the page. We keep the
  // sticky "You" card untouched: it still surfaces the caller's real
  // rank/points (even when 0) so a brand-new user gets feedback that
  // they're on the board they just don't appear *in* the visible
  // top list until they've scored.
  //
  // Why filter client-side rather than in `parseLeaderboardSnapshot`?
  // The parser stays a transparent mirror of `leaderboard_get`'s
  // wire shape; if the backend later starts filtering server-side
  // this becomes a no-op rather than a contradicting double-filter.
  const top = overriddenTop.filter((e) => e.points > 0);
  if (top.length === 0) {
    // Snapshot might still include the caller via `snapshot.me` 
    // render the sticky-me card over the empty state so a new user
    // sees their own zero-row even when no one else qualifies.
    const me = overriddenMe;
    return (
      <>
        <Header t={t} onRefresh={onRefresh} />
        <div className="flex-1 overflow-y-auto">
          <EmptyState t={t} />
        </div>
        {me && <StickyMe me={me} t={t} />}
      </>
    );
  }

  const me = overriddenMe;
  // `meInTop` checks `snapshot.top` (the *unfiltered* list). After
  // hiding zeros, a caller with 0 pts who was technically present in
  // the API response now disappears from the rendered list so we
  // re-derive against the filtered array.
  const meInRenderedTop =
    me !== null && top.some((e) => e.rank === me.rank && e.isMe === true);
  const showStickyMe = me !== null && !meInRenderedTop;

  return (
    <>
      <Header t={t} onRefresh={onRefresh} />
      {/* Scrollable body. The bottom-spacer trick: putting
          `padding-bottom` directly on a `overflow:auto` element is
          unreliable Safari and Firefox don't include it in the
          scroll extent, so the last row stops flush with the
          container's bottom edge and gets hidden behind the fixed
          bottom-nav (and the sticky "You" card when present). Pushing
          the reserved space onto the inner content wrapper makes it
          part of the scrollable extent everywhere. */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="flex flex-col gap-1.5 px-4 pt-2"
          style={{
            paddingBottom: showStickyMe
              ? BOTTOM_NAV_RESERVED_PX + 96
              : BOTTOM_NAV_RESERVED_PX + 16,
          }}
        >
          {top.map((e) => (
            <RankRow key={e.rank} entry={e} t={t} />
          ))}
        </div>
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
    <div className="flex items-center gap-3 px-5 pb-3 pt-4 phone-sm:px-4">
      <h1 className="min-w-0 flex-1 truncate text-[26px] font-extrabold text-text phone-sm:text-[22px]">
        {t("leaderboardTitle")}
      </h1>
      <IconButton
        icon={RefreshCw}
        label={t("leaderboardRefreshLabel")}
        size={40}
        variant="outline"
        iconColor="#00539F"
        onClick={onRefresh}
      />
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
  const avatarColor = AVATAR_COLORS[(entry.rank - 1) % AVATAR_COLORS.length]!;
  return (
    <div
      className={`flex items-center rounded-2xl px-3 py-2.5 ${
        me ? "border-2 border-blue-border bg-blue-light" : ""
      }`}
    >
      {/* Rank: medal disc for the top 3, plain number below. */}
      <span className="flex w-9 shrink-0 items-center justify-center">
        {entry.rank <= 3 ? (
          <MedalDisc rank={entry.rank} />
        ) : (
          <span className="text-[16px] font-extrabold text-blue">
            {entry.rank}
          </span>
        )}
      </span>
      <div className="w-2.5" />
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: avatarColor }}
      >
        <span className="text-[17px] font-extrabold text-white">
          {monogram}
        </span>
      </div>
      <div className="w-3" />
      <span
        className={`line-clamp-1 min-w-0 flex-1 text-[15px] ${
          me ? "font-extrabold text-text" : "font-bold text-text"
        }`}
      >
        {entry.nickname}
      </span>
      <span className="shrink-0 text-[15px] font-extrabold text-text-muted">
        {entry.points}
      </span>
      <span className="w-1" />
      <span className="shrink-0 text-[12px] font-bold text-text-faint">
        {t("leaderboardPointsAbbrev")}
      </span>
    </div>
  );
}

/** Gold / silver / bronze medal disc with the rank numeral. */
function MedalDisc({ rank }: { rank: number }) {
  const color = MEDALS[rank - 1] ?? Palette.medalBronze;
  return (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-full"
      style={{
        backgroundColor: color,
        boxShadow: `inset 0 -3px 0 rgba(0,0,0,0.18)`,
      }}
    >
      <span className="text-[14px] font-extrabold text-white">{rank}</span>
    </span>
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
      className="absolute inset-x-0 border-t-2 border-border bg-bg px-5 py-3.5"
      style={{ bottom: BOTTOM_NAV_RESERVED_PX }}
    >
      <div className="flex items-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary">
          <span className="text-[19px] font-extrabold text-white">
            {monogram}
          </span>
        </div>
        <div className="w-3" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-1 text-[15px] font-extrabold text-text">
            {t("leaderboardYouLine", { nickname: me.nickname })}
          </span>
          <span className="text-[13px] font-semibold text-text-muted">
            {t("leaderboardYouRankOf", {
              rank: me.rank,
              totalDevices: me.totalDevices,
            })}
          </span>
        </div>
        <div className="rounded-full bg-yellow-light px-3 py-1.5">
          <span className="text-[14px] font-extrabold text-orange-deep">
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

function CloudOffIcon() {
  // Hex, not var(): SVG `fill` attributes don't resolve CSS vars.
  // Purple-tinted faint neutral (--color-text-faint).
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="#A9A1BC" aria-hidden>
      <path d="M19.35 10.04A7.49 7.49 0 0012 4c-1.4 0-2.7.39-3.82 1.06l1.49 1.49C10.4 6.2 11.18 6 12 6a5.5 5.5 0 015.5 5.5v.5H19a3 3 0 011.95 5.27l1.42 1.42A4.99 4.99 0 0024 14a5 5 0 00-4.65-3.96zM3 5.27l2.77 2.77A4.99 4.99 0 003 13a5 5 0 005 5h11.73l2 2L23 18.73 4.27 4 3 5.27z" />
    </svg>
  );
}
