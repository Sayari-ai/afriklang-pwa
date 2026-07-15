"use client";

/**
 * Home tab — gamified zig-zag adventure map ("wood & grass" theme).
 *
 * Layout is a direct port of the `_MapTab` widget tree in
 * `lib/features/home/home_screen.dart:144-468`, reskinned with the
 * game UI kit:
 *   - The map sits on the dark "game board" backdrop (grid +
 *     vignette) instead of the old bg.png artwork.
 *   - `LevelNode`s render as wooden medallions (`LevelBadge`) nested
 *     in grass — completed levels carry their earned 1–3 star arc,
 *     the current level pulses with a gold glow, locked levels wear
 *     the green padlock.
 *   - A dotted cream trail connects the nodes in play order, like a
 *     classic level path.
 *   - The floating points pill is now a wooden `ResourceCounter`
 *     with a gold coin and the same animated count-up.
 *   - Tap on `current` or `completed` → navigate to `/level/[id]`.
 *     Tap on `locked` → snackbar + shake animation.
 *
 * Multi-cycle layout:
 *   - The repo hands us `bundle: PathDefinition[]` — one entry per
 *     cycle the device has been issued, in cycle-ascending order. We
 *     render every cycle in a single continuous scroll, with the
 *     oldest cycle (cycle 1) at the **bottom** of the scroller (so
 *     `scrollTop = scrollHeight` on mount keeps level 1 visible) and
 *     any newer cycles stacked above. Each cycle reuses the same 8
 *     `NODE_POSITIONS`, with the level ids lifted from that cycle's
 *     `levels[]`.
 *
 * Hydration: the parent `(app)` layout's `<AppRouteGuard>` blocks
 * rendering until stores are hydrated, so `usePathRepo.bundle` is
 * always non-null here. Defensive null-checks are still in place
 * because the repository fields can in theory be null between a
 * `reset()` and the next `boot()`.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { LevelBadge } from "@/components/game/level-badge";
import { ResourceCounter } from "@/components/game/resource-counter";
import { NicknameSheet } from "@/components/nickname-sheet";
import { GameBoardBackdrop } from "@/components/screen-background";
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

/** Virtual map proportions per cycle. Inherited from the retired
 *  bg.png artwork (1608×3496 → ratio ≈ 2.174) so node spacing and the
 *  scroll feel stay identical after the reskin. */
