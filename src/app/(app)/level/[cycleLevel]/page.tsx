"use client";

/**
 * Level screen the recording lesson (flat redesign).
 *
 * Sequences the level's questions one at a time. Each question has
 * four phases:
 *   1. idle      → green mic CTA (Tap to record)
 *   2. recording → red mic CTA (Tap to stop) + running timer
 *   3. review    → Retake / Listen / Submit row
 *   4. feedback  → green "Nice job!" sheet with CONTINUE (the
 *                  Duolingo correct-answer moment) after a
 *                  successful upload. CONTINUE advances to the next
 *                  question or finalises the level.
 *
 * On Submit:
 *   - Upload the WAV via Sayari (`uploadAudio`).
 *   - If consent has been revoked since onboarding, refuse with a
 *     snackbar (defence-in-depth: the consent gate already enforces
 *     this, but a user can revoke from Profile mid-level).
 *   - Show the feedback sheet; CONTINUE advances, or on the last
 *     question calls `usePathRepo.completeLevel(cycle, levelId)` and
 *     `router.replace`s to `/level/${cycle}-${levelId}/complete`.
 *
 * Chrome: white background, quit-X + green progress bar + Skip in the
 * top bar, flat white image card, big 3D mic button pinned above the
 * safe area. This route lives outside the `(tabs)` group no
 * bottom-nav, full-bleed.
 *
 * Audio invariants (unchanged by the redesign):
 *   - iOS Safari requires `getUserMedia` to be called from a
 *     synchronously-reachable code path of the gesture handler; we
 *     pre-acquire the stream in `beginRecording` and let the recorder
 *     adopt it. See `acquireMicStream()` doc.
 *   - Submit is a hard, online-only, at-most-once operation.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FeedbackSheet } from "@/components/ui/feedback-sheet";
import { IconButton } from "@/components/ui/icon-button";
import { MicIcon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress-bar";
import { uploadAudio, AudioUploadError } from "@/lib/api/audio";
import { EdgeFunctionError } from "@/lib/api/edge";
import { track } from "@/lib/api/events";
import { swapQuestion } from "@/lib/api/questions";
import { buildRecordingFilename } from "@/lib/audio/filename";
import { RecorderError, WavRecorder, acquireMicStream, prewarmAudioWorklet } from "@/lib/audio/recorder";
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

type Phase = "idle" | "recording" | "review" | "feedback";

export default function LevelPage({
  params,
}: {
  // Next 16: dynamic route params resolve as a Promise; unwrap with
  // `use()`. See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
  //
  // The `cycleLevel` segment is a composite `${cycle}-${levelId}` key
  // (e.g. `2-3`); see `lib/content/cycle-level.ts`. We tolerate the
  // legacy bare-integer form (`/level/3`) by falling back to cycle 1
  // that keeps any pre-multi-cycle deep-links and shared bookmarks
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
  // the memoization early returns with constructor-literal objects
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
      // Unparsable param not even worth a snackbar with a level id.
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
  const [uploading, setUploading] = useState(false);
  // True while the last-step CONTINUE is persisting the completion.
  const [finalizing, setFinalizing] = useState(false);
  // Holds the most recent recording blob for the current question.
  // Cleared whenever we leave review (advance, retake, skip).
  const [recording, setRecording] = useState<Blob | null>(null);

  const recorderRef = useRef<WavRecorder | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mic stream pre-acquired synchronously during the user-gesture
  // click handler. iOS Safari requires `getUserMedia` to be called
  // from a synchronously-reachable code path of the gesture handler;
  // any awaits before the call lose the gesture token and the OS
  // prompt is silently suppressed. So we grab the stream right away
  // in `toggleRecord` and hold it for the worklet to adopt inside
  // `startRecording`. See `acquireMicStream()` doc.
  const pendingStreamRef = useRef<Promise<MediaStream> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackUrlRef = useRef<string | null>(null);
  // Reentrancy guard for the start/stop pair (matches `_busy` in Dart).
  const busyRef = useRef(false);
  // Interaction-epoch counter. Bumped whenever a user action
  // invalidates any in-flight async continuation (new take begins,
  // skip fires, screen unmounts). Async work (`startRecording`,
  // `runSwap`, `onSubmit`) captures the value up front and re-checks
  // it after each await a mismatch means "the world moved on,
  // abandon your UI mutations". Closes the orphaned-mic and
  // stale-phase-clobber races around slow getUserMedia / uploads /
  // question swaps.
  const takeGenRef = useRef(0);
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
  // Analytics: one `level_start` per screen visit (StrictMode double
  // effects + swap-induced re-renders must not re-fire it).
  const levelStartTrackedRef = useRef(false);
  useEffect(() => {
    if (!level || levelStartTrackedRef.current) return;
    levelStartTrackedRef.current = true;
    track("level_start", { cycle, level_id: levelId });
  }, [level, cycle, levelId]);

  const question = questions[step - 1];
  const isRecording = phase === "recording";
  const isReview = phase === "review";
  const isFeedback = phase === "feedback";

  // Cleanup: stop the recorder + ticker + revoke any blob URLs when
  // the screen is torn down (back-button or replace).
  useEffect(() => {
    // Warm the AudioWorklet HTTP cache so the first mic tap doesn't
    // wait on a 200–500 ms network round-trip. Safe to call on every
    // mount the helper dedupes via a marker <link> in <head>.
    prewarmAudioWorklet();
    const takeGen = takeGenRef;
    return () => {
      // Invalidate every in-flight continuation before tearing down.
      takeGen.current += 1;
      if (tickerRef.current) clearInterval(tickerRef.current);
      const rec = recorderRef.current;
      if (rec) void rec.dispose();
      // If the user backed out before the recorder adopted the
      // pre-acquired mic stream, release it so the OS indicator
      // goes away.
      const pending = pendingStreamRef.current;
      if (pending) {
        pending
          .then((s) => s.getTracks().forEach((t) => t.stop()))
          .catch(() => {});
        pendingStreamRef.current = null;
      }
      // Stop any in-flight playback backing out mid-Listen must not
      // leave the take audible over the next screen.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
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

  const startRecording = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    // Capture the epoch this take belongs to. `beginRecording` bumped
    // it synchronously in the same gesture tick; any skip/unmount
    // after this point bumps it again, telling us to bail.
    const gen = takeGenRef.current;
    try {
      // Stop any in-flight playback before starting a new take.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      // Drop the previous take (if any) fresh slate for the new
      // recording. The blob URL was created lazily in `onListen`, so
      // revoke it if it exists.
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
        playbackUrlRef.current = null;
      }
      setRecording(null);

      // Adopt the mic stream that the click handler pre-acquired
      // during the user gesture. If for some reason it's missing
      // (defensive: programmatic call), fall back to the recorder's
      // internal `getUserMedia`. That fallback path won't work on
      // iOS Safari but is safe on Chrome / Firefox / Android.
      const pending = pendingStreamRef.current;
      pendingStreamRef.current = null;
      const stream = pending ? await pending : undefined;

      // Defensive: never leak a previous recorder instance if a
      // desync left one behind, dispose it before overwriting.
      const stale = recorderRef.current;
      if (stale) void stale.dispose();

      const rec = new WavRecorder();
      recorderRef.current = rec;
      await rec.start(stream);

      // A skip / unmount landed while we were awaiting the epoch
      // moved on. Tear the fresh recorder straight down instead of
      // resurrecting recording UI over the new state.
      if (takeGenRef.current !== gen) {
        recorderRef.current = null;
        void rec.dispose();
        return;
      }

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
   * Begin a fresh recording attempt. MUST run synchronously inside a
   * user-gesture event handler (the mic-button click or retake click)
   * so that `acquireMicStream()` retains its iOS Safari gesture token.
   *
   * iOS Safari mic-permission dance: `getUserMedia` MUST be called
   * synchronously from the user-gesture handler. Any prior `await`
   * loses the gesture token and the OS prompt is silently suppressed.
   * We therefore stash the Promise on a ref while still in the gesture
   * tick, then `startRecording` adopts the resolved stream.
   *
   * Idempotent: a second call while already recording is a no-op.
   */
  const beginRecording = useCallback(() => {
    if (phase === "recording") return;
    // Synchronous reentrancy guard: a double-tap must not acquire a
    // second mic stream while the first `startRecording` is between
    // awaits (the orphaned stream would keep the OS indicator hot
    // with no owner to stop it).
    if (busyRef.current) return;

    // New interaction epoch: invalidates any stale async continuation
    // (e.g. a slow question-swap resolving later must not clobber the
    // phase of this fresh take).
    takeGenRef.current += 1;

    // CRITICAL: synchronous getUserMedia call inside the gesture
    // handler. Don't await just stash the promise. If the user
    // denies, `startRecording` will surface the snackbar and reset
    // to idle.
    if (!pendingStreamRef.current) {
      pendingStreamRef.current = acquireMicStream();
      // Swallow unhandledrejection `startRecording` re-throws and
      // surfaces the snackbar with the proper i18n copy.
      pendingStreamRef.current.catch(() => {});
    }

    void startRecording();
  }, [phase, startRecording]);

  const stopRecording = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const rec = recorderRef.current;
      if (!rec) {
        setPhase("idle");
        stopTimer();
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
      beginRecording();
    } else if (phase === "recording") {
      void stopRecording();
    }
  };

  // ---------------------------------------------------------------
  // Review actions
  // ---------------------------------------------------------------

  const onRetake = () => {
    beginRecording();
  };

  const onListen = () => {
    if (!recording) return;
    if (!audioRef.current) audioRef.current = new Audio();
    // Build (or rebuild) a fresh blob: URL. The previous one if
    // any is revoked first so we don't leak object URLs across
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

    setUploading(true);
    // Epoch guard: if a back/unmount lands while the POST is in
    // flight, the continuation below must not mutate a screen that
    // has already moved on.
    const gen = takeGenRef.current;

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

    // Upload OK clear the local blob + URL.
    if (playbackUrlRef.current) {
      URL.revokeObjectURL(playbackUrlRef.current);
      playbackUrlRef.current = null;
    }
    setRecording(null);

    // Stale epoch: the user exited (back → partial persistence, or
    // unmount) while the upload round-tripped. The file is stored
    // server-side, but this screen's flow already concluded don't
    // re-animate it with a feedback sheet or count the slot into a
    // completion that was already dispatched.
    if (takeGenRef.current !== gen) {
      setUploading(false);
      return;
    }

    // Count this successful submission. Used by the feedback CONTINUE
    // (and by `onSkip` / the back button) to decide whether the level
    // should be persisted as a full or partial completion.
    submittedCountRef.current += 1;
    track("recording_submitted", {
      cycle,
      level_id: levelId,
      q_index: question.qIndex,
    });

    // The Duolingo moment: celebrate the submission and let the user
    // consciously CONTINUE (instead of silently jumping to the next
    // image). The continue handler advances or finalises.
    setUploading(false);
    setPhase("feedback");
    stopTimer();
  };

  /**
   * Feedback-sheet CONTINUE. Advances to the next question, or on
   * the last one persists the completion and routes to the
   * celebration screen.
   */
  const onFeedbackContinue = () => {
    if (step >= totalSteps) {
      if (finalizing) return;
      setFinalizing(true);
      void finalizeFullRun();
      return;
    }
    setStep((s) => s + 1);
    setPhase("idle");
    setElapsedSec(0);
  };

  /**
   * Persist the end-of-level completion (full sweep or partial) and
   * route to the celebration screen. Only called from the last-step
   * feedback CONTINUE (or the back button while that feedback is up).
   */
  const finalizeFullRun = async () => {
    if (completionDispatchedRef.current) return;
    completionDispatchedRef.current = true;

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
    // to the celebration screen the next boot will reconcile
    // from the backend (Flutter has the same optimistic policy).
    // We capture `cycleComplete` from the repo's return value: when
    // true, the user just finished the last level of the current
    // cycle and the celebration screen should render the
    // cycle-complete variant (with the "Start next cycle" CTA)
    // rather than the per-level one.
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
    track("level_complete", {
      cycle,
      level_id: levelId,
      partial: isPartial,
      points: awardedPoints,
      submitted,
      total: totalSteps,
      cycle_complete: cycleComplete,
    });
    const params = new URLSearchParams({
      points: String(awardedPoints),
      total: String(totalSteps),
      submitted: String(submitted),
    });
    if (isPartial) params.set("partial", "1");
    if (cycleComplete) params.set("cycleComplete", "1");
    // Build the composite-key segment via the canonical formatter
    // never hand-concatenate. See `lib/content/cycle-level.ts`.
    const seg = formatCycleLevelParam({ cycle, levelId });
    router.replace(`/level/${seg}/complete?${params.toString()}`);
  };

  const onSkip = () => {
    // Cancel any in-flight recording / playback and clear local state
    // for the *current* question. Skipping never uploads.
    //
    // Semantics changed: Skip now means "I don't know this word give
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
    // Reset the visible phase *synchronously* leaving the review UI
    // live while the swap round-trips lets a Retake race the swap and
    // orphan a hot recorder. New epoch: any in-flight start/upload
    // continuation must abandon its UI mutations.
    takeGenRef.current += 1;
    const skipGen = takeGenRef.current;
    setPhase("idle");
    setElapsedSec(0);

    const online =
      typeof navigator === "undefined" ? true : navigator.onLine;
    const currentQ = questions[step - 1];

    track("skip_used", {
      cycle,
      level_id: levelId,
      // "swap" = server-side question replacement attempt; "plain" =
      // legacy advance-without-credit (offline or no question).
      mode: online && currentQ ? "swap" : "plain",
    });

    if (!online || !currentQ) {
      // Offline (or defensive: no current question to swap) keep the
      // legacy advance-or-exit behaviour so the user is never stuck.
      fallbackSkip();
      return;
    }

    // Online: ask the server for a replacement at the same slot.
    void runSwap(currentQ.qIndex, skipGen);
  };

  /**
   * Server-driven swap of the current slot's question. On success,
   * mutates the cached bundle so the live `questions[step-1]` reflects
   * the new prompt/image; the user stays on the same step. On
   * `swap_pool_exhausted` (409) or any other failure we fall back to
   * the legacy plain-skip behaviour so the user is never stuck.
   *
   * `gen` is the interaction epoch captured when the skip fired: if
   * the user started a fresh take while the swap round-tripped, the
   * epoch moved on and we must not clobber their phase.
   */
  const runSwap = async (slotQIndex: number, gen: number) => {
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
      // Reset transient phase so the new image/prompt renders cleanly
      // with the mic CTA but only if no fresh interaction started
      // in the meantime.
      if (takeGenRef.current === gen) {
        setPhase("idle");
        setElapsedSec(0);
      }
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
   * last step). Does NOT touch the recorder/mic state `onSkip` has
   * already cleaned those up before delegating here.
   */
  const fallbackSkip = () => {
    const isLast = step >= totalSteps;
    if (isLast) {
      // End of the level reached via skip. If the user managed to
      // submit at least one recording, the level still counts as a
      // partial completion (half points). Otherwise nothing is
      // persisted they just leave the level untouched.
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
    track("level_complete", {
      cycle,
      level_id: levelId,
      partial: true,
      points: awardedPoints,
      submitted,
      total: totalSteps,
      cycle_complete: cycleComplete,
    });
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
   * TopBar quit button. During the last-step feedback the run is a
   * *full* completion the user just hasn't tapped CONTINUE yet 
   * so exiting must not demote it to a partial (half points). Any
   * other time: ≥1 submission → partial completion; none → just leave.
   */
  const onBack = () => {
    if (isFeedback && step >= totalSteps) {
      if (!finalizing) {
        setFinalizing(true);
        void finalizeFullRun();
      }
      return;
    }
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
    // Hydration race / deep link show the bare canvas while the
    // effect above bounces us home.
    return <div className="min-h-dvh w-full" />;
  }

  const langDisplay = useLearningLanguage.getState().displayNameOrDefault();

  return (
    <div className="flex min-h-dvh w-full flex-col pb-safe pt-[env(safe-area-inset-top)]">
      <TopBar
        totalSteps={totalSteps}
        // Progress = achievement, not position: the bar fills the
        // moment a recording is accepted (feedback phase), not on
        // arrival at a question. Turns every fill into a micro-reward
        // and means a fresh level honestly starts at 0.
        progressValue={isFeedback ? step : step - 1}
        onBack={onBack}
        quitLabel={t("levelQuitLabel")}
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

      {/* Footer: timer + record CTA, OR the review row. Reserved
          height collapses under the feedback sheet. */}
      <div className="flex flex-col items-center px-6 pb-6 phone-sm:px-4 phone-sm:pb-4">
        {isRecording && (
          <>
            <p className="text-[22px] font-extrabold text-red phone-sm:text-[19px]">
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
        ) : isFeedback ? null : (
          <>
            <RecordButton
              recording={isRecording}
              onClick={toggleRecord}
            />
            <div className="h-3" />
            <p className="text-[16px] font-bold text-text-muted phone-sm:text-[14px]">
              {isRecording ? t("levelTapToStop") : t("levelTapToRecord")}
            </p>
          </>
        )}

        {/* Skip lives down here in the thumb zone (it used to sit
            top-right in the header): it's a per-question, repeat
            action, and our users hold the phone one-handed. Same
            visibility contract as before: available while idle,
            recording and reviewing; hidden while the feedback sheet
            owns the flow and while an upload is in flight (skipping
            mid-upload would fork the flow and corrupt the
            submitted-count accounting). */}
        {!isFeedback && !uploading && (
          <>
            <div className="h-1" />
            <button
              type="button"
              onClick={onSkip}
              className="min-h-11 px-6 py-2 text-[14px] font-extrabold uppercase tracking-[0.8px] text-text-faint transition-opacity active:opacity-60 phone-sm:text-[13px]"
            >
              {t("commonSkip")}
            </button>
          </>
        )}
      </div>

      {/* Post-submit celebration sheet. CONTINUE advances (or
          finalises the level on the last step). */}
      {isFeedback && (
        <FeedbackSheet
          title={t("levelFeedbackTitle")}
          ctaLabel={
            finalizing ? t("cycleAdvancePending") : t("commonContinue")
          }
          onContinue={onFeedbackContinue}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar: quit, progress
// ---------------------------------------------------------------------------

function TopBar({
  totalSteps,
  progressValue,
  onBack,
  quitLabel,
}: {
  totalSteps: number;
  /** Completed-question count (fills on success, not on arrival). */
  progressValue: number;
  onBack: () => void;
  quitLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <IconButton icon={X} label={quitLabel} size={44} onClick={onBack} />
      {/* Right inset mirrors the quit button's visual weight so the
          bar reads centered. (Skip used to live here it moved to
          the bottom footer, into the one-handed thumb zone.) */}
      <div className="min-w-0 flex-1 px-1 pr-3">
        <ProgressBar value={progressValue} max={totalSteps} />
      </div>
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
  // Question images arrive from Supabase Storage over the network 
  // fade them in over a pulsing placeholder instead of popping. The
  // component is re-keyed per step, so the flag resets naturally.
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div className="flex flex-col items-center px-6 phone-sm:px-4">
      <h1 className="whitespace-pre-line text-center text-[26px] font-extrabold leading-tight text-text phone-sm:text-[21px]">
        {titleTemplate}
      </h1>
      <div className="h-3" />
      {/* The term to say a neutral chip, not link-blue text (it
          isn't tappable; blue would promise interaction). */}
      <p className="text-center">
        <span className="inline-block rounded-xl border-2 border-border bg-bg-subtle px-3.5 py-1.5 text-[17px] font-extrabold text-text phone-sm:px-3 phone-sm:text-[15px]">
          {promptEn}
        </span>
      </p>
      <div className="h-4" />
      {/* Flat white picture card. `aspect-square` keeps it 1:1
          regardless of the underlying image; `object-cover` clips.
          Width-capped on narrow phones: the footer grew by ~48px
          when Skip moved into the thumb zone, so the square card
          gives some height back to keep more of the image above
          the fold at 320px. */}
      <div className="relative aspect-square w-full max-w-md rounded-2xl border-2 border-border bg-bg p-2 phone-sm:max-w-[260px]">
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-bg-subtle">
          {/* Skeleton shimmer until the network image lands. */}
          {!imageLoaded && (
            <span
              aria-hidden
              className="absolute inset-0 bg-border/60 motion-safe:animate-pulse"
            />
          )}
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
            className={`object-cover transition-opacity duration-300 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setImageLoaded(true)}
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

/** Hard bottom edge height of the big round action buttons, px. */
const ROUND_EDGE = 7;

function RecordButton({
  recording,
  onClick,
}: {
  recording: boolean;
  onClick: () => void;
}) {
  const t = useTranslations();
  // Idle green → active red (the affordance tokens), rendered as a
  // flat 3D circle: fixed dark edge + face that depresses on press.
  const fill = recording ? "var(--color-red)" : "var(--color-primary)";
  const edge = recording
    ? "var(--color-red-deep)"
    : "var(--color-primary-deep)";
  return (
    <button
      type="button"
      onClick={onClick}
      // Localized: mirror the visible caption so screen readers hear
      // the same instruction sighted users see.
      aria-label={recording ? t("levelTapToStop") : t("levelTapToRecord")}
      className="group relative block h-[104px] w-[96px] phone-sm:h-[90px] phone-sm:w-[82px]"
      style={{
        // Kill the iOS Safari 300ms tap delay AND prevent the touch
        // landing on the inner <svg>/<span> children from being
        // re-routed away from the button. Without this, on iPhone +
        // some Android browsers the second tap (the one meant to stop
        // recording) can be swallowed by the WaveformIcon's animated
        // child elements.
        touchAction: "manipulation",
      }}
    >
      {/* Fixed bottom edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 rounded-full"
        style={{ top: ROUND_EDGE, background: edge }}
      />
      {/* Face circle depresses onto the edge while pressed. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center rounded-full transition-transform duration-100 group-active:translate-y-[5px]"
        style={{ bottom: ROUND_EDGE, background: fill }}
      >
        {/* `pointer-events: none` on the icon ensures every tap on the
            circle hits the <button>, never an animated child. */}
        {recording ? (
          <WaveformIcon />
        ) : (
          <MicIcon className="h-12 w-12 phone-sm:h-10 phone-sm:w-10" />
        )}
      </span>
    </button>
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
        fill="var(--color-red)"
        edge="var(--color-red-deep)"
        label={labels.retake}
        onClick={onRetake}
        disabled={submitting}
        icon={
          <svg viewBox="0 0 24 24" width="32" height="32" fill="white" aria-hidden>
            <path d="M17.65 6.35A8 8 0 1019.46 15h-2.1a6 6 0 11-1.4-6.24L13 12h7V5l-2.35 1.35z" />
          </svg>
        }
      />
      <ActionButton
        // Listen wears the brand-orange accent Submit owns primary
        // blue, and two adjacent same-colored actions would read as
        // one. `--color-listen` aliases the orange ramp.
        fill="var(--color-listen)"
        edge="var(--color-orange-deep)"
        label={labels.listen}
        onClick={onListen}
        disabled={submitting}
        icon={
          <svg viewBox="0 0 24 24" width="32" height="32" fill="white" aria-hidden>
            <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 8.05v7.9a4.5 4.5 0 002.5-3.95zM14 3.23v2.06a7 7 0 010 13.42v2.06a9 9 0 000-17.54z" />
          </svg>
        }
      />
      <ActionButton
        fill="var(--color-primary)"
        edge="var(--color-primary-deep)"
        label={submitting ? labels.submitUploading : labels.submit}
        onClick={onSubmit}
        disabled={submitting}
        busy={submitting}
        icon={
          <svg viewBox="0 0 24 24" width="32" height="32" fill="white" aria-hidden>
            <path d="M1 21h4V9H1v12zm22-11a2 2 0 00-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 00-.44-1.06L14.17 1 7.59 7.59A2 2 0 007 9v10a2 2 0 002 2h9a2 2 0 001.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
          </svg>
        }
      />
    </div>
  );
}

function ActionButton({
  fill,
  edge,
  icon,
  label,
  onClick,
  disabled,
  busy = false,
}: {
  /** Face color (CSS value). */
  fill: string;
  /** Bottom-edge color (CSS value). */
  edge: string;
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
        aria-label={label}
        className="group relative block h-[78px] w-[72px] shrink-0 transition-opacity disabled:cursor-not-allowed phone-sm:h-[68px] phone-sm:w-[62px]"
        style={{
          opacity: disabled && !busy ? 0.5 : 1,
          touchAction: "manipulation",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 rounded-full"
          style={{ top: ROUND_EDGE - 1, background: edge }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center rounded-full transition-transform duration-100 group-active:translate-y-[4px]"
          style={{ bottom: ROUND_EDGE - 1, background: fill }}
        >
          {busy ? <ActionSpinner /> : icon}
        </span>
      </button>
      <div className="h-2" />
      <span className="line-clamp-2 text-center text-[14px] font-bold text-text-muted phone-sm:text-[12px]">
        {label}
      </span>
    </div>
  );
}

function ActionSpinner() {
  // Decorative: the owning button's aria-label already announces the
  // uploading state (localized) don't double-speak in English.
  return (
    <span
      aria-hidden
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
