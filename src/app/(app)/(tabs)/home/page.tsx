"use client";

/**
 * Home tab — gamified zig-zag adventure map.
 *
 * Direct port of the `_MapTab` widget tree in
 * `lib/features/home/home_screen.dart:144-468`. Concretely:
 *   - A fixed-to-viewport background image (bg.png, 1608×3496),
 *     `object-cover` so it always fills the screen no matter the
 *     scroll position. Eight `LevelNode`s are positioned absolutely
 *     in normalized coordinates (`_kNodePositions`) inside a
 *     transparent scroll container layered above, so the user
 *     scrolls the nodes (and the map's coordinate system) over the
 *     fixed background — same vibe as Duolingo's path.
 *   - A floating points pill at the top, fixed above the scroll
 *     (matches `_PointsHeader`).
 *   - Tap on `current` or `completed` → navigate to `/level/[id]`.
 *     Tap on `locked` → snackbar + shake animation.
 *
 * What's intentionally simplified for the web port:
 *   - The Flutter version computes a `cover` image scale that picks
 *     `max(viewportW/1608, viewportH/3496)` so the artwork covers
 *     both axes. On the PWA we let the map width track the viewport
 *     width (`100%`) and height follow from the aspect ratio. This
 *     loses the "wide-viewport extra padding" behaviour, but
 *     desktop browsers will naturally constrain the column via the
 *     centred max-width container.
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
 * rendering until stores are hydrated, so `usePathRepo.path` is
 * always non-null here. Defensive null-checks are still in place
 * because the repository fields can in theory be null between a
 * `reset()` and the next `boot()`.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { type LevelDefinition } from "@/lib/content/models";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

// ---------------------------------------------------------------------------
// Types + node positions
// ---------------------------------------------------------------------------

type LevelStatus = "completed" | "current" | "locked";

interface LevelNode {
  id: number;
  status: LevelStatus;
  /** Normalized x ∈ [0,1] within the map. */
  dx: number;
  /** Normalized y ∈ [0,1] within the map. */
  dy: number;
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
  const path = usePathRepo((s) => s.path);
  const progress = usePathRepo((s) => s.progress);

  // Derive nodes from the live progress vector. `useMemo` so the
  // mascot-position lookup downstream is stable across renders that
  // don't actually change progress.
  const levels = useMemo<LevelNode[]>(() => {
    const out: LevelNode[] = [];
    for (let i = 0; i < 8; i++) {
      const id = i + 1;
      const entry = progress?.entries.find((e) => e.levelId === id) ?? null;
      const status: LevelStatus = entry
        ? (entry.status as LevelStatus)
        : id === 1
          ? "current"
          : "locked";
      out.push({ id, status, ...NODE_POSITIONS[i] });
    }
    return out;
  }, [progress]);

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
    if (!path) {
      useSnackbar.getState().show(t("homeAdventureNotLoadedSnack"));
      return;
    }
    const level: LevelDefinition | undefined = path.levels.find(
      (l) => l.levelId === node.id,
    );
    if (!level || level.questions.length === 0) {
      useSnackbar
        .getState()
        .show(t("homeLevelHasNoQuestionsSnack", { levelId: node.id }));
      return;
    }
    router.push(`/level/${node.id}`);
  };

  const currentNode =
    levels.find((n) => n.status === "current") ?? levels[0];

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#7BC96F]">
      {/* Fixed background layer — `object-cover` fills the viewport,
          never scrolls. Sits below the scroller and the points pill.
          Sized to the layout box (the page itself, which is min-h-dvh)
          so it tracks viewport resizes without re-layout. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <Image
          src="/images/bg.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* Scrollable node layer. Transparent — the fixed bg shows
          through. Padded at the bottom so the last visible row clears
          the floating bottom-nav. */}
      <div
        ref={scrollerRef}
        className="relative z-[1] h-dvh w-full overflow-y-auto overscroll-y-contain"
        style={{
          paddingBottom: BOTTOM_NAV_RESERVED_PX,
        }}
      >
        {/* Node container: width 100%, height = width × aspect. The
            nodes stay anchored to the same artwork coordinates as
            before, so as the user scrolls them up the visual still
            tracks the (fixed) bg. */}
        <div
          className="relative w-full"
          style={{ paddingTop: `${MAP_ASPECT * 100}%` }}
        >
          {/* Level nodes. Each anchored absolutely in the map's own
              coordinate system. */}
          {levels.map((node) => (
            <div
              key={node.id}
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
      className="flex h-16 items-center rounded-full px-5 shadow-lg"
      style={{ backgroundColor: "var(--color-brand-primary)" }}
    >
      <p className="text-[22px] text-white">
        <span className="font-black">+{animated} </span>
        <span className="font-medium">{pointsLabel}</span>
      </p>
      <div className="flex-1" />
      {/* Streak pill (cosmetic — backend has no streak yet, hardcoded
          to 0 to match Flutter). */}
      <div className="flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3">
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
      {node.status === "completed" && <CompletedNode />}
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

function CompletedNode() {
  return (
    <div className="relative h-full w-full">
      <DashedRing color="white" />
      <div
        className="absolute inset-1.5 flex animate-[afk-pulse-glow_1.4s_ease-in-out_infinite_alternate] items-center justify-center rounded-full bg-[#7BC96F]"
        style={{ boxShadow: "0 0 18px 3px rgba(255,200,61,0.4)" }}
      >
        <StarIcon />
      </div>
      <style>{`
        @keyframes afk-pulse-glow {
          from { box-shadow: 0 0 0 0 rgba(255,200,61,0); }
          to { box-shadow: 0 0 18px 3px rgba(255,200,61,0.4); }
        }
      `}</style>
    </div>
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
      <div className="absolute left-1/2 top-[-34px] -translate-x-1/2 whitespace-nowrap rounded-xl bg-white px-2.5 py-1 shadow">
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

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-11 w-11" fill="#FFC83D" aria-hidden>
      <path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.1L12 17.6 5.7 21.3l1.7-7.1L2 9.5l7.1-.6L12 2z" />
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
