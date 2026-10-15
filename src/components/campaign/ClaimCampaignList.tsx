"use client";

/**
 * The speaker's home. Campaigns with missions assigned to them, each with a direct way in.
 * Campaigns without missions are not shown: a speaker with nothing to record sees their history
 * instead.
 */

import { CheckCircle2, Flame, Hourglass } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCampaignList, useCampaignSession } from "@/lib/campaign/hooks";
import type { CampaignList } from "@/lib/campaign/api";
import { useOutbox } from "@/lib/campaign/outbox-client";
import { streakDays } from "@/lib/campaign/activity";
import { totalPaidTime } from "@/lib/campaign/pool";
import { hasMissions, totals } from "@/lib/campaign/view";
import { ActivityTimeline, useActivity } from "./ActivityTimeline";
import { CampaignCardView } from "./CampaignCardView";
import { useFailureText } from "./CampaignHubParts";
import { ClaimNotLinked, ClaimSpinner } from "./ClaimNotice";
import { OutboxPanel } from "./OutboxPanel";
import { isQualification } from "@/lib/campaign/types";
import { useTimeText } from "./PoolParts";

export function ClaimCampaignList() {
  const t = useTranslations("campaign.claim.home");
  const failureText = useFailureText();
  const common = useTranslations("campaign.common");
  const list = useCampaignList();

  if (list.state === "ready") return <Home data={list.data} />;
  if (list.state === "error") {
    if (list.error.code === "not_linked") return <ClaimNotLinked />;
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("errorTitle")}</h1>
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
          {failureText(list.error)}
        </p>
        <button type="button" onClick={list.reload} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white">
          {common("retry")}
        </button>
      </section>
    );
  }
  return <ClaimSpinner title={t("loadingList")} />;
}

function Home({ data }: { data: CampaignList }) {
  const t = useTranslations("campaign.home.home");
  const session = useCampaignSession();
  const userId = session.status === "signedIn" ? session.userId : null;
  const box = useOutbox();
  const activity = useActivity(userId);
  const withMissions = data.campaigns.filter(hasMissions);
  // The qualification test is not paid work: the stats count collection campaigns only.
  const collection = data.campaigns.filter((c) => !isQualification(c));
  const sum = totals(collection);
  // Speakers are paid per hour of accepted audio: show time when the dashboard sends it, counts otherwise.
  const paid = totalPaidTime(collection);
  const time = useTimeText();
  const streak = streakDays(activity);
  const waitingFor = (campaignId: string) => box.items.filter((i) => i.campaignId === campaignId && i.userId === userId).length;
  const waitingOkFor = (campaignId: string) => box.items.filter((i) => i.campaignId === campaignId && i.userId === userId && i.state !== "failed").length;

  // The qualification test first, then campaigns that need the speaker: ready to record, then setup, then the rest.
  const rank = (c: (typeof withMissions)[number]) => (isQualification(c) ? -1 : c.next_step === "ready" ? 0 : c.next_step === "paused" || c.next_step === "closed" ? 2 : 1);
  const ordered = [...withMissions].sort((a, b) => rank(a) - rank(b));

  return (
    <>
      <section className="rounded-3xl bg-gradient-to-br from-primary to-[#003a70] p-5 text-white shadow-md">
        <h1 className="text-2xl font-black">{t("hello")}</h1>
        <p className="text-sm text-white/85">{t("intro")}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {paid ? (
            <>
              <Stat icon={<CheckCircle2 size={18} aria-hidden />} value={time(paid.acceptedS)} label={t("stats.acceptedTime")} small />
              <Stat icon={<Hourglass size={18} aria-hidden />} value={time(paid.pendingS)} label={t("stats.inReviewTime")} small />
            </>
          ) : (
            <>
              <Stat icon={<CheckCircle2 size={18} aria-hidden />} value={sum.accepted} label={t("stats.accepted")} />
              <Stat icon={<Hourglass size={18} aria-hidden />} value={sum.submitted} label={t("stats.inReview")} />
            </>
          )}
          <Stat icon={<Flame size={18} aria-hidden className="text-yellow" />} value={streak} label={t("stats.streak", { n: streak })} />
        </dl>
      </section>

      <OutboxPanel compact />

      {ordered.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-black text-slate-900">{t("yourMissions")}</h2>
          {ordered.map((card) => (
            <CampaignCardView key={card.assignment_id} card={card} waiting={waitingFor(card.campaign_id)} waitingOk={waitingOkFor(card.campaign_id)} />
          ))}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div role="status" className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <p className="text-lg font-black text-slate-900">{t("noMissionsTitle")}</p>
            <p className="mt-1 text-sm text-slate-600">{t("noMissionsBody")}</p>
          </div>
          {userId ? (
            <>
              <h2 className="text-lg font-black text-slate-900">{t("recent")}</h2>
              <ActivityTimeline userId={userId} limit={6} />
            </>
          ) : null}
          <Link href="/campaign/history" className="flex min-h-12 items-center justify-center rounded-2xl bg-primary px-4 font-bold text-white">
            {t("seeHistory")}
          </Link>
        </section>
      )}
    </>
  );
}

function Stat({ icon, value, label, small = false }: { icon: React.ReactNode; value: number | string; label: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/10 px-2 py-3">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className={`flex items-center justify-center gap-1 font-black tabular-nums ${small ? "text-base leading-7" : "text-2xl"}`}>
          {icon}
          {value}
        </span>
        <span aria-hidden className="block text-[11px] leading-tight font-semibold text-white/80">{label}</span>
      </dd>
    </div>
  );
}
