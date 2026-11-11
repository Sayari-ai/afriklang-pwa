"use client";

/**
 * The recording studio: the missions of a campaign, recorded one after the other.
 *
 *   idle ─tap─► countdown ─► lead (silent) ─► speaking ─stop─► tail (silent) ─► analyzing
 *                                                                         ├─► problem (length) ─► idle
 *                                                                         └─► review ─submit─► next mission
 *                                                       (with advice: no sound, clipped, quiet, noisy, short pause, long pauses)
 *
 * The studio adds the silence the campaign asks for around the voice by itself (it records a
 * moment before saying "Speak now" and keeps recording a moment after Stop), shows a live level
 * ring, and checks each take: a wrong length must be recorded again, anything else is advice.
 * Submitting saves the take on the phone (the outbox sends it in the background) and moves
 * straight to the next mission.
 */

import { Check, ChevronRight, CloudOff, RotateCcw, SkipForward, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { checkTake, sha256Hex, type FullAnalysis, type TakeProblem } from "@/lib/audio/analyze";
import { RecorderError, WavRecorder, acquireMicStream, prewarmAudioWorklet } from "@/lib/audio/recorder";
import { MIC_START_HINT_MS, MIC_START_TIMEOUT_MS, micHelpFor, type MicHelp } from "@/lib/audio/mic-help";
import { buildAudioMetadata, parseDevice, varietyFor } from "@/lib/campaign/audio-metadata";
import { clearDraft, loadDraft, saveDraft } from "@/lib/campaign/drafts";
import { LOW_SPACE_BYTES, freeSpaceBytes } from "@/lib/campaign/storage-safety";
import { enqueueTake, outbox, useOutbox } from "@/lib/campaign/outbox-client";
import { missionsInOutbox, type OutboxItem } from "@/lib/campaign/outbox-logic";
import { buildCampaignFilename } from "@/lib/campaign/recording-name";
import { buildMetadata, buildSayariCampaignFields, deviceLabel, draftProblem, formatClock, isTimed, takeRules } from "@/lib/campaign/record-flow";
import { QUIET_HINT_AFTER_S, TEXT_SIZES, autoStopAtS, canRecordNow, focusQueue, nextInQueue, onHideAction, onInterruptAction, paddingS, queueProgress, sessionGoal, sessionQueue, skip } from "@/lib/campaign/studio-flow";
import { isRefusal } from "@/lib/campaign/pool";
import { languageInText } from "@/lib/campaign/language-name";
import type { PoolState } from "@/lib/campaign/pool-client";
import type { CampaignCard, ContributorView, Mission } from "@/lib/campaign/types";
import { toRecordCount, waitsForPartner } from "@/lib/campaign/view";
import { reportException } from "@/lib/analytics/client";
import { track, type MicErrorCode } from "@/lib/analytics/events";
import { PoolRefusal } from "../PoolParts";
import { Confetti, PromptCard, RecordButton, SessionBar, TakePlayer } from "./StudioParts";

type Phase = "idle" | "countdown" | "lead" | "speaking" | "tail" | "analyzing" | "problem" | "review" | "saving" | "goal" | "done";
type Take = {
  blob: Blob;
  analysis: FullAnalysis;
  recordedAt: Date;
  inputSampleRate: number;
  processing: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean };
  quietHintShown: boolean;
  takeNumber: number;
  /** Brought back from the phone's storage after the app closed (drafts.ts). */
  restored?: boolean;
  /** Stopped early because the app went to the background while the speaker was talking (APP2-12). */
  cutShort?: boolean;
};

const COUNTDOWN_S = 3;
const SIZE_KEY = "afriklang.studio.textSize";

type Props = {
  campaignId: string;
  card: CampaignCard;
  missions: readonly Mission[];
  userId: string;
  speakerId: string;
  contributor: ContributorView;
  /** One id: open on it. Several: a focus, the session is those recordings alone (sessionQueue). */
  startId: string | string[] | null;
  /** Pool campaigns: the batch's draws (the studio asks for more when it is recorded). Null when planned. */
  pool?: PoolState | null;
};

