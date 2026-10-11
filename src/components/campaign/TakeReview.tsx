"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { formatClock } from "@/lib/campaign/record-flow";

type Props = { blob: Blob; durationS: number; busy: boolean; onRecordAgain: () => void; onSubmit: () => void };

/** Listen back to the take, then record again or submit. Never submits by itself. */
export function TakeReview({ blob, durationS, busy, onRecordAgain, onSubmit }: Props) {
  const t = useTranslations("campaign.record");
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    if (audioRef.current) audioRef.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  return (
    <div className="flex flex-col gap-4">
      <audio ref={audioRef} controls className="w-full" aria-label={t("review.player")} />
      <p className="text-sm text-slate-600">{t("review.duration", { time: formatClock(durationS) })}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={onRecordAgain} disabled={busy} className="min-h-12 flex-1 rounded-full border border-slate-300 px-5 text-base font-semibold text-slate-800 disabled:opacity-50">
          {t("recordAgain")}
        </button>
        <button type="button" onClick={onSubmit} disabled={busy} className="min-h-12 flex-1 rounded-full bg-primary px-5 text-base font-semibold text-white disabled:opacity-50">
          {busy ? t("review.submitting") : t("review.submit")}
        </button>
      </div>
    </div>
  );
}
