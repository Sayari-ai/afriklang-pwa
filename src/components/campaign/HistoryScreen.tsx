"use client";

/**
 * Everything the speaker has done: totals, takes still on the phone, each campaign's recordings
 * with their review result, and the recent activity on this phone.
 */

import { AlertTriangle, CheckCircle2, Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useCampaignList, useCampaignMissions, useCampaignSession } from "@/lib/campaign/hooks";
import { truncate } from "@/lib/campaign/mission-list";
import type { CampaignCard, Mission } from "@/lib/campaign/types";
import { totalPaidTime } from "@/lib/campaign/pool";
import { totals } from "@/lib/campaign/view";
import { ActivityTimeline } from "./ActivityTimeline";
import { LanguageBadge } from "./CampaignCardView";
import { buttonPrimary, useFailureText, useRejectionText } from "./CampaignHubParts";
import { ClaimNotLinked, ClaimSpinner } from "./ClaimNotice";
import { MissionSkeleton } from "./MissionList";
import { OutboxPanel } from "./OutboxPanel";
import { SignInCard } from "./SignInCard";
import { useTimeText } from "./PoolParts";

type Filter = "all" | "accepted" | "review" | "redo";
const MATCH: Record<Filter, (m: Mission) => boolean> = {
  all: (m) => m.status !== "todo",
  accepted: (m) => m.status === "accepted",
  review: (m) => m.status === "submitted",
  redo: (m) => m.status === "rejected",
};

export function HistoryScreen() {
  const t = useTranslations("campaign.home.history");
  const tc = useTranslations("campaign.common");
  const session = useCampaignSession();
  const list = useCampaignList();
  const [filter, setFilter] = useState<Filter>("all");
  const time = useTimeText();
  const failureText = useFailureText();

  if (list.state === "error" && list.error.code === "not_linked") return <ClaimNotLinked />;
  // Signed out (the "My history" shortcut opens here too) or a failed load: say so, never spin for ever (APP-017).
  if (list.state === "signedOut" || session.status === "signedOut") return <SignInCard hasInvitation={false} />;
  if (list.state === "error") {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-black">{t("title")}</h1>
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
          {failureText(list.error)}
        </p>
        <button type="button" onClick={list.reload} className={buttonPrimary}>
          {tc("retry")}
        </button>
      </section>
    );
  }
  if (list.state !== "ready" || session.status !== "signedIn") return <ClaimSpinner title={tc("loading")} />;

  const cards = list.data.campaigns;
  const sum = totals(cards);
  const paid = totalPaidTime(cards);
  // The bridge lists missions only once both consents are signed.
  const readable = cards.filter((c) => c.progress.total > 0 && ["ready", "paused", "closed"].includes(c.next_step) && c.progress.total - c.progress.todo > 0);

  return (
    <>
      <header>
        <h1 className="text-2xl font-black">{t("title")}</h1>
        <p className="text-sm text-slate-600">{t("intro")}</p>
      </header>
      <dl className="grid grid-cols-4 gap-2 text-center">
        {(
          [
            ["recorded", sum.submitted + sum.accepted + sum.rejected, "text-slate-900"],
            ["accepted", sum.accepted, "text-emerald-700"],
            ["inReview", sum.submitted, "text-primary"],
            ["toRedo", sum.rejected, "text-amber-700"],
          ] as const
        ).map(([k, n, color]) => (
          <div key={k} className="rounded-2xl bg-white px-1 py-3 ring-1 ring-slate-200">
            <dd className={`text-2xl font-black tabular-nums ${color}`}>{n}</dd>
            <dt className="text-[11px] leading-tight font-semibold text-slate-600">{t(`stats.${k}`)}</dt>
          </div>
        ))}
      </dl>
      {paid ? <p className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">{t("paid", { accepted: time(paid.acceptedS), pending: time(paid.pendingS) })}</p> : null}

      <OutboxPanel />

      <section className="space-y-3">
        <h2 className="text-lg font-black">{t("recordings")}</h2>
        {readable.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-slate-600">{t("nothingYet")}</p>
        ) : (
          <>
            <div role="radiogroup" aria-label={t("recordings")} className="flex gap-2 overflow-x-auto pb-1">
              {(["all", "accepted", "review", "redo"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${filter === f ? "bg-primary text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
                  {t(`filters.${f}`)}
                </button>
              ))}
            </div>
            {readable.map((c) => (
              <CampaignRecordings key={c.campaign_id} card={c} filter={filter} />
            ))}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">{t("timeline")}</h2>
        <ActivityTimeline userId={session.userId} limit={60} />
      </section>
    </>
  );
}

function CampaignRecordings({ card, filter }: { card: CampaignCard; filter: Filter }) {
  const t = useTranslations("campaign.home.history");
  const rejectionText = useRejectionText();
  const res = useCampaignMissions(card.campaign_id);
  if (res.state === "error") return <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">{t("loadError")}</p>;
  if (res.state !== "ready") return <MissionSkeleton />;
  const shown = res.data.missions.filter(MATCH[filter]).sort((a, b) => a.position - b.position);

  return (
    <article className="rounded-3xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-3">
        <LanguageBadge code={card.language.code} className="size-10 text-xs" />
        <div className="min-w-0">
          <h3 className="truncate font-black">{card.title}</h3>
          <p className="text-xs text-slate-500">{card.language.name}</p>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((m) => (
            <li key={m.mission_id} className="flex items-start gap-3 py-2.5">
              {m.status === "accepted" ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              ) : m.status === "rejected" ? (
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
              ) : (
                <Hourglass size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">{truncate(m.prompt.text_or_topic, 90)}</p>
                <p className="text-xs text-slate-500">
                  <span className="font-mono">#{m.position}</span> · {t(`status.${m.status as "submitted" | "accepted" | "rejected"}`)}
                  {m.status === "rejected" && rejectionText(m.rejection_reason) ? ` · ${rejectionText(m.rejection_reason)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
