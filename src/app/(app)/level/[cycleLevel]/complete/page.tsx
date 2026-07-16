"use client";

/**
 * Level complete screen port of `lib/features/level/level_complete_screen.dart`.
 *
 * Shown after the last question of a level uploads successfully. The
 * actual `usePathRepo.completeLevel(...)` call happens in the level
 * screen *before* navigating here, which differs from Flutter (where
 * the home owns it via callback) but is closer to a web "the URL is
 * the truth" model: by the time you land on `/level/:id/complete`,
 * the level is already marked done.
 *
 * Inputs (query string):
 *   - `points`         → integer points reward to display (defaults to 0).
 *   - `total`          → number of segments in the all-green step bar
 *                         (the question count for this level). Defaults to 4.
 *   - `submitted`      → number of questions actually recorded; the
 *                         step bar fills only that many segments.
 *   - `partial`        → "1" when the level was completed partially
 *                         (skip/back with at least one submission).
 *                         Halves the bar fill behaviour.
 *   - `cycleComplete`  → "1" when this completion was the *last* level
 *                         of the user's current cycle. Switches the
 *                         page to the "cycle complete" variant: a
 *                         different headline, a "Start next cycle" CTA
 *                         that calls `usePathRepo.advanceCycle()`, and
 *                         offline-aware enable state for the CTA.
 *
 * Hardware back / browser back: indistinguishable from the "Next
 * mission" CTA in our case both routes back to `/home`. The Flutter
 * version uses `PopScope` to force a `pop(true)` so the home callback
 * runs; we don't need that ceremony because completion is already
 * persisted before we arrive.
 *
 * Visuals:
 *   - Same dark scrim background (`overlay="strong"` → 0xCC overlay).
 *   - Massive amber `+N` numeral, white headline, purpose-driven
 *     encouragement line (every recording contributes to the language
 *     dataset honest copy, no monetary promise).
 *   - All-green step bar pinned to the top.
 *   - White pill CTA at the bottom. Label depends on the variant:
 *     "Next mission" for the per-level variant, "Start next cycle"
 *     for the cycle-complete variant.
 *   - CSS-only confetti burst near the top 24 particles, 6 brand
 *     colors, 3-second one-shot animation. No npm dep.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";

import { CoinIcon } from "@/components/game/game-icons";
import { RibbonBanner } from "@/components/game/ribbon";
import { StarRating } from "@/components/game/star-rating";
import { WoodButton } from "@/components/game/wood-button";
import { InstallPromptCard } from "@/components/install-prompt-card";
import { ScreenBackground } from "@/components/screen-background";
import { GameColors } from "@/lib/colors";
import { track } from "@/lib/api/events";
import { requestPersistentStorage } from "@/lib/storage/persistence";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

// Confetti palette game-kit greens, golds and wood oranges.
const CONFETTI_COLORS = GameColors.confetti;

export default function LevelCompletePage({
  params,
}: {
  // Next 16: params are async; unwrap with `React.use()`. The
  // `cycleLevel` segment is unused inside the component itself (the
  // URL already encodes it and the celebration body reads everything
  // else from the query string), but consuming the promise here keeps
  // the type signature honest.
  params: Promise<{ cycleLevel: string }>;
}) {
  void use(params);

  const router = useRouter();
  const t = useTranslations();
  const search = useSearchParams();

  const points = parseIntSafe(search.get("points"), 0);
  const total = parseIntSafe(search.get("total"), 4);
  // Partial-completion query params. When `partial=1`, the step bar
  // renders the first `submitted` segments green and the rest grey, so
  // the user can see at a glance that they skipped some images. Falls
  // back to a full bar (the legacy behaviour) when the params are
  // missing e.g. older URLs from before partial credit existed.
  const isPartial = search.get("partial") === "1";
  const submitted = parseIntSafe(search.get("submitted"), total);

  // Star rating for the hero same 3-slot mapping the map badges use:
  // clean sweep → 3 stars, partial → ceil(ratio × 3), min 1.
  const earnedStars = isPartial
    ? Math.max(
        1,
        Math.min(3, Math.ceil((submitted / Math.max(1, total)) * 3)),
      )
    : 3;

  // Cycle-complete variant. When the level page detected (via the
  // repo's `completeLevel` return) that this was the final level of
  // the active cycle, it appends `&cycleComplete=1` to the URL. We
  // branch the headline + CTA on this rather than rendering a
  // separate page, because the layout (step bar, hero, points,
  // confetti, pill button) is otherwise identical and we'd just be
  // duplicating the chrome.
  const isCycleComplete = search.get("cycleComplete") === "1";

  // Track online/offline so the cycle-complete CTA can disable when
  // the device is offline `advanceCycle` POSTs to the backend and
  // we don't queue path-assignment writes (the backend issues a new
  // cycle synchronously, so there's nothing meaningful to defer).
  // `navigator.onLine` is unreliable on its own (some browsers stay
  // optimistic) but for a UX hint it's fine; the actual `advanceCycle`
  // call still has a try/catch fallback.
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  // Pending state for the "Start next cycle" CTA. While true the
  // button is disabled + shows a spinner, so a slow `paths_assign`
  // round-trip can't be re-triggered by an impatient double-tap.
  const [advancing, setAdvancing] = useState(false);

  // Phase-1 durability: the user just invested real effort ask the
  // browser to protect our storage bucket from best-effort eviction.
  // One-shot per session, silently no-ops where unsupported.
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Headline variants. For cycle-complete we want a punchier, more
  // celebratory string ("Path complete!") so the user understands the
  // scope of what they just achieved not just "another level done".
  const headline = isCycleComplete
    ? t("levelCompleteCycleTitle")
    : t("levelCompleteCongrats");

  /**
   * Per-level CTA: just go home. The home page picks up the new
   * `current` level from the progress vector and the user keeps
   * playing.
   */
  const onNext = useCallback(() => {
    router.replace("/home");
  }, [router]);

  /**
   * Cycle-complete CTA: ask the backend for a new cycle, refetch
   * the bundle + progress, and go home. The repo's `advanceCycle`
   * is online-only by design (no offline queue for path issuance,
   * since the backend response is what defines the new cycle's
   * level ids). On any failure we keep the user on this screen and
   * snackbar the error, so they can retry once back online.
   */
  const onAdvanceCycle = useCallback(async () => {
    if (advancing) return;
    if (!online) {
      useSnackbar.getState().show(t("cycleAdvanceOfflineSnack"));
      return;
    }
    setAdvancing(true);
    try {
      await usePathRepo.getState().advanceCycle();
      track("cycle_advance");
      router.replace("/home");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useSnackbar
        .getState()
        .show(t("cycleAdvanceFailedSnack", { error: msg }));
      setAdvancing(false);
    }
  }, [advancing, online, router, t]);

  return (
    <ScreenBackground overlay="strong">
      <div className="flex min-h-dvh flex-1 flex-col">
        {/* All-green step bar pinned near the top, 60% width to match
            the in-level top bar. */}
        <div className="px-6 pt-3">
          <div className="mx-auto w-3/5">
            <AllGreenStepBar total={total} submitted={isPartial ? submitted : total} />
          </div>
        </div>

        {/* Confetti absolutely positioned over the top of the
            content so it can rain down behind the points numeral. */}
        <ConfettiBurst />

        {/* Centered hero block (stars + points + headline + copy). */}
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          {/* Earned stars same 3-slot mapping as the map badges. */}
          <StarRating filled={earnedStars} size={52} />
          <div className="h-6" />
          <div className="flex items-center justify-center gap-3">
            <CoinIcon className="h-[0.7em] w-[0.7em] shrink-0" style={{ fontSize: "clamp(56px, 18vw, 84px)" }} />
            <span
              className="text-outline block max-w-full break-words font-game leading-none text-star-gold"
              style={{
                // Fluid: 56px on tiny phones, scales up around 480px.
                fontSize: "clamp(56px, 18vw, 84px)",
              }}
            >
              +{points}
            </span>
          </div>
          <div className="h-7" />
          <RibbonBanner className="h-14 w-full max-w-[340px]" textClassName="text-[22px] phone-sm:text-[18px]">
            {headline}
          </RibbonBanner>
          <div className="h-5" />
          <p
            className="text-[16px] font-medium leading-snug text-cream/95 phone-sm:text-[14px]"
            style={{ lineHeight: 1.4, textShadow: "0 1px 0 rgba(0,0,0,0.4)" }}
          >
            {/*
              Cycle-complete variant gets its own subtitle the
              per-level encouragement copy doesn't fit the "you
              finished the whole path" beat.
            */}
            {isCycleComplete
              ? t("levelCompleteCycleSubtitle")
              : t("levelCompleteEncouragement")}
          </p>
        </div>

        {/* CTA. Variant-dependent label + handler. Wooden game button
            disabled while `advancing` (cycle-complete only) so the
            user can't double-submit a `paths_assign`. */}
        <div className="flex flex-col gap-5 px-6 pb-6">
          {/* Add-to-home-screen offer at the peak-motivation moment.
              Self-gating: renders nothing when installed, dismissed
              recently, or no install path exists on this browser. */}
          <InstallPromptCard />
          <WoodButton
            tone="green"
            size="lg"
            fullWidth
            onClick={isCycleComplete ? onAdvanceCycle : onNext}
            disabled={isCycleComplete && (advancing || !online)}
            loading={isCycleComplete && advancing}
          >
            {isCycleComplete
              ? advancing
                ? t("cycleAdvancePending")
                : t("levelCompleteCycleStartNext")
              : t("levelCompleteNextMission")}
          </WoodButton>
        </div>
      </div>
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// All-green step bar
// ---------------------------------------------------------------------------

function AllGreenStepBar({ total, submitted }: { total: number; submitted: number }) {
  // Defensive: at least 1 segment so we don't render an empty row.
  const n = Math.max(1, total);
  const filled = Math.max(0, Math.min(n, submitted));
  return (
    <div className="flex h-2 items-center gap-1.5">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="h-2 flex-1 rounded-[4px]"
          style={
            i < filled
              ? {
                  background:
                    "linear-gradient(180deg, var(--color-ribbon-light) 0%, var(--color-grass-light) 100%)",
                  boxShadow: "0 1px 0 var(--color-grass-deep)",
                }
              : {
                  background: "rgba(0,0,0,0.35)",
                  boxShadow: "inset 0 1.5px 2px rgba(0,0,0,0.5)",
                }
          }
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
 * and stays static no JS rAF loop and no `confetti` dep.
 *
 * We cannot use `Math.random()` during render under React 19's
 * `react-hooks/purity` rule, so the random pattern is computed via a
 * tiny seedable LCG keyed on the particle index deterministic, no
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
        /*
         * Reduced-motion users get a still version: the keyframes
         * still exist (browsers need them defined for the animation
         * shorthand to resolve), but we cancel the animation
         * outright on each particle so they render at their
         * computed start state (top-center, opacity 0). The result
         * is "no confetti at all" rather than a frozen mid-fall
         * snapshot, which matches the spirit of the preference.
         */
        @media (prefers-reduced-motion: reduce) {
          .afk-confetti-particle { animation: none !important; }
        }
      `}</style>
      {particles.map((p, i) => (
        <span
          key={i}
          className="afk-confetti-particle absolute left-1/2 top-16 block"
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
  // mounts so the visual is identical every time fine for a
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
