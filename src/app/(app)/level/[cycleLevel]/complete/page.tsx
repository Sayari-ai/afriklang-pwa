"use client";

/**
 * Level complete screen the celebration (flat redesign).
 *
 * Shown after the last question of a level uploads successfully. The
 * actual `usePathRepo.completeLevel(...)` call happens in the level
 * screen *before* navigating here by the time you land on
 * `/level/:id/complete`, the level is already marked done.
 *
 * Inputs (query string):
 *   - `points`         → integer points reward to display (defaults to 0).
 *   - `total`          → question count for this level (progress bar
 *                         denominator + recordings stat). Defaults to 4.
 *   - `submitted`      → number of questions actually recorded.
 *   - `partial`        → "1" when the level was completed partially
 *                         (skip/back with at least one submission).
 *   - `cycleComplete`  → "1" when this completion was the *last* level
 *                         of the user's current cycle. Switches the
 *                         page to the "cycle complete" variant: a
 *                         different headline, a "Start next cycle" CTA
 *                         that calls `usePathRepo.advanceCycle()`, and
 *                         offline-aware enable state for the CTA.
 *
 * Visuals (Duolingo end-of-lesson style):
 *   - White surface, confetti burst in brand colors.
 *   - Celebrating mascot over the earned 1-3 star arc.
 *   - Big yellow headline.
 *   - Two stat cards: POINTS (yellow, coin) and RECORDINGS (green,
 *     mic, `submitted/total`).
 *   - Full-width primary CONTINUE pinned at the bottom (label varies
 *     by variant), with the add-to-home-screen card above it.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InstallPromptCard } from "@/components/install-prompt-card";
import { Button } from "@/components/ui/button";
import { CoinIcon, MicIcon } from "@/components/ui/icons";
import { Mascot } from "@/components/ui/mascot";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StarRating } from "@/components/ui/star-rating";
import { Palette } from "@/lib/colors";
import { track } from "@/lib/api/events";
import { playSfx } from "@/lib/audio/sfx";
import { requestPersistentStorage } from "@/lib/storage/persistence";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

// Confetti palette brand green, blue, red, yellow, orange, purple.
const CONFETTI_COLORS = Palette.confetti;

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
  // Partial-completion query params. When `partial=1`, the progress
  // bar fills only `submitted/total`, so the user can see at a glance
  // that they skipped some images. Falls back to a full bar (the
  // legacy behaviour) when the params are missing e.g. older URLs
  // from before partial credit existed.
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
  // separate page, because the layout is otherwise identical and
  // we'd just be duplicating the chrome.
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

  // Celebration fanfare, once per mount. The CONTINUE tap that
  // navigated here already unlocked the sfx AudioContext, so playing
  // outside a gesture works. Ref-guarded against React strict-mode's
  // double effect invocation (a doubled fanfare is very audible).
  const fanfarePlayedRef = useRef(false);
  useEffect(() => {
    if (fanfarePlayedRef.current) return;
    fanfarePlayedRef.current = true;
    playSfx(isCycleComplete ? "cycleComplete" : "levelComplete");
  }, [isCycleComplete]);

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
    <div className="flex min-h-dvh w-full flex-col pb-safe pt-[env(safe-area-inset-top)]">
      {/* Progress bar pinned near the top full for clean sweeps,
          partial fills show the skipped tail. */}
      <div className="px-6 pt-4">
        <ProgressBar value={isPartial ? submitted : total} max={total} />
      </div>

      {/* Confetti absolutely positioned over the top of the
          content so it can rain down behind the hero. */}
      <ConfettiBurst />

      {/* Centered hero block (mascot + stars + headline + stats). */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center phone-sm:px-4">
        <Mascot size={120} />
        <div className="h-4" />
        <StarRating filled={earnedStars} size={40} />
        <div className="h-5" />
        <h1 className="text-[32px] font-extrabold leading-tight text-orange-deep phone-sm:text-[26px]">
          {headline}
        </h1>
        <div className="h-2" />
        <p className="max-w-[340px] text-[15px] font-semibold leading-snug text-text-muted phone-sm:text-[13px]">
          {/*
            Cycle-complete variant gets its own subtitle the
            per-level encouragement copy doesn't fit the "you
            finished the whole path" beat.
          */}
          {isCycleComplete
            ? t("levelCompleteCycleSubtitle")
            : t("levelCompleteEncouragement")}
        </p>
        <div className="h-7" />

        {/* Stat cards colored frame, white well, matching value. */}
        <div className="flex w-full max-w-[360px] items-stretch gap-3">
          <StatCard
            frame={Palette.yellow}
            label={t("levelCompleteStatPoints")}
            value={
              <>
                <CoinIcon className="h-6 w-6 shrink-0" />
                <span
                  className="text-[20px] font-extrabold"
                  style={{ color: Palette.yellowDeep }}
                >
                  +{points}
                </span>
              </>
            }
          />
          <StatCard
            frame={Palette.primary}
            label={t("levelCompleteStatRecordings")}
            value={
              <>
                <MicIcon
                  className="h-6 w-6 shrink-0"
                  color={Palette.primary}
                />
                <span
                  className="text-[20px] font-extrabold"
                  style={{ color: Palette.primaryText }}
                >
                  {submitted}/{total}
                </span>
              </>
            }
          />
        </div>
      </div>

      {/* CTA. Variant-dependent label + handler disabled while
          `advancing` (cycle-complete only) so the user can't
          double-submit a `paths_assign`. */}
      <div className="flex flex-col gap-5 px-6 pb-4">
        {/* Add-to-home-screen offer at the peak-motivation moment.
            Self-gating: renders nothing when installed, dismissed
            recently, or no install path exists on this browser. */}
        <InstallPromptCard />
        <Button
          variant="primary"
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
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

/**
 * Colored stat tile: saturated frame with a tiny uppercase label on
 * the frame itself, and a white inner well carrying the value.
 */
function StatCard({
  frame,
  label,
  value,
}: {
  /** Frame hex color. */
  frame: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-1 flex-col overflow-hidden rounded-2xl p-[3px]"
      style={{ backgroundColor: frame }}
    >
      <p className="px-2 py-1 text-center text-[11px] font-extrabold uppercase tracking-[1px] text-white phone-sm:px-1 phone-sm:text-[10px] phone-sm:tracking-normal">
        {label}
      </p>
      <div className="flex h-[52px] items-center justify-center gap-1.5 rounded-[13px] bg-bg">
        {value}
      </div>
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
