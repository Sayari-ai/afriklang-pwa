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
import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import useSWR from "swr";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import {
  GameHourglass,
  GameIconHalo,
  GameTrophy,
} from "@/components/game/glossy-icons";
import { WoodButton } from "@/components/game/wood-button";
import { WoodIconButton } from "@/components/game/wood-icon-button";
import { getLeaderboard } from "@/lib/api/leaderboard";
import {
  type LeaderboardEntry,
  type LeaderboardMe,
  type LeaderboardSnapshot,
} from "@/lib/content/leaderboard-models";
import { useDeviceIdentity } from "@/stores/device-identity";
import { useNickname } from "@/stores/nickname";
import { usePathRepo } from "@/stores/path-repo";

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
        className="block h-10 w-10 animate-spin rounded-full border-[3px] border-cream/30 border-t-cream"
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
      <h2 className="text-outline font-game text-[24px] tracking-wide text-cream">
        {t("leaderboardErrorTitle")}
      </h2>
      <div className="h-2" />
      <p className="text-[14px] font-medium text-cream/90">{message}</p>
      <div className="h-5" />
      <WoodButton tone="green" size="md" grass={false} onClick={onRetry}>
        {t("commonRetry")}
      </WoodButton>
    </div>
  );
}

function EmptyState({
  t,
}: {
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-24 text-center">
      <GameIconHalo size={132}>
        <GameHourglass className="h-[64%] w-[64%]" />
      </GameIconHalo>
      <div className="h-3" />
      <h2 className="text-outline font-game text-[24px] tracking-wide text-cream">
        {t("leaderboardEmptyTitle")}
      </h2>
      <div className="h-1.5" />
      <p className="text-[14px] font-medium text-cream/80">
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
      <GameTrophy size={40} className="shrink-0" />
      <h1 className="text-outline min-w-0 flex-1 truncate font-game text-[30px] tracking-wide text-cream phone-sm:text-[23px]">
        {t("leaderboardTitle")}
      </h1>
      <WoodIconButton
        icon={RefreshCw}
        label="Refresh leaderboard"
        size={40}
        grass={false}
        onClick={onRefresh}
      />
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
          <GameTrophy size={32} />
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
          className={`relative flex h-full w-full items-center justify-center rounded-full border-[3px] border-cream ${
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
        style={{
          color: entry.isMe ? "#FFD740" : "var(--color-cream)",
          textShadow: "0 1px 0 rgba(0,0,0,0.5)",
        }}
      >
        {entry.nickname}
      </p>
      <div className="h-1.5" />
      {/* Wooden plinth with a medal-coloured cap. */}
      <div
        className="flex w-full flex-col items-center px-1.5 pt-2"
        style={{
          height,
          background:
            "linear-gradient(180deg, var(--color-wood-panel-light) 0%, var(--color-wood-panel-dark) 100%)",
          border: "2px solid var(--color-wood-rim)",
          borderBottom: "none",
          borderTop: `6px solid ${medalColor}`,
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
          boxShadow:
            "inset 0 2px 0 rgba(255,235,200,0.35), 0 6px 10px rgba(0,0,0,0.3)",
        }}
      >
        <span className="text-outline font-game text-[22px] text-cream">
          #{entry.rank}
        </span>
        <div className="h-1" />
        <span
          className="text-[14px] font-bold text-cream"
          style={{ textShadow: "0 1px 0 rgba(92,48,24,0.6)" }}
        >
          {entry.points}
        </span>
        <span className="text-[10px] font-semibold text-cream/70">
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
  // "Me" rows sit on a lit wooden plank (dark ink text); everyone
  // else gets a carved dark slot (cream text).
  const textColor = me ? "var(--color-ink)" : "var(--color-cream)";
  return (
    <div
      className="flex items-center rounded-[14px] px-3 py-2.5"
      style={
        me
          ? {
              background:
                "linear-gradient(180deg, var(--color-wood-panel-light) 0%, var(--color-wood-panel-dark) 100%)",
              border: "2px solid #FFD740",
              boxShadow:
                "inset 0 2px 0 rgba(255,235,200,0.4), 0 3px 6px rgba(0,0,0,0.3)",
              color: textColor,
            }
          : {
              background: "rgba(0,0,0,0.25)",
              border: "1.5px solid rgba(233,160,91,0.28)",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)",
              color: textColor,
            }
      }
    >
      <span
        className="font-game text-[16px]"
        style={{ width: 34, color: textColor }}
      >
        #{entry.rank}
      </span>
      <div className="w-2" />
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={
          me
            ? {
                background:
                  "linear-gradient(180deg, #b5e162 0%, var(--color-grass-light) 100%)",
                boxShadow: "0 1.5px 0 var(--color-grass-deep)",
              }
            : { backgroundColor: "rgba(255,246,224,0.22)" }
        }
      >
        <span
          className="text-[16px] font-black"
          style={{ color: me ? "var(--color-grass-deep)" : "var(--color-cream)" }}
        >
          {monogram}
        </span>
      </div>
      <div className="w-3" />
      <span
        className="line-clamp-1 min-w-0 flex-1 text-[15px]"
        style={{
          color: textColor,
          fontWeight: me ? 800 : 600,
        }}
      >
        {entry.nickname}
      </span>
      <span
        className="shrink-0 font-game text-[16px]"
        style={{ color: textColor }}
      >
        {entry.points}
      </span>
      <span className="w-1" />
      <span
        className="shrink-0 text-[12px] font-semibold"
        style={{
          color: me ? "rgba(92,48,24,0.7)" : "rgba(255,246,224,0.7)",
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
      className="absolute inset-x-0 px-5 py-3.5"
      style={{
        bottom: BOTTOM_NAV_RESERVED_PX,
        background:
          "linear-gradient(180deg, var(--color-wood-panel-light) 0%, var(--color-wood-panel-dark) 100%)",
        borderTop: "3px solid var(--color-wood-rim)",
        boxShadow:
          "inset 0 2px 0 rgba(255,235,200,0.35), 0 -4px 16px rgba(0,0,0,0.35)",
      }}
    >
      <div className="flex items-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background:
              "linear-gradient(180deg, #b5e162 0%, var(--color-grass-light) 100%)",
            boxShadow: "0 2px 0 var(--color-grass-deep)",
          }}
        >
          <span
            className="text-[20px] font-black"
            style={{ color: "var(--color-grass-deep)" }}
          >
            {monogram}
          </span>
        </div>
        <div className="w-3" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className="line-clamp-1 text-[15px] font-black"
            style={{ color: "var(--color-ink)" }}
          >
            {t("leaderboardYouLine", { nickname: me.nickname })}
          </span>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "rgba(92,48,24,0.75)" }}
          >
            {t("leaderboardYouRankOf", {
              rank: me.rank,
              totalDevices: me.totalDevices,
            })}
          </span>
        </div>
        <div
          className="rounded-[20px] px-3 py-1.5"
          style={{
            background:
              "linear-gradient(180deg, var(--color-ribbon-light) 0%, var(--color-ribbon-mid) 100%)",
            boxShadow: "0 2px 0 var(--color-grass-deep)",
          }}
        >
          <span
            className="text-[14px] font-black"
            style={{ color: "var(--color-grass-deep)" }}
          >
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
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="#FFF6E0" aria-hidden>
      <path d="M19.35 10.04A7.49 7.49 0 0012 4c-1.4 0-2.7.39-3.82 1.06l1.49 1.49C10.4 6.2 11.18 6 12 6a5.5 5.5 0 015.5 5.5v.5H19a3 3 0 011.95 5.27l1.42 1.42A4.99 4.99 0 0024 14a5 5 0 00-4.65-3.96zM3 5.27l2.77 2.77A4.99 4.99 0 003 13a5 5 0 005 5h11.73l2 2L23 18.73 4.27 4 3 5.27z" />
    </svg>
  );
}
