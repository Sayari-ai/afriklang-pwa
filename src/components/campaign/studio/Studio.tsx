"use client";

/**
 * The recording studio: the missions of a campaign, recorded one after the other.
 *
 *   idle ─tap─► countdown ─► lead (silent) ─► speaking ─stop─► tail (silent) ─► analyzing
 *                                                                         ├─► problem ─► idle
 *                                                                         └─► review ─submit─► next mission
 *                                                                   (with advice: quiet, noisy, short pause)
 *
 * The studio adds the silence the campaign asks for around the voice by itself (it records a
 * moment before saying "Speak now" and keeps recording a moment after Stop), shows a live level
 * ring, and checks each take before it can be submitted. Submitting saves the take on the phone
 * (the outbox sends it in the background) and moves straight to the next mission.
 */

import { Check, ChevronRight, CloudOff, RotateCcw, SkipForward, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { checkTake, sha256Hex, type FullAnalysis, type TakeProblem } from "@/lib/audio/analyze";
import { RecorderError, WavRecorder, acquireMicStream, prewarmAudioWorklet } from "@/lib/audio/recorder";
import { buildAudioMetadata, parseDevice, varietyFor } from "@/lib/campaign/audio-metadata";
import { clearDraft, loadDraft, saveDraft } from "@/lib/campaign/drafts";
import { LOW_SPACE_BYTES, freeSpaceBytes } from "@/lib/campaign/storage-safety";
import { enqueueTake, outbox, useOutbox } from "@/lib/campaign/outbox-client";
import { missionsInOutbox, type OutboxItem } from "@/lib/campaign/outbox-logic";
import { buildCampaignFilename } from "@/lib/campaign/recording-name";
import { buildMetadata, buildSayariCampaignFields, deviceLabel, formatClock, isTimed, takeRules } from "@/lib/campaign/record-flow";
import { QUIET_HINT_AFTER_S, TEXT_SIZES, autoStopAtS, canRecordNow, nextInQueue, paddingS, sessionGoal, sessionQueue, skip } from "@/lib/campaign/studio-flow";
import { isRefusal } from "@/lib/campaign/pool";
import type { PoolState } from "@/lib/campaign/pool-client";
import type { CampaignCard, ContributorView, Mission } from "@/lib/campaign/types";
import { toRecordCount } from "@/lib/campaign/view";
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
  startId: string | null;
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

  // The session's order is fixed when the studio opens (later answers only remove missions from it).
  const [queue, setQueue] = useState<string[]>(() => sessionQueue(missions, onPhone, startId));
  const [currentId, setCurrentId] = useState<string | null>(() => queue[0] ?? null);
  const [phase, setPhase] = useState<Phase>(() => (queue.length ? "idle" : "done"));
  const [count, setCount] = useState(COUNTDOWN_S);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [problem, setProblem] = useState<TakeProblem | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [flash, setFlash] = useState<"online" | "offline" | null>(null);
  const [size, setSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem(SIZE_KEY));
      return Number.isInteger(n) && n >= 0 && n < TEXT_SIZES.length ? n : 1;
    } catch {
      return 1;
    }
  });

  // Missions that became recordable during the session (sent back by the team, or drawn for a pool
  // campaign) join the end of the queue. A pool session that had run out picks up the new batch.
  const isPoolSession = pool != null;
  useEffect(() => {
    const fresh = sessionQueue(missions, onPhoneRef.current, null).filter((id) => !queue.includes(id));
    if (!fresh.length) return;
    setQueue((q) => [...q, ...fresh.filter((id) => !q.includes(id))]);
    if (isPoolSession && phase === "done") {
      setCurrentId(fresh[0]);
      setPhase("idle");
    }
  }, [missions, queue, isPoolSession, phase]);

  // The mission on screen keeps its last known copy: in a pool campaign it can leave the list while
  // it is being recorded (its lease ended, or a refresh came in), and the take must still go through.
  const [held, setHeld] = useState<Mission | null>(null);
  const found = currentId ? byId.get(currentId) ?? null : null;
  if (found && found !== held) setHeld(found);
  const mission = found ?? (held && held.mission_id === currentId ? held : null);
  const rules = mission ? takeRules(card, mission) : null;
  const pad = paddingS(card);
  const goal = sessionGoal(card);
  const timed = mission ? isTimed(mission.type) : false;
  const minS = mission ? (mission.duration_s.min ?? rules?.durationMinS ?? 0) : 0;
  const maxS = mission && timed ? (mission.duration_s.max ?? rules?.durationMaxS ?? null) : null;
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

  useEffect(() => {
    prewarmAudioWorklet();
    return teardown;
  }, [teardown]);

  // A take cut by a call, a lost microphone or the app going to the background is dropped, with a
  // clear message, instead of being kept with a gap (APP-032).
  const interrupt = () => {
    if (!recorderRef.current) return;
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
      const p = phaseRef.current;
      if (document.visibilityState === "hidden" && (p === "lead" || p === "speaking" || p === "tail")) interruptRef.current();
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
      setProblem(null);
      setTake({ blob: d.blob, analysis: d.analysis, recordedAt: new Date(d.recordedAt), inputSampleRate: d.inputSampleRate, processing: d.processing, quietHintShown: d.quietHintShown, takeNumber: d.takeNumber, restored: true });
      setPhase("review");
    });
    return () => {
      cancelled = true;
    };
  }, [userId, campaignId]);

  // The address shows the current mission, so a reload comes back to it.
  useEffect(() => {
    if (!currentId) return;
    const url = `/campaign/${campaignId}/studio?m=${encodeURIComponent(currentId)}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [campaignId, currentId]);

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

  const micMessage = useCallback((e: unknown) => t(`mic.${e instanceof RecorderError ? e.code : "internal"}`), [t]);

  // ── Stop: keep recording `pad` seconds of silence, then analyse ─────────

  const finish = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || !rules) return;
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
      if (p) void clearDraft(userId, campaignId);
      setTake(p ? null : { blob, analysis, recordedAt, inputSampleRate, processing, quietHintShown, takeNumber });
      setProblem(p);
      setPhase(p ? "problem" : "review");
      vibrate(p ? [40, 60, 40] : 30);
    } catch {
      recorderRef.current = null;
      if (attempt !== attemptRef.current) return;
      setMicError(t("mic.stopFailed"));
      setPhase("idle");
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
    [stopAtS, pad, rules?.minLevelDbfs],
  );

  useEffect(() => {
    if (phase !== "countdown") return;
    const attempt = attemptRef.current;
    if (count <= 0) {
      startRecorder(attempt).catch((e) => {
        if (attempt !== attemptRef.current) return;
        recorderRef.current = null;
        setMicError(micMessage(e));
        setPhase("idle");
      });
      return;
    }
    const id = setTimeout(() => setCount((c) => c - 1), 700);
    return () => clearTimeout(id);
  }, [phase, count, startRecorder, micMessage]);

  function start() {
    // Synchronous inside the tap: iOS drops the permission prompt after any await.
    attemptRef.current++;
    const attempt = attemptRef.current;
    setMicError(null);
    setProblem(null);
    setTake(null);
    // Recording again replaces the take kept on the phone.
    void clearDraft(userId, campaignId);
    const p = acquireMicStream();
    streamRef.current = p;
    p.catch((e) => {
      if (attempt !== attemptRef.current) return;
      streamRef.current = null;
      setMicError(micMessage(e));
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
          takeNumber: take.takeNumber,
          sessionId,
          indexInSession: sessionCount + 1,
          appLocale: locale,
          utcOffsetMin: -new Date().getTimezoneOffset(),
          device: { label: deviceLabel(navigator.userAgent), ...parseDevice(navigator.userAgent) },
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
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
      // A failed take of this mission is replaced by the new one.
      await Promise.all(box.items.filter((i) => i.missionId === mission.mission_id && i.id !== sha).map((i) => outbox.discard(i.id)));
      try {
        await enqueueTake(item);
      } catch {
        setMicError(t("mic.prepare"));
        setPhase("review");
        return;
      }
      void clearDraft(userId, campaignId);
      // Saved. A nearly full phone may lose it before it is sent: say so (APP-007).
      void freeSpaceBytes().then((free) => {
        if (free != null && free < LOW_SPACE_BYTES) setMicError(t("saved.lowSpace"));
      });
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
    beginTailRef.current = beginTail;
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

  // ── Render ──────────────────────────────────────────────────────────────

  // Takes waiting on the phone are done as far as the speaker is concerned (MAN-004, APP-026).
  const open = toRecordCount(missions, onPhone);
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
          <SessionBar count={sessionCount} goal={goal} />
        </div>
      </header>
      {flash ? (
        <div role="status" className="afk-pop absolute inset-x-4 top-[calc(max(env(safe-area-inset-top),12px)+56px)] z-20 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-xl">
          {flash === "offline" ? <CloudOff size={18} className="text-amber-600" aria-hidden /> : <Check size={18} className="text-emerald-600" aria-hidden />}
          {flash === "offline" ? t("saved.flashOffline") : t("saved.flash")}
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
    return shell(
      <div className="afk-pop m-auto flex max-w-sm flex-col items-center gap-4 text-center">
        {sessionCount > 0 ? <Confetti /> : null}
        <div className="grid size-24 place-items-center rounded-full bg-emerald-500 shadow-lg">
          <Check size={52} strokeWidth={3} aria-hidden />
        </div>
        <h1 className="text-3xl font-black">{t("done.title")}</h1>
        {sessionCount > 0 ? <p className="text-lg font-bold text-yellow">{t("done.sessionCount", { n: sessionCount })}</p> : null}
        <p className="text-base text-white/85">{t("done.body")}</p>
      </div>,
      <Link href={hubHref} className="grid min-h-14 place-items-center rounded-2xl bg-white text-lg font-bold text-primary">
        {t("done.back")}
      </Link>,
    );
  }

  // Advice about the take on the review screen (quiet, noisy, short pause): the speaker may send anyway.
  const check = take ? checkTake(take.analysis, rules) : null;
  const advice = check && !check.blocking ? (check.problem as "too_quiet" | "noisy" | "silence") : null;
  const position = Math.max(1, missions.length - open + 1);
  const progress = recording && maxS ? elapsed / maxS : null;
  const buttonMode = phase === "countdown" ? "countdown" : recording ? "recording" : phase === "analyzing" || phase === "saving" ? "busy" : "record";
  const buttonLabel = recording || phase === "countdown" ? (phase === "speaking" ? t("button.stop") : t("button.cancel")) : t("button.record");

  return shell(
    <div key={mission.mission_id} className="afk-slide-in flex flex-1 flex-col gap-4 pt-2">
      <div className="flex items-center justify-between text-sm font-semibold text-white/75">
        <span>{t("missionOf", { n: Math.min(position, missions.length), total: missions.length })}</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs">{card.kind === "qualification" && mission.type === "read" ? t("type.say") : t(`type.${mission.type}`)}</span>
      </div>
      <PromptCard mission={mission} lang={card.language.code} size={size} onSize={changeSize} sayIn={card.kind === "qualification" ? { language: card.language.name, uiLocale: locale } : undefined} />
      {micError ? (
        <p role="alert" className="rounded-2xl bg-red-500/20 px-4 py-3 text-sm font-medium text-red-50 ring-1 ring-red-300/40">
          {micError}
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
              {phase === "saving" ? t("review.preparing") : advice ? t("review.sendAnyway") : open > 1 ? t("review.submit") : t("review.submitLast")}
              {phase !== "saving" ? <ChevronRight size={20} aria-hidden /> : null}
            </button>
          </div>
        </div>
      ) : null
    ) : (
      <div className="flex flex-col items-center gap-2">
        <p aria-hidden className={`min-h-7 text-center text-lg font-bold ${phase === "speaking" ? "text-emerald-300" : "text-white/85"}`}>
          {phase === "problem" ? t("phase.idle") : t(`phase.${phase as "idle" | "countdown" | "lead" | "speaking" | "tail" | "analyzing"}`)}
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
