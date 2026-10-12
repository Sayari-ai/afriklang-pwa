"use client";

/**
 * One campaign. Before recording: a three-step setup (profile, account consent, campaign
 * consent). Then: one big button into the studio, the recording tips, and the missions.
 */

import { ArrowLeft, Check, Ear, Hand, Mic, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { logActivity } from "@/lib/campaign/activity";
import { isRetryable } from "@/lib/campaign/errors";
import { useCampaignList, useCampaignSession } from "@/lib/campaign/hooks";
import type { CampaignCard, ContributorView } from "@/lib/campaign/types";
import { daysLeft, hasMissions, openCount, setupStep } from "@/lib/campaign/view";
import { LanguageBadge, ProgressRing } from "./CampaignCardView";
import { BackToList, FailureMessage, Notice, buttonSecondary } from "./CampaignHubParts";
import { ConsentStep } from "./ConsentStep";
import { Instructions } from "./Instructions";
import { MissionList, MissionSkeleton } from "./MissionList";
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
  const step = setupStep(card.next_step);
  const done = card.progress.submitted + card.progress.accepted;
  const days = daysLeft(card.deadline);
  const open = openCount(card);

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
          <h1 className="text-xl leading-tight font-black">{card.title}</h1>
          <p className="text-sm text-slate-600">
            {[card.topic.domain, card.topic.sub_domain].filter(Boolean).join(" · ")}
            {days != null ? ` · ${days < 0 ? t("card.ended") : t("card.daysLeft", { n: days })}` : ""}
          </p>
        </div>
        <div className="relative shrink-0 text-submit">
          <ProgressRing value={done} total={card.progress.total} size={56} />
          <span className="absolute inset-0 grid place-items-center text-[11px] font-black text-slate-900">
            {done}/{card.progress.total}
          </span>
        </div>
      </header>

      {step ? <Stepper current={step} /> : null}

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

      {card.next_step === "ready" ? (
        <>
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
          ) : (
            <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              <Check size={18} aria-hidden /> {t("hub.allRecorded")}
            </p>
          )}
          <Tips card={card} />
          <MissionList campaignId={card.campaign_id} readOnly={false} />
          <details className="group rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <summary className="cursor-pointer list-none text-sm font-bold text-slate-700">{t("hub.more")}</summary>
            <div className="mt-3">
              <Instructions card={card} onWithdrawn={after("withdrawn")} />
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
