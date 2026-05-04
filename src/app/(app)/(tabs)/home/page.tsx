"use client";

/**
 * Home tab — gamified zig-zag adventure map.
 *
 * Direct port of the `_MapTab` widget tree in
 * `lib/features/home/home_screen.dart:144-468`. Concretely:
 *   - A background image (bg.png, 1608×3496) tiled vertically, one
 *     copy per cycle. `LevelNode`s are positioned absolutely in
 *     normalized coordinates (`NODE_POSITIONS`) inside a scroll
 *     container, so the user scrolls the nodes + bg as one — same
 *     vibe as Duolingo's path.
 *   - A floating points pill at the top, fixed above the scroll
 *     (matches `_PointsHeader`).
 *   - Tap on `current` or `completed` → navigate to `/level/[id]`.
 *     Tap on `locked` → snackbar + shake animation.
 *
 * Multi-cycle layout:
 *   - The repo now hands us `bundle: PathDefinition[]` — one entry
 *     per cycle the device has been issued, in cycle-ascending order.
 *     We render every cycle in a single continuous scroll, with the
 *     oldest cycle (cycle 1) at the **bottom** of the scroller (so
 *     `scrollTop = scrollHeight` on mount keeps level 1 visible, same
 *     as before) and any newer cycles stacked above. Each cycle gets
 *     its own copy of the `bg.png` artwork and the same 8
 *     `NODE_POSITIONS`, with the level ids lifted from that cycle's
 *     `levels[]`. Level ids are globally unique across cycles (per
 *     the backend contract) so id-based lookups keep working.
 *
 * What's intentionally simplified for the web port:
 *   - The Flutter version computes a `cover` image scale that picks
 *     `max(viewportW/1608, viewportH/3496)` so the artwork covers
 *     both axes. On the PWA we let the map width track the viewport
 *     width (`100%`) and height follow from the aspect ratio × cycle
 *     count.
 *   - The strawberry mascot's hand-painted CustomPaint is replaced
 *     by an inline SVG that captures the shape (red body, green
 *     leaves, eyes, smile). Close enough for parity at thumbnail
 *     size; not worth shipping a Konva/canvas dependency for one
 *     mascot.
 *   - The "Force-reassign" debug long-press is omitted — the
 *     Profile tab already exposes a `Reset` affordance per Flutter's
 *     plan, so we don't need a second entry point.
 *
 * Hydration: the parent `(app)` layout's `<AppRouteGuard>` blocks
 * rendering until stores are hydrated, so `usePathRepo.bundle` is
 * always non-null here. Defensive null-checks are still in place
 * because the repository fields can in theory be null between a
 * `reset()` and the next `boot()`.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { NicknameSheet } from "@/components/nickname-sheet";
import { type LevelDefinition } from "@/lib/content/models";
import { formatCycleLevelParam } from "@/lib/content/cycle-level";
import { useNickname } from "@/stores/nickname";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

// ---------------------------------------------------------------------------
// Types + node positions
// ---------------------------------------------------------------------------

type LevelStatus = "completed" | "current" | "locked";

interface LevelNode {
  /**
   * The cycle this level belongs to. Together with `id` forms the
   * composite identity of a level — level ids are 1..8 *within a
   * cycle* and NOT globally unique. React `key` and `progress` lookups
   * must use both fields.
   */
  cycle: number;
  id: number;
  status: LevelStatus;
  /** Normalized x ∈ [0,1] within the map. */
  dx: number;
  /**
   * Normalized y ∈ [0,1] within the entire stacked map (i.e. across
   * every cycle). Computed from the per-cycle `dy` plus a
   * cycle-index offset so that cycle 1 sits at the bottom of the
   * scroller and newer cycles stack above. See `useMemo` below.
   */
  dy: number;
  /**
   * For `completed` levels only: number of questions the user actually
   * submitted recordings for. Drives the 3-star rating on the node.
   * Undefined if the entry came from the backend without a client-side
   * completion event (e.g. cross-device progress, or a level completed
   * before the partial-credit feature shipped) — render as "fully
   * completed" (3 filled stars) in that case.
   */
  submittedCount?: number;
  /** Total questions the level had at the moment of completion. */
  totalSteps?: number;
}

