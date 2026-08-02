"use client";

/**
 * Home tab the serpentine learning path (flat redesign).
 *
 * Duolingo-style path layout:
 *   - White background, sticky stat bar up top (learning-language
 *     flag + animated points counter).
 *   - One section per issued cycle, ordered cycle-ascending
 *     **top-down**: cycle 1 opens the page, newer cycles append
 *     below the natural reading/scrolling direction.
 *   - Each section opens with a green `UnitBanner` ("Path N") and
 *     lays its 8 levels on a gentle S-curve of flat 3D `PathNode`s:
 *     completed = gold + check + earned star arc, current = green +
 *     star + ripple + bouncing START bubble, locked = gray + padlock.
 *   - The parrot mascot bobs beside the current node.
 *   - Tap on `current` or `completed` → navigate to `/level/[id]`.
 *     Tap on `locked` → snackbar + shake animation.
 *
 * On mount the scroller centers the active node (`scrollIntoView`),
 * so returning users land on their frontier regardless of how many
 * cycles they've stacked up.
 *
 * Hydration: the parent `(app)` layout's `<AppRouteGuard>` blocks
 * rendering until stores are hydrated, so `usePathRepo.bundle` is
 * always non-null here. Defensive null-checks are still in place
 * because the repository fields can in theory be null between a
 * `reset()` and the next `boot()`.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { HomeInstallSheet } from "@/components/install-sheet";
import { CountryFlag } from "@/components/ui/country-flag";
import {
  CycleDecor,
  GameMapBackdrop,
} from "@/components/ui/game-map-backdrop";
import { CoinIcon } from "@/components/ui/icons";
import { Mascot } from "@/components/ui/mascot";
import { PathNode } from "@/components/ui/path-node";
import { UnitBanner } from "@/components/ui/unit-banner";
import { type LevelDefinition } from "@/lib/content/models";
import { formatCycleLevelParam } from "@/lib/content/cycle-level";
import {
  findLanguageByIso,
  useLearningLanguage,
} from "@/stores/learning-language";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

// ---------------------------------------------------------------------------
// Types + node positions
// ---------------------------------------------------------------------------

type LevelStatus = "completed" | "current" | "locked";

interface LevelNode {
  /**
   * The cycle this level belongs to. Together with `id` forms the
   * composite identity of a level level ids are 1..8 *within a
   * cycle* and NOT globally unique. React `key` and `progress` lookups
   * must use both fields.
   */
  cycle: number;
  id: number;
  status: LevelStatus;
  /** Normalized x ∈ [0,1] within the cycle's path container. */
  dx: number;
  /** Normalized y ∈ [0,1] within the cycle's path container. */
  dy: number;
  /**
   * For `completed` levels only: number of questions the user actually
   * submitted recordings for. Drives the 3-star rating on the node.
   * Undefined if the entry came from the backend without a client-side
   * completion event (e.g. cross-device progress, or a level completed
   * before the partial-credit feature shipped) render as "fully
   * completed" (3 filled stars) in that case.
   */
  submittedCount?: number;
  /** Total questions the level had at the moment of completion. */
  totalSteps?: number;
}

interface CycleGroup {
  cycle: number;
  nodes: LevelNode[];
}

/**
 * Hand-tuned serpentine positions (top-down): level 1 starts on the
 * center line right under the unit banner, the path sweeps left,
 * returns through center, sweeps right and eases back toward center
 * so the next cycle's level 1 continues the curve seamlessly.
 */
const NODE_POSITIONS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0.5, dy: 0.1 },
  { dx: 0.32, dy: 0.215 },
  { dx: 0.24, dy: 0.33 },
  { dx: 0.34, dy: 0.445 },
  { dx: 0.52, dy: 0.56 },
  { dx: 0.68, dy: 0.675 },
  { dx: 0.76, dy: 0.79 },
  { dx: 0.62, dy: 0.905 },
];

/** Path-container height = width × this ratio (per cycle). ~100px of
 *  vertical rhythm between nodes at the 480px frame width. */
