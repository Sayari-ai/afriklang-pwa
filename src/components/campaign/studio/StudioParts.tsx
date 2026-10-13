"use client";

/** Presentational pieces of the recording studio. */

import { Mic, Minus, Pause, Play, Plus, Square, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type RefObject } from "react";
import { TEXT_SIZES } from "@/lib/campaign/studio-flow";
import type { Mission } from "@/lib/campaign/types";
import { useRejectionText } from "../CampaignHubParts";

// ── Prompt ───────────────────────────────────────────────────────────────

export function PromptCard({ mission, lang, size, onSize }: { mission: Mission; lang: string; size: number; onSize: (n: number) => void }) {
  const t = useTranslations("campaign.studio");
  const why = useRejectionText()(mission.rejection_reason);
  const { min, max } = mission.duration_s;
  const text = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, size))];
  return (
    <section aria-label={t(`prompt.${mission.type}`)} className="relative rounded-3xl bg-white p-5 text-slate-900 shadow-[0_12px_40px_rgba(0,20,60,0.35)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">{t(`prompt.${mission.type}`)}</p>
        <div className="flex items-center gap-1" role="group" aria-label={t("textSize")}>
          <button type="button" onClick={() => onSize(size - 1)} disabled={size <= 0} aria-label={t("textSmaller")} className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-40">
            <Minus size={16} aria-hidden />
          </button>
          <button type="button" onClick={() => onSize(size + 1)} disabled={size >= TEXT_SIZES.length - 1} aria-label={t("textBigger")} className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-40">
            <Plus size={16} aria-hidden />
          </button>
        </div>
      </div>
      {mission.status === "rejected" ? (
        <p role="note" className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          {why ? t("prompt.redoReason", { reason: why }) : t("prompt.redo")}
        </p>
      ) : null}
      <p lang={lang} className={`${text} font-semibold leading-snug ${mission.type === "read" ? "" : "text-slate-800"}`}>
        {mission.prompt.text_or_topic}
      </p>
      {mission.type === "conversational" ? (
        <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
          {mission.partner_speaker_id ? (
            <p className="flex items-center gap-2 font-semibold">
              <Users size={16} aria-hidden /> {t("prompt.partner", { id: mission.partner_speaker_id })}
            </p>
          ) : null}
          <p>{t("prompt.onePhone")}</p>
        </div>
      ) : null}
      {mission.type !== "read" && min != null && max != null ? <p className="mt-3 text-sm font-medium text-slate-500">{t("prompt.length", { min, max })}</p> : null}
    </section>
  );
}

// ── Record button with a live level ring ─────────────────────────────────

type ButtonMode = "record" | "countdown" | "recording" | "busy";

/**
 * The big round button. While recording, a ring around it breathes with the voice (read from
 * `levelRef` on each animation frame, so React does not re-render 60 times a second).
 * Green when the voice is loud enough, amber when too quiet.
 */
