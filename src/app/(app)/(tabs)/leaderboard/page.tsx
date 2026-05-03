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
import { useEffect, useRef } from "react";
import useSWR from "swr";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { getLeaderboard } from "@/lib/api/leaderboard";
import {
  type LeaderboardEntry,
  type LeaderboardMe,
  type LeaderboardSnapshot,
} from "@/lib/content/leaderboard-models";
import { useDeviceIdentity } from "@/stores/device-identity";
import { useNickname } from "@/stores/nickname";
import { usePathRepo } from "@/stores/path-repo";

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

  // Refetch the leaderboard whenever the locally-tracked total
  // points change. The home pill is driven by `progress.totalPoints`
  // (sum over completed-level entries, recomputed by `path-repo` on
  // every `completeLevel`), and is treated as the canonical number
  // by the UX. The leaderboard endpoint sometimes lags those writes
  // — either because the queue hasn't drained yet, or because the
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
      // First observed value after hydration — don't trigger a
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
    <ScreenBackground overlay="strong">
      {/* Why `min-h-0` and not `min-h-dvh`?
          `<ScreenBackground>` already gives us a full-viewport flex
          column. Re-asserting `min-h-dvh` here would force this
          container to grow with its children, defeating the
          `flex-1 overflow-y-auto` on the scroll body below — the page
          would scroll the *whole document* instead of just the list.
          `min-h-0` is the standard flexbox unlock that lets a `flex-1`
          child shrink below its content height and trigger overflow. */}
      <div className="flex min-h-0 flex-1 flex-col">
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
  // Local nickname override. The user can choose a display name on
  // first run (`/home` modal) or from `/profile`. Until the backend
  // `nickname_set` Edge Function is deployed, the `nickname_get` /
  // `leaderboard_get` server response still echoes the auto-assigned
  // name — we substitute the local value on the caller's row(s) and
  // sticky-me so the user sees their chosen name regardless. Other
  // devices keep showing the server value (cross-device propagation
  // is the backend's job once the function ships).
  const localNickname = useNickname((s) => s.value);

  // Local-points override. The home tab's points pill reads from
  // `progress.totalPoints` (sum over `progress.entries[i].points`,
  // recomputed locally by `path-repo` on every `completeLevel`),
  // and the product's stance is that this number is canonical. The
  // leaderboard endpoint occasionally lags it — either because the
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
  // the leaderboard at 0 pts, which clutters the podium with empty
  // monograms and pushes real climbers down the page. We keep the
  // sticky "You" card untouched: it still surfaces the caller's real
  // rank/points (even when 0) so a brand-new user gets feedback that
  // they're on the board — they just don't appear *in* the visible
  // top list until they've scored.
  //
  // Why filter client-side rather than in `parseLeaderboardSnapshot`?
  // The parser stays a transparent mirror of `leaderboard_get`'s
  // wire shape; if the backend later starts filtering server-side
  // this becomes a no-op rather than a contradicting double-filter.
  const top = overriddenTop.filter((e) => e.points > 0);
  if (top.length === 0) {
    // Snapshot might still include the caller via `snapshot.me` —
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

  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  const me = overriddenMe;
  // `meInTop` checks `snapshot.top` (the *unfiltered* list). After
  // hiding zeros, a caller with 0 pts who was technically present in
  // the API response now disappears from the rendered list — so we
  // re-derive against the filtered array.
  const meInRenderedTop =
    me !== null && top.some((e) => e.rank === me.rank && e.isMe === true);
  const showStickyMe = me !== null && !meInRenderedTop;

  return (
    <>
      <Header t={t} onRefresh={onRefresh} />
      {/* Scrollable body. The bottom-spacer trick: putting
          `padding-bottom` directly on a `overflow:auto` element is
          unreliable — Safari and Firefox don't include it in the
          scroll extent, so the last row stops flush with the
          container's bottom edge and gets hidden behind the fixed
          bottom-nav (and the sticky "You" card when present). Pushing
          the reserved space onto the inner content wrapper makes it
          part of the scrollable extent everywhere. */}
      <div className="flex-1 overflow-y-auto">
        <div
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
    <div className="flex items-center gap-3 px-5 pt-4 pb-2 phone-sm:px-4">
      <TrophyIcon size={36} color="#FFC107" />
      <h1
        className="min-w-0 flex-1 truncate text-[32px] font-black text-white phone-sm:text-[24px]"
        style={{ letterSpacing: "-0.5px" }}
      >
        {t("leaderboardTitle")}
      </h1>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh leaderboard"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
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
    <div className="flex items-end gap-1 px-4 pt-2 pb-2 phone-sm:px-2">
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
  // When the caller is one of the top 3 we draw extra attention to
  // their avatar disc with a continuous glow + gentle scale pulse —
  // same flavour as the home-tab `current` level node (`afk-pulse`
  // + ripple), but tuned for a smaller surface and an always-on
  // (rather than tap-to-start) context. Scope is intentionally
  // limited to the avatar so the layout doesn't shift and the rank
  // number / points stay readable.
  //
  // Implementation: a CSS keyframe animates `box-shadow` between
  // two glow strengths and `transform` between scale 1 and 1.06.
  // The animation runs on the avatar element; an outer absolutely
  // positioned ring expands+fades on a longer loop to add a subtle
  // halo without nesting more nodes than necessary. Both keyframes
  // are scoped via inline `<style>` so we don't have to touch
  // `globals.css` for one screen's flair.
  const isMe = entry.isMe;
  return (
    <div className="flex flex-col items-center">
      {showCrown && (
        <div className="pb-1">
          <TrophyIcon size={28} color={GOLD} />
        </div>
      )}
      <div
        className="relative"
        style={{ width: avatarSize, height: avatarSize }}
      >
        {/* Outward halo ring — only rendered for the caller. Sits
            *behind* the avatar (z-0) and expands beyond its bounds
            via a negative margin trick (`-inset-2`). `pointer-events`
            off so it never steals taps from a hypothetical future
            avatar press. The breathing animation is gated on
            `prefers-reduced-motion: no-preference` (see the <style>
            below) — users with motion sensitivity see a static ring. */}
        {isMe && (
          <span
            aria-hidden
            className="afk-podium-halo pointer-events-none absolute -inset-2 rounded-full"
            style={{
              border: `2px solid ${medalColor}`,
            }}
          />
        )}
        <div
          className={`relative flex h-full w-full items-center justify-center rounded-full border-[3px] border-white ${
            isMe ? "afk-podium-pulse" : ""
          }`}
          style={{
            backgroundColor: medalColor,
            // Default static glow for everyone in the podium; for
            // the caller, the keyframe (when not reduced-motion)
            // overrides this with a breathing version (lower → higher
            // spread). Reduced-motion users keep this static glow,
            // which is intentional — they still get the medal-tint
            // affordance, just without the animation.
            boxShadow: `0 0 16px 1px ${medalColor}99`,
            // Local custom prop so the keyframe can reference the
            // medal colour without us inlining a different set of
            // keyframes per rank.
            ["--afk-medal" as string]: medalColor,
          } as React.CSSProperties}
        >
          <span
            className="font-black text-black/85"
            style={{ fontSize: showCrown ? 30 : 24 }}
          >
            {monogram}
          </span>
        </div>
        {isMe && (
          <style>{`
            /*
             * Pulse + halo are gated on the user *not* having opted
             * into reduced motion. Inside the reduce branch the
             * keyframe names simply don't exist, so the
             * \`animation\` declarations below resolve to "no
             * animation" and the elements stay static (the avatar
             * keeps its base \`box-shadow\` glow, the halo ring
             * stays at its starting opacity/scale).
             *
             * We still emit the \`animation\` declarations
             * unconditionally so the shorthand structure is the
             * same in both branches — easier to reason about than
             * conditionally injecting the property.
             */
            .afk-podium-pulse {
              animation: afk-podium-pulse 1.4s ease-in-out infinite alternate;
            }
            .afk-podium-halo {
              animation: afk-podium-halo 1.6s ease-in-out infinite alternate;
            }
            @media (prefers-reduced-motion: no-preference) {
              @keyframes afk-podium-pulse {
                0% {
                  transform: scale(1);
                  box-shadow: 0 0 12px 1px var(--afk-medal);
                }
                100% {
                  transform: scale(1.06);
                  box-shadow: 0 0 22px 4px var(--afk-medal);
                }
              }
              @keyframes afk-podium-halo {
                0% {
                  transform: scale(1);
                  opacity: 0.55;
                }
                100% {
                  transform: scale(1.18);
                  opacity: 0;
                }
              }
            }
            /*
             * Belt-and-braces: explicitly cancel the animation
             * shorthand under reduce-motion. Some engines retain
             * a degenerate "running" animation state when the
             * referenced keyframes are missing, which can subtly
             * affect compositing layers. \`animation: none\`
             * forces the element back to its declared static
             * styles.
             */
            @media (prefers-reduced-motion: reduce) {
              .afk-podium-pulse,
              .afk-podium-halo {
                animation: none;
              }
            }
          `}</style>
        )}
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
        className="line-clamp-1 min-w-0 flex-1 text-[15px]"
        style={{
          color: me ? PRIMARY : "#FFFFFF",
          fontWeight: me ? 800 : 600,
        }}
      >
        {entry.nickname}
      </span>
      <span
        className="shrink-0 text-[16px] font-black"
        style={{ color: me ? PRIMARY : "#FFFFFF" }}
      >
        {entry.points}
      </span>
      <span className="w-1" />
      <span
        className="shrink-0 text-[12px]"
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
        <div className="flex min-w-0 flex-1 flex-col">
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
