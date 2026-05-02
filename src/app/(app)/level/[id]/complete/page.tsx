"use client";

/**
 * Level complete screen — port of `lib/features/level/level_complete_screen.dart`.
 *
 * Shown after the last question of a level uploads successfully. The
 * actual `usePathRepo.completeLevel(...)` call happens in the level
 * screen *before* navigating here, which differs from Flutter (where
 * the home owns it via callback) but is closer to a web "the URL is
 * the truth" model: by the time you land on `/level/:id/complete`,
 * the level is already marked done.
 *
 * Inputs (query string):
 *   - `points` → integer points reward to display (defaults to 0).
 *   - `total`  → number of segments in the all-green step bar (the
 *     question count for this level). Defaults to 4 for safety.
 *
 * Hardware back / browser back: indistinguishable from the "Next
 * mission" CTA in our case — both routes back to `/home`. The Flutter
 * version uses `PopScope` to force a `pop(true)` so the home callback
 * runs; we don't need that ceremony because completion is already
 * persisted before we arrive.
 *
 * Visuals:
 *   - Same dark scrim background (`overlay="strong"` → 0xCC overlay).
 *   - Massive amber `+N` numeral, white "Congratulations" headline,
 *     bilingual encouragement with a bold `$20` span (rendered via
 *     a sentinel split, mirroring Flutter's `\u0000AMOUNT\u0000`).
 *   - All-green step bar pinned to the top.
 *   - White pill CTA at the bottom labelled "Next mission".
 *   - CSS-only confetti burst near the top — 24 particles, 6 brand
 *     colors, 3-second one-shot animation. No npm dep.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { use, useMemo } from "react";

import { ScreenBackground } from "@/components/screen-background";

// Encouragement is a templated ICU string with a `{amount}` slot. We
// render it with a control-char sentinel, then split around the
// sentinel so the amount can become a bold <strong>$20</strong> span.
const AMOUNT_SENTINEL = "\u0000AMOUNT\u0000";

// Confetti palette — same six tokens as the Flutter version.
const CONFETTI_COLORS = [
  "#E53935", // red
  "#FFC02E", // amber
  "#66BB6A", // green
  "#2196F3", // blue
  "#E91E63", // pink
  "#9C27B0", // purple
] as const;

export default function LevelCompletePage({
  params,
}: {
  // Next 16: params are async; unwrap with `React.use()`. The id is
  // unused inside the component itself (the URL already encodes it),
  // but consuming the promise here keeps the type signature honest.
  params: Promise<{ id: string }>;
}) {
  void use(params);

  const router = useRouter();
  const t = useTranslations();
  const search = useSearchParams();

  const points = parseIntSafe(search.get("points"), 0);
  const total = parseIntSafe(search.get("total"), 4);

  // Render the encouragement once with the sentinel, then split into
  // [before, after] around it. This avoids rebuilding the string on
  // every render and keeps the bold span structure stable.
  const [encouragementBefore, encouragementAfter] = useMemo(() => {
    const rendered = t("levelCompleteEncouragement", { amount: AMOUNT_SENTINEL });
    const idx = rendered.indexOf(AMOUNT_SENTINEL);
    if (idx < 0) return [rendered, ""];
    return [
      rendered.slice(0, idx),
      rendered.slice(idx + AMOUNT_SENTINEL.length),
    ];
  }, [t]);

  const onNext = () => {
    router.replace("/home");
  };

  return (
    <ScreenBackground overlay="strong">
      <div className="flex min-h-dvh flex-1 flex-col">
        {/* All-green step bar pinned near the top, 60% width to match
            the in-level top bar. */}
        <div className="px-6 pt-3">
          <div className="mx-auto w-3/5">
            <AllGreenStepBar total={total} />
          </div>
        </div>

        {/* Confetti — absolutely positioned over the top of the
            content so it can rain down behind the points numeral. */}
        <ConfettiBurst />

        {/* Centered hero block (points + headline + encouragement). */}
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <span
            className="block font-black leading-none"
            style={{
              color: "#FFC02E",
              fontSize: "96px",
              fontWeight: 900,
              letterSpacing: "-2px",
            }}
          >
            +{points}
          </span>
          <div className="h-8" />
          <h1 className="text-[28px] font-bold text-white">
            {t("levelCompleteCongrats")}
          </h1>
          <div className="h-4" />
          <p
            className="text-[16px] font-normal leading-snug text-white"
            style={{ lineHeight: 1.4 }}
          >
            {encouragementBefore}
            <strong className="font-bold">$20</strong>
            {encouragementAfter}
          </p>
        </div>

        {/* Next-mission CTA. White pill, green text — matches the
            Flutter style (`#66BB6A` foreground). */}
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onNext}
            className="flex h-15 w-full items-center justify-center rounded-full bg-white text-[20px] font-bold transition-opacity active:opacity-80"
            style={{ height: 60, color: "#66BB6A" }}
          >
            {t("levelCompleteNextMission")}
          </button>
        </div>
      </div>
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// All-green step bar
// ---------------------------------------------------------------------------