export function Studio({ campaignId, card, missions, userId, speakerId, contributor, startId, pool = null }: Props) {
  // Only a variety of this campaign's language labels its audio (APP-015).
  const dialect = varietyFor(card, contributor);
  const locale = useLocale();
  // One id per studio visit: groups the takes of a sitting in the dataset.
  const [sessionId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now().toString(36)}`));
  const quietShownRef = useRef(false);
  const takesRef = useRef(new Map<string, number>());
  const t = useTranslations("campaign.studio");
  const tp = useTranslations("campaign.common.pool");
  const tc = useTranslations("campaign.common");
  const hubHref = `/campaign/${campaignId}`;
  const box = useOutbox();
  const onPhone = useMemo(() => missionsInOutbox(box.items.filter((i) => i.userId === userId)), [box.items, userId]);
  const onPhoneRef = useRef(onPhone);
  const byId = useMemo(() => new Map(missions.map((m) => [m.mission_id, m])), [missions]);
  const byIdRef = useRef(byId);
  const cardRef = useRef(card);

  // The session's order is fixed when the studio opens (later answers only remove missions from it).
  const [queue, setQueue] = useState<string[]>(() => sessionQueue(missions, onPhone, startId));
  // A link naming several recordings (`?m=a,b`) restricts the session to them. When none of them
  // is left to record, the session is the usual full one, and the speaker is told (focusDone).
  const focus = Array.isArray(startId) ? startId : null;
  const [focusActive] = useState(() => focus != null && queue.length > 0 && queue.every((id) => focus.includes(id)));
  const focusDone = focus != null && !focusActive;
  const [currentId, setCurrentId] = useState<string | null>(() => queue[0] ?? null);
  const [phase, setPhase] = useState<Phase>(() => (queue.length ? "idle" : "done"));
  const [count, setCount] = useState(COUNTDOWN_S);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [problem, setProblem] = useState<TakeProblem | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  // Where to allow the microphone, shown under a "blocked" or "did not start" message.
  const [micHelp, setMicHelp] = useState<MicHelp | null>(null);
  // The countdown is over but the microphone has not started yet: say to answer the browser.
  const [slowStart, setSlowStart] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [flash, setFlash] = useState<"online" | "offline" | "lastOne" | null>(null);
  const [size, setSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem(SIZE_KEY));
      return Number.isInteger(n) && n >= 0 && n < TEXT_SIZES.length ? n : 1;
    } catch {
      return 1;
    }
  });

  // Analytics: what the studio opened with, once per visit.
  const campaignKind = card.kind ?? "collection";
  useEffect(() => {
    track("studio_opened", { campaign_kind: card.kind ?? "collection", language: card.language.code, to_record: queue.length, focused: Array.isArray(startId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Missions that became recordable during the session (sent back by the team, or drawn for a pool
  // campaign) join the end of the queue. A pool session that had run out picks up the new batch.
  // A focused session takes only missions of its focus: never the whole campaign.
  const isPoolSession = pool != null;
  useEffect(() => {
    const fresh = (focusActive && focus ? focusQueue(missions, onPhoneRef.current, focus) : sessionQueue(missions, onPhoneRef.current, null)).filter((id) => !queue.includes(id));
    if (!fresh.length) return;
    setQueue((q) => [...q, ...fresh.filter((id) => !q.includes(id))]);
    if (isPoolSession && phase === "done") {
      setCurrentId(fresh[0]);
      setPhase("idle");
    }
  }, [missions, queue, isPoolSession, phase, focusActive, focus]);

  // The mission on screen keeps its last known copy: in a pool campaign it can leave the list while
  // it is being recorded (its lease ended, or a refresh came in), and the take must still go through.
  const [held, setHeld] = useState<Mission | null>(null);
  const found = currentId ? byId.get(currentId) ?? null : null;
  if (found && found !== held) setHeld(found);
  const mission = found ?? (held && held.mission_id === currentId ? held : null);
  const rules = mission ? takeRules(card, mission) : null;
  const pad = paddingS(card);
  // A focus is the whole session: its bar counts the focus, and the campaign's session goal
  // (and its celebration) does not apply.
  const goal = focusActive ? null : sessionGoal(card);
  const timed = mission ? isTimed(mission.type) : false;
  const minS = mission ? (mission.duration_s.min ?? rules?.durationMinS ?? 0) : 0;
  // Shown for every type: a read sentence has a maximum too, and the speaker must see it (N-10).
  const maxS = mission ? (mission.duration_s.max ?? rules?.durationMaxS ?? null) : null;
  // Every take stops by itself, read ones included (APP-005: a forgotten recording must not grow until the phone runs out of memory).
  const stopAtS = mission && rules ? autoStopAtS(timed, mission.duration_s.max ?? rules.durationMaxS, pad) : autoStopAtS(false, 0, pad);

  const recorderRef = useRef<WavRecorder | null>(null);
  const currentIdRef = useRef<string | null>(currentId);
  const streamRef = useRef<Promise<MediaStream> | null>(null);
  const attemptRef = useRef(0);
  const levelRef = useRef(-100);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = useRef(false);
  const phaseRef = useRef<Phase>(phase);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const teardown = useCallback(() => {
    attemptRef.current++;
    clearTimers();
    void recorderRef.current?.dispose();
    recorderRef.current = null;
    const p = streamRef.current;
    streamRef.current = null;
    p?.then((s) => s.getTracks().forEach((x) => x.stop())).catch(() => {});
  }, []);
  const teardownRef = useRef(teardown);
  /** A take being finished (stopped and measured): a second Stop, a hide or an interruption must not touch it. */
  const finishingRef = useRef(false);
  const finishRef = useRef<(opts?: { cutShort?: boolean }) => Promise<void>>(async () => {});

  useEffect(() => {
    prewarmAudioWorklet();
    return teardown;
  }, [teardown]);

  // A take cut by a call, a lost microphone or the app going to the background is dropped, with a
  // clear message, instead of being kept with a gap (APP-032).
  const interrupt = () => {
    if (!recorderRef.current || finishingRef.current) return;
    // Only the silence after Stop was left: the voice is complete, keep the take (APP2-12).
    if (onInterruptAction(phaseRef.current) === "finish") return void finishRef.current();
    teardown();
    setElapsed(0);
    setQuiet(false);
    setMicError(t("mic.interrupted"));
    setPhase("idle");
    vibrate([40, 60, 40]);
  };
  const interruptRef = useRef(interrupt);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      // A notification tapped, the screen turned off, another app: finish the take rather than
      // lose it, and never let a countdown start the recording in the background (APP2-12).
      const action = onHideAction(phaseRef.current);
      if (action === "cancel") {
        teardownRef.current();
        setPhase("idle");
      } else if (action === "drop") interruptRef.current();
      else if (action === "finish" || action === "finishCut") void finishRef.current({ cutShort: action === "finishCut" });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Keep the screen on while the studio is open.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      void lock?.release().catch(() => {});
    };
  }, []);

  // A take recorded before the app closed (crash, call, closed tab) comes back on the review screen.
  useEffect(() => {
    let cancelled = false;
    void loadDraft(userId, campaignId).then((d) => {
      if (cancelled || !d) return;
      const m = byIdRef.current.get(d.missionId);
      if (!m || !canRecordNow(m, onPhoneRef.current)) return void clearDraft(userId, campaignId);
      if (phaseRef.current !== "idle" && phaseRef.current !== "done") return;
      takesRef.current.set(d.missionId, d.takeNumber);
      setQueue((q) => (q.includes(d.missionId) ? q : [d.missionId, ...q]));
      setCurrentId(d.missionId);
      // The length check runs again (draftProblem): a take saved just before the check, by a crash
      // in between, must not come back as a checked take. The usual notice says why, as at Stop.
      const p = draftProblem(d.analysis, cardRef.current, m);
      if (p) {
        void clearDraft(userId, campaignId);
        setTake(null);
        setProblem(p);
        setPhase("problem");
        return;
      }
      setProblem(null);
      setTake({ blob: d.blob, analysis: d.analysis, recordedAt: new Date(d.recordedAt), inputSampleRate: d.inputSampleRate, processing: d.processing, quietHintShown: d.quietHintShown, takeNumber: d.takeNumber, restored: true });
      setPhase("review");
    });
    return () => {
      cancelled = true;
    };
  }, [userId, campaignId]);

  // The address shows the current mission, so a reload comes back to it. A focused session keeps
  // its other ids after it, so a reload keeps the restriction (ids are UUIDs: nothing to encode,
  // and the link's commas stay commas, as the email writes them).
  useEffect(() => {
    if (!currentId) return;
    const url = `/campaign/${campaignId}/studio?m=${focusActive ? [currentId, ...queue.filter((id) => id !== currentId)].join(",") : encodeURIComponent(currentId)}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [campaignId, currentId, focusActive, queue]);

  // An unsent take or a running recording asks before the tab closes.
  const unsaved = take !== null || phase === "lead" || phase === "speaking" || phase === "tail";
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsaved]);

  // Live level, copied from the recorder on each frame while it runs.
  const recording = phase === "lead" || phase === "speaking" || phase === "tail";
  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    const loop = () => {
      levelRef.current = recorderRef.current?.levelDbfs ?? -100;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  const vibrate = (ms: number | number[]) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      // not supported
    }
  };

  const showMicError = useCallback(
    (e: unknown) => {
      const code = e instanceof RecorderError ? e.code : "internal";
      const help = micHelpFor(typeof navigator === "undefined" ? "" : navigator.userAgent);
      reportMicError(help === "inApp" && code !== "no-mic" ? "inApp" : code, help === "inApp", e);
      // Inside WhatsApp, Facebook and the like, the answer is the same whatever failed: open the
      // page in the phone's browser.
      setMicError(help === "inApp" && code !== "no-mic" ? t("mic.inApp") : t(`mic.${code}`));
      setMicHelp(code === "permission-denied" && help !== "inApp" ? help : null);
    },
    [t],
  );

  // ── Stop: keep recording `pad` seconds of silence, then analyse ─────────

  const finish = useCallback(async (opts: { cutShort?: boolean } = {}) => {
    const rec = recorderRef.current;
    if (!rec || !rules || finishingRef.current) return;
    finishingRef.current = true;
    const attempt = attemptRef.current;
    clearTimers();
    setPhase("analyzing");
    try {
      // The recorder measured the take while it was recorded: no second pass over the audio.
      // The lead (recorded before "Speak now") is known silence: it gives the background level.
      const { blob, analysis, inputSampleRate, processing } = await rec.stop({ leadS: pad });
      const recordedAt = new Date();
      recorderRef.current = null;
      if (attempt !== attemptRef.current) return;
      const mid = currentIdRef.current ?? "";
      const takeNumber = (takesRef.current.get(mid) ?? 0) + 1;
      takesRef.current.set(mid, takeNumber);
      const quietHintShown = quietShownRef.current;
      // Saved on the phone before anything else, so a crash from here on cannot lose it.
      await saveDraft({ v: 1, userId, campaignId, missionId: mid, blob, analysis, recordedAt: recordedAt.getTime(), inputSampleRate, processing, quietHintShown, takeNumber });
      if (attempt !== attemptRef.current) return;
      // Only a blocking problem sends the speaker back to record; advice is shown on the review screen.
      const check = checkTake(analysis, rules);
      const p = check?.blocking ? check.problem : null;
      track("take_checked", { result: p ? "problem" : check ? "advice" : "ok", ...(check ? { problem: check.problem } : {}), duration_s: Math.round(analysis.duration_s * 10) / 10, mission_type: missionTypeIn(byIdRef.current, mid) });
      if (p) void clearDraft(userId, campaignId);
      setTake(p ? null : { blob, analysis, recordedAt, inputSampleRate, processing, quietHintShown, takeNumber, ...(opts.cutShort ? { cutShort: true } : {}) });
      setProblem(p);
      setPhase(p ? "problem" : "review");
      vibrate(p ? [40, 60, 40] : 30);
    } catch (e) {
      recorderRef.current = null;
      if (attempt !== attemptRef.current) return;
      reportMicError("stopFailed", false, e);
      setMicError(t("mic.stopFailed"));
      setPhase("idle");
    } finally {
      finishingRef.current = false;
    }
  }, [rules, t, userId, campaignId, pad]);

  const beginTail = useCallback(() => {
    clearTimers();
    setPhase("tail");
    later(() => void finish(), pad * 1000);
  }, [finish, pad]);
  const beginTailRef = useRef(beginTail);

  // ── Start ───────────────────────────────────────────────────────────────

  const startRecorder = useCallback(
    async (attempt: number) => {
      const stream = await streamRef.current;
      streamRef.current = null;
      if (attempt !== attemptRef.current) {
        stream?.getTracks().forEach((x) => x.stop());
        return;
      }
      const rec = new WavRecorder();
      recorderRef.current = rec;
      // Cut by the system (call, mic gone): the take would have a gap, drop it and say so (APP-032).
      rec.onInterrupted = () => interruptRef.current();
      await rec.start(stream ?? undefined);
      if (attempt !== attemptRef.current) return void rec.dispose();
      const startedAt = Date.now();
      let quietFor = 0;
      let last = startedAt;
      setElapsed(0);
      setQuiet(false);
      quietShownRef.current = false;
      const recordingId = currentIdRef.current;
      track("record_started", { campaign_kind: campaignKind, mission_type: missionTypeIn(byIdRef.current, recordingId), take_number: (takesRef.current.get(recordingId ?? "") ?? 0) + 1 });
      setPhase("lead");
      vibrate(20);
      later(() => {
        if (attempt === attemptRef.current) {
          setPhase((p) => (p === "lead" ? "speaking" : p));
          vibrate(15);
        }
      }, pad * 1000);
      const tick = () => {
        if (attempt !== attemptRef.current || !recorderRef.current) return;
        const now = Date.now();
        const s = (now - startedAt) / 1000;
        setElapsed(s);
        // A too-quiet voice, for a while, after the lead silence: say so.
        if (s > pad + 0.5 && recorderRef.current.levelDbfs < (rules?.minLevelDbfs ?? -35)) quietFor += (now - last) / 1000;
        else quietFor = 0;
        last = now;
        if (quietFor >= QUIET_HINT_AFTER_S) quietShownRef.current = true;
        setQuiet(quietFor >= QUIET_HINT_AFTER_S);
        if (s >= stopAtS) return beginTailRef.current();
        timers.current.push(setTimeout(tick, 100));
      };
      timers.current.push(setTimeout(tick, 100));
    },
    [stopAtS, pad, rules?.minLevelDbfs, campaignKind],
  );

  useEffect(() => {
    if (phase !== "countdown") return;
    const attempt = attemptRef.current;
    if (count <= 0) {
      startRecorder(attempt).catch((e) => {
        if (attempt !== attemptRef.current) return;
        recorderRef.current = null;
        showMicError(e);
        setPhase("idle");
      });
      // Never wait for the microphone forever (a prompt left unanswered, an in-app browser that
      // never shows one, a hung audio start): first say to answer the browser, then give up with
      // a message instead of staying on "Get ready…".
      later(() => {
        if (attempt === attemptRef.current && phaseRef.current === "countdown") setSlowStart(true);
      }, MIC_START_HINT_MS);
      later(() => {
        if (attempt !== attemptRef.current || phaseRef.current !== "countdown") return;
        teardown();
        const help = micHelpFor(navigator.userAgent);
        reportMicError(help === "inApp" ? "inApp" : "startTimeout", help === "inApp", null);
        setMicError(t(help === "inApp" ? "mic.inApp" : "mic.startTimeout"));
        setMicHelp(help === "inApp" ? null : help);
        setSlowStart(false);
        setPhase("idle");
        vibrate([40, 60, 40]);
      }, MIC_START_TIMEOUT_MS);
      return;
    }
    const id = setTimeout(() => setCount((c) => c - 1), 700);
    return () => clearTimeout(id);
  }, [phase, count, startRecorder, showMicError, t, teardown]);

  function start() {
    // Synchronous inside the tap: iOS drops the permission prompt after any await.
    attemptRef.current++;
    const attempt = attemptRef.current;
    setMicError(null);
    setMicHelp(null);
    setSlowStart(false);
    setProblem(null);
    setTake(null);
    // Recording again replaces the take kept on the phone.
    void clearDraft(userId, campaignId);
    const p = acquireMicStream();
    streamRef.current = p;
    p.catch((e) => {
      if (attempt !== attemptRef.current) return;
      streamRef.current = null;
      showMicError(e);
      setPhase("idle");
    });
    setCount(COUNTDOWN_S);
    setPhase("countdown");
  }

  const canStop = phase === "speaking" && (!timed || elapsed + pad >= minS);

  function press() {
    if (phase === "idle" || phase === "problem") return start();
    if (phase === "countdown" || phase === "lead") {
      teardown();
      setPhase("idle");
      return;
    }
    if (phase === "speaking" && canStop) beginTail();
  }

  // ── Submit: save on the phone, move on ──────────────────────────────────

  const advance = useCallback(
    (fromId: string, sessionAfter: number, q: string[] = queue) => {
      const isOpen = (id: string) => {
        const m = byIdRef.current.get(id);
        return Boolean(m) && id !== fromId && canRecordNow(m!, onPhoneRef.current);
      };
      const next = nextInQueue(q, fromId, isOpen);
      setTake(null);
      setProblem(null);
      setElapsed(0);
      setQuiet(false);
      if (!next) return setPhase("done");
      setCurrentId(next);
      setPhase(goal && sessionAfter === goal ? "goal" : "idle");
    },
    [goal, queue],
  );

  async function submit() {
    if (busy.current || !take || !mission) return;
    busy.current = true;
    setPhase("saving");
    try {
      let sha: string;
      try {
        sha = await sha256Hex(take.blob);
      } catch {
        setMicError(t("mic.prepare"));
        setPhase("review");
        return;
      }
      const metadata = buildMetadata(take.analysis, sha, deviceLabel(navigator.userAgent), null);
      const filename = buildCampaignFilename({ languageCode: card.language.code, speakerId, missionCode: mission.code });
      // The advice the review screen showed (the same check as the render below): a submit over it is "Send anyway".
      const shown = checkTake(take.analysis, rules!);
      const advice = shown && !shown.blocking ? shown.problem : null;
      const audioDoc = buildAudioMetadata({
        card,
        mission,
        contributor,
        analysis: take.analysis,
        rules: rules!,
        sha256: sha,
        filename,
        capture: {
          recordedAt: take.recordedAt,
          submittedAt: new Date(),
          inputSampleRate: take.inputSampleRate,
          processing: take.processing,
          sizeBytes: take.blob.size,
          paddingS: pad,
          quietHintShown: take.quietHintShown,
          advice,
          sentAnyway: advice !== null,
          takeNumber: take.takeNumber,
          sessionId,
          indexInSession: sessionCount + 1,
          appLocale: locale,
          utcOffsetMin: -new Date().getTimezoneOffset(),
          device: { label: deviceLabel(navigator.userAgent), ...parseDevice(navigator.userAgent) },
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
          appBuild: process.env.NEXT_PUBLIC_APP_BUILD ?? null,
        },
      });
      const item: OutboxItem = {
        v: 1,
        id: sha,
        userId,
        campaignId,
        missionId: mission.mission_id,
        missionCode: mission.code,
        missionType: mission.type,
        createdAt: Date.now(),
        blob: take.blob,
        filename,
        upload: {
          languageIso: card.language.code,
          ...(dialect ? { dialect } : {}),
          englishDescription: mission.prompt.text_or_topic,
          speakerId,
          extraFields: { ...buildSayariCampaignFields(card, mission, metadata), metadata: JSON.stringify(audioDoc) },
        },
        metadata,
        uploaded: false,
        sayariId: null,
        state: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        lastCode: null,
      };
      try {
        await enqueueTake(item);
      } catch (e) {
        // A full phone is the usual cause: say so (N-13). The earlier take is kept: nothing is lost.
        const full = (e as { name?: string } | null)?.name === "QuotaExceededError";
        setMicError(t(full ? "mic.noSpace" : "mic.prepare"));
        setPhase("review");
        return;
      }
      // Saved: an earlier take of this mission (one that failed) is replaced by the new one. Only
      // now, so a save that fails never loses the previous take.
      await Promise.all(box.items.filter((i) => i.missionId === mission.mission_id && i.id !== sha).map((i) => outbox.discard(i.id)));
      void clearDraft(userId, campaignId);
      // Saved. A nearly full phone may lose it before it is sent: say so (APP-007).
      void freeSpaceBytes().then((free) => {
        if (free != null && free < LOW_SPACE_BYTES) setMicError(t("saved.lowSpace"));
      });
      track("take_submitted", { take_number: take.takeNumber, mission_type: mission.type, campaign_kind: campaignKind, sent_anyway: advice !== null, offline: navigator.onLine === false });
      const n = sessionCount + 1;
      setSessionCount(n);
      setFlash(navigator.onLine === false ? "offline" : "online");
      later(() => setFlash(null), 2200);
      vibrate([20, 40, 20]);
      advance(mission.mission_id, n);
    } finally {
      busy.current = false;
    }
  }

  function skipMission() {
    if (!currentId) return;
    // The last mission left: skipping would show "All recorded!" with it still to do (N-14).
    if (!nextInQueue(queue, currentId, (id) => { const m = byId.get(id); return Boolean(m && canRecordNow(m, onPhone)); })) {
      setFlash("lastOne");
      later(() => setFlash(null), 2200);
      return;
    }
    track("take_skipped", { mission_type: mission?.type ?? "unknown", campaign_kind: campaignKind });
    const q = skip(queue, currentId);
    setQueue(q);
    advance(currentId, sessionCount, q);
  }

  // Keyboard: Space records/stops, Enter submits, R records again (useful on a laptop).
  const pressRef = useRef(press);
  const submitRef = useRef(submit);
  // Timers and key handlers read the latest values through refs, updated after each render.
  useLayoutEffect(() => {
    onPhoneRef.current = onPhone;
    phaseRef.current = phase;
    interruptRef.current = interrupt;
    currentIdRef.current = currentId;
    byIdRef.current = byId;
    cardRef.current = card;
    beginTailRef.current = beginTail;
    finishRef.current = finish;
    teardownRef.current = teardown;
    pressRef.current = press;
    submitRef.current = submit;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "Space" && el?.tagName !== "BUTTON") {
        e.preventDefault();
        pressRef.current();
      } else if (e.key === "Enter" && el?.tagName !== "BUTTON" && phase === "review") {
        e.preventDefault();
        void submitRef.current();
      } else if ((e.key === "r" || e.key === "R") && (phase === "review" || phase === "problem")) start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // start() only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function changeSize(n: number) {
    const v = Math.max(0, Math.min(TEXT_SIZES.length - 1, n));
    setSize(v);
    try {
      localStorage.setItem(SIZE_KEY, String(v));
    } catch {
      // not remembered
    }
  }

  function leave(e: React.MouseEvent) {
    if (unsaved && !window.confirm(t("closeConfirm"))) e.preventDefault();
    else {
      teardown();
      void clearDraft(userId, campaignId);
    }
  }

  // Analytics: every prompt of a qualification test recorded in this visit (sent or waiting on the phone).
  const testDoneRef = useRef(false);
  const testAllRecorded = card.kind === "qualification" && phase === "done" && sessionCount > 0 && toRecordCount(missions, onPhone) === 0;
  useEffect(() => {
    if (!testAllRecorded || testDoneRef.current) return;
    testDoneRef.current = true;
    track("test_completed", { language: card.language.code, prompts: missions.length, ...(card.qualification ? { attempt_no: card.qualification.attempt_no } : {}) });
  }, [testAllRecorded, card.language.code, card.qualification, missions.length]);

  // ── Render ──────────────────────────────────────────────────────────────

  // Takes waiting on the phone are done as far as the speaker is concerned (MAN-004, APP-026).
  const open = toRecordCount(missions, onPhone);
  // This campaign's takes still on the phone (not failed): they need the app open to be sent.
  const waitingHere = box.items.filter((i) => i.userId === userId && i.campaignId === campaignId && i.state !== "failed").length;
  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[radial-gradient(120%_80%_at_50%_0%,#0a5bb0_0%,#00396f_45%,#001b36_100%)] text-white">
      <p ref={statusRef} className="sr-only" role="status" aria-live="polite">
        {t(`status.${phase === "goal" ? "goal" : phase}`)}
      </p>
      <header className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <Link href={hubHref} onClick={leave} aria-label={t("close")} className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <X size={22} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <SessionBar count={sessionCount} goal={focusActive ? queue.length : goal} />
        </div>
      </header>
      {flash ? (
        <div role="status" className="afk-pop absolute inset-x-4 top-[calc(max(env(safe-area-inset-top),12px)+56px)] z-20 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-xl">
          {flash === "offline" ? <CloudOff size={18} className="text-amber-600" aria-hidden /> : flash === "lastOne" ? null : <Check size={18} className="text-emerald-600" aria-hidden />}
          {flash === "offline" ? t("saved.flashOffline") : flash === "lastOne" ? t("skipLast") : t("saved.flash")}
        </div>
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2">{children}</main>
      {footer ? <footer className="px-4 pt-2 pb-[max(env(safe-area-inset-bottom),16px)]">{footer}</footer> : null}
    </div>
  );

  if (phase === "goal") {
    return shell(
      <div className="afk-pop m-auto flex max-w-sm flex-col items-center gap-4 text-center">
        <Confetti />
        <div className="grid size-24 place-items-center rounded-full bg-yellow text-5xl shadow-lg" aria-hidden>
          ★
        </div>
        <h1 className="text-3xl font-black">{t("goal.title")}</h1>
        <p className="text-base text-white/85">{t("goal.body", { n: sessionCount })}</p>
      </div>,
      <div className="flex flex-col gap-3">
        <button type="button" autoFocus onClick={() => setPhase("idle")} className="min-h-14 rounded-2xl bg-white text-lg font-bold text-primary">
          {t("goal.keepGoing")}
        </button>
        <Link href={hubHref} className="grid min-h-14 place-items-center rounded-2xl border border-white/30 text-base font-semibold">
          {t("goal.finish")}
        </Link>
      </div>,
    );
  }

  if ((phase === "done" || !mission || !rules) && pool) {
    // Pool: the batch is recorded. Draw the next one here, or say why there is none.
    const refused = isRefusal(pool.memo?.last.status) ? (pool.memo!.last.status as Parameters<typeof PoolRefusal>[0]["status"]) : null;
    const back = (
      <Link href={hubHref} className="grid min-h-14 place-items-center rounded-2xl border border-white/30 text-base font-semibold">
        {t("done.back")}
      </Link>
    );
    return shell(
      <div className="afk-pop m-auto flex max-w-sm flex-col items-center gap-4 text-center">
        {sessionCount > 0 && !refused ? <Confetti /> : null}
        {refused ? (
          <PoolRefusal status={refused} campaignId={campaignId} elsewhere={pool.memo?.pool} dark />
        ) : (
          <>
            <div className="grid size-24 place-items-center rounded-full bg-emerald-500 shadow-lg">
              <Check size={52} strokeWidth={3} aria-hidden />
            </div>
            <h1 className="text-3xl font-black">{t("done.batchTitle")}</h1>
            {sessionCount > 0 ? <p className="text-lg font-bold text-yellow">{t("done.sessionCount", { n: sessionCount })}</p> : null}
            <p role={pool.drawFailed ? "alert" : "status"} className="text-base text-white/85">
              {pool.drawing ? tp("drawing") : pool.drawFailed ? tp("drawFailed") : tp("batchDone")}
            </p>
          </>
        )}
      </div>,
      <div className="flex flex-col gap-3">
        {!refused ? (
          <button type="button" autoFocus onClick={() => void pool.drawNow()} disabled={pool.drawing} className="min-h-14 rounded-2xl bg-white text-lg font-bold text-primary disabled:opacity-70">
            {pool.drawFailed ? tc("retry") : tp("getMore")}
          </button>
        ) : null}
        {back}
      </div>,
    );
  }

  if (phase === "done" || !mission || !rules) {
    // Conversations left wait for the partner's consent: "every mission" would not be true (APP2-08).
    const partnerWaits = missions.filter((m) => waitsForPartner(m, onPhone.get(m.mission_id))).length;
    return shell(
      <div className="afk-pop m-auto flex max-w-sm flex-col items-center gap-4 text-center">
        {sessionCount > 0 ? <Confetti /> : null}
        <div className="grid size-24 place-items-center rounded-full bg-emerald-500 shadow-lg">
          <Check size={52} strokeWidth={3} aria-hidden />
        </div>
        <h1 className="text-3xl font-black">{t("done.title")}</h1>
        {sessionCount > 0 ? <p className="text-lg font-bold text-yellow">{t("done.sessionCount", { n: sessionCount })}</p> : null}
        {/* Takes go only while the app is open and online: never say "done" while some wait (N-4). */}
        {waitingHere > 0 ? (
          <p role="status" className="rounded-2xl bg-amber-400/15 px-4 py-3 text-base font-semibold text-amber-50 ring-1 ring-amber-300/40">{t("done.onPhone", { n: waitingHere })}</p>
        ) : (
          // A focused session recorded what its link asked for, not "every mission": say so.
          <p className="text-base text-white/85">{t(focusActive ? "done.bodyFocus" : card.kind === "qualification" ? "done.bodyTest" : "done.body")}</p>
        )}
        {partnerWaits > 0 ? <p className="text-base text-white/85">{t("done.partnerWaits", { n: partnerWaits })}</p> : null}
      </div>,
      <Link href={hubHref} className="grid min-h-14 place-items-center rounded-2xl bg-white text-lg font-bold text-primary">
        {t("done.back")}
      </Link>,
    );
  }

  // Advice about the take on the review screen (quiet, noisy, short pause): the speaker may send anyway.
  const check = take ? checkTake(take.analysis, rules) : null;
  const advice = check && !check.blocking ? (check.problem as "silent" | "clipped" | "too_quiet" | "noisy" | "silence" | "pauses") : null;
  // A focus counts its own queue ("1 of 2"); otherwise the whole campaign's missions.
  const focusProgress = focusActive ? queueProgress(queue, (id) => { const m = byId.get(id); return Boolean(m && canRecordNow(m, onPhone)); }) : null;
  const position = focusProgress ? focusProgress.position : Math.min(Math.max(1, missions.length - open + 1), missions.length);
  const total = focusProgress ? focusProgress.total : missions.length;
  const leftHere = focusProgress ? focusProgress.left : open;
  const progress = recording && maxS ? elapsed / maxS : null;
  const buttonMode = phase === "countdown" ? "countdown" : recording ? "recording" : phase === "analyzing" || phase === "saving" ? "busy" : "record";
  const buttonLabel = recording || phase === "countdown" ? (phase === "speaking" ? t("button.stop") : t("button.cancel")) : t("button.record");

  return shell(
    <div key={mission.mission_id} className="afk-slide-in flex flex-1 flex-col gap-4 pt-2">
      <div className="flex items-center justify-between text-sm font-semibold text-white/75">
        <span>{t("missionOf", { n: position, total })}</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs">{card.kind === "qualification" && mission.type === "read" ? t("type.sayIn", { language: languageInText(card.language.name, locale) }) : t(`type.${mission.type}`)}</span>
      </div>
      {focusDone ? (
        <p role="status" className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/90">
          {t("focusDone")}
        </p>
      ) : null}
      <PromptCard mission={mission} lang={card.language.code} size={size} onSize={changeSize} sayIn={card.kind === "qualification" ? { language: card.language.name, uiLocale: locale } : undefined} />
      {micError ? (
        <p role="alert" className="rounded-2xl bg-red-500/20 px-4 py-3 text-sm font-medium text-red-50 ring-1 ring-red-300/40">
          {micError}
          {micHelp ? <span className="mt-1 block font-normal text-red-50/90">{t(`mic.help.${micHelp}`)}</span> : null}
        </p>
      ) : null}
      {phase === "problem" && problem ? (
        <div role="alert" className="afk-pop rounded-2xl bg-amber-400/15 px-4 py-3 ring-1 ring-amber-300/40">
          <p className="font-bold text-amber-100">{t("problem.title")}</p>
          <p className="text-sm text-amber-50">{t(`problem.${problem}`, { min: rules.durationMinS, max: rules.durationMaxS })}</p>
        </div>
      ) : null}
    </div>,
    phase === "review" || phase === "saving" ? (
      take ? (
        <div className="afk-pop flex flex-col gap-3">
          {take.restored ? (
            <p role="status" className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/90">
              {t("review.restored")}
            </p>
          ) : null}
          {take.cutShort ? (
            <p role="status" className="rounded-2xl bg-amber-400/15 px-4 py-3 text-sm text-amber-50 ring-1 ring-amber-300/40">
              {t("review.cutShort")}
            </p>
          ) : null}
          {advice ? (
            <div role="status" className="rounded-2xl bg-amber-400/15 px-4 py-3 ring-1 ring-amber-300/40">
              <p className="font-bold text-amber-100">{t("advice.title")}</p>
              <p className="text-sm text-amber-50">{t(`advice.${advice}`)}</p>
            </div>
          ) : null}
          <p className="text-center text-sm font-semibold text-white/80">{t("review.length", { time: formatClock(take.analysis.duration_s) })}</p>
          <TakePlayer blob={take.blob} peaks={take.analysis.peaks} durationS={take.analysis.duration_s} />
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <button type="button" onClick={start} disabled={phase === "saving"} className="flex min-h-14 items-center gap-2 rounded-2xl border border-white/30 px-4 font-semibold disabled:opacity-50">
              <RotateCcw size={18} aria-hidden /> {t("review.again")}
            </button>
            <button type="button" onClick={() => void submit()} disabled={phase === "saving"} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-white text-lg font-bold text-primary shadow-lg disabled:opacity-70">
              {phase === "saving" ? t("review.preparing") : advice ? t("review.sendAnyway") : leftHere > 1 ? t("review.submit") : t("review.submitLast")}
              {phase !== "saving" ? <ChevronRight size={20} aria-hidden /> : null}
            </button>
          </div>
        </div>
      ) : null
    ) : (
      <div className="flex flex-col items-center gap-2">
        <p aria-hidden className={`min-h-7 text-center text-lg font-bold ${phase === "speaking" ? "text-emerald-300" : "text-white/85"}`}>
          {phase === "problem" ? t("phase.idle") : phase === "countdown" && slowStart ? t("phase.waitingMic") : t(`phase.${phase as "idle" | "countdown" | "lead" | "speaking" | "tail" | "analyzing"}`)}
        </p>
        {recording ? (
          <p role="timer" className="text-3xl font-black tabular-nums">
            {formatClock(elapsed)}
            {maxS ? <span className="text-lg font-semibold text-white/60"> / {formatClock(maxS)}</span> : null}
          </p>
        ) : null}
        <RecordButton mode={buttonMode} count={count} onPress={press} disabled={phase === "speaking" && !canStop} describedBy="rec-hint" levelRef={levelRef} minLevelDbfs={rules.minLevelDbfs} progress={progress} label={buttonLabel} />
        <p id="rec-hint" className="min-h-5 text-center text-sm text-white/75">
          {phase === "speaking" && quiet ? <span className="font-semibold text-amber-200">{t("hint.quiet")}</span> : phase === "speaking" && !canStop ? t("hint.tooEarly", { min: minS }) : null}
        </p>
        {phase === "idle" || phase === "problem" ? (
          <button type="button" onClick={skipMission} className="flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white/75 hover:bg-white/10">
            <SkipForward size={16} aria-hidden /> {t("skip")}
          </button>
        ) : null}
      </div>
    ),
  );
}

/** The type of a mission of the session, for analytics. */
const missionTypeIn = (byId: ReadonlyMap<string, Mission>, id: string | null) => (id ? byId.get(id)?.type ?? "unknown" : "unknown");

/**
 * A microphone failure: an analytics event, and a handled exception in error tracking (which
 * starts the session replay: analytics/init.ts). The error carries no prompt or audio.
 */
function reportMicError(code: MicErrorCode, inApp: boolean, error: unknown) {
  track("record_mic_error", { code, in_app_browser: inApp });
  reportException(error instanceof Error ? error : new Error(`Microphone: ${code}`), { source: "studio-mic", mic_code: code });
}
