"use client";

/** Small shared pieces of the campaign hub. */

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import { ERROR_KEY } from "@/lib/campaign/errors";
import { rejectDetailMessage, rejectDetailOf } from "@/lib/campaign/reject-detail";
import { rejectionReasonCode } from "@/lib/campaign/view";
import type { CampaignFailure, Mission, RejectDetail } from "@/lib/campaign/types";

export const buttonPrimary =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500";
export const buttonSecondary =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 disabled:opacity-50";

/**
 * The sentence for a failure, in the contributor's language. A 429 says how long to wait when the
 * server said so; an invalid_input keeps the dashboard's precise (English) detail for English readers.
 */
export function useFailureText() {
  const t = useTranslations("campaign.common.errors");
  const locale = useLocale();
  return (failure: Pick<CampaignFailure, "code" | "message" | "retryAfterS">): string => {
    if (failure.code === "rate_limited" && failure.retryAfterS && failure.retryAfterS > 0) return t("rateLimitedWait", { s: Math.ceil(failure.retryAfterS) });
    const text = t(ERROR_KEY[failure.code]);
    if (failure.code === "invalid_input" && failure.message && locale === "en") return `${text} (${failure.message})`;
    return text;
  };
}

/**
 * Why a mission came back, as a sentence (MAN-002): a reason code becomes one clear sentence in the
 * speaker's language; a reviewer's own words are shown as written; nothing gives null.
 */
export function useRejectionText() {
  const t = useTranslations("campaign.common.rejection");
  return (reason: string | null | undefined): string | null => {
    const code = rejectionReasonCode(reason);
    if (code) return t(code);
    return reason?.trim() ? reason.trim() : null;
  };
}

/** Why a take was refused, in the speaker's language: a title, what was measured (null without numbers), how to fix it (null for a reviewer's own words). */
export type RejectText = { title: string; measured: string | null; fix: string | null };

/**
 * What a refused take says, the same words as the "to record again" email (E09). With a detail
 * from the automatic checks (`rejection_detail`, on the mission or its recording): the check's
 * title, what was measured with the limit, and how to fix it. Without one (an older dashboard, or
 * a reviewer's decision): today's reason sentence as the title, nothing else. Null with no reason
 * at all. `fromDetail` gives the same three lines for a bare detail (the activity log keeps one).
 */
export function useRejectDetailText() {
  const t = useTranslations("campaign.common");
  const locale = useLocale();
  const reasonText = useRejectionText();
  const fromDetail = (d: RejectDetail): RejectText => {
    const m = rejectDetailMessage(d, locale);
    return { title: t(m.titleKey), measured: m.measuredKey ? t(m.measuredKey, m.values) : null, fix: t(m.fixKey) };
  };
  const ofMission = (m: Pick<Mission, "rejection_reason" | "rejection_detail" | "recording">): RejectText | null => {
    // Guarded again here: a saved copy or a newer dashboard may carry a check this app does not know.
    const d = rejectDetailOf(m.rejection_detail ?? m.recording?.rejection_detail);
    if (d) return fromDetail(d);
    const title = reasonText(m.rejection_reason);
    return title ? { title, measured: null, fix: null } : null;
  };
  return Object.assign(ofMission, { fromDetail });
}

/**
 * The "what we measured" and "how to fix it" lines under a refused take's title, on a white card
 * (the mission list, the studio's prompt card). Nothing without a detail.
 */
export function RejectDetailLines({ text }: { text: RejectText }) {
  const t = useTranslations("campaign.common.rejectDetail");
  if (!text.measured && !text.fix) return null;
  return (
    <span className="mt-1 block space-y-1 text-xs font-normal">
      {text.measured ? <span className="block text-slate-600">{t("measuredLabel", { measured: text.measured })}</span> : null}
      {text.fix ? (
        <span className="flex items-start gap-1 text-slate-800">
          <Lightbulb size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>{t("fixLabel", { fix: text.fix })}</span>
        </span>
      ) : null}
    </span>
  );
}

/** A failed write, with a way back to sign-in when the session expired. */
export function FailureMessage({ failure }: { failure: CampaignFailure }) {
  const t = useTranslations("campaign.record");
  const text = useFailureText()(failure);
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p>{text}</p>
      {failure.code === "unauthorized" ? (
        <Link href="/campaign" className="inline-flex min-h-11 items-center font-semibold text-red-900 underline underline-offset-2">
          {t("signInAgain")}
        </Link>
      ) : null}
    </div>
  );
}

export function Notice({ title, children, tone = "info" }: { title?: string; children: ReactNode; tone?: "info" | "warn" }) {
  const palette = tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${palette}`}>
      {title ? <h2 className="mb-1 text-base font-bold">{title}</h2> : null}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function BackToList() {
  const t = useTranslations("campaign.flow.hub");
  return (
    <Link href="/campaign" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2">
      {t("backToList")}
    </Link>
  );
}