function AllGreenStepBar({ total }: { total: number }) {
  // Defensive: at least 1 segment so we don't render an empty row.
  const n = Math.max(1, total);
  return (
    <div className="flex h-1.5 items-center gap-1.5">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="h-1.5 flex-1 rounded-[3px]"
          style={{ backgroundColor: "#66BB6A" }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confetti burst (CSS-only)
// ---------------------------------------------------------------------------

/**
 * 24 small confetti rectangles fall from the top center, each with a
 * pre-randomised horizontal drift, rotation, color, and delay. The
 * animation runs once (no `infinite`) so the burst settles after ~3 s
 * and stays static — no JS rAF loop and no `confetti` dep.
 *
 * We cannot use `Math.random()` during render under React 19's
 * `react-hooks/purity` rule, so the random pattern is computed via a
 * tiny seedable LCG keyed on the particle index — deterministic, no
 * lint complaints, and visually identical to a fresh random per mount.
 */
function ConfettiBurst() {
  const particles = useMemo(() => buildParticles(24), []);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-64 w-full overflow-visible"
      style={{ position: "absolute" }}
    >
      <style>{`
        @keyframes afk-confetti {
          0%   { transform: translate3d(0, -40px, 0) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate3d(var(--afk-cx), 480px, 0) rotate(var(--afk-rot)); opacity: 0; }
        }
      `}</style>
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-16 block"
          style={{
            width: p.w,
            height: p.h,
            backgroundColor: p.color,
            borderRadius: 1,
            // Centered, then horizontal drift via CSS var.
            marginLeft: -p.w / 2,
            // Custom-prop end positions consumed by @keyframes.
            ["--afk-cx" as string]: `${p.dx}px`,
            ["--afk-rot" as string]: `${p.rot}deg`,
            animation: `afk-confetti 2.6s cubic-bezier(0.2, 0.6, 0.4, 1) ${p.delay}s 1 forwards`,
          }}
        />
      ))}
    </div>
  );
}

interface ConfettiParticle {
  /** Horizontal drift in px (signed). */
  dx: number;
  /** End rotation in degrees. */
  rot: number;
  /** Animation delay in seconds. */
  delay: number;
  /** Particle width in px. */
  w: number;
  /** Particle height in px. */
  h: number;
  /** Hex color from CONFETTI_COLORS. */
  color: string;
}

function buildParticles(count: number): ConfettiParticle[] {
  const out: ConfettiParticle[] = [];
  // Seedable LCG (numerical recipes constants). Deterministic across
  // mounts so the visual is identical every time — fine for a
  // celebration burst.
  let seed = 0x12345678;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < count; i++) {
    const dir = next() < 0.5 ? -1 : 1;
    out.push({
      dx: dir * (30 + next() * 160), // 30..190 px each side
      rot: (next() * 720 - 360),     // -360..+360 deg
      delay: next() * 0.4,           // 0..0.4 s
      w: 6 + Math.floor(next() * 4), // 6..9 px
      h: 10 + Math.floor(next() * 6),// 10..15 px
      color: CONFETTI_COLORS[Math.floor(next() * CONFETTI_COLORS.length)]!,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntSafe(v: string | null, fallback: number): number {
  if (v == null) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
