"use client";

/**
 * Pieces for pool campaigns (the speaker draws leased batches) and for pay per hour. Planned
 * campaigns use only the paid-time pieces.
 */

import { Clock, Coins, Loader2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useMinuteClock, type PoolState } from "@/lib/campaign/pool-client";
import { LEASE_URGENT_MS, earliestLease, elsewhereOf, hoursLeft, isRefusal, paidTime, timeParts } from "@/lib/campaign/pool";
import type { CampaignCard, Mission, PoolStatus } from "@/lib/campaign/types";
import { Notice, buttonPrimary, buttonSecondary, useFailureText } from "./CampaignHubParts";
import { isRetryable } from "@/lib/campaign/errors";

/** Seconds as "1 h 5 min" / "12 min" / "under 1 min", in the speaker's language. */
export function useTimeText() {
  const t = useTranslations("campaign.common.time");
  return (seconds: number) => {
    const p = timeParts(seconds);
    return p.key === "hm" ? t("hm", { h: p.h, m: p.m }) : p.key === "m" ? t("m", { m: p.m }) : t("underMinute");
  };
}

/** Accepted and in-review audio time for one campaign. Nothing when the dashboard does not send it yet. */
export function PaidTime({ card }: { card: Pick<CampaignCard, "rewards"> }) {
  const t = useTranslations("campaign.common.paid");
  const time = useTimeText();
  const paid = paidTime(card.rewards);
  if (!paid) return null;
  return (
    <section aria-label={t("help")} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("accepted")}</dt>
          <dd className="flex items-center gap-1.5 text-xl font-black text-emerald-700 tabular-nums">
            <Coins size={18} aria-hidden /> {time(paid.acceptedS)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("pending")}</dt>
          <dd className="text-xl font-black text-primary tabular-nums">{time(paid.pendingS)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-600">{t("help")}</p>
    </section>
  );
}

/** "Record these by Tue 15 Oct, 10:00": when the first lease of the batch ends. Urgent under a day. */
export function LeaseNotice({ missions }: { missions: readonly Mission[] }) {
  const t = useTranslations("campaign.common.pool");
  const locale = useLocale();
  const now = useMinuteClock(true, true);
  const end = earliestLease(missions, now);
  if (end == null) return null;
  const urgent = end - now < LEASE_URGENT_MS;
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(end));
  return (
    <p className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${urgent ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
      <Clock size={18} className="mt-0.5 shrink-0" aria-hidden />
      <span>{urgent ? t("leaseSoon", { n: hoursLeft(end, now) }) : t("leaseUntil", { date })}</span>
    </p>
  );
}

/** Hours left on one mission's lease, only when it ends within a day. */
export function LeaseLeft({ mission }: { mission: Pick<Mission, "status" | "lease_until"> }) {
  const t = useTranslations("campaign.common.pool");
  const now = useMinuteClock(Boolean(mission.lease_until), true);
  if (mission.status !== "todo" && mission.status !== "rejected") return null;
  const end = mission.lease_until ? Date.parse(mission.lease_until) : Number.NaN;
  if (!Number.isFinite(end) || end <= now || end - now >= LEASE_URGENT_MS) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
      <Clock size={12} aria-hidden /> {t("leaseRow", { n: hoursLeft(end, now) })}
    </span>
  );
}

/** Why a draw added nothing (cell full, cap, hold), and the speaker's other campaigns that still need them. */
export function PoolRefusal({ status, campaignId, elsewhere, dark = false }: { status: Exclude<PoolStatus, "ok">; campaignId: string; elsewhere: Parameters<typeof elsewhereOf>[0]; dark?: boolean }) {
  const t = useTranslations("campaign.common.pool");
  const others = elsewhereOf(elsewhere, campaignId);
  const links = others.length ? (
    <div className="space-y-2">
      <p className="font-semibold">{t("elsewhere")}</p>
      <ul className="space-y-2">
        {others.map((o) => (
          <li key={o.campaign_id}>
            <Link href={`/campaign/${o.campaign_id}`} className={dark ? "flex min-h-12 items-center justify-center rounded-2xl bg-white px-4 font-bold text-primary" : buttonPrimary}>
              {o.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  if (dark) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-2xl font-black">{t(`status.${status}.title`)}</h2>
        <p className="text-base text-white/85">{t(`status.${status}.body`)}</p>
        {links}
      </div>
    );
  }
  return (
    <Notice title={t(`status.${status}.title`)} tone="warn">
      <p>{t(`status.${status}.body`)}</p>
      {links}
    </Notice>
  );
}

/**
 * The pool part of a campaign page: the batch's lease, a draw in progress or failed, a refusal,
 * or "get more" once the batch is recorded.
 */
export function PoolPanel({ card, missions, state }: { card: CampaignCard; missions: readonly Mission[]; state: PoolState }) {
  const t = useTranslations("campaign.common.pool");
  const tc = useTranslations("campaign.common");
  const status = state.memo?.last.status;
  const refused = isRefusal(status) ? status : null;
  const drawCode = state.memo?.last.code ?? null;
  const failureText = useFailureText();
  return (
    <div className="space-y-3">
      {state.drawing ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
          <Loader2 size={18} className="animate-spin" aria-hidden /> {t("drawing")}
        </p>
      ) : null}
      {refused ? <PoolRefusal status={refused} campaignId={card.campaign_id} elsewhere={state.memo?.pool} /> : null}
      <LeaseNotice missions={missions} />
      {!state.drawing && status === "clock" ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {t("clockWrong")}
        </p>
      ) : null}
      {!state.drawing && state.drawFailed ? (
        <div role="alert" className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {/* A refusal (campaign paused or closed, consent missing…) says so; only a failed call asks to check the connection. */}
          <p>{drawCode && !isRetryable(drawCode) ? failureText({ code: drawCode, message: "" }) : t("drawFailed")}</p>
          {!drawCode || isRetryable(drawCode) ? (
            <button type="button" onClick={() => void state.drawNow()} className="min-h-11 rounded-xl border border-red-300 px-3 font-semibold">
              {tc("retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {!state.drawing && !state.drawFailed && !refused && state.open === 0 && card.next_step === "ready" ? (
        <div className="space-y-2 rounded-2xl bg-white p-4 text-sm text-slate-700 ring-1 ring-slate-200">
          <p>{t("batchDone")}</p>
          <button type="button" onClick={() => void state.drawNow()} className={buttonPrimary}>
            {t("getMore")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Give back the open missions the speaker will not record (frees them for others at once). */
export function GiveBack({ state }: { state: PoolState }) {
  const t = useTranslations("campaign.common.pool");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const n = state.returnable.length;
  if (!state.pool || (n === 0 && !result)) return null;
  async function go() {
    if (!window.confirm(t("giveBackConfirm", { n }))) return;
    setBusy(true);
    setResult(null);
    const returned = await state.giveBackOpen();
    setBusy(false);
    setResult(returned == null ? t("giveBackFailed") : t("givenBack", { n: returned }));
  }
  return (
    <div className="space-y-2 border-t border-slate-200 pt-3">
      {n > 0 ? (
        <>
          <button type="button" onClick={() => void go()} disabled={busy} className={buttonSecondary}>
            {t("giveBack")}
          </button>
          <p className="text-xs text-slate-600">{t("giveBackHelp")}</p>
        </>
      ) : null}
      {result ? <p role="status" className="text-sm font-semibold text-slate-700">{result}</p> : null}
    </div>
  );
}