const MAP_ASPECT = 3496 / 1608;

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

  // Dotted trail between consecutive nodes (play order). `levels` is
  // already emitted in play order — cycle-ascending, level-ascending —
  // so pairing neighbours also bridges cycle boundaries.
  const trailDots = useMemo(() => {
    const dots: Array<{ x: number; y: number; key: string }> = [];
    for (let i = 1; i < levels.length; i++) {
      const a = levels[i - 1];
      const b = levels[i];
      for (let k = 1; k <= 3; k++) {
        const f = k / 4;
        dots.push({
          x: a.dx + (b.dx - a.dx) * f,
          y: a.dy + (b.dy - a.dy) * f,
          key: `${a.cycle}-${a.id}-${k}`,
        });
      }
    }
    return dots;
  }, [levels]);

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
    <div className="relative min-h-dvh w-full overflow-hidden bg-surface">
      {/* Game-board backdrop (grid + vignette), pinned to the
          viewport. It does NOT scroll with the nodes; the level path
          scrolls over it. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <GameBoardBackdrop />
      </div>

      {/* Scrollable nodes. Padded at the bottom so the last visible
          row clears the floating bottom-nav. */}
      <div
        ref={scrollerRef}
        className="relative z-[1] h-dvh w-full overflow-y-auto overscroll-y-contain"
        style={{
          paddingBottom: BOTTOM_NAV_RESERVED_PX,
        }}
      >
        {/* Node container: width 100%, height = width × aspect ×
            cycleCount. Each cycle gets one copy of the 8 node
            positions, stacked top-to-bottom with cycle 1 at the
            *bottom*. */}
        <div
          className="relative w-full"
          style={{ paddingTop: `${MAP_ASPECT * cycleCount * 100}%` }}
        >
          {/* Dotted trail — under the nodes. */}
          {trailDots.map((d) => (
            <span
              key={d.key}
              aria-hidden
              className="absolute h-2 w-2 rounded-full"
              style={{
                left: `calc(${d.x * 100}% - 4px)`,
                top: `calc(${d.y * 100}% - 4px)`,
                background: "rgba(255,246,224,0.32)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
              }}
            />
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

      {/* Floating points counter — fixed to viewport, not scroll. */}
      <div
        className="absolute inset-x-4 top-0 z-10"
        style={{ marginTop: "calc(env(safe-area-inset-top) + 10px)" }}
      >
        <PointsHeader points={totalPoints} pointsLabel={t("homePointsLabel")} />
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
    <ResourceCounter
      icon="coin"
      value={`+${animated}`}
      suffix={pointsLabel}
    />
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

  // Completed levels carry a 3-star "completion quality" rating. The
  // mapping squashes the user's submitted/total ratio into 3 slots:
  //   - clean sweep (submittedCount === totalSteps) → 3 filled stars
  //   - partial run → ceil(ratio * 3), min 1
  // When the entry has no client-side completion data (legacy or
  // cross-device), default to 3 filled stars.
  const knownPartial =
    typeof node.submittedCount === "number" &&
    typeof node.totalSteps === "number" &&
    node.totalSteps > 0;
  const stars = knownPartial
    ? Math.max(
        1,
        Math.min(3, Math.ceil((node.submittedCount! / node.totalSteps!) * 3)),
      )
    : 3;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Level ${node.id}`}
      className="relative block h-20 w-20 cursor-pointer"
      style={{
        // Alternate between two identical keyframe sets so a repeat
        // tap re-triggers the wobble. Keyframes live in globals.css.
        animation: shake ? `afk-shake-${shake % 2} 0.45s ease` : undefined,
      }}
    >
      <LevelBadge level={node.id} state={node.status} stars={stars} />

      {/* "Tap to start" call-out floating above the current node —
          a mini wooden plank tooltip. `w-max` so longer translations
          (FR "Touchez pour commencer") widen the plank rather than
          wrapping over the badge. */}
      {node.status === "current" && (
        <span className="absolute left-1/2 top-[-38px] z-20 block w-max max-w-[80vw] -translate-x-1/2 phone-sm:max-w-[160px]">
          <span className="relative block px-3 py-1.5">
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                background: "linear-gradient(180deg, #7d4423 0%, #56301a 100%)",
                borderRadius: "10px 9px 10px 9px / 9px 10px 8px 10px",
                boxShadow: "0 3px 6px rgba(0,0,0,0.4)",
              }}
            />
            <span
              aria-hidden
              className="absolute"
              style={{
                inset: "2px 2px 4px 2px",
                background:
                  "linear-gradient(180deg, var(--color-wood-light) 0%, var(--color-wood-mid) 100%)",
                borderRadius: "8px 7px 8px 7px / 7px 8px 6px 8px",
              }}
            />
            <span
              className="relative z-10 font-game text-[12px] leading-none text-cream"
              style={{ textShadow: "0 1px 0 rgba(92,48,24,0.8)" }}
            >
              {tapToStartLabel}
            </span>
          </span>
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Decorative bits
// ---------------------------------------------------------------------------

function Mascot() {
  // Bobbing strawberry. Animation is a tiny Y translate on a 1.8 s
  // ease-in-out-alternate loop, matching the Flutter sin-curve.
  // Keyframes live in globals.css.
  return (
    <div className="motion-safe:animate-[afk-bob_1.8s_ease-in-out_infinite_alternate]">
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
        <path d="M41.8 72 Q55 93.6 68.2 72 Z" fill="#6A1B1B" />
        {/* Tongue */}
        <path d="M48.4 81.6 Q55 93.6 61.6 81.6 Z" fill="#FF80AB" />
      </svg>
    </div>
  );
}
