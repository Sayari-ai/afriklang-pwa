"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFailureText } from "@/components/campaign/CampaignHubParts";
import { RecordMission } from "@/components/campaign/RecordMission";
import { useCampaignList, useCampaignMissions } from "@/lib/campaign/hooks";
import { isRetryable } from "@/lib/campaign/errors";
import { guardMission } from "@/lib/campaign/record-flow";

const linkClass = "inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-5 text-base font-semibold text-white";

export default function RecordMissionPage() {
  const { id, missionId } = useParams<{ id: string; missionId: string }>();
  const t = useTranslations("campaign.record");
  const tc = useTranslations("campaign.common");
  const failureText = useFailureText();
  const missions = useCampaignMissions(id);
  const list = useCampaignList();
  // After a save the list reloads and the mission turns "submitted"; the success screen must stay.
  const [savedId, setSavedId] = useState<string | null>(null);

  const hub = (
    <Link href={`/campaign/${id}`} className={linkClass}>
      {t("backToMissions")}
    </Link>
  );

  if (missions.state === "signedOut" || list.state === "signedOut") {
    return (
      <div className="flex flex-col gap-3" role="alert">
        <p>{tc("errors.unauthorized")}</p>
        <Link href="/campaign" className={linkClass}>
          {t("signInAgain")}
        </Link>
      </div>
    );
  }
  const failed = missions.state === "error" ? missions : list.state === "error" ? list : null;
  if (failed) {
    return (
      <div className="flex flex-col gap-3" role="alert">
        <p>{failureText(failed.error)}</p>
        {isRetryable(failed.error.code) ? (
          <button type="button" onClick={failed.reload} className="min-h-12 rounded-full border border-slate-300 px-5 text-base font-semibold">
            {tc("retry")}
          </button>
        ) : null}
        {hub}
      </div>
    );
  }
  if (missions.state !== "ready" || list.state !== "ready") {
    return (
      <p role="status" className="text-slate-600">
        {tc("loading")}
      </p>
    );
  }

  const { campaign: card, missions: all } = missions.data;
  const mission = all.find((m) => m.mission_id === missionId);
  const speakerId = list.data.contributor.speaker_id;
  const reason = savedId === missionId ? null : guardMission(card, mission) ?? (speakerId ? null : "profile");

  if (reason || !mission || !speakerId) {
    const key = reason ?? "missing";
    return (
      <div className="flex flex-col gap-3" role="alert">
        <h1 className="text-lg font-bold">{t(`guard.${key}.title`)}</h1>
        <p className="text-slate-700">{t(`guard.${key}.body`)}</p>
        {hub}
      </div>
    );
  }

  return (
    <RecordMission
      key={mission.mission_id}
      campaignId={id}
      card={card}
      mission={mission}
      missions={all}
      speakerId={speakerId}
      dialect={list.data.contributor.profile.values?.variety ?? null}
      onSaved={() => setSavedId(mission.mission_id)}
      reload={missions.reload}
    />
  );
}
