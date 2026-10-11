"use client";

import { useTranslations } from "next-intl";
import { useCampaignMissions } from "@/lib/campaign/hooks";
import { isRetryable } from "@/lib/campaign/errors";
import { groupMissions, percentDone } from "@/lib/campaign/mission-list";
import type { Mission } from "@/lib/campaign/types";
import { useFailureText } from "./CampaignHubParts";
import { MissionRow } from "./MissionRow";

type Props = { campaignId: string; readOnly: boolean };

export function MissionList({ campaignId, readOnly }: Props) {
  const t = useTranslations("campaign.flow.missions");
  const tc = useTranslations("campaign.common");
  const res = useCampaignMissions(campaignId);
  const failureText = useFailureText();

  if (res.state === "error") {
    return (
      <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">{t("loadError")}</p>
        <p>{failureText(res.error)}</p>
        {isRetryable(res.error.code) ? <button type="button" onClick={res.reload} className="min-h-11 rounded-lg border border-red-300 px-3 font-semibold">{tc("retry")}</button> : null}
      </div>
    );
  }
  if (res.state !== "ready") return <p role="status" className="text-sm text-slate-500">{tc("loading")}</p>;

  const { missions, rewards } = res.data;
  const g = groupMissions(missions);
  const done = g.done.length;
  const pct = percentDone({ total: missions.length, submitted: done, accepted: 0 });

  const section = (id: string, title: string, list: Mission[]) =>
    list.length ? (
      <section aria-labelledby={`g-${id}`} className="space-y-2">
        <h3 id={`g-${id}`} className="text-base font-bold text-slate-900">{title} <span className="font-normal text-slate-500">({list.length})</span></h3>
        <ul className="space-y-2">{list.map((m) => <MissionRow key={m.mission_id} campaignId={campaignId} mission={m} readOnly={readOnly} />)}</ul>
      </section>
    ) : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">{t("title")}</h2>
      {missions.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-bold">{t("emptyTitle")}</p>
          <p>{t("emptyBody")}</p>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-800">{t("progress", { done, total: missions.length })}</p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("progress", { done, total: missions.length })} className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-slate-600">{t("accepted", { n: rewards.accepted })}</p>
        </div>
      )}
      {!readOnly && missions.length > 0 && g.toRecord.length + g.toRedo.length === 0 ? <p className="text-sm text-slate-700">{t("allDone")}</p> : null}
      {section("redo", t("toRedo"), g.toRedo)}
      {section("todo", t("toRecord"), g.toRecord)}
      {section("done", t("done"), g.done)}
    </div>
  );
}