export function RecordButton({
  mode,
  count,
  disabled,
  onPress,
  levelRef,
  minLevelDbfs,
  progress,
  label,
  describedBy,
}: {
  mode: ButtonMode;
  count?: number;
  disabled?: boolean;
  onPress: () => void;
  levelRef: RefObject<number>;
  minLevelDbfs: number;
  /** 0..1 of the allowed length, drawn as an arc. */
  progress: number | null;
  label: string;
  /** The id of the text saying why the button does nothing yet (it stays focusable: APP-027). */
  describedBy?: string;
}) {
  const ringRef = useRef<HTMLDivElement>(null);
  const live = mode === "recording";

  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const draw = () => {
      const db = levelRef.current ?? -100;
      // -60 dBFS → 0, -10 dBFS → 1
      const k = Math.max(0, Math.min(1, (db + 60) / 50));
      const el = ringRef.current;
      if (el) {
        el.style.transform = `scale(${1 + k * 0.45})`;
        el.style.opacity = String(0.25 + k * 0.6);
        el.style.backgroundColor = db >= minLevelDbfs ? "rgba(102,187,106,0.55)" : "rgba(255,192,46,0.55)";
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [live, levelRef, minLevelDbfs]);

  const R = 62;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative grid size-40 place-items-center">
      {live ? <div ref={ringRef} aria-hidden className="absolute inset-4 rounded-full transition-[transform,opacity] duration-75" /> : null}
      {progress != null ? (
        <svg aria-hidden viewBox="0 0 140 140" className="absolute inset-0 -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6" />
          <circle cx="70" cy="70" r={R} fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, progress))} />
        </svg>
      ) : null}
      <button
        type="button"
        onClick={() => !disabled && onPress()}
        aria-disabled={disabled || undefined}
        aria-describedby={describedBy}
        aria-label={label}
        className={`relative grid size-28 place-items-center rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-transform active:scale-95 aria-disabled:opacity-50 ${
          mode === "recording" ? "bg-record-active" : mode === "countdown" ? "bg-white/15 ring-2 ring-white/60" : "bg-white"
        }`}
      >
        {mode === "record" ? <Mic size={44} strokeWidth={2.4} className="text-record-active" aria-hidden /> : null}
        {mode === "recording" ? <Square size={36} fill="white" className="text-white" aria-hidden /> : null}
        {mode === "countdown" ? <span aria-hidden className="text-5xl font-black text-white tabular-nums">{count}</span> : null}
        {mode === "busy" ? <span aria-hidden className="size-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" /> : null}
      </button>
    </div>
  );
}

// ── Review: waveform + play ──────────────────────────────────────────────

export function TakePlayer({ blob, peaks, durationS }: { blob: Blob; peaks: number[]; durationS: number }) {
  const t = useTranslations("campaign.studio.review");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const a = audioRef.current;
    if (a) a.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) setPos(durationS > 0 ? a.currentTime / durationS : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationS]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else a.pause();
  };

  const max = Math.max(0.05, ...peaks);
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-white/10 p-3 backdrop-blur">
      <audio ref={audioRef} preload="auto" onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }} className="hidden" />
      <button type="button" onClick={toggle} aria-label={playing ? t("pause") : t("play")} className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-primary shadow">
        {playing ? <Pause size={26} fill="currentColor" aria-hidden /> : <Play size={26} fill="currentColor" className="translate-x-0.5" aria-hidden />}
      </button>
      <div aria-hidden className="flex h-14 flex-1 items-center gap-[2px]">
        {peaks.map((p, i) => (
          <span key={i} className={`flex-1 rounded-full ${i / peaks.length <= pos ? "bg-white" : "bg-white/40"}`} style={{ height: `${Math.max(6, (p / max) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

// ── Session progress dots ────────────────────────────────────────────────

export function SessionBar({ count, goal }: { count: number; goal: number | null }) {
  const t = useTranslations("campaign.studio");
  if (!goal) return <p className="text-sm font-semibold text-white/80">{t("session", { n: count })}</p>;
  const pct = Math.min(100, (count / goal) * 100);
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-xs font-semibold text-white/80">
        <span>{t("sessionGoal", { n: count, goal })}</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(count, goal)} aria-label={t("sessionGoal", { n: count, goal })} className="h-2 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-yellow transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A burst of confetti for celebrations (pure CSS; skipped when the user prefers less motion). */
export function Confetti() {
  const colors = ["#ffc02e", "#66bb6a", "#2196f3", "#e53935", "#ffffff"];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="afk-confetti absolute top-[-10px] block h-3 w-2 rounded-sm"
          style={{ left: `${(i * 37) % 100}%`, backgroundColor: colors[i % colors.length], animationDelay: `${(i % 7) * 0.12}s`, animationDuration: `${1.8 + (i % 5) * 0.3}s` }}
        />
      ))}
    </div>
  );
}
