"use client";

/**
 * One campaign on the home screen. The main button goes where the speaker should go next:
 * straight into the studio when they can record, or to the setup step that is missing.
 */

import { AlertTriangle, CalendarClock, ChevronRight, Coins, Mic, PauseCircle, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { isPool, isRefusal, paidTime } from "@/lib/campaign/pool";
import { usePoolMemo } from "@/lib/campaign/pool-client";
import type { CampaignCard } from "@/lib/campaign/types";
import { daysLeft, openCountOnPhone, setupStep } from "@/lib/campaign/view";
import { useTimeText } from "./PoolParts";

export function ProgressRing({ value, total, size = 64 }: { value: number; total: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="transition-[stroke-dashoffset] duration-700" />
    </svg>
  );
}

export function LanguageBadge({ code, className = "" }: { code: string; className?: string }) {
  return <span className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-sm font-black uppercase tracking-wide text-white ${className}`}>{code.slice(0, 3)}</span>;
}

/** `waiting`: takes of the campaign on the phone; `waitingOk`: those not failed (they no longer count as to record). */
export function CampaignCardView({ card, waiting, waitingOk = 0 }: { card: CampaignCard; waiting: number; waitingOk?: number }) {
  const t = useTranslations("campaign.home.card");
  const { progress } = card;
  const done = progress.submitted + progress.accepted;
  const open = openCountOnPhone(card, waitingOk);
  const days = daysLeft(card.deadline);
  const step = setupStep(card.next_step);
  const hub = `/campaign/${card.campaign_id}`;
  const topic = [card.topic.domain, card.topic.sub_domain].filter(Boolean).join(" · ");
  const pool = isPool(card);
  const memo = usePoolMemo(card.campaign_id);
  const time = useTimeText();
  const paid = paidTime(card.rewards);

  let cta: { href: string; label: string; tone: "go" | "setup" | "warn" | "quiet" };
  if (card.next_step === "ready" && open > 0) cta = { href: `${hub}/studio`, label: done > 0 ? t("continue", { n: open }) : t("start"), tone: "go" };
  // Pool: an empty batch is filled when the studio opens, unless the last draw was refused.
  else if (card.next_step === "ready" && pool) cta = isRefusal(memo?.last.status) ? { href: hub, label: t("noNewMissions"), tone: "quiet" } : { href: `${hub}/studio`, label: t("getMissions"), tone: "go" };
  else if (card.next_step === "ready") cta = { href: hub, label: t("allSent"), tone: "quiet" };
  else if (card.next_step === "blocked") cta = { href: hub, label: t("blocked"), tone: "warn" };
  else if (step) cta = { href: hub, label: t("setup"), tone: "setup" };
  else cta = { href: hub, label: t("view"), tone: "quiet" };

  const ctaClass = {
    go: "bg-submit text-white shadow-[0_6px_0_var(--color-primary-deep)] active:translate-y-0.5 active:shadow-[0_3px_0_var(--color-primary-deep)]",
    setup: "bg-primary text-white",
    warn: "bg-amber-100 text-amber-900",
    quiet: "bg-slate-100 text-slate-700",
  }[cta.tone];

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
      <Link href={hub} className="flex items-start gap-3 p-4 pb-3">
        <LanguageBadge code={card.language.code} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">{card.language.name}</p>
          <h2 className="text-lg leading-tight font-black text-slate-900">{card.title}</h2>
          {topic ? <p className="truncate text-sm text-slate-600">{topic}</p> : null}
        </div>
        <ChevronRight size={20} className="mt-1 shrink-0 text-slate-400" aria-label={t("details")} />
      </Link>

      <div className="flex items-center gap-4 px-4 pb-3">
        <div className="relative text-submit">
          <ProgressRing value={done} total={progress.total} />
          {/* A pool campaign has no fixed total (it grows with each batch): show the count, not a share. */}
          <span className="absolute inset-0 grid place-items-center text-sm font-black text-slate-900">{pool ? done : `${progress.total ? Math.round((done / progress.total) * 100) : 0}%`}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-bold text-slate-900">{pool ? t("sent", { n: done }) : t("recorded", { done, total: progress.total })}</p>
          <div className="flex flex-wrap gap-1.5">
            {paid && paid.acceptedS > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                <Coins size={12} aria-hidden /> {t("paid", { time: time(paid.acceptedS) })}
              </span>
            ) : null}
            {days != null ? (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${days <= 3 && days >= 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                <CalendarClock size={12} aria-hidden /> {days < 0 ? t("ended") : t("daysLeft", { n: days })}
              </span>
            ) : null}
            {progress.rejected > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                <AlertTriangle size={12} aria-hidden /> {t("redo", { n: progress.rejected })}
              </span>
            ) : null}
            {card.next_step === "paused" || card.next_step === "closed" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <PauseCircle size={12} aria-hidden /> {t(card.next_step)}
              </span>
            ) : null}
            {waiting > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                <UploadCloud size={12} aria-hidden /> {t("waiting", { n: waiting })}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <Link href={cta.href} className={`flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-black transition ${ctaClass}`}>
          {cta.tone === "go" ? <Mic size={20} aria-hidden /> : null}
          {cta.label}
        </Link>
        {step ? <p className="mt-2 text-center text-xs font-semibold text-slate-500">{t("setupStep", { n: step })}</p> : null}
      </div>
    </article>
  );
}
