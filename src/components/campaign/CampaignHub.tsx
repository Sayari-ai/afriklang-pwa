"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useCampaignList } from "@/lib/campaign/hooks";
import { isRetryable } from "@/lib/campaign/errors";
import type { CampaignCard, ContributorView } from "@/lib/campaign/types";
import { BackToList, FailureMessage, Notice, buttonSecondary } from "./CampaignHubParts";
import { ConsentStep } from "./ConsentStep";
import { Instructions } from "./Instructions";
import { MissionList } from "./MissionList";
import { ProfileForm } from "./ProfileForm";

export function CampaignHub({ campaignId }: { campaignId: string }) {
  const t = useTranslations("campaign.flow.hub");
  const tc = useTranslations("campaign.common");
  const list = useCampaignList();

  if (list.state === "waiting" || list.state === "loading") return <p role="status" className="text-sm text-slate-500">{tc("loading")}</p>;
  if (list.state === "signedOut") {
    return (
      <div className="space-y-3">
        <p>{t("signedOut")}</p>
        <BackToList />
      </div>
    );
  }
  if (list.state === "error") {
    return (
      <div className="space-y-3">
        <FailureMessage failure={list.error} />
        {isRetryable(list.error.code) ? <button type="button" onClick={list.reload} className={buttonSecondary}>{tc("retry")}</button> : null}
        <BackToList />
      </div>
    );
  }

  if (list.state !== "ready") return null;
  const { contributor, campaigns } = list.data;
  const card = campaigns.find((c) => c.campaign_id === campaignId);
  if (!card) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">{t("notFoundTitle")}</h1>
        <p className="text-slate-700">{t("notFoundBody")}</p>
        <BackToList />
      </div>
    );
  }
  return <Hub card={card} contributor={contributor} reload={list.reload} />;
}

function Hub({ card, contributor, reload }: { card: CampaignCard; contributor: ContributorView; reload: () => void }) {
  const t = useTranslations("campaign.flow.hub");
  const tp = useTranslations("campaign.flow.profile");
  const tb = useTranslations("campaign.flow.blocked");
  const [correcting, setCorrecting] = useState(false);
  const topic = card.topic.sub_domain ? `${card.topic.domain}, ${card.topic.sub_domain}` : card.topic.domain;

  let body;
  switch (card.next_step) {
    case "profile":
      body = <ProfileForm card={card} contributor={contributor} onSaved={reload} />;
      break;
    case "blocked":
      // blocked_reason is for staff; the contributor gets the translated message only.
      body = correcting ? (
        <ProfileForm card={card} contributor={contributor} onSaved={reload} heading={tp("correctTitle")} />
      ) : (
        <div className="space-y-3">
          <Notice title={tb("title")} tone="warn"><p>{tb("body")}</p><p>{tb("fix")}</p></Notice>
          <button type="button" onClick={() => setCorrecting(true)} className={buttonSecondary}>{tp("correctTitle")}</button>
        </div>
      );
      break;
    case "account_consent":
      body = <ConsentStep type="account" card={card} onSigned={reload} />;
      break;
    case "campaign_consent":
      body = <ConsentStep type="campaign" card={card} onSigned={reload} />;
      break;
    case "paused":
    case "closed":
      body = (
        <div className="space-y-4">
          <Notice title={t(card.next_step === "paused" ? "pausedTitle" : "closedTitle")} tone="warn">
            <p>{t(card.next_step)}</p>
          </Notice>
          <MissionList campaignId={card.campaign_id} readOnly />
        </div>
      );
      break;
    default:
      body = (
        <div className="space-y-5">
          <Instructions card={card} onWithdrawn={reload} />
          <MissionList campaignId={card.campaign_id} readOnly={false} />
        </div>
      );
  }

  return (
    <div className="space-y-5">
      <BackToList />
      <header className="space-y-0.5">
        <p className="font-mono text-xs text-slate-500">{card.code}</p>
        <p className="text-lg font-bold text-slate-900">{card.title}</p>
        <p className="text-sm text-slate-600">{t("topic", { topic })}{card.deadline ? ` · ${t("deadline", { date: card.deadline })}` : ""}</p>
      </header>
      {body}
    </div>
  );
}