/** Hand-tuned positions, identical to `_kNodePositions` in Dart. */
const NODE_POSITIONS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0.62, dy: 0.88 },
  { dx: 0.22, dy: 0.8 },
  { dx: 0.4, dy: 0.7 },
  { dx: 0.78, dy: 0.62 },
  { dx: 0.3, dy: 0.52 },
  { dx: 0.62, dy: 0.43 },
  { dx: 0.42, dy: 0.32 },
  { dx: 0.74, dy: 0.2 },
];

/** bg.png intrinsic dimensions — pinned here so the container can
 *  reserve the right height (ratio = 3496/1608 ≈ 2.174). */
const MAP_W = 1608;
const MAP_H = 3496;
const MAP_ASPECT = MAP_H / MAP_W;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();

  // We subscribe to the entire repo so any background mutation
  // (e.g. `completeLevel` from the level screen returning) re-renders
  // the map. Cheap — it's a single object identity.
  const bundle = usePathRepo((s) => s.bundle);
  const progress = usePathRepo((s) => s.progress);

  // Cycle count drives container height + per-cycle vertical offsets.
  // `bundle` is sorted cycle-ascending in the repo; we treat index 0
  // as the *oldest* cycle (cycle 1, on first run) and stack newer
  // cycles above. At least one — defensive for the brief window
  // between `reset()` and the next `boot()`.
  const cycleCount = Math.max(1, bundle?.length ?? 1);

  // Derive nodes from the live progress vector. `useMemo` so the
  // mascot-position lookup downstream is stable across renders that
  // don't actually change progress. We iterate every cycle in the
  // bundle, emit one node per (cycle, position-in-cycle) pair, and
  // stamp a global `dy` that places cycle 1 at the bottom and newer
  // cycles above. Falls back to a single synthetic cycle (level ids
  // 1..8) when the bundle is briefly null, matching the legacy
  // single-cycle behaviour.
  const levels = useMemo<LevelNode[]>(() => {
    const out: LevelNode[] = [];
    // Synthetic fallback so the page still renders something during
    // the boot ↔ reset window. Only used when `bundle` is null.
    const cycles =
      bundle && bundle.length > 0
        ? bundle
        : [
            {
              pathId: "",
              cycle: 1,
              levels: Array.from({ length: 8 }, (_, i) => ({
                levelId: i + 1,
                theme: "",
                pointsReward: 0,
                questions: [],
              })),
            },
          ];
    for (let ci = 0; ci < cycles.length; ci++) {
      const cycle = cycles[ci];
      // Cycle 0 (oldest) → bottom of the scroll. The y-offset is
      // measured from the *top* (CSS convention), so the oldest
      // cycle gets the largest top offset.
      const cycleTopOffset = (cycles.length - 1 - ci) / cycles.length;
      // Each cycle occupies 1/cycles.length of the global y-range.
      // The per-cycle `dy` from `NODE_POSITIONS` is in [0,1] within
      // that band, so we scale and shift.
      const bandHeight = 1 / cycles.length;

      for (let i = 0; i < NODE_POSITIONS.length; i++) {
        const def = cycle.levels[i];
        // Cycle should always carry exactly 8 levels per the backend
        // contract, but guard so a malformed payload doesn't crash
        // the render — skip the missing slot.
        if (!def) continue;
        const id = def.levelId;
        // Composite-key lookup: same level id can appear in cycle 1
        // and cycle 2 with completely different progress states.
        const entry =
          progress?.entries.find(
            (e) => e.cycle === cycle.cycle && e.levelId === id,
          ) ?? null;
        // Default-status fallback only applies in the synthetic
        // cycle (no bundle yet): legacy behaviour was "level 1 is
        // current, the rest are locked". Once the bundle loads, the
        // backend's `progress` vector is authoritative.
        const status: LevelStatus = entry
          ? (entry.status as LevelStatus)
          : id === 1 && bundle === null
            ? "current"
            : "locked";
        const pos = NODE_POSITIONS[i];
        out.push({
          cycle: cycle.cycle,
          id,
          status,
          submittedCount: entry?.submittedCount,
          totalSteps: entry?.totalSteps,
          dx: pos.dx,
          dy: cycleTopOffset + pos.dy * bandHeight,
        });
      }
    }
    return out;
  }, [bundle, progress]);

  const totalPoints = progress?.totalPoints ?? 0;

  // Scroll-to-bottom on mount so the active level is on screen.
  // (Map is laid out top→down, with level 1 at the bottom — same
  // semantic as the Flutter `jumpTo(maxScrollExtent)` call.)
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const launchLevel = (node: LevelNode) => {
    if (node.status === "locked") {
      useSnackbar
        .getState()
        .show(t("homeLevelLockedSnack", { levelId: node.id }));
      return;
    }
    if (!bundle) {
      useSnackbar.getState().show(t("homeAdventureNotLoadedSnack"));
      return;
    }
    // Resolve by composite (cycle, levelId) — flattening + level-id
    // match alone would silently launch a same-numbered level from a
    // different cycle once the user has advanced.
    const cycleDef = bundle.find((c) => c.cycle === node.cycle);
    const level: LevelDefinition | undefined = cycleDef?.levels.find(
      (l) => l.levelId === node.id,
    );
    if (!level || level.questions.length === 0) {
      useSnackbar
        .getState()
        .show(t("homeLevelHasNoQuestionsSnack", { levelId: node.id }));
      return;
    }
    const seg = formatCycleLevelParam({ cycle: node.cycle, levelId: node.id });
    router.push(`/level/${seg}`);
  };

  // The "Tap to start" pulse anchors to the active cycle's current
  // node. Each cycle can have at most one `current` row, but the user
  // may have multiple cycles active in `bundle` (i.e. they advanced
  // mid-completion of a previous cycle, which the backend doesn't
  // currently allow but is cheap to defend against). Prefer the
  // highest-cycle current — that's the one the user is "on".
  const currentNode =
    levels
      .filter((n) => n.status === "current")
      .sort((a, b) => b.cycle - a.cycle)[0] ?? levels[0];

  // First-visit nickname prompt. Derived directly from the store
  // rather than a local `useState`: opening means "no nickname set
  // *and* prompt has not been shown", and the sheet's own dismiss /
  // submit paths flip `prompted` (or both flags) which collapses
  // the predicate to `false` and closes the sheet.
  //
  // We gate on `hydrated` to avoid a flash where `prompted` defaults
  // to `false` pre-hydrate and we'd open the sheet for a user who
  // already dismissed it. `<AppRouteGuard>` blocks render until the
  // *onboarding* store is hydrated, but the nickname store hydrates
  // independently in `<AppHydration>` — wait for it explicitly.
  const nicknameHydrated = useNickname((s) => s.hydrated);
  const nicknameValue = useNickname((s) => s.value);
  const nicknamePrompted = useNickname((s) => s.prompted);
  const showNicknameSheet =
    nicknameHydrated && nicknameValue === null && !nicknamePrompted;

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#7BC96F]">
      {/* Scrollable map. The bg.png is *inside* the scroller (one tile
          per cycle, stacked vertically), so it scrolls with the nodes
          rather than staying fixed to the viewport. The page bg
          (#7BC96F) shows through if the scroller is shorter than the
          viewport. Padded at the bottom so the last visible row clears
          the floating bottom-nav. */}
      <div
        ref={scrollerRef}
        className="relative z-[1] h-dvh w-full overflow-y-auto overscroll-y-contain"
        style={{
          paddingBottom: BOTTOM_NAV_RESERVED_PX,
        }}
      >
        {/* Node container: width 100%, height = width × aspect ×
            cycleCount. Each cycle gets one full bg tile and one
            copy of the 8 node positions, stacked top-to-bottom with
            cycle 1 at the *bottom*. */}
        <div
          className="relative w-full"
          style={{ paddingTop: `${MAP_ASPECT * cycleCount * 100}%` }}
        >
          {/* Background tiles. We render `cycleCount` copies of bg.png,
              each occupying `1/cycleCount` of the container's height.
              `next/image` with `fill` needs an absolutely-positioned
              parent — give each tile its own wrapper. The newest cycle
              (top) gets `priority` so the initial paint above the fold
              lights up fast; older cycles below load lazily. */}
          {Array.from({ length: cycleCount }).map((_, idx) => (
            <div
              key={idx}
              className="pointer-events-none absolute left-0 w-full"
              style={{
                top: `${(idx / cycleCount) * 100}%`,
                height: `${(1 / cycleCount) * 100}%`,
              }}
            >
              <Image
                src="/images/bg.png"
                alt=""
                fill
                priority={idx === 0}
                sizes="100vw"
                className="object-cover"
              />
            </div>
          ))}

          {/* Level nodes. Each anchored absolutely in the map's own
              coordinate system. `dy` is already in global (whole-map)
              normalized space — see the `useMemo` above. */}
          {levels.map((node) => (
            <div
              // Composite key — `node.id` alone collides across cycles
              // (level 1 of cycle 1 and level 1 of cycle 2 are both
              // rendered when the user has advanced).
              key={`${node.cycle}-${node.id}`}
              className="absolute"
              style={{
                // 80×80 node, anchor centre-to-coordinate
                left: `calc(${node.dx * 100}% - 40px)`,
                top: `calc(${node.dy * 100}% - 40px)`,
              }}
            >
              <LevelNodeView
                node={node}
                onLaunch={() => launchLevel(node)}
                tapToStartLabel={t("homeLevelTapToStart")}
              />
            </div>
          ))}

          {/* Mascot — bobs gently next to the current level node. */}
          <div
            className="pointer-events-none absolute"
            style={{
              left: `calc(${currentNode.dx * 100}% + 20px)`,
              top: `calc(${currentNode.dy * 100}% - 40px)`,
            }}
          >
            <Mascot />
          </div>
        </div>
      </div>

      {/* Floating points pill — fixed to viewport, not scroll. */}
      <div
        className="absolute inset-x-4 top-0 z-10"
        style={{ marginTop: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <PointsHeader
          points={totalPoints}
          pointsLabel={t("homePointsLabel")}
        />
      </div>

      {/* First-run nickname prompt. Lives at the page root so its
          fixed-position scrim covers the whole shell, not just the
          scroll container. The sheet is visible whenever the store
          says we haven't shown it yet — it dismisses itself by
          flipping `prompted` (via `markPrompted()`), which makes the
          predicate above evaluate to `false` and unmounts this. */}
      {showNicknameSheet && (
        <NicknameSheet
          mode="first-run"
          onClose={() => {
            // Defensive: ensure `prompted` is set even if the sheet
            // closed via a path that didn't flip it (e.g. an edge
            // case where the network call branched early). Calling
            // `markPrompted()` is idempotent.
            useNickname.getState().markPrompted();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function PointsHeader({
  points,
  pointsLabel,
}: {
  points: number;
  pointsLabel: string;
}) {
  // Tween the displayed value when `points` changes — same flavour as
  // Flutter's `TweenAnimationBuilder<int>`. 900 ms easeOutCubic.
  const animated = useAnimatedNumber(points, 900);

  return (
    <div
      className="flex h-16 items-center gap-2 rounded-full px-5 shadow-lg phone-sm:h-14 phone-sm:px-4"
      style={{ backgroundColor: "var(--color-brand-primary)" }}
    >
      <p className="min-w-0 flex-1 truncate text-[22px] text-white phone-sm:text-[18px]">
        <span className="font-black">+{animated} </span>
        <span className="font-medium">{pointsLabel}</span>
      </p>
      {/* Streak pill (cosmetic — backend has no streak yet, hardcoded
          to 0 to match Flutter). */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 phone-sm:h-8 phone-sm:px-2.5">
        <span className="text-[18px] leading-none">🔥</span>
        <span className="text-[16px] font-bold text-white">0</span>
      </div>
    </div>
  );
}

/**
 * Tiny tween hook — counts `target` up from the previous value over
 * `durationMs` with an ease-out-cubic curve. Pure CSS won't do here
 * because we want the formatted text to update each frame, not just
 * an opacity/transform.
 */
function useAnimatedNumber(target: number, durationMs: number): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

// ---------------------------------------------------------------------------
// Level node
// ---------------------------------------------------------------------------

function LevelNodeView({
  node,
  onLaunch,
  tapToStartLabel,
}: {
  node: LevelNode;
  onLaunch: () => void;
  tapToStartLabel: string;
}) {
  const [shake, setShake] = useState(0);

  const handleClick = () => {
    if (node.status === "locked") {
      // Trigger the wobble; the snackbar is the parent's job.
      setShake((s) => s + 1);
    }
    onLaunch();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Level ${node.id}`}
      className="relative block h-20 w-20 cursor-pointer"
      style={{
        animation: shake
          ? "afk-shake 0.45s ease"
          : undefined,
        // Re-trigger by changing key via a custom property that
        // depends on `shake` count. Cheap.
        animationName: shake ? `afk-shake-${shake % 2}` : undefined,
      }}
    >
      {node.status === "locked" && <LockedNode />}
      {node.status === "completed" && (
        <CompletedNode
          submittedCount={node.submittedCount}
          totalSteps={node.totalSteps}
        />
      )}
      {node.status === "current" && (
        <CurrentNode id={node.id} tapLabel={tapToStartLabel} />
      )}

      {/* Inline keyframes — defined inside the page so we don't
          touch globals.css for one animation. */}
      <style>{`
        @keyframes afk-shake-0 {
          0% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(7px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(3px); }
          100% { transform: translateX(0); }
        }
        @keyframes afk-shake-1 {
          0% { transform: translateX(0); }
          20% { transform: translateX(8px); }
          40% { transform: translateX(-7px); }
          60% { transform: translateX(5px); }
          80% { transform: translateX(-3px); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </button>
  );
}

function LockedNode() {
  return (
    <div className="relative h-full w-full">
      <DashedRing color="rgba(255,255,255,0.9)" />
      <div className="absolute inset-1 flex items-center justify-center rounded-full bg-[#6B6B6B] shadow-[0_3px_6px_rgba(0,0,0,0.33)]">
        <LockIcon />
      </div>
    </div>
  );
}

function CompletedNode({
  submittedCount,
  totalSteps,
}: {
  submittedCount?: number;
  totalSteps?: number;
}) {
  // 3-star "completion quality" rating. The mapping squashes the
  // user's submitted/total ratio into 3 slots so that:
  //   - a clean sweep (submittedCount === totalSteps) → 3 filled stars
  //   - a partial run → ceil(ratio * 3) filled stars, e.g.
  //       1/4 submitted → 1 filled, 2 outline
  //       2/4 → 2 filled, 1 outline
  //       3/4 → 3 filled, 0 outline (full bar visible only at 4/4)
  // When the entry has no client-side completion data (legacy or
  // cross-device), default to 3 filled stars.
  //
  // Visual: per design, completed levels are rendered as *just stars*
  // — no green disc, no dashed ring, no halo. The stars sit directly
  // on the map background, so the cluster needs a soft shadow to keep
  // them legible against the green path. The 80×80 button slot is
  // preserved for layout (so positions don't shift), and the row is
  // centered inside it.
  const knownPartial =
    typeof submittedCount === "number" &&
    typeof totalSteps === "number" &&
    totalSteps > 0;
  const filled = knownPartial
    ? Math.max(
        1,
        Math.min(3, Math.ceil((submittedCount! / totalSteps!) * 3)),
      )
    : 3;
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <ThreeStarRow filled={filled} />
    </div>
  );
}

function ThreeStarRow({ filled }: { filled: number }) {
  // Three small stars centered in the 80×80 node slot. Stars sit
  // directly on the green map background (no disc behind them), so
  // they get a soft drop-shadow for legibility and a subtle white
  // stroke ring on filled stars — the same trick used on the points
  // pill numerals.
  const slots = [0, 1, 2];
  return (
    <div
      className="flex items-center gap-0.5"
      style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}
    >
      {slots.map((i) => (
        <SmallStarIcon key={i} filled={i < filled} />
      ))}
    </div>
  );
}

function SmallStarIcon({ filled }: { filled: boolean }) {
  // Filled = gold with a thin white outline so the star pops off the
  // green map. Outline-only = white stroke (no fill), matching the
  // "missed slot" look you'd find in classic 3-star rating UIs.
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={filled ? "#FFC83D" : "none"}
      stroke="white"
      strokeWidth={filled ? 1.25 : 2}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.1L12 17.6 5.7 21.3l1.7-7.1L2 9.5l7.1-.6L12 2z" />
    </svg>
  );
}

function CurrentNode({ id, tapLabel }: { id: number; tapLabel: string }) {
  return (
    <div className="relative h-full w-full">
      {/* Outward ripple ring — pure CSS keyframe scaling an absolutely
          positioned border. */}
      <span
        aria-hidden
        className="absolute inset-0 -m-4 animate-[afk-ripple_1.4s_ease-in-out_infinite_alternate] rounded-full border-[3px] border-white/70"
      />
      <div
        className="absolute inset-1.5 flex animate-[afk-pulse_1.4s_ease-in-out_infinite_alternate] items-center justify-center rounded-full border-[4px] border-white"
        style={{
          backgroundColor: "var(--color-brand-primary)",
        }}
      >
        <span className="text-[36px] font-black text-white leading-none">
          {id}
        </span>
      </div>
      {/* "Tap to start" call-out floating above. `whitespace-nowrap`
          so a longer translation (e.g. FR "Touchez pour commencer")
          extends the pill horizontally rather than wrapping to a
          second line and covering the level number underneath. */}
      <div className="absolute left-1/2 top-[-34px] max-w-[80vw] -translate-x-1/2 whitespace-nowrap rounded-xl bg-white px-2.5 py-1 text-center shadow phone-sm:whitespace-normal phone-sm:max-w-[140px]">
        <span
          className="text-[12px] font-extrabold"
          style={{ color: "var(--color-brand-primary)" }}
        >
          {tapLabel}
        </span>
      </div>
      <style>{`
        @keyframes afk-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
        }
        @keyframes afk-ripple {
          from { transform: scale(1); opacity: 0.7; }
          to { transform: scale(1.75); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decorative bits
// ---------------------------------------------------------------------------

function DashedRing({ color }: { color: string }) {
  // 22 dashes around the circumference, ratio 0.55 — same as the
  // `_DashedCirclePainter` in Dart. Implemented with SVG so there's
  // no canvas/JS overhead per node.
  const radius = 38; // 80/2 - 2px stroke padding
  const circ = 2 * Math.PI * radius;
  // Each dash occupies (1/22) of the circumference; visible portion
  // 0.55 × dash, gap 0.45 × dash.
  const dashLen = (circ / 22) * 0.55;
  const gapLen = (circ / 22) * 0.45;
  return (
    <svg
      viewBox="0 0 80 80"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <circle
        cx="40"
        cy="40"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={`${dashLen} ${gapLen}`}
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9" fill="#B5B5B5" aria-hidden>
      <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 116 0v3H9z" />
    </svg>
  );
}

function Mascot() {
  // Bobbing strawberry. Animation is a tiny Y translate on a 1.8 s
  // ease-in-out-alternate loop, matching the Flutter sin-curve.
  return (
    <div className="animate-[afk-bob_1.8s_ease-in-out_infinite_alternate]">
      <svg viewBox="0 0 110 120" width="110" height="120" aria-hidden>
        {/* Body */}
        <path
          d="M55 114 C5.5 84 11 30 55 33.6 C99 30 104.5 84 55 114 Z"
          fill="#E53935"
        />
        {/* Seeds */}
        {[
          [33, 84],
          [49.5, 98.4],
          [71.5, 84],
          [60.5, 66],
          [38.5, 66],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} fill="#FFE57F" />
        ))}
        {/* Leaves */}
        <path d="M55 6 L27.5 36 L82.5 36 Z" fill="#43A047" />
        {/* Eyes */}
        <circle cx={44} cy={54} r={8} fill="white" />
        <circle cx={68.2} cy={54} r={8} fill="white" />
        <circle cx={46.2} cy={55.2} r={3.5} fill="black" />
        <circle cx={70.4} cy={55.2} r={3.5} fill="black" />
        {/* Mouth */}
        <path
          d="M41.8 72 Q55 93.6 68.2 72 Z"
          fill="#6A1B1B"
        />
        {/* Tongue */}
        <path
          d="M48.4 81.6 Q55 93.6 61.6 81.6 Z"
          fill="#FF80AB"
        />
      </svg>
      <style>{`
        @keyframes afk-bob {
          from { transform: translateY(-3px); }
          to { transform: translateY(3px); }
        }
      `}</style>
    </div>
  );
}
