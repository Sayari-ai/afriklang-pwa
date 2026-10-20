"use client";

/**
 * One campaign. Before recording: a three-step setup (profile, account consent, campaign
 * consent). Then: one big button into the studio, the recording tips, and the missions.
 */

import { ArrowLeft, Check, Ear, Hand, Mic, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { logActivity } from "@/lib/campaign/activity";
import { isRetryable } from "@/lib/campaign/errors";
import { useCampaignList, useCampaignMissions, useCampaignSession } from "@/lib/campaign/hooks";
import { useLiveMissions, usePool } from "@/lib/campaign/pool-client";
import { isQualification, type CampaignCard, type ContributorView } from "@/lib/campaign/types";
import { missionsInOutbox } from "@/lib/campaign/outbox-logic";
import { useOutbox } from "@/lib/campaign/outbox-client";
import { daysLeft, hasMissions, openCountOnPhone, setupStep, toRecordCount } from "@/lib/campaign/view";
import { OutboxPanel } from "./OutboxPanel";
import { LanguageBadge, ProgressRing, useQualificationText } from "./CampaignCardView";
import { BackToList, FailureMessage, Notice, buttonSecondary } from "./CampaignHubParts";
import { ConsentStep } from "./ConsentStep";
import { Instructions } from "./Instructions";
import { MissionList, MissionSkeleton } from "./MissionList";
import { GiveBack, PaidTime, PoolPanel } from "./PoolParts";
import { ProfileForm } from "./ProfileForm";

export function CampaignHub({ campaignId }: { campaignId: string }) {
  const t = useTranslations("campaign.flow.hub");
  const tc = useTranslations("campaign.common");
  const list = useCampaignList();

  if (list.state === "waiting" || list.state === "loading") return <MissionSkeleton />;
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
  // A campaign without missions for this speaker is not shown (they see their history instead).
  if (!card || !hasMissions(card)) {
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
  const t = useTranslations("campaign.home");
  const tf = useTranslations("campaign.flow");
  const session = useCampaignSession();
  const userId = session.status === "signedIn" ? session.userId : null;
  const [correcting, setCorrecting] = useState(false);
  /** After a withdrawal: how many takes of the campaign were deleted from the phone. */
  const [withdrawn, setWithdrawn] = useState<number | null>(null);
  const step = setupStep(card.next_step);
  const qualifying = isQualification(card);
  // A qualification test that is being reviewed or decided takes no recording: a sentence says where it stands.
  const testStatus = useQualificationText()(card);
  const done = card.progress.submitted + card.progress.accepted;
  const days = daysLeft(card.deadline);
  // Pool campaigns: the batch (lapsed leases dropped) decides what is left, and a low batch is
  // topped up by itself when the speaker opens the campaign. Planned campaigns: the card's counts.
  const missionRes = useCampaignMissions(card.campaign_id, card.next_step === "ready");
  const live = useLiveMissions(missionRes.state === "ready" ? missionRes.data.missions : null);
  const pool = usePool(card, card.next_step === "ready" ? live : null, true);
  const box = useOutbox();
  const onPhone = useMemo(() => missionsInOutbox(box.items.filter((i) => i.userId === userId && i.campaignId === card.campaign_id)), [box.items, userId, card.campaign_id]);
  // The same count as the mission tabs: the list minus the takes waiting on the phone (MAN-004).
  const open = live ? toRecordCount(live, onPhone) : openCountOnPhone(card, [...onPhone.values()].filter((s) => s !== "failed").length);
  // Takes still on this phone: they go only while the app is open and online, so "all recorded"
  // must not read as "done" while they wait (N-4).
  const stillOnPhone = [...onPhone.values()].filter((s) => s !== "failed").length;
  // Conversational missions waiting for the partner's consent: not recordable yet (N-12).
  const waitingPartner = live ? live.filter((m) => (m.status === "todo" || m.status === "rejected") && m.type === "conversational" && !m.partner_ready && !onPhone.has(m.mission_id)).length : 0;

  const after = useCallback(
    (type: "profile" | "consent" | "withdrawn") => () => {
      if (userId) logActivity(userId, { type, campaignId: card.campaign_id });
      setCorrecting(false);
      reload();
    },
    [userId, card.campaign_id, reload],
  );

  return (
    <div className="space-y-4">
      <Link href="/campaign" className="inline-flex min-h-10 items-center gap-1 text-sm font-bold text-primary">
        <ArrowLeft size={16} aria-hidden /> {tf("hub.backToList")}
      </Link>

      <header className="flex items-center gap-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <LanguageBadge code={card.language.code} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">{card.language.name}</p>
          <h1 className="text-xl leading-tight font-black">{qualifying ? t("qualification.title") : card.title}</h1>
          {qualifying ? (
            card.qualification && card.qualification.attempt_no > 1 ? <p className="text-sm text-slate-600">{t("qualification.attempt", { n: card.qualification.attempt_no })}</p> : null
          ) : (
            <p className="text-sm text-slate-600">
              {[card.topic.domain, card.topic.sub_domain].filter(Boolean).join(" · ")}
              {days != null ? ` · ${days < 0 ? t("card.ended") : t("card.daysLeft", { n: days })}` : ""}
            </p>
          )}
        </div>
        <div className="relative shrink-0 text-submit">
          <ProgressRing value={done} total={card.progress.total} size={56} />
          <span className="absolute inset-0 grid place-items-center text-[11px] font-black text-slate-900">
            {done}/{card.progress.total}
          </span>
        </div>
      </header>

      {withdrawn !== null ? (
        <div role="status">
          <Notice title={tf("hub.withdrawnTitle")}>
            <p>{tf("hub.withdrawnDeleted", { n: withdrawn })}</p>
          </Notice>
        </div>
      ) : null}

      {step ? <Stepper current={step} /> : null}

      {!step && card.next_step !== "blocked" && !qualifying ? <PaidTime card={card} /> : null}
      {qualifying && !testStatus && card.next_step === "ready" ? <p className="rounded-2xl bg-primary/5 p-4 text-sm font-medium text-slate-800">{t("qualification.intro", { language: card.language.name })}</p> : null}

      {card.next_step === "profile" || (card.next_step === "blocked" && correcting) ? (
        <Panel>
          <ProfileForm card={card} contributor={contributor} onSaved={after("profile")} heading={card.next_step === "blocked" ? tf("profile.correctTitle") : undefined} />
        </Panel>
      ) : null}
      {card.next_step === "blocked" && !correcting ? (
        <div className="space-y-3">
          <Notice title={tf("blocked.title")} tone="warn">
            <p>{tf("blocked.body")}</p>
            <p>{tf("blocked.fix")}</p>
          </Notice>
          <button type="button" onClick={() => setCorrecting(true)} className={buttonSecondary}>
            {tf("profile.correctTitle")}
          </button>
        </div>
      ) : null}
      {card.next_step === "account_consent" ? (
        <Panel>
          <ConsentStep key="account" type="account" card={card} onSigned={after("consent")} />
        </Panel>
      ) : null}
      {card.next_step === "campaign_consent" ? (
        <Panel>
          <ConsentStep key="campaign" type="campaign" card={card} onSigned={after("consent")} />
        </Panel>
      ) : null}

      {card.next_step === "paused" || card.next_step === "closed" ? (
        <>
          <Notice title={tf(card.next_step === "paused" ? "hub.pausedTitle" : "hub.closedTitle")} tone="warn">
            <p>{tf(`hub.${card.next_step}`)}</p>
          </Notice>
          <MissionList campaignId={card.campaign_id} readOnly />
        </>
      ) : null}

      {card.next_step === "ready" && testStatus ? (
        <>
          <p role="status" className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-200">{testStatus}</p>
          <MissionList campaignId={card.campaign_id} readOnly />
        </>
      ) : null}

      {card.next_step === "ready" && !testStatus ? (
        <>
          {pool.pool ? <PoolPanel card={card} missions={live ?? []} state={pool} /> : null}
          {open > 0 ? (
            <Link
              href={`/campaign/${card.campaign_id}/studio`}
              className="flex items-center gap-4 rounded-3xl bg-submit p-4 text-white shadow-[0_6px_0_var(--color-primary-deep)] transition active:translate-y-0.5 active:shadow-[0_3px_0_var(--color-primary-deep)]"
            >
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-record-active">
                <Mic size={28} strokeWidth={2.5} aria-hidden />
              </span>
              <span>
                <span className="block text-xl font-black">{t("hub.start")}</span>
                <span className="block text-sm font-semibold text-white/90">{t("hub.toRecord", { n: open })}</span>
              </span>
            </Link>
          ) : pool.pool ? null : stillOnPhone > 0 ? (
            <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              {t("hub.allRecordedOnPhone", { n: stillOnPhone })}
            </p>
          ) : waitingPartner > 0 ? (
            <p role="status" className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-200">
              {t("hub.waitingPartner", { n: waitingPartner })}
            </p>
          ) : (
            <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              <Check size={18} aria-hidden /> {t(qualifying ? "hub.allRecordedTest" : "hub.allRecorded")}
            </p>
          )}
          {stillOnPhone > 0 ? <OutboxPanel compact /> : null}
          <Tips card={card} />
          <MissionList campaignId={card.campaign_id} readOnly={false} />
          <details className="group rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <summary className="cursor-pointer list-none text-sm font-bold text-slate-700">{t("hub.more")}</summary>
            <div className="mt-3 space-y-3">
              <Instructions
                card={card}
                onWithdrawn={(deleted) => {
                  setWithdrawn(deleted);
                  after("withdrawn")();
                }}
              />
              <GiveBack state={pool} />
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">{children}</div>;
}

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const t = useTranslations("campaign.home.hub");
  const steps = [t("steps.profile"), t("steps.account"), t("steps.campaign")];
  return (
    <nav aria-label={t("before")} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">{t("before")}</p>
      <ol className="flex items-start">
        {steps.map((label, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "next";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-1 text-center">
              {i > 0 ? <span aria-hidden className={`absolute top-[15px] right-1/2 -left-1/2 h-0.5 ${n <= current ? "bg-submit" : "bg-slate-200"}`} /> : null}
              <span className={`relative z-10 grid size-8 place-items-center rounded-full text-sm font-black ${state === "done" ? "bg-submit text-white" : state === "current" ? "bg-primary text-white ring-4 ring-primary/20" : "bg-slate-200 text-slate-500"}`}>
                {state === "done" ? <Check size={16} strokeWidth={3} aria-hidden /> : n}
              </span>
              <span className={`text-[11px] leading-tight font-semibold ${state === "current" ? "text-primary" : "text-slate-600"}`}>{label}</span>
              <span className="sr-only">{state === "done" ? t("done") : state === "current" ? t("current") : ""}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Tips({ card }: { card: CampaignCard }) {
  const t = useTranslations("campaign.home.hub.tips");
  const mic = card.instructions.recording.mic_distance_cm;
  const tips = [
    { Icon: VolumeX, text: t("quiet") },
    { Icon: Hand, text: mic?.min != null && mic?.max != null ? t("distance", { min: mic.min, max: mic.max }) : t("distanceDefault") },
    { Icon: Volume2, text: t("wait") },
    { Icon: Ear, text: t("listen") },
  ];
  return (
    <section aria-labelledby="tips-title">
      <h2 id="tips-title" className="mb-2 text-base font-black">{t("title")}</h2>
      <ul className="grid grid-cols-2 gap-2">
        {tips.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-2 rounded-2xl bg-white p-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
            <Icon size={18} className="shrink-0 text-primary" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}
