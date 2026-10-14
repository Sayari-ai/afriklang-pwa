"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFailureText } from "@/components/campaign/CampaignHubParts";
import { Studio } from "@/components/campaign/studio/Studio";
import { isRetryable } from "@/lib/campaign/errors";
import { useCampaignList, useCampaignMissions, useCampaignSession } from "@/lib/campaign/hooks";
import { useLiveMissions, usePool } from "@/lib/campaign/pool-client";

const dark = "flex h-dvh flex-col items-center justify-center gap-4 bg-[#001b36] px-6 text-center text-white";
const pill = "inline-flex min-h-12 items-center justify-center rounded-2xl bg-white px-6 font-bold text-primary";

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("campaign.studio");
  const tc = useTranslations("campaign.common");
  const failureText = useFailureText();
  const session = useCampaignSession();
  const list = useCampaignList();
  const missions = useCampaignMissions(id);
  // Read once: which mission the studio opens on (the address is then kept up to date by the studio).
  const [startId] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("m")));
  // Online, the studio opens on a fresh mission list (its order is fixed when it opens); offline, on the
  // saved copy. Once open, it stays open through later refreshes.
  const [opened, setOpened] = useState(false);
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  // Pool campaigns: missions whose lease ended are not recorded, and a low batch is topped up, by
  // itself, before the studio opens (and again while recording, as the batch runs low).
  const live = useLiveMissions(missions.state === "ready" ? missions.data.missions : null);
  const cardNow = (list.state === "ready" ? list.data.campaigns.find((c) => c.campaign_id === id) : null) ?? (missions.state === "ready" ? missions.data.campaign : null);
  const pool = usePool(cardNow, cardNow?.next_step === "ready" ? live : null, true);
  // On a slow network do not keep the speaker waiting for the fresh list: after 3 s the saved copy
  // opens, and the fresh list merges in when it comes (APP-034).
  const [waitedEnough, setWaitedEnough] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaitedEnough(true), 3000);
    return () => clearTimeout(t);
  }, []);
  const stale = !opened && !waitedEnough && missions.state === "ready" && online && (missions.saved || missions.refreshing) && !missions.failure;
  const filling = !opened && pool.pool && pool.pending;
  if (!opened && missions.state === "ready" && !stale && !filling) setOpened(true);
  const back = (
    <Link href={`/campaign/${id}`} className={pill}>
      {t("guard.back")}
    </Link>
  );

  if (list.state === "signedOut" || missions.state === "signedOut") {
    return (
      <div className={dark} role="alert">
        <p>{tc("errors.unauthorized")}</p>
        <Link href="/campaign" className={pill}>{tc("continue")}</Link>
      </div>
    );
  }
  const failed = missions.state === "error" ? missions : list.state === "error" ? list : null;
  if (failed) {
    return (
      <div className={dark} role="alert">
        <p>{failureText(failed.error)}</p>
        {isRetryable(failed.error.code) ? (
          <button type="button" onClick={failed.reload} className="min-h-12 rounded-2xl border border-white/40 px-6 font-semibold">
            {tc("retry")}
          </button>
        ) : null}
        {back}
      </div>
    );
  }
  if (list.state !== "ready" || missions.state !== "ready" || session.status !== "signedIn" || stale || filling) {
    return (
      <div className={dark} role="status">
        <span aria-hidden className="size-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        <p className="text-white/80">{filling ? tc("pool.drawing") : tc("loading")}</p>
      </div>
    );
  }

  const card = list.data.campaigns.find((c) => c.campaign_id === id) ?? missions.data.campaign;
  const speakerId = list.data.contributor.speaker_id;
  const guard =
    card.next_step === "paused" ? "paused"
    : card.next_step === "closed" ? "closed"
    : card.next_step !== "ready" || !speakerId ? "notReady"
    // A qualification test takes recordings only while it is recording (then it is being reviewed).
    : card.kind === "qualification" && card.qualification && card.qualification.stage !== "recording" ? "testClosed"
    : null;
  if (guard) {
    return (
      <div className={dark} role="alert">
        <h1 className="text-2xl font-black">{t(`guard.${guard}.title`)}</h1>
        <p className="text-white/80">{t(`guard.${guard}.body`)}</p>
        {back}
      </div>
    );
  }

  return (
    <Studio
      campaignId={id}
      card={card}
      missions={live ?? missions.data.missions}
      userId={session.userId}
      speakerId={speakerId!}
      contributor={list.data.contributor}
      startId={startId}
      pool={pool.pool ? pool : null}
    />
  );
}
