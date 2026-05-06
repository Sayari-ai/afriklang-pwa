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
 *     `usePathRepo.completeLevel(cycle, levelId)` and `router.replace`
 *     to `/level/${cycle}-${levelId}/complete?points=N`.
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
import { EdgeFunctionError } from "@/lib/api/edge";
import { swapQuestion } from "@/lib/api/questions";
import { buildRecordingFilename } from "@/lib/audio/filename";
import { RecorderError, WavRecorder, acquireMicStream } from "@/lib/audio/recorder";
import { type LevelDefinition } from "@/lib/content/models";
import {
  formatCycleLevelParam,
  parseCycleLevelParam,
} from "@/lib/content/cycle-level";
import { useConsent } from "@/stores/consent";
import { useDeviceIdentity } from "@/stores/device-identity";
import { useLearningLanguage } from "@/stores/learning-language";
import { usePathRepo } from "@/stores/path-repo";
import { useSnackbar } from "@/stores/snackbar";

type Phase = "idle" | "countdown" | "recording" | "review";

export default function LevelPage({
  params,
}: {
  // Next 16: dynamic route params resolve as a Promise; unwrap with
  // `use()`. See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
  //
  // The `cycleLevel` segment is a composite `${cycle}-${levelId}` key
  // (e.g. `2-3`); see `lib/content/cycle-level.ts`. We tolerate the
  // legacy bare-integer form (`/level/3`) by falling back to cycle 1
  // — that keeps any pre-multi-cycle deep-links and shared bookmarks
  // alive without a redirect dance.
  params: Promise<{ cycleLevel: string }>;
}) {
  const { cycleLevel: rawParam } = use(params);
  const parsed = parseCycleLevelParam(rawParam);
  // We render guards against `parsed === null` below; until we know
  // the parse worked, fall back to NaN so any downstream lookups miss
  // (and the home-redirect effect fires).
  const cycle = parsed?.cycle ?? Number.NaN;
  const levelId = parsed?.levelId ?? Number.NaN;

  const t = useTranslations();
  const router = useRouter();

  const bundle = usePathRepo((s) => s.bundle);
  // Locate the level by composite (cycle, levelId) key. Level ids are
  // 1..8 *within a cycle* and NOT globally unique across cycles, so
  // matching on levelId alone would silently surface a same-numbered
  // level from a different cycle once the user has advanced. Memoised
  // together so the level's `pathId` (used to build recording
  // filenames) and the level definition stay aligned.
  // The shape (`{ level, owningPathId }` with both nullable) is kept
  // single-shape across all branches so the React Compiler can preserve
  // the memoization — early returns with constructor-literal objects
  // confuse its escape analysis.
  const { level, owningPathId } = useMemo(() => {
    let foundLevel: LevelDefinition | null = null;
    let foundPathId: number | null = null;
    if (bundle && Number.isInteger(cycle) && Number.isInteger(levelId)) {
      const cycleDef = bundle.find((c) => c.cycle === cycle);
      const hit = cycleDef?.levels.find((l) => l.levelId === levelId);
      if (cycleDef && hit) {
        foundLevel = hit;
        foundPathId = cycleDef.pathId;
      }
    }
    return { level: foundLevel, owningPathId: foundPathId };
  }, [bundle, cycle, levelId]);
  const questions = level?.questions ?? [];
  const totalSteps = questions.length;

  // Defensive: if a user deep-links to /level/9-9 or a malformed
  // composite key, bounce back home rather than render a broken
  // screen. The home tab already gates this, but the guard belongs
  // here too.
  useEffect(() => {
    if (parsed === null) {
      // Unparsable param — not even worth a snackbar with a level id.
      router.replace("/home");
      return;
    }
    if (bundle && (level === null || totalSteps === 0)) {
      useSnackbar
        .getState()
        .show(t("homeLevelHasNoQuestionsSnack", { levelId }));
      router.replace("/home");
    }
  }, [bundle, level, totalSteps, levelId, parsed, router, t]);

  // ---------------------------------------------------------------
  // Live state
  // ---------------------------------------------------------------

  const [step, setStep] = useState(1); // 1-based
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  // 3-2-1 countdown shown on the mic button before recording starts.
  // null = no countdown active. Decreases once per second; when it
  // would tick past 0 we transition to `recording`.
  const [countdown, setCountdown] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  // Holds the most recent recording blob for the current question.
  // Cleared whenever we leave review (advance, retake, skip).
  const [recording, setRecording] = useState<Blob | null>(null);

  const recorderRef = useRef<WavRecorder | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 3-2-1 countdown timer handle. Lives in a ref so we can cancel it
  // from cleanup and from `stopRecording` without needing it in any
  // dependency array.
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mic stream pre-acquired synchronously during the user-gesture
  // click handler that kicks off the countdown. iOS Safari requires
  // `getUserMedia` to be called from a synchronously-reachable code
  // path of the gesture handler — `setInterval` callbacks lose the
  // gesture token and the OS prompt is silently suppressed. So we
  // grab the stream right away and hold it for the worklet to adopt
  // when the countdown completes. See `acquireMicStream()` doc.
  const pendingStreamRef = useRef<Promise<MediaStream> | null>(null);
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
      if (countdownRef.current) clearInterval(countdownRef.current);
      const rec = recorderRef.current;
      if (rec) void rec.dispose();
      // If the user backed out mid-countdown, release the
      // pre-acquired mic stream so the OS indicator goes away.
      const pending = pendingStreamRef.current;
      if (pending) {
        pending
          .then((s) => s.getTracks().forEach((t) => t.stop()))
          .catch(() => {});
        pendingStreamRef.current = null;
      }
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

  const stopCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
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

      // Adopt the mic stream that `beginCountdown` pre-acquired during
      // the user-gesture click. If for any reason it's not there
      // (defensive: countdown was bypassed), fall back to the
      // recorder's internal `getUserMedia`. That fallback path won't
      // work on iOS Safari but is safe on Chrome / Firefox / Android.
      const pending = pendingStreamRef.current;
      pendingStreamRef.current = null;
      const stream = pending ? await pending : undefined;

      const rec = new WavRecorder();
      recorderRef.current = rec;
      await rec.start(stream);
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

  /**
   * Show a 3 → 2 → 1 countdown on the mic button, then call
   * `startRecording`. Idempotent: a second call while already counting
   * down (or already recording) is a no-op.
   *
   * Why a separate phase rather than a brief delay-then-record:
   *   - The mic button must remain visibly disabled and show the
   *     digit, so the user knows recording hasn't started yet.
   *   - The label flips to `levelGetReady` so screen readers announce
   *     the state change explicitly.
   *
   * iOS Safari mic-permission dance: we MUST call `getUserMedia`
   * synchronously from the user-gesture handler (the click that
   * triggered `beginCountdown`). `setInterval` callbacks lose the
   * gesture token, so deferring `getUserMedia` until after the
   * countdown silently suppresses the permission prompt on iOS.
   *
   * Workaround: kick off `acquireMicStream()` right here while the
   * gesture is still alive, stash the Promise on a ref, and let
   * `startRecording` adopt the resolved stream once the countdown
   * fires. The OS prompt may appear immediately (overlapping the
   * countdown) — that's fine: once accepted, the digit keeps ticking
   * and recording starts at zero.
   */
  const beginCountdown = useCallback(() => {
    // Allowed entry points: idle (initial take) and review (retake).
    // Reject if a countdown or recording is already in flight.
    if (phase === "countdown" || phase === "recording") return;
    if (countdownRef.current) return;

    // CRITICAL: synchronous getUserMedia call inside the gesture
    // handler. Don't await — just stash the promise. If the user
    // denies, `startRecording` will surface the snackbar and reset
    // to idle. If we're mid-countdown when that happens, that's OK:
    // the permission prompt itself paused the JS event loop until
    // the user dismissed it, so the countdown timer is paused too.
    if (!pendingStreamRef.current) {
      pendingStreamRef.current = acquireMicStream();
      // Swallow unhandledrejection — `startRecording` re-throws and
      // surfaces the snackbar with the proper i18n copy.
      pendingStreamRef.current.catch(() => {});
    }

    setPhase("countdown");
    setCountdown(3);
    countdownRef.current = setInterval(() => {
      setCountdown((n) => {
        // n is the digit currently *displayed*. After 1s, decrement.
        // When we'd tick past 1, clear the interval and start
        // recording. Use the functional setter so we don't capture
        // a stale `countdown` value.
        if (n === null) return null;
        if (n <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          // Defer `startRecording` so we don't call setState during
          // a setState callback.
          queueMicrotask(() => {
            setCountdown(null);
            void startRecording();
          });
          return n;
        }
        return n - 1;
      });
    }, 1000);
  }, [phase, startRecording]);

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
      beginCountdown();
    } else if (phase === "recording") {
      void stopRecording();
    }
    // `countdown` phase: tap is a no-op. The button is also disabled
    // visually so this branch shouldn't fire in practice.
  };

  // ---------------------------------------------------------------
  // Review actions
  // ---------------------------------------------------------------

  const onRetake = () => {
    beginCountdown();
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
        const res = await usePathRepo.getState().completeLevel(cycle, levelId, {
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
      // Build the composite-key segment via the canonical formatter
      // — never hand-concatenate. See `lib/content/cycle-level.ts`.
      const seg = formatCycleLevelParam({ cycle, levelId });
      router.replace(`/level/${seg}/complete?${params.toString()}`);
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
    // for the *current* question. Skipping never uploads.
    //
    // Semantics changed: Skip now means "I don't know this word — give
    // me a different one for the same slot". When online we ask the
    // server for a fresh question (`question_swap`), splice it into
    // the cached bundle, and stay on the same step. When offline we
    // fall back to the original "advance without credit" behaviour
    // since the swap requires the server to know which questions the
    // device has already been served. The back button (TopBar) is the
    // way to exit a level mid-flow.
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
    stopCountdown();
    // Release any mic stream that was pre-acquired for an
    // about-to-start take but never adopted by the recorder.
    const pending = pendingStreamRef.current;
    if (pending) {
      pending
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
      pendingStreamRef.current = null;
    }
    setUploading(false);

    const online =
      typeof navigator === "undefined" ? true : navigator.onLine;
    const currentQ = questions[step - 1];

    if (!online || !currentQ) {
      // Offline (or defensive: no current question to swap) — keep the
      // legacy advance-or-exit behaviour so the user is never stuck.
      fallbackSkip();
      return;
    }

    // Online: ask the server for a replacement at the same slot.
    void runSwap(currentQ.qIndex);
  };

  /**
   * Server-driven swap of the current slot's question. On success,
   * mutates the cached bundle so the live `questions[step-1]` reflects
   * the new prompt/image; the user stays on the same step. On
   * `swap_pool_exhausted` (409) or any other failure we fall back to
   * the legacy plain-skip behaviour so the user is never stuck.
   */
  const runSwap = async (slotQIndex: number) => {
    const deviceId = useDeviceIdentity.getState().ensure();
    useSnackbar.getState().show(t("levelSwappingSnack"), 1000);
    try {
      const replacement = await swapQuestion(
        deviceId,
        cycle,
        levelId,
        slotQIndex,
      );
      usePathRepo.getState().applyQuestionSwap(
        cycle,
        levelId,
        slotQIndex,
        replacement,
      );
      // Stay on the same step; reset transient phase so the new
      // image/prompt renders cleanly with the mic CTA.
      setPhase("idle");
      setElapsedSec(0);
    } catch (e) {
      const isExhausted =
        e instanceof EdgeFunctionError && e.status === 409;
      const isNetwork =
        e instanceof EdgeFunctionError && e.status === 0;
      if (isExhausted) {
        useSnackbar.getState().show(t("levelSwapPoolExhaustedSnack"), 1500);
      } else if (isNetwork) {
        // We checked navigator.onLine before calling, but the server
        // may still be unreachable (DNS, CORS, function cold-boot
        // failure). Surface the same offline message the rest of the
        // app uses for consistency.
        useSnackbar.getState().show(t("levelOfflineSubmitSnack"), 1500);
      } else {
        useSnackbar.getState().show(t("levelSwapFailedSnack"), 1500);
      }
      // Fall back to plain skip so the user keeps moving.
      fallbackSkip();
    }
  };

  /**
   * Original Skip behaviour preserved for the offline / swap-failed
   * fallback path: advance to next step (or finalise the level on the
   * last step). Does NOT touch the recorder/mic state — `onSkip` has
   * already cleaned those up before delegating here.
   */
  const fallbackSkip = () => {
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
      const res = await usePathRepo.getState().completeLevel(cycle, levelId, {
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
    const seg = formatCycleLevelParam({ cycle, levelId });
    router.replace(`/level/${seg}/complete?${params.toString()}`);
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
        <div className="flex flex-col items-center px-6 pb-6 phone-sm:px-4 phone-sm:pb-4">
          {isRecording && (
            <>
              <p className="text-[20px] font-semibold text-white phone-sm:text-[18px]">
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
              <RecordButton
                recording={isRecording}
                countdown={phase === "countdown" ? countdown : null}
                onClick={toggleRecord}
              />
              <div className="h-3" />
              <p className="text-[18px] font-semibold text-white">
                {phase === "countdown"
                  ? t("levelGetReady")
                  : isRecording
                    ? t("levelTapToStop")
                    : t("levelTapToRecord")}
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
  countdown,
  onClick,
}: {
  recording: boolean;
  /** Non-null while the 3-2-1 countdown is active. The digit is
   *  rendered inside the button and the click is disabled. */
  countdown: number | null;
  onClick: () => void;
}) {
  const counting = countdown !== null;
  // Idle green #66BB6A → active red #E53935 (matches Flutter tokens).
  // During countdown we keep the green hue but dim the glow to hint
  // the button is non-interactive.
  const color = recording ? "#E53935" : "#66BB6A";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={counting}
      aria-label={
        counting
          ? `Recording starts in ${countdown}`
          : recording
            ? "Stop recording"
            : "Start recording"
      }
      aria-live={counting ? "polite" : undefined}
      className="relative flex h-[100px] w-[100px] items-center justify-center rounded-full phone-sm:h-[88px] phone-sm:w-[88px]"
      style={{
        backgroundColor: color,
        boxShadow: counting
          ? `0 0 12px 1px ${color}55`
          : `0 0 18px 2px ${color}80`,
        opacity: counting ? 0.85 : 1,
      }}
    >
      {counting ? (
        <span
          // Pop the digit each tick — key on the value so the CSS
          // animation restarts on every change.
          key={countdown}
          className="text-[56px] font-bold leading-none text-white phone-sm:text-[48px]"
          style={{ animation: "afk-count-pop 0.5s ease-out" }}
        >
          {countdown}
        </span>
      ) : recording ? (
        <WaveformIcon />
      ) : (
        <MicIcon />
      )}
      <style>{`
        @keyframes afk-count-pop {
          0% { transform: scale(0.6); opacity: 0; }
          40% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
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
