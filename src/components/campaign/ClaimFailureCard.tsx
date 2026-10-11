"use client";

import { useTranslations } from "next-intl";
import { signOut } from "@/lib/campaign/auth-client";
import { claimOutcome } from "@/lib/campaign/claim-flow";
import type { CampaignFailure } from "@/lib/campaign/types";

type Props = { failure: CampaignFailure; email: string | null; onRetry: () => void; onContinue: () => void };

export function ClaimFailureCard({ failure, email, onRetry, onContinue }: Props) {
  const t = useTranslations("campaign.claim.failure");
  const errors = useTranslations("campaign.common.errors");
  const common = useTranslations("campaign.common");
  const outcome = claimOutcome(failure);
  const title = outcome.offerOtherAccount ? t("titleAccount") : outcome.retryable ? t("titleRetry") : t("titleLink");

  // The token stays saved, so after signing out the sign-in card shows and the claim resumes.
  const useAnother = () => void signOut().finally(() => window.location.assign("/campaign"));

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <div role="alert" className="flex flex-col gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
        {outcome.showServerMessage && failure.message ? <p className="font-medium">{failure.message}</p> : null}
        <p>{errors(outcome.messageKey)}</p>
      </div>
      {outcome.offerOtherAccount ? (
        <>
          {email ? <p className="text-sm text-slate-600">{t("signedInAs", { email })}</p> : null}
          <p className="text-sm text-slate-600">{t("otherAccountHint")}</p>
          <button type="button" onClick={useAnother} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">
            {t("useAnother")}
          </button>
        </>
      ) : null}
      {outcome.retryable ? (
        <button type="button" onClick={onRetry} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">
          {common("retry")}
        </button>
      ) : null}
      {!outcome.offerOtherAccount && !outcome.retryable ? (
        <>
          <p className="text-sm text-slate-600">{t("contact")}</p>
          <button type="button" onClick={onContinue} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 px-5 text-base font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {t("continue")}
          </button>
        </>
      ) : null}
    </section>
  );
}