const CYCLE_ASPECT = 1.78;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();

  // We subscribe to the entire repo so any background mutation
  // (e.g. `completeLevel` from the level screen returning) re-renders
  // the map. Cheap it's a single object identity.
  const bundle = usePathRepo((s) => s.bundle);
  const progress = usePathRepo((s) => s.progress);

  // Derive per-cycle node groups from the live progress vector.
  // `bundle` is sorted cycle-ascending in the repo; we render it in
  // that order top-down (cycle 1 first). Falls back to a single
  // synthetic cycle (level ids 1..8) when the bundle is briefly null,
  // matching the legacy single-cycle behaviour.
  const cycleGroups = useMemo<CycleGroup[]>(() => {
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
    return cycles.map((cycle) => {
      const nodes: LevelNode[] = [];
      for (let i = 0; i < NODE_POSITIONS.length; i++) {
        const def = cycle.levels[i];
        // Cycles should always carry exactly 8 levels per the backend
        // contract, but guard so a malformed payload doesn't crash
        // the render skip the missing slot.
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
        nodes.push({
          cycle: cycle.cycle,
          id,
          status,
          submittedCount: entry?.submittedCount,
          totalSteps: entry?.totalSteps,
          dx: pos.dx,
          dy: pos.dy,
        });
      }
      return { cycle: cycle.cycle, nodes };
    });
  }, [bundle, progress]);

  const totalPoints = progress?.totalPoints ?? 0;

  // The START bubble + mascot anchor to the active cycle's current
  // node. Each cycle can have at most one `current` row, but the user
  // may have multiple cycles active in `bundle` (cheap to defend
  // against). Prefer the highest-cycle current that's the one the
  // user is "on".
  const currentNode = useMemo<LevelNode | null>(() => {
    const all = cycleGroups.flatMap((g) => g.nodes);
    return (
      all
        .filter((n) => n.status === "current")
        .sort((a, b) => b.cycle - a.cycle)[0] ??
      all[0] ??
      null
    );
  }, [cycleGroups]);

  // Center the active node on mount so returning users land on their
  // frontier no matter how many cycles are stacked above it.
  const currentNodeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    currentNodeRef.current?.scrollIntoView({ block: "center" });
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
    // Resolve by composite (cycle, levelId) flattening + level-id
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

  return (
    <div className="relative isolate flex h-dvh w-full flex-col">
      {/* Joyful game-map scene (sky, sun, hills, clouds) pinned
          behind the scroller the path floats over the landscape. */}
      <GameMapBackdrop />

      {/* Stat bar pinned above the scroller (flag + points). */}
      <StatBar points={totalPoints} />

      {/* Scrollable path. Padded at the bottom so the last node
          clears the fixed bottom-nav. */}
      <div
        className="flex-1 overflow-y-auto overscroll-y-contain"
        style={{ paddingBottom: BOTTOM_NAV_RESERVED_PX }}
      >
        {cycleGroups.map((group, ci) => (
          <section key={group.cycle}>
            <div className="px-4 pb-1 pt-4">
              <UnitBanner
                title={t("homePathTitle", { cycle: group.cycle })}
                subtitle={t("homePathSubtitle")}
              />
            </div>

            {/* Path container: width 100%, height = width × aspect.
                Nodes anchor absolutely in its coordinate system. */}
            <div
              className="relative w-full"
              style={{ paddingTop: `${CYCLE_ASPECT * 100}%` }}
            >
              {/* Scenery scrolls with the band (balloon, birds,
                  sparkles on the serpentine's empty flanks). */}
              <CycleDecor index={ci} />
              {group.nodes.map((node) => {
                const isCurrent =
                  currentNode !== null &&
                  node.cycle === currentNode.cycle &&
                  node.id === currentNode.id &&
                  node.status === "current";
                return (
                  <div
                    // Composite key `node.id` alone collides across
                    // cycles (level 1 of cycle 1 and level 1 of cycle
                    // 2 are both rendered once the user advances).
                    key={`${node.cycle}-${node.id}`}
                    ref={isCurrent ? currentNodeRef : undefined}
                    className="absolute"
                    style={{
                      // 80×80 anchor box, centre-to-coordinate.
                      left: `calc(${node.dx * 100}% - 40px)`,
                      top: `calc(${node.dy * 100}% - 40px)`,
                    }}
                  >
                    <LevelNodeView
                      node={node}
                      onLaunch={() => launchLevel(node)}
                      bubbleLabel={
                        isCurrent ? t("homeStartBubble") : undefined
                      }
                    />
                  </div>
                );
              })}

              {/* Mascot bobs gently next to the current level node
                  (flips to the node's left when the path swings
                  right so it never clips the frame edge). */}
              {currentNode !== null &&
                group.nodes.some(
                  (n) =>
                    n.cycle === currentNode.cycle &&
                    n.id === currentNode.id &&
                    n.status === "current",
                ) && (
                  <div
                    className="pointer-events-none absolute"
                    style={{
                      left:
                        currentNode.dx > 0.6
                          ? `calc(${currentNode.dx * 100}% - 130px)`
                          : `calc(${currentNode.dx * 100}% + 42px)`,
                      top: `calc(${currentNode.dy * 100}% - 52px)`,
                    }}
                  >
                    <Mascot size={88} />
                  </div>
                )}
            </div>
          </section>
        ))}
      </div>

      {/* First-run nickname prompt used to live here; retired now
          that the leaderboard name comes from the Google account
          (see `<DisplayNameSync>` in the `(app)` layout). */}

      {/* Proactive install ask (once per session, 14-day cool-off,
          self-gating). */}
      <HomeInstallSheet />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat bar
// ---------------------------------------------------------------------------

function StatBar({ points }: { points: number }) {
  const t = useTranslations();
  // Show the *effective* course: if the user skipped the language
  // picker, recordings default to Wolof (`isoOrDefault`) so the
  // chip must say so too, not render an empty globe.
  const selected = useLearningLanguage((s) => s.selected);
  const language = selected ?? findLanguageByIso("wo");

  // Tween the displayed value when `points` changes same flavour as
  // Flutter's `TweenAnimationBuilder<int>`. 900 ms easeOutCubic.
  const animated = useAnimatedNumber(points, 900);

  return (
    <header
      className="z-10 border-b-2 border-border bg-bg px-5 pb-2.5 phone-sm:px-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}
    >
      <div className="flex items-center justify-between">
        {/* Learning-language chip tappable: the natural place to
            look for "switch course" is the flag (the profile row is
            where it actually lives). */}
        <Link
          href="/profile"
          aria-label={t("profileLearningLanguageLabel")}
          className="flex items-center gap-2 rounded-xl px-1 py-1 transition-opacity active:opacity-60"
        >
          <CountryFlag
            iso={language?.iso ?? null}
            size={30}
            className="shrink-0"
          />
          <span className="text-[15px] font-extrabold text-text-muted">
            {language?.displayName ?? ""}
          </span>
        </Link>

        {/* Points counter. */}
        <span
          className="flex items-center gap-1.5"
          aria-label={`${points} ${t("homePointsLabel")}`}
        >
          <CoinIcon className="h-6 w-6 shrink-0" />
          <span className="text-[17px] font-extrabold text-orange-deep">
            {animated}
          </span>
        </span>
      </div>
    </header>
  );
}

/**
 * Tiny tween hook counts `target` up from the previous value over
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
  bubbleLabel,
}: {
  node: LevelNode;
  onLaunch: () => void;
  /** START bubble copy only set for the active current node. */
  bubbleLabel?: string;
}) {
  const t = useTranslations();
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

  // Localized, state-aware label glyph-only nodes are mute to
  // screen readers otherwise, and "locked" is critical context
  // before activating.
  const nodeLabel =
    node.status === "completed"
      ? t("homeLevelNodeCompleted", { levelId: node.id })
      : node.status === "current"
        ? t("homeLevelNodeCurrent", { levelId: node.id })
        : t("homeLevelNodeLocked", { levelId: node.id });

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={nodeLabel}
      aria-disabled={node.status === "locked" || undefined}
      // `group` lets the PathNode face depress onto its edge on press.
      className="group relative flex h-20 w-20 cursor-pointer items-center justify-center"
      style={{
        // Alternate between two identical keyframe sets so a repeat
        // tap re-triggers the wobble. Keyframes live in globals.css.
        animation: shake ? `afk-shake-${shake % 2} 0.45s ease` : undefined,
        touchAction: "manipulation",
      }}
    >
      <PathNode state={node.status} stars={stars} bubbleLabel={bubbleLabel} />
    </button>
  );
}
