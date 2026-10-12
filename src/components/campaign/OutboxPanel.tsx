"use client";

/**
 * What is waiting on this phone to be sent. `compact`: one line for the home screen;
 * otherwise each take with its state and actions (History).
 */

import { AlertTriangle, CloudOff, Loader2, PauseCircle, Send, Trash2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCampaignSession } from "@/lib/campaign/hooks";
import { outbox, useOutbox } from "@/lib/campaign/outbox-client";
import { outboxReasonKey } from "@/lib/campaign/view";
import { useOnline } from "./CampaignShell";

export function OutboxPanel({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("campaign.home.outbox");
  const session = useCampaignSession();
  const box = useOutbox();
  const online = useOnline();
  const userId = session.status === "signedIn" ? session.userId : null;
  const items = box.items.filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  if (!userId || items.length === 0) return null;

  const pending = items.filter((i) => i.state === "pending");
  const held = items.filter((i) => i.state === "held");
  const failed = items.filter((i) => i.state === "failed");
  const sending = box.activeId !== null;

  const headline = sending ? t("sending") : pending.length ? t("waiting", { n: pending.length }) : held.length ? t("held", { n: held.length }) : t("failed", { n: failed.length });
  const sub = !online ? t("offline") : failed.length && !pending.length && !held.length ? null : t("retrying");
  const tone = failed.length && !pending.length ? "border-red-200 bg-red-50 text-red-900" : !online ? "border-amber-200 bg-amber-50 text-amber-900" : "border-primary/20 bg-white text-slate-900";
  const Icon = sending ? Loader2 : !online ? CloudOff : failed.length && !pending.length ? AlertTriangle : UploadCloud;

  return (
    <section aria-live="polite" className={`rounded-2xl border p-3 shadow-sm ${tone}`}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon size={20} className={sending ? "animate-spin" : ""} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{headline}</p>
          {sub ? <p className="text-xs opacity-80">{sub}</p> : null}
        </div>
        {online && (pending.length || held.length) && !sending ? (
          <button type="button" onClick={() => void outbox.retryNow(userId)} className="flex min-h-10 items-center gap-1 rounded-full bg-primary px-3 text-xs font-bold text-white">
            <Send size={14} aria-hidden /> {t("sendNow")}
          </button>
        ) : null}
      </div>
      {compact ? null : (
        <ul className="mt-3 space-y-2">
          {items.map((i) => {
            const state = box.activeId === i.id ? "sending" : i.state;
            return (
              <li key={i.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800">
                {state === "held" ? <PauseCircle size={16} className="shrink-0 text-amber-600" aria-hidden /> : state === "failed" ? <AlertTriangle size={16} className="shrink-0 text-red-600" aria-hidden /> : <UploadCloud size={16} className="shrink-0 text-primary" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-semibold">{i.missionCode}</p>
                  <p className="text-xs text-slate-600">
                    {t(`state.${state}`)}
                    {(state === "held" || state === "failed") && i.lastCode ? ` · ${t(`reason.${outboxReasonKey(i.lastCode)}`)}` : ""}
                  </p>
                </div>
                {state === "failed" ? (
                  <>
                    <Link href={`/campaign/${i.campaignId}/studio?m=${encodeURIComponent(i.missionId)}`} className="min-h-9 rounded-full bg-primary px-3 py-2 text-xs font-bold text-white">
                      {t("recordAgain")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => window.confirm(t("discardConfirm")) && void outbox.discard(i.id)}
                      aria-label={t("discard")}
                      className="grid size-9 place-items-center rounded-full text-red-700 hover:bg-red-50"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
