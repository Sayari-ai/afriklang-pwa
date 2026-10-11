"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { acceptedPercent, chipFor, type ChipTone } from "@/lib/campaign/claim-flow";
import type { CampaignCard } from "@/lib/campaign/types";

const TONE: Record<ChipTone, string> = {
  action: "bg-blue-50 text-blue-900",
  warn: "bg-amber-50 text-amber-900",
  muted: "bg-slate-100 text-slate-700",
  good: "bg-emerald-50 text-emerald-900",
};

export function CampaignCardView({ card }: { card: CampaignCard }) {
  const t = useTranslations("campaign.claim.card");
  const locale = useLocale();
  const chip = chipFor(card.next_step);
  const { progress } = card;
  const percent = acceptedPercent(progress);
  const deadline = card.deadline ? new Date(card.deadline) : null;
  const deadlineText = deadline && !Number.isNaN(deadline.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(deadline) : null;
  const topic = [card.topic.domain, card.topic.sub_domain].filter(Boolean).join(" / ");
  const counts = [
    ["todo", progress.todo],
    ["submitted", progress.submitted],
    ["accepted", progress.accepted],
    ["rejected", progress.rejected],
  ] as const;

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">{card.title}</h2>
          <p className="text-xs text-slate-500">{t("code", { code: card.code })}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${TONE[chip.tone]}`}>{t(`chip.${chip.key}`)}</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">{t("language")}</dt>
        <dd className="text-slate-900">{card.language.name}</dd>
        {topic ? (
          <>
            <dt className="text-slate-500">{t("topic")}</dt>
            <dd className="text-slate-900">{topic}</dd>
          </>
        ) : null}
      </dl>
      {deadlineText ? <p className="text-sm font-medium text-slate-800">{t("deadline", { date: deadlineText })}</p> : null}

      <div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("progress", { accepted: progress.accepted, total: progress.total })} className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-sm text-slate-700">{t("progress", { accepted: progress.accepted, total: progress.total })}</p>
        <ul className="mt-2 grid grid-cols-4 gap-1 text-center">
          {counts.map(([key, n]) => (
            <li key={key} className="rounded-lg bg-slate-50 px-1 py-1.5">
              <span className="block text-base font-bold text-slate-900">{n}</span>
              <span className="block text-[11px] leading-tight text-slate-600">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link href={`/campaign/${card.campaign_id}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">
        {t("open")}
      </Link>
    </article>
  );
}
