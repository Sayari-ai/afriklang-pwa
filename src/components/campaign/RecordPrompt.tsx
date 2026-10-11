"use client";

import { useTranslations } from "next-intl";
import type { Mission } from "@/lib/campaign/types";

/** What the contributor has to say, by speech type, plus the mission facts. */
export function RecordPrompt({ mission }: { mission: Mission }) {
  const t = useTranslations("campaign.record");
  const { min, max } = mission.duration_s;
  return (
    <section aria-label={t("prompt.label")} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t(`type.${mission.type}`)} · {mission.code}
      </p>
      {mission.type === "read" ? <p className="text-xl leading-relaxed text-slate-900 sm:text-2xl">{mission.prompt.text_or_topic}</p> : null}
      {mission.type === "spontaneous" ? (
        <>
          <p className="text-sm text-slate-600">{t("prompt.spontaneous")}</p>
          <p className="text-xl font-semibold leading-snug text-slate-900">{mission.prompt.text_or_topic}</p>
        </>
      ) : null}
      {mission.type === "conversational" ? (
        <>
          <p className="text-sm text-slate-600">{t("prompt.conversationalScenario")}</p>
          <p className="text-xl font-semibold leading-snug text-slate-900">{mission.prompt.text_or_topic}</p>
          {mission.partner_speaker_id ? <p className="text-sm text-slate-700">{t("prompt.partner", { id: mission.partner_speaker_id })}</p> : null}
          <p className="rounded-xl bg-white p-3 text-sm text-slate-700">{t("prompt.onePhone")}</p>
        </>
      ) : null}
      {mission.type !== "read" && (min != null || max != null) ? (
        <p className="text-sm text-slate-600">{t("prompt.duration", { min: min ?? 0, max: max ?? 0 })}</p>
      ) : null}
      {mission.status === "rejected" ? (
        <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {mission.rejection_reason ? t("prompt.rejectedWithReason", { reason: mission.rejection_reason }) : t("prompt.rejected")}
        </p>
      ) : null}
    </section>
  );
}
