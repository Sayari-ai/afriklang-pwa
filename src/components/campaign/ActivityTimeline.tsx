"use client";

/** The speaker's recent activity on this phone, grouped by day. */

import { AlertTriangle, CheckCircle2, FileSignature, LogOut, UploadCloud, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { byDay, readActivity, subscribeActivity, type Activity, type ActivityType } from "@/lib/campaign/activity";
import { rejectDetailOf } from "@/lib/campaign/reject-detail";
import { rejectionReasonCode } from "@/lib/campaign/view";
import { useRejectDetailText } from "./CampaignHubParts";

const ICON: Record<ActivityType, typeof CheckCircle2> = {
  sent: UploadCloud,
  rejected: AlertTriangle,
  failed: AlertTriangle,
  profile: UserRound,
  consent: FileSignature,
  withdrawn: LogOut,
};

const EMPTY: Activity[] = [];

export function useActivity(userId: string | null): Activity[] {
  return useSyncExternalStore(
    subscribeActivity,
    () => (userId ? readActivity(userId) : EMPTY),
    () => EMPTY,
  );
}

export function ActivityTimeline({ userId, limit }: { userId: string; limit?: number }) {
  const t = useTranslations("campaign.home.history");
  const format = useFormatter();
  const detailText = useRejectDetailText();
  const all = useActivity(userId);
  const list = limit ? all.slice(0, limit) : all;
  if (!list.length) return <p className="rounded-2xl bg-white p-4 text-sm text-slate-600">{t("noActivity")}</p>;

  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const label = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.toDateString() === today.toDateString()) return t("today");
    if (date.toDateString() === yesterday.toDateString()) return t("yesterday");
    return format.dateTime(date, { weekday: "long", day: "numeric", month: "long" });
  };
  /** The line, and for a refused take with a measured detail, the sentence saying what was measured. */
  const text = (a: Activity): { line: string; measured: string | null } => {
    const code = a.prompt ? `“${a.prompt}”` : (a.missionCode ?? "");
    if (a.type === "rejected") {
      // Guarded: the log is JSON in localStorage, written by any earlier version of the app.
      const d = rejectDetailOf(a.rejectDetail);
      if (d) {
        const words = detailText.fromDetail(d);
        return { line: t("activity.rejected", { code, reason: words.title }), measured: words.measured };
      }
      const reason = rejectionReasonCode(a.detail) ?? "other";
      return { line: t("activity.rejected", { code, reason: t(`reasons.${reason}`) }), measured: null };
    }
    if (a.type === "sent" || a.type === "failed") return { line: t(`activity.${a.type}`, { code }), measured: null };
    return { line: t(`activity.${a.type}`), measured: null };
  };

  return (
    <ol className="space-y-4">
      {byDay(list).map((g) => (
        <li key={g.dayKey}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{label(g.dayKey)}</h3>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white">
            {g.items.map((a, i) => {
              const Icon = ICON[a.type];
              const bad = a.type === "rejected" || a.type === "failed";
              const { line, measured } = text(a);
              return (
                <li key={`${a.at}-${i}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Icon size={18} className={`shrink-0 ${bad ? "text-amber-600" : "text-primary"}`} aria-hidden />
                  <span className="min-w-0 flex-1 text-slate-800">
                    {line}
                    {measured ? <span className="mt-0.5 block text-xs text-slate-500">{measured}</span> : null}
                  </span>
                  <time dateTime={new Date(a.at).toISOString()} className="shrink-0 text-xs text-slate-500">
                    {format.dateTime(new Date(a.at), { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
