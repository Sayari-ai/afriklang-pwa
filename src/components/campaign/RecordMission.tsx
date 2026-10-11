"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { analyzeWav, checkTake, sha256Hex, type TakeAnalysis, type TakeProblem } from "@/lib/audio/analyze";
import { RecorderError, WavRecorder, acquireMicStream, prewarmAudioWorklet } from "@/lib/audio/recorder";
import { AudioUploadError, uploadAudio } from "@/lib/api/audio";
import { submitRecording } from "@/lib/campaign/api";
import { ERROR_KEY } from "@/lib/campaign/errors";
import { buildCampaignFilename } from "@/lib/campaign/recording-name";
import { autoStopS, buildMetadata, canStop, deviceLabel, formatClock, isTimed, nextTodo, problemMessageKey, submitFailureAction, takeRules, type SubmitAction } from "@/lib/campaign/record-flow";
import type { CampaignCard, CampaignErrorCode, Mission, RecordingMetadata } from "@/lib/campaign/types";
import { RecordPrompt } from "./RecordPrompt";
import { TakeReview } from "./TakeReview";

type Phase = "idle" | "countdown" | "recording" | "analyzing" | "review" | "problem" | "submitting" | "failed" | "saved";
type Take = { blob: Blob; analysis: TakeAnalysis & { sample_rate: number; channels: number } };
type Failure = { action: SubmitAction; code: CampaignErrorCode | "upload"; offline?: boolean };

const COUNTDOWN_S = 3;

type Props = {
  campaignId: string;
  card: CampaignCard;
  mission: Mission;
  missions: Mission[];
  speakerId: string;
  dialect: string | null;
  onSaved: () => void;
  reload: () => void;
};

