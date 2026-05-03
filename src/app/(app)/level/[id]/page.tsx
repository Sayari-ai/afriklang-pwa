"use client";

/**
 * Level screen — port of `lib/features/level/level_screen.dart`.
 *
 * Sequences the level's questions one at a time. Each question has
 * three phases:
 *   1. idle     → green mic CTA (Tap to record)
 *   2. recording → red mic CTA (Tap to stop) + running timer
 *   3. review    → Retake / Listen / Submit row
 *
 * On Submit:
 *   - Upload the WAV via Sayari (`uploadAudio`).
 *   - If consent has been revoked since onboarding, refuse with a
 *     snackbar (defence-in-depth: the consent gate already enforces
 *     this, but a user can revoke from Profile mid-level).
 *   - Advance to the next question, or — on the last one — call
 *     `usePathRepo.completeLevel(levelId)` and `router.replace` to
 *     `/level/[id]/complete?points=N`.
 *
 * Differences from Flutter:
 *   - No `permission_handler`/`AudioRecorder` adapters; we use the
 *     `WavRecorder` (Phase 5) which speaks AudioWorklet directly.
 *   - We don't write the WAV to a temp file — it lives in memory as a
 *     Blob and is uploaded in-place. The filename is still constructed
 *     via `buildRecordingFilename()` so Sayari sees the canonical
 *     `${iso}_${uuid}_${stamp}_${topic}.wav` shape.
 *   - Playback uses an `<audio>` element with a fresh blob: URL per
 *     review session. The URL is revoked on phase change to release
 *     the blob.
 *   - Page-level `params` arrives async (Next 16) — unwrapped via
 *     `React.use()`. We resolve the level definition + question list
 *     via `usePathRepo`, not via prop-drilling like Flutter.
 *
 * Layout: full-bleed scrim background (no bottom-nav since this route
 * lives outside the `(tabs)` group). The whole screen is a flex column
 * pinned to safe-area, so the mic button always sits a comfortable
 * distance above the safe-area bottom.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ScreenBackground } from "@/components/screen-background";
import { uploadAudio, AudioUploadError } from "@/lib/api/audio";
import { buildRecordingFilename } from "@/lib/audio/filename";
import { RecorderError, WavRecorder } from "@/lib/audio/recorder";
import { type LevelDefinition } from "@/lib/content/models";
import { useConsent } from "@/stores/consent";
import { useDeviceIdentity } from "@/stores/device-identity";
import { useLearningLanguage } from "@/stores/learning-language";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

type Phase = "idle" | "recording" | "review";

export default function LevelPage({
  params,
}: {
  // Next 16: dynamic route params resolve as a Promise; unwrap with
  // `use()`. See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = use(params);
  const levelId = Number.parseInt(idParam, 10);

  const t = useTranslations();
  const router = useRouter();

  const bundle = usePathRepo((s) => s.bundle);
  // Locate the cycle that owns this level, then the level itself.
  // Level ids are globally unique across cycles, so the first match
  // is canonical. Memoised together so the level's `pathId` (used to
  // build recording filenames) and the level definition stay aligned.
  // The shape (`{ level, owningPathId }` with both nullable) is kept
  // single-shape across all branches so the React Compiler can preserve
  // the memoization — early returns with constructor-literal objects
  // confuse its escape analysis.
  const { level, owningPathId } = useMemo(() => {
    let foundLevel: LevelDefinition | null = null;
    let foundPathId: number | null = null;
    if (bundle) {
      for (const cycle of bundle) {
        const hit = cycle.levels.find((l) => l.levelId === levelId);
        if (hit) {
          foundLevel = hit;
          foundPathId = cycle.pathId;
          break;
        }
      }
    }
    return { level: foundLevel, owningPathId: foundPathId };
  }, [bundle, levelId]);
  const questions = level?.questions ?? [];
  const totalSteps = questions.length;

  // Defensive: if a user deep-links to /level/9 or similar, bounce
  // back home rather than render a broken screen. The home tab
  // already gates this, but the guard belongs here too.
  useEffect(() => {
    if (bundle && (level === null || totalSteps === 0)) {
      useSnackbar
        .getState()
        .show(t("homeLevelHasNoQuestionsSnack", { levelId }));
      router.replace("/home");
    }
  }, [bundle, level, totalSteps, levelId, router, t]);

  // ---------------------------------------------------------------
  // Live state
  // ---------------------------------------------------------------

  const [step, setStep] = useState(1); // 1-based
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [uploading, setUploading] = useState(false);
  // Holds the most recent recording blob for the current question.
  // Cleared whenever we leave review (advance, retake, skip).
  const [recording, setRecording] = useState<Blob | null>(null);

  const recorderRef = useRef<WavRecorder | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackUrlRef = useRef<string | null>(null);
  // Reentrancy guard for the start/stop pair (matches `_busy` in Dart).
  const busyRef = useRef(false);
  // Number of questions the user has actually submitted (i.e. uploaded
  // a recording for) so far in this level. Skips don't increment. Used
  // to decide whether the level is a "full" or "partial" completion
  // when the user reaches the last step / skips it / hits back.
  // A ref (not state) because it never affects render and avoids stale
  // closures inside async submit handlers.
  const submittedCountRef = useRef(0);
  // Guards against double-firing the partial-completion persistence.
  // `onSkip` on the last step + the back button + the unmount cleanup
  // can race; we only ever want one `completeLevel` call per visit.
  const completionDispatchedRef = useRef(false);

  const question = questions[step - 1];
  const isRecording = phase === "recording";
  const isReview = phase === "review";

  // Cleanup: stop the recorder + ticker + revoke any blob URLs when
  // the screen is torn down (back-button or replace).
  useEffect(() => {
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      const rec = recorderRef.current;
      if (rec) void rec.dispose();
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
        playbackUrlRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------
  // Recording lifecycle
  // ---------------------------------------------------------------

  const startTimer = () => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    setElapsedSec(0);
    tickerRef.current = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };

  const startRecording = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // Stop any in-flight playback before starting a new take.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      // Drop the previous take (if any) — fresh slate for the new
      // recording. The blob URL was created lazily in `onListen`, so
      // revoke it if it exists.
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
        playbackUrlRef.current = null;
      }
      setRecording(null);

      const rec = new WavRecorder();
      recorderRef.current = rec;
      await rec.start();
      setPhase("recording");
      startTimer();
    } catch (e) {
      const msg =
        e instanceof RecorderError && e.code === "permission-denied"
          ? t("levelMicPermissionRequired")
          : e instanceof Error
            ? t("levelCouldNotStartRecording", { error: e.message })
            : t("levelCouldNotStartRecording", { error: String(e) });
      useSnackbar.getState().show(msg, 4000);
      // Reset to idle so the user can try again.
      setPhase("idle");
      stopTimer();
      recorderRef.current = null;
    } finally {
      busyRef.current = false;
    }
  }, [t]);

  const stopRecording = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const rec = recorderRef.current;
      if (!rec) {
        setPhase("idle");
        return;
      }
      const result = await rec.stop();
      stopTimer();
      setRecording(result.blob);
      setPhase("review");
    } catch (e) {
      const msg =
        e instanceof Error
          ? t("levelCouldNotStopRecording", { error: e.message })
          : t("levelCouldNotStopRecording", { error: String(e) });
      useSnackbar.getState().show(msg);
      setPhase("idle");
      stopTimer();
    } finally {
      recorderRef.current = null;
      busyRef.current = false;
    }
  }, [t]);

  const toggleRecord = () => {
    if (phase === "idle") {
      void startRecording();
    } else if (phase === "recording") {
      void stopRecording();
    }
  };

  // ---------------------------------------------------------------
  // Review actions
  // ---------------------------------------------------------------

  const onRetake = () => {
    void startRecording();
  };

  const onListen = () => {
    if (!recording) return;
    if (!audioRef.current) audioRef.current = new Audio();
    // Build (or rebuild) a fresh blob: URL. The previous one — if
    // any — is revoked first so we don't leak object URLs across
    // multiple Listen taps.
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
    }
    const url = URL.createObjectURL(recording);
    playbackUrlRef.current = url;
    const a = audioRef.current;
    a.src = url;
    a.currentTime = 0;
    a.play().catch((e) => {
      const msg =
        e instanceof Error
          ? t("levelCouldNotPlayRecording", { error: e.message })
          : t("levelCouldNotPlayRecording", { error: String(e) });
      useSnackbar.getState().show(msg);
    });
  };

  const onSubmit = async () => {
    if (uploading || !recording || owningPathId === null || !question) return;

    // Defence-in-depth: a revoked-since-onboarding consent state must
    // block uploads, even mid-level (matches Flutter, level_screen.dart:319).
    if (!useConsent.getState().granted) {
      useSnackbar.getState().show(t("levelConsentRequiredSnack"), 5000);
      return;
    }

    if (audioRef.current) audioRef.current.pause();

    const isLast = step >= totalSteps;
    setUploading(true);

    const speakerId = useDeviceIdentity.getState().ensure();
    const langIso = useLearningLanguage.getState().isoOrDefault();

    const filename = buildRecordingFilename({
      languageIso: langIso,
      speakerId,
      pathId: owningPathId,
      levelId,
      qIndex: question.qIndex,
    });

    try {
      await uploadAudio({
        file: recording,
        filename,
        languageIso: langIso,
        consentRecorded: true,
        speakerId,
        englishDescription: question.promptEn,
      });
    } catch (e) {
      // Submit is a hard, online-only operation now. Earlier
      // revisions queued failed uploads to IDB and replayed them
      // when connectivity returned, but that combined with the
      // audio-API's own retry loop produced duplicate writes in the
      // backend bucket on ambiguous failures (timeout-after-store,
      // lost response). Both layers are now at-most-once: one POST
      // per call, no client-side queue. The user retries by tapping
      // Submit again. We pick a friendlier copy for offline so they
      // know reconnecting is the next step, but otherwise reuse the
      // generic snackbar.
      const isNetwork = e instanceof AudioUploadError && e.isNetwork;
      const message = isNetwork
        ? t("levelOfflineSubmitSnack")
        : e instanceof AudioUploadError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      useSnackbar
        .getState()
        .show(
          isNetwork ? message : t("levelUploadFailedSnack", { error: message }),
          4000,
        );
      setUploading(false);
      return;
    }

    // Upload OK — clear the local blob + URL.
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
    }
    setRecording(null);

    // Count this successful submission. Used by the last-step branch
    // below (and by `onSkip` / the back button) to decide whether the
    // level should be persisted as a full or partial completion.
    submittedCountRef.current += 1;

    if (isLast) {
      // Decide whether this run was a full sweep (every question
      // submitted) or a partial completion (at least one skip). The
      // backend always returns the full `points_reward`, so for partial
      // we override locally with floor(reward / 2).
      const submitted = submittedCountRef.current;
      const isPartial = submitted < totalSteps;
      const reward = level?.pointsReward ?? 0;
      const awardedPoints = isPartial ? Math.floor(reward / 2) : reward;

      // Persist completion (best-effort). If the network call to
      // `progress_set` fails, surface a snackbar but still navigate
      // to the celebration screen — the next boot will reconcile
      // from the backend (Flutter has the same optimistic policy).
      // We capture `cycleComplete` from the repo's return value: when
      // true, the user just finished the last level of the current
      // cycle and the celebration screen should render the
      // cycle-complete variant (with the "Start next cycle" CTA)
      // rather than the per-level one.
      completionDispatchedRef.current = true;
      let cycleComplete = false;
      try {
        const res = await usePathRepo.getState().completeLevel(levelId, {
          pointsOverride: awardedPoints,
          submittedCount: submitted,
          totalSteps,
        });
        cycleComplete = res.cycleComplete;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useSnackbar
          .getState()
          .show(t("homeCouldNotSaveProgressSnack", { error: msg }));
      }
      const params = new URLSearchParams({
        points: String(awardedPoints),
        total: String(totalSteps),
        submitted: String(submitted),
      });
      if (isPartial) params.set("partial", "1");
      if (cycleComplete) params.set("cycleComplete", "1");
      router.replace(`/level/${levelId}/complete?${params.toString()}`);
      return;
    }

    // Advance to the next question.
    setUploading(false);
    setStep((s) => s + 1);
    setPhase("idle");
    setElapsedSec(0);
    stopTimer();
  };

  const onSkip = () => {
    // Cancel any in-flight recording / playback and clear local state
    // for the *current* question, then move on to the next image.
    // Skipping never uploads.
    const rec = recorderRef.current;
    if (rec) void rec.dispose();
    recorderRef.current = null;
    if (audioRef.current) audioRef.current.pause();
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
    }
    setRecording(null);
    stopTimer();
    setUploading(false);

    const isLast = step >= totalSteps;
    if (isLast) {
      // End of the level reached via skip. If the user managed to
      // submit at least one recording, the level still counts as a
      // partial completion (half points). Otherwise nothing is
      // persisted — they just leave the level untouched.
      const submitted = submittedCountRef.current;
      if (submitted > 0) {
        void persistPartialAndExit(submitted);
      } else {
        useSnackbar.getState().show(t("levelSkippedSnack"), 1000);
        router.back();
      }
      return;
    }

    // Advance to the next question (next image).
    useSnackbar.getState().show(t("levelSkippedSnack"), 1000);
    setStep((s) => s + 1);
    setPhase("idle");
    setElapsedSec(0);
  };

  /**
   * Persist a partial completion and route to the celebration screen.
   * Called from `onSkip` (last step, with prior submissions) and from
   * the TopBar back button (any step, with prior submissions). Idempotent
   * via `completionDispatchedRef`.
   */
  const persistPartialAndExit = async (submitted: number) => {
    if (completionDispatchedRef.current) return;
    completionDispatchedRef.current = true;
    const reward = level?.pointsReward ?? 0;
    const awardedPoints = Math.floor(reward / 2);
    let cycleComplete = false;
    try {
      const res = await usePathRepo.getState().completeLevel(levelId, {
        pointsOverride: awardedPoints,
        submittedCount: submitted,
        totalSteps,
      });
      cycleComplete = res.cycleComplete;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useSnackbar
        .getState()
        .show(t("homeCouldNotSaveProgressSnack", { error: msg }));
    }
    const params = new URLSearchParams({
      points: String(awardedPoints),
      total: String(totalSteps),
      submitted: String(submitted),
      partial: "1",
    });
    if (cycleComplete) params.set("cycleComplete", "1");
    router.replace(`/level/${levelId}/complete?${params.toString()}`);
  };

  /**
   * TopBar back button. If the user has already submitted at least one
   * recording, treat the exit as a partial completion (half points,
   * level marked complete with N/total stars). Otherwise just leave
   * the level — no progress recorded.
   */
  const onBack = () => {
    const submitted = submittedCountRef.current;
    if (submitted > 0 && !completionDispatchedRef.current) {
      void persistPartialAndExit(submitted);
      return;
    }
    router.back();
  };

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  if (!bundle || !level || !question) {
    // Hydration race / deep link — show a transparent placeholder
    // while the effect above bounces us home.
    return <ScreenBackground overlay="strong"><div /></ScreenBackground>;
  }

  const langDisplay = useLearningLanguage.getState().displayNameOrDefault();

  return (
    <ScreenBackground overlay="strong">
      <div className="flex min-h-dvh flex-1 flex-col">
        <TopBar
          totalSteps={totalSteps}
          currentStep={step}
          onBack={onBack}
          onSkip={onSkip}
          skipLabel={t("commonSkip")}
        />

        <div className="h-4" />

        {/* Question content. Re-keyed on `step` so React tears it
            down + remounts on advance, restarting the inner image
            transition / fade for free. */}
        <div className="flex-1 overflow-y-auto" key={step}>
          <QuestionContent
            languageDisplay={langDisplay}
            promptEn={question.promptEn}
            imageUrl={question.imageUrl}
            titleTemplate={t("levelQuestionTitle", { language: langDisplay })}
          />
        </div>

        {/* Footer: timer + record CTA, OR the review row. */}
        <div className="flex flex-col items-center px-6 pb-6">
          {isRecording && (
            <>
              <p className="text-[20px] font-semibold text-white">
                {formatElapsed(elapsedSec)}
              </p>
              <div className="h-4" />
            </>
          )}
          {isReview ? (
            <ReviewActions
              onRetake={onRetake}
              onListen={onListen}
              onSubmit={() => void onSubmit()}
              submitting={uploading}
              labels={{
                retake: t("levelRetake"),
                listen: t("levelListen"),
                submit: t("levelSubmit"),
                submitUploading: t("levelSubmitUploading"),
              }}
            />
          ) : (
            <>
              <RecordButton recording={isRecording} onClick={toggleRecord} />
              <div className="h-3" />
              <p className="text-[18px] font-semibold text-white">
                {isRecording ? t("levelTapToStop") : t("levelTapToRecord")}
              </p>
            </>
          )}
        </div>
      </div>
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// Top bar: back, step indicator, skip
// ---------------------------------------------------------------------------

function TopBar({
  totalSteps,
  currentStep,
  onBack,
  onSkip,
  skipLabel,
}: {
  totalSteps: number;
  currentStep: number;
  onBack: () => void;
  onSkip: () => void;
  skipLabel: string;
}) {
  return (
    <div className="flex items-center px-2 pt-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-12 w-12 items-center justify-center text-white"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="flex flex-1 justify-center">
        {/* Step bar — 60% width to match Flutter's FractionallySizedBox.
            On very narrow phones, give it more room so dots stay legible. */}
        <div className="w-3/5 phone-sm:w-4/5">
          <StepBar total={totalSteps} current={currentStep} />
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="px-3 py-2 text-[18px] font-semibold text-white phone-sm:px-2 phone-sm:text-[15px]"
      >
        {skipLabel}
      </button>
    </div>
  );
}

function StepBar({ total, current }: { total: number; current: number }) {
  // Track green at #66BB6A, idle grey at #CFCFCF — Flutter `_StepBar`.
  return (
    <div className="flex h-3 items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < current;
        const isHead = i === current - 1;
        return (
          <div key={i} className="relative flex-1">
            <div
              className="h-1.5 w-full rounded-[3px]"
              style={{ backgroundColor: filled ? "#66BB6A" : "#CFCFCF" }}
            />
            {isHead && (
              <span
                aria-hidden
                className="absolute right-[-4px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: "#66BB6A" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question card
// ---------------------------------------------------------------------------

function QuestionContent({
  promptEn,
  imageUrl,
  titleTemplate,
}: {
  /** Display name of the target language ("Wolof", "Twi", ...). */
  languageDisplay: string;
  promptEn: string;
  imageUrl: string;
  titleTemplate: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 phone-sm:px-4">
      <h1
        className="whitespace-pre-line text-center text-[32px] font-black leading-tight text-white phone-sm:text-[24px]"
        style={{ letterSpacing: "-0.3px" }}
      >
        {titleTemplate}
      </h1>
      <div className="h-3" />
      <p className="text-center text-[18px] font-medium text-white phone-sm:text-[15px]">
        {promptEn}
      </p>
      <div className="h-4" />
      {/* Square card. `aspect-square` keeps it 1:1 regardless of the
          underlying image; `object-cover` clips. */}
      <div
        className="relative aspect-square w-full max-w-md overflow-hidden rounded-[28px] bg-white p-2 shadow-[0_8px_20px_rgba(0,0,0,0.33)]"
      >
        <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[#EFEFEF]">
          {/* `unoptimized` because Supabase Storage URLs are public
              and we don't need Next's image optimisation for this
              one-shot render. Saves us configuring a remote pattern
              just for this. (Already configured for *.supabase.co
              actually, but `unoptimized` cuts a roundtrip.) */}
          <Image
            src={imageUrl}
            alt={promptEn}
            fill
            sizes="(max-width: 600px) 100vw, 480px"
            className="object-cover"
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record button
// ---------------------------------------------------------------------------

function RecordButton({
  recording,
  onClick,
}: {
  recording: boolean;
  onClick: () => void;
}) {
  // Idle green #66BB6A → active red #E53935 (matches Flutter tokens).
  const color = recording ? "#E53935" : "#66BB6A";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={recording ? "Stop recording" : "Start recording"}
      className="relative flex h-[100px] w-[100px] items-center justify-center rounded-full phone-sm:h-[88px] phone-sm:w-[88px]"
      style={{
        backgroundColor: color,
        boxShadow: `0 0 18px 2px ${color}80`,
      }}
    >
      {recording ? <WaveformIcon /> : <MicIcon />}
    </button>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="white" aria-hidden>
      <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3zm5 9a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
    </svg>
  );
}

function WaveformIcon() {
  // 5-bar pulsing waveform. Heights from `_WaveformPainter` base
  // pattern [0.5, 0.85, 1.0, 0.85, 0.5], each animated with a phase
  // offset so they ripple. Pure CSS keyframes per bar.
  const heights = [50, 85, 100, 85, 50];
  return (
    <div className="flex h-9 w-14 items-center justify-center gap-1">
      {heights.map((h, i) => (
        <span
          key={i}
          className="block w-1.5 rounded-full bg-white"
          style={{
            height: `${h}%`,
            animation: `afk-wave 0.9s ease-in-out ${i * 0.12}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes afk-wave {
          from { transform: scaleY(0.6); }
          to { transform: scaleY(1.1); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

function ReviewActions({
  onRetake,
  onListen,
  onSubmit,
  submitting,
  labels,
}: {
  onRetake: () => void;
  onListen: () => void;
  onSubmit: () => void;
  submitting: boolean;
  labels: {
    retake: string;
    listen: string;
    submit: string;
    submitUploading: string;
  };
}) {
  return (
    <div className="flex w-full max-w-md items-start justify-between px-2">
      <ActionButton
        color="#E53935"
        label={labels.retake}
        onClick={onRetake}
        disabled={submitting}
        icon={
          <svg viewBox="0 0 24 24" width="34" height="34" fill="white" aria-hidden>
            <path d="M17.65 6.35A8 8 0 1019.46 15h-2.1a6 6 0 11-1.4-6.24L13 12h7V5l-2.35 1.35z" />
          </svg>
        }
      />
      <ActionButton
        color="#2196F3"
        label={labels.listen}
        onClick={onListen}
        disabled={submitting}
        icon={
          <svg viewBox="0 0 24 24" width="34" height="34" fill="white" aria-hidden>
            <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 8.05v7.9a4.5 4.5 0 002.5-3.95zM14 3.23v2.06a7 7 0 010 13.42v2.06a9 9 0 000-17.54z" />
          </svg>
        }
      />
      <ActionButton
        color="#66BB6A"
        label={submitting ? labels.submitUploading : labels.submit}
        onClick={onSubmit}
        disabled={submitting}
        busy={submitting}
        icon={
          <svg viewBox="0 0 24 24" width="34" height="34" fill="white" aria-hidden>
            <path d="M1 21h4V9H1v12zm22-11a2 2 0 00-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 00-.44-1.06L14.17 1 7.59 7.59A2 2 0 007 9v10a2 2 0 002 2h9a2 2 0 001.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
          </svg>
        }
      />
    </div>
  );
}

function ActionButton({
  color,
  icon,
  label,
  onClick,
  disabled,
  busy = false,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex w-full max-w-[88px] flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed phone-sm:h-[64px] phone-sm:w-[64px]"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 14px 1px ${color}73`,
          opacity: disabled && !busy ? 0.5 : 1,
        }}
      >
        {busy ? <ActionSpinner /> : icon}
      </button>
      <div className="h-2" />
      <span className="line-clamp-2 text-center text-[15px] font-semibold text-white phone-sm:text-[13px]">{label}</span>
    </div>
  );
}

function ActionSpinner() {
  return (
    <span
      role="progressbar"
      aria-label="Uploading"
      className="block h-7 w-7 animate-spin rounded-full border-[3px] border-white/30 border-t-white"
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60) % 60;
  const s = totalSeconds % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
