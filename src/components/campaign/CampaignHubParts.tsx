"use client";

/** Small shared pieces of the campaign hub. */

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ERROR_KEY } from "@/lib/campaign/errors";
import { rejectionReasonCode } from "@/lib/campaign/view";
import type { CampaignFailure } from "@/lib/campaign/types";

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
