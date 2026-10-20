"use client";

/**
 * A campaign's missions in four tabs: to record, to redo, in review, accepted. A mission that
 * can be recorded opens the studio on it; takes still on the phone show their sending state.
 */

import { AlertTriangle, CheckCircle2, ChevronRight, Hourglass, MessagesSquare, Mic, MessageCircle, BookOpen, UploadCloud, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { isRetryable } from "@/lib/campaign/errors";
import { truncate } from "@/lib/campaign/mission-list";
import { missionsInOutbox, type OutboxState } from "@/lib/campaign/outbox-logic";
import { useOutbox } from "@/lib/campaign/outbox-client";
import { canRecordNow } from "@/lib/campaign/studio-flow";
import type { Mission, SpeechType } from "@/lib/campaign/types";
import { useCampaignMissions, useCampaignSession } from "@/lib/campaign/hooks";
import { useLiveMissions } from "@/lib/campaign/pool-client";
import { useFailureText, useRejectionText } from "./CampaignHubParts";
import { LeaseLeft } from "./PoolParts";

type Tab = "todo" | "redo" | "sent" | "accepted";
const TYPE_ICON: Record<SpeechType, typeof BookOpen> = { read: BookOpen, spontaneous: MessageCircle, conversational: MessagesSquare };

export function tabOf(m: Mission, local: OutboxState | undefined): Tab {
  if (m.status === "accepted") return "accepted";
  if (m.status === "submitted") return "sent";
  // A take waiting on the phone counts as sent for the speaker (a failed one still needs them).
  if (local && local !== "failed") return "sent";
  return m.status === "rejected" ? "redo" : "todo";
}

type Props = { campaignId: string; readOnly: boolean };

export function MissionList({ campaignId, readOnly }: Props) {
  const t = useTranslations("campaign.home.hub");
  const tm = useTranslations("campaign.flow.missions");
  const tc = useTranslations("campaign.common");
  const res = useCampaignMissions(campaignId);
  const failureText = useFailureText();
  const session = useCampaignSession();
  const box = useOutbox();
  const userId = session.status === "signedIn" ? session.userId : null;
  const onPhone = useMemo(() => missionsInOutbox(box.items.filter((i) => i.userId === userId && i.campaignId === campaignId)), [box.items, userId, campaignId]);
  const [picked, setPicked] = useState<Tab | null>(null);
  // Pool missions whose lease ended are back in the pool: not listed, even from a saved copy.
  const live = useLiveMissions(res.state === "ready" ? res.data.missions : null);
  // A qualification test's sentences are shown in English or French and said in the speaker's language.
  const qualifying = res.state === "ready" && res.data.campaign?.kind === "qualification";
  // The test's language by name, as the studio says it ("Say this in Wolof"), not "your language" (L-20).
  const sayIn = qualifying && res.state === "ready" ? res.data.campaign.language.name : null;
  // Once a test is sent, a rejection is a result, not a request to record again.
  const stage = res.state === "ready" ? res.data.campaign?.qualification?.stage : undefined;
  const testClosed = qualifying && stage != null && stage !== "recording";

  const groups = useMemo(() => {
    const g: Record<Tab, Mission[]> = { todo: [], redo: [], sent: [], accepted: [] };
    if (live) for (const m of [...live].sort((a, b) => a.position - b.position)) g[tabOf(m, onPhone.get(m.mission_id))].push(m);
    return g;
  }, [live, onPhone]);

  if (res.state === "error") {
    return (
      <div role="alert" className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">{tm("loadError")}</p>
        <p>{failureText(res.error)}</p>
        {isRetryable(res.error.code) ? (
          <button type="button" onClick={res.reload} className="min-h-11 rounded-xl border border-red-300 px-3 font-semibold">
            {tc("retry")}
          </button>
        ) : null}
      </div>
    );
  }
  if (res.state !== "ready") return <MissionSkeleton />;

  // Open on the first tab with something in it (redo first: it was asked again).
  const tab: Tab = picked ?? (groups.redo.length ? "redo" : groups.todo.length ? "todo" : groups.sent.length ? "sent" : "accepted");
  const tabs: Tab[] = ["todo", "redo", "sent", "accepted"];
  const list = groups[tab];

  return (
    <section className="space-y-3">
      <div role="tablist" aria-label={tm("title")} className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-200/70 p-1">
        {tabs.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            aria-controls="mission-panel"
            onClick={() => setPicked(k)}
            className={`flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[11px] leading-tight font-bold ${tab === k ? "bg-white text-primary shadow-sm" : "text-slate-600"}`}
          >
            <span className="text-base font-black tabular-nums">{groups[k].length}</span>
            {testClosed && k === "redo" ? t("tabs.notAccepted") : t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <ul id="mission-panel" role="tabpanel" className="space-y-2">
        {list.length === 0 ? <li className="rounded-2xl bg-white p-5 text-center text-sm text-slate-600">{t(`empty.${tab}`)}</li> : null}
        {list.map((m) => (
          <MissionRow key={m.mission_id} campaignId={campaignId} mission={m} local={onPhone.get(m.mission_id)} active={box.activeId != null && box.items.some((i) => i.id === box.activeId && i.missionId === m.mission_id)} readOnly={readOnly || testClosed} qualifying={qualifying} testClosed={testClosed} sayIn={sayIn} />
        ))}
      </ul>
    </section>
  );
}

function MissionRow({ campaignId, mission: m, local, active, readOnly, qualifying = false, testClosed = false, sayIn = null }: { campaignId: string; mission: Mission; local: OutboxState | undefined; active: boolean; readOnly: boolean; qualifying?: boolean; testClosed?: boolean; sayIn?: string | null }) {
  const t = useTranslations("campaign.home");
  const tm = useTranslations("campaign.flow.missions");
  const why = useRejectionText()(m.rejection_reason);
  const Icon = TYPE_ICON[m.type];
  const recordable = !readOnly && canRecordNow(m, local ? new Map([[m.mission_id, local]]) : new Map());
  const partnerWait = m.type === "conversational" && !m.partner_ready && (m.status === "todo" || m.status === "rejected");

  let status: React.ReactNode = null;
  if (local && local !== "failed") status = <Badge tone="blue" icon={<UploadCloud size={12} aria-hidden />}>{active ? t("outbox.state.sending") : t(`outbox.state.${local}`)}</Badge>;
  else if (local === "failed") status = <Badge tone="red" icon={<AlertTriangle size={12} aria-hidden />}>{t("outbox.state.failed")}</Badge>;
  else if (m.status === "accepted") status = <Badge tone="green" icon={<CheckCircle2 size={12} aria-hidden />}>{t("history.status.accepted")}</Badge>;
  else if (m.status === "submitted") status = <Badge tone="slate" icon={<Hourglass size={12} aria-hidden />}>{t("history.status.submitted")}</Badge>;

  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono font-semibold">#{m.position}</span>
          <span>{qualifying && m.type === "read" ? (sayIn ? tm("types.sayIn", { language: sayIn }) : tm("types.say")) : tm(`types.${m.type}`)}</span>
          {m.duration_s.min != null && m.duration_s.max != null ? <span>{tm("duration", { min: m.duration_s.min, max: m.duration_s.max })}</span> : null}
        </span>
        <span className="block text-sm font-semibold text-slate-900">{truncate(m.prompt.text_or_topic, 110)}</span>
        {m.status === "rejected" && !local ? <span className="mt-1 block text-xs font-semibold text-amber-800">{testClosed ? tm("notAccepted", { reason: why ?? "" }) : why ? tm("reason", { reason: why }) : tm("noReason")}</span> : null}
        {!local ? <LeaseLeft mission={m} /> : null}
        {partnerWait ? (
          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
            <Users size={12} aria-hidden /> {t("hub.partnerWait")}
          </span>
        ) : null}
        {status ? <span className="mt-1.5 flex">{status}</span> : null}
      </span>
      {recordable ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-submit text-white">
          <Mic size={18} aria-hidden />
        </span>
      ) : null}
    </>
  );

  return (
    <li>
      {recordable ? (
        <Link href={`/campaign/${campaignId}/studio?m=${encodeURIComponent(m.mission_id)}`} aria-label={`${m.status === "rejected" ? tm("redo") : tm("record")}: ${truncate(m.prompt.text_or_topic, 60)}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
          {body}
          <ChevronRight size={18} className="sr-only" aria-hidden />
        </Link>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">{body}</div>
      )}
    </li>
  );
}

function Badge({ tone, icon, children }: { tone: "blue" | "red" | "green" | "slate"; icon: React.ReactNode; children: React.ReactNode }) {
  const c = { blue: "bg-primary/10 text-primary", red: "bg-red-50 text-red-700", green: "bg-emerald-50 text-emerald-800", slate: "bg-slate-100 text-slate-700" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{icon}{children}</span>;
}

export function MissionSkeleton() {
  return (
    <div aria-hidden className="space-y-2">
      <div className="h-14 animate-pulse rounded-2xl bg-slate-200" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-white" />
      ))}
    </div>
  );
}
