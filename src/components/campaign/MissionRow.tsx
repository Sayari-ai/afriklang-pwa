"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { truncate } from "@/lib/campaign/mission-list";
import type { Mission } from "@/lib/campaign/types";

type Props = { campaignId: string; mission: Mission; readOnly: boolean };

export function MissionRow({ campaignId, mission: m, readOnly }: Props) {
  const t = useTranslations("campaign.flow.missions");
  const actionable = m.status === "todo" || m.status === "rejected";
  const waiting = m.type === "conversational" && !m.partner_ready;
  const { min, max } = m.duration_s;
  const duration = min != null && max != null ? t("duration", { min, max }) : max != null ? t("durationMax", { max }) : null;
  const waitId = `wait-${m.mission_id}`;

  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-semibold text-slate-700">{m.code}</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{t(`types.${m.type}`)}</span>
        {duration ? <span className="text-slate-500">{duration}</span> : null}
        {!actionable ? <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{t(`status.${m.status as "submitted" | "accepted"}`)}</span> : null}
      </div>
      <p className="text-sm text-slate-800">{truncate(m.prompt.text_or_topic)}</p>
      {m.status === "rejected" ? (
        <p role="note" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {m.rejection_reason ? t("reason", { reason: m.rejection_reason }) : t("noReason")}
        </p>
      ) : null}
      {m.type === "conversational" && m.partner_speaker_id ? <p className="text-xs text-slate-500">{t("partner", { id: m.partner_speaker_id })}</p> : null}
      {actionable && !readOnly ? (
        <>
          {waiting ? <p id={waitId} className="text-sm text-amber-800">{t("partnerWait")}</p> : null}
          {waiting ? (
            <button type="button" disabled aria-describedby={waitId} className="min-h-12 w-full rounded-xl bg-slate-200 px-4 text-base font-bold text-slate-500">
              {t("record")}
            </button>
          ) : (
            <Link href={`/campaign/${campaignId}/record/${m.mission_id}`} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-bold text-white">
              {m.status === "rejected" ? t("redo") : t("record")}
            </Link>
          )}
        </>
      ) : null}
    </li>
  );
}
