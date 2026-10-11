"use client";

/** Small shared pieces of the campaign hub. */

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ERROR_KEY } from "@/lib/campaign/errors";
import type { CampaignFailure } from "@/lib/campaign/types";

export const buttonPrimary =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500";
export const buttonSecondary =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 disabled:opacity-50";

/** A failed write: the dashboard's own words for invalid_input, our translation for the rest. */
export function FailureMessage({ failure }: { failure: CampaignFailure }) {
  const t = useTranslations("campaign.common");
  const text = failure.code === "invalid_input" && failure.message ? failure.message : t(`errors.${ERROR_KEY[failure.code]}`);
  return (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {text}
    </p>
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