export function RecordMission({ campaignId, card, mission, missions, speakerId, dialect, onSaved, reload }: Props) {
  const t = useTranslations("campaign.record");
  const tc = useTranslations("campaign.common");
  const hubHref = `/campaign/${campaignId}`;
  const rules = takeRules(card, mission);
  const maxS = autoStopS(mission, rules);
  const minS = mission.duration_s.min ?? rules.durationMinS;
  const timed = isTimed(mission.type);

  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(COUNTDOWN_S);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [problem, setProblem] = useState<TakeProblem | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [rejectReason, setRejectReason] = useState<string | null>(null);

  const recorderRef = useRef<WavRecorder | null>(null);
  const pendingStreamRef = useRef<Promise<MediaStream> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);
  const attemptRef = useRef(0); // bumps on every new attempt so late async results of an abandoned one are ignored
  // What already happened to the current take: a retry must never repeat the upload.
  const sentRef = useRef<{ sha: string; filename: string; sayariId: string | null; uploaded: boolean; metadata: RecordingMetadata | null } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstPhase = useRef(true);

  const clearTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };
  const releasePending = () => {
    const p = pendingStreamRef.current;
    pendingStreamRef.current = null;
    p?.then((s) => s.getTracks().forEach((x) => x.stop())).catch(() => {});
  };

  useEffect(() => {
    prewarmAudioWorklet();
    return () => {
      // a counter, not a DOM node: the latest value is what we want
      // eslint-disable-next-line react-hooks/exhaustive-deps
      attemptRef.current++;
      clearTick();
      void recorderRef.current?.dispose();
      recorderRef.current = null;
      releasePending();
    };
  }, []);

  // Move focus to the new state's heading so screen readers announce the change.
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [phase]);

  // Closing the tab with an unsent take asks first. (In-app links are guarded on this screen's own buttons.)
  const unsent = phase === "review" || phase === "problem" || phase === "failed" || phase === "submitting" || phase === "recording";
  useEffect(() => {
    if (!unsent) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsent]);

  const startRecorder = useCallback(
    async (attempt: number) => {
      const stream = await pendingStreamRef.current;
      pendingStreamRef.current = null;
      if (attempt !== attemptRef.current) {
        stream?.getTracks().forEach((x) => x.stop());
        return;
      }
      const rec = new WavRecorder();
      recorderRef.current = rec;
      await rec.start(stream ?? undefined);
      if (attempt !== attemptRef.current) {
        void rec.dispose();
        return;
      }
      const startedAt = Date.now();
      setElapsed(0);
      setPhase("recording");
      clearTick();
      tickRef.current = setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setElapsed(s);
        if (maxS != null && s >= maxS) stopRef.current();
      }, 250);
    },
    [maxS],
  );

  const micMessage = (e: unknown) => {
    const code = e instanceof RecorderError ? e.code : "internal";
    return t(`mic.${code}`);
  };

  // Countdown ticks; at zero the recorder starts. The mic stream was requested earlier, inside the tap.
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
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
    // micMessage only depends on t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count, startRecorder]);

  function onStart() {
    // Must stay synchronous inside the tap: iOS drops the permission prompt after any await.
    attemptRef.current++;
    const attempt = attemptRef.current;
    setMicError(null);
    setFailure(null);
    const p = acquireMicStream();
    pendingStreamRef.current = p;
    p.catch((e) => {
      if (attempt !== attemptRef.current) return;
      pendingStreamRef.current = null;
      setMicError(micMessage(e));
      setPhase("idle");
    });
    setCount(COUNTDOWN_S);
    setPhase("countdown");
  }

  function cancelCountdown() {
    attemptRef.current++;
    releasePending();
    setPhase("idle");
  }

  const onStop = useCallback(async () => {
    if (busyRef.current) return;
    const rec = recorderRef.current;
    if (!rec) return;
    busyRef.current = true;
    clearTick();
    const attempt = attemptRef.current;
    setPhase("analyzing");
    try {
      const { blob } = await rec.stop();
      recorderRef.current = null;
      const analysis = await analyzeWav(blob);
      if (attempt !== attemptRef.current) return;
      const p = checkTake(analysis, rules);
      setTake({ blob, analysis });
      sentRef.current = null;
      setProblem(p);
      setPhase(p ? "problem" : "review");
    } catch (e) {
      recorderRef.current = null;
      if (attempt !== attemptRef.current) return;
      setMicError(e instanceof RecorderError ? micMessage(e) : t("mic.internal"));
      setPhase("idle");
    } finally {
      busyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules.durationMinS, rules.durationMaxS, rules.minLevelDbfs, rules.silenceMarginS, t]);

  useEffect(() => {
    stopRef.current = () => void onStop();
  }, [onStop]);

  function recordAgain() {
    setTake(null);
    setProblem(null);
    setFailure(null);
    setRejectReason(null);
    sentRef.current = null;
    setElapsed(0);
    setPhase("idle");
  }

  async function onSubmit() {
    if (busyRef.current || !take) return;
    busyRef.current = true;
    setPhase("submitting");
    setFailure(null);
    try {
      if (!sentRef.current) {
        const sha = await sha256Hex(take.blob);
        const filename = buildCampaignFilename({ languageCode: card.language.code, speakerId, missionCode: mission.code });
        sentRef.current = { sha, filename, sayariId: null, uploaded: false, metadata: null };
      }
      const sent = sentRef.current;
      if (!sent.uploaded) {
        try {
          const res = await uploadAudio({
            file: take.blob,
            filename: sent.filename,
            languageIso: card.language.code,
            consentRecorded: true,
            ...(dialect ? { dialect } : {}),
            englishDescription: mission.prompt.text_or_topic,
            speakerId,
          });
          sent.uploaded = true;
          sent.sayariId = res.recordingId;
        } catch (e) {
          setFailure({ action: { kind: "retry", reupload: true }, code: "upload", offline: e instanceof AudioUploadError && e.isNetwork });
          setPhase("failed");
          return;
        }
      }
      sent.metadata ??= buildMetadata(take.analysis, sent.sha, deviceLabel(navigator.userAgent), sent.sayariId);
      const result = await submitRecording(mission.mission_id, sent.metadata);
      if (result.ok) {
        onSaved();
        reload();
        setPhase("saved");
        return;
      }
      const action = submitFailureAction(result, { uploaded: sent.uploaded });
      if (action.kind === "rerecord") {
        recordAgain();
        setRejectReason(action.reason);
        return;
      }
      setFailure({ action, code: result.code });
      setPhase("failed");
    } finally {
      busyRef.current = false;
    }
  }

  function leave(e: React.MouseEvent) {
    if ((take || phase === "recording") && !window.confirm(t("leaveConfirm"))) e.preventDefault();
  }

  const next = phase === "saved" ? nextTodo(missions, mission.mission_id) : null;
  const heading = (key: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-slate-900 outline-none">
      {t(key)}
    </h2>
  );
  const linkClass = "inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 px-5 text-base font-semibold text-slate-800";
  const errorText = (code: CampaignErrorCode) => tc(`errors.${ERROR_KEY[code]}`);

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status" aria-live="polite">
        {t(`status.${phase}`)}
      </p>
      {phase !== "saved" ? <RecordPrompt mission={mission} /> : null}

      {rejectReason && phase === "idle" ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t(`rejected.${rejectReason}`)}
        </p>
      ) : null}
      {micError && phase === "idle" ? (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {micError}
        </p>
      ) : null}

      {phase === "idle" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          {heading(take || rejectReason ? "recordAgain" : "ready")}
          <p className="text-center text-sm text-slate-600">{timed ? t("hint.timed", { min: minS }) : t("hint.read")}</p>
          <button type="button" onClick={onStart} aria-label={t("start")} className="flex size-24 items-center justify-center rounded-full bg-record-idle text-base font-bold text-white shadow-lg">
            {t("start")}
          </button>
        </div>
      ) : null}

      {phase === "countdown" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          {heading("countdown")}
          <p aria-hidden className="text-6xl font-bold text-slate-900">
            {Math.max(count, 1)}
          </p>
          <button type="button" onClick={cancelCountdown} className="min-h-12 rounded-full border border-slate-300 px-5 text-base font-semibold text-slate-800">
            {t("cancel")}
          </button>
        </div>
      ) : null}

      {phase === "recording" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          {heading("recording")}
          <p role="timer" className="text-4xl font-bold tabular-nums text-record-active">
            {formatClock(elapsed)}
            {maxS != null ? <span className="text-xl font-semibold text-slate-500"> / {formatClock(maxS)}</span> : null}
          </p>
          {maxS != null ? (
            <div role="progressbar" aria-label={t("progress")} aria-valuemin={0} aria-valuemax={maxS} aria-valuenow={Math.min(Math.floor(elapsed), maxS)} className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-record-active" style={{ width: `${Math.min(100, (elapsed / maxS) * 100)}%` }} />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void onStop()}
            disabled={!canStop(mission.type, elapsed, minS)}
            aria-describedby="stop-hint"
            className="flex size-24 items-center justify-center rounded-full bg-record-active text-base font-bold text-white shadow-lg disabled:opacity-40"
          >
            {t("stop")}
          </button>
          <p id="stop-hint" className="text-center text-sm text-slate-600">
            {canStop(mission.type, elapsed, minS) ? t("hint.canStop") : t("hint.tooEarly", { min: minS })}
          </p>
        </div>
      ) : null}

      {phase === "analyzing" ? (
        <div className="py-4 text-center">{heading("analyzing")}</div>
      ) : null}

      {phase === "problem" && problem ? (
        <div className="flex flex-col gap-3">
          {heading("problem.title")}
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
            {t(problemMessageKey(problem), { min: rules.durationMinS, max: rules.durationMaxS })}
          </p>
          <button type="button" onClick={recordAgain} className="min-h-12 rounded-full bg-primary px-5 text-base font-semibold text-white">
            {t("recordAgain")}
          </button>
        </div>
      ) : null}

      {phase === "review" && take ? (
        <div className="flex flex-col gap-3">
          {heading("review.title")}
          <TakeReview blob={take.blob} durationS={take.analysis.duration_s} busy={false} onRecordAgain={recordAgain} onSubmit={() => void onSubmit()} />
        </div>
      ) : null}

      {phase === "submitting" && take ? (
        <div className="flex flex-col gap-3">
          {heading("review.submitting")}
          <TakeReview blob={take.blob} durationS={take.analysis.duration_s} busy onRecordAgain={recordAgain} onSubmit={() => {}} />
        </div>
      ) : null}

      {phase === "failed" && failure ? (
        <div className="flex flex-col gap-3">
          {heading("failed.title")}
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-base text-red-900">
            {failure.code === "upload" ? (failure.offline ? tc("errors.network") : t("failed.upload")) : failure.action.kind === "already" ? tc("errors.alreadySubmitted") : errorText(failure.code)}
          </p>
          {failure.action.kind === "retry" ? (
            <>
              <p className="text-sm text-slate-600">{failure.action.reupload ? t("failed.willUpload") : t("failed.alreadyUploaded")}</p>
              <button type="button" onClick={() => void onSubmit()} className="min-h-12 rounded-full bg-primary px-5 text-base font-semibold text-white">
                {tc("retry")}
              </button>
              <button type="button" onClick={recordAgain} className="min-h-12 rounded-full border border-slate-300 px-5 text-base font-semibold text-slate-800">
                {t("recordAgain")}
              </button>
            </>
          ) : null}
          {failure.action.kind === "signin" ? (
            <Link href="/campaign" className={linkClass}>
              {t("signInAgain")}
            </Link>
          ) : null}
          {failure.action.kind === "hub" || failure.action.kind === "already" ? (
            <Link href={hubHref} className={linkClass}>
              {t("backToMissions")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {phase === "saved" ? (
        <div className="flex flex-col gap-3 py-2">
          {heading("saved.title")}
          <p className="text-base text-slate-700">{t("saved.body", { code: mission.code })}</p>
          {next ? (
            <Link href={`${hubHref}/record/${next.mission_id}`} className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-5 text-base font-semibold text-white">
              {t("saved.next")}
            </Link>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-base font-semibold text-slate-800">{t("saved.allDone")}</p>
          )}
          <Link href={hubHref} className={linkClass}>
            {t("backToMissions")}
          </Link>
        </div>
      ) : null}

      {phase !== "saved" && phase !== "failed" ? (
        <Link href={hubHref} onClick={leave} className="self-start py-3 text-sm font-semibold text-slate-600 underline">
          {t("backToMissions")}
        </Link>
      ) : null}
    </div>
  );
}
