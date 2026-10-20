"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useCampaignSession } from "@/lib/campaign/hooks";
import { signOutHere } from "@/lib/campaign/sign-out";
import { claimOutcome, maskedEmailIn } from "@/lib/campaign/claim-flow";
import type { CampaignFailure } from "@/lib/campaign/types";
import { useFailureText } from "./CampaignHubParts";

type Props = { failure: CampaignFailure; email: string | null; onRetry: () => void; onContinue: () => void };

const PRIMARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 px-5 text-base font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Why the invitation could not be used, and always a way on: every failure offers "Go to my
 * campaigns", so a wrong Google account or a bad connection never locks the speaker out of
 * the campaigns they already have.
 */
export function ClaimFailureCard({ failure, email, onRetry, onContinue }: Props) {
  const t = useTranslations("campaign.claim.failure");
  const errors = useTranslations("campaign.common.errors");
  const common = useTranslations("campaign.common");
  const outcome = claimOutcome(failure);
  const failureText = useFailureText();
  // One tap, one new attempt: the card goes away as soon as the claim restarts.
  const [retried, setRetried] = useState(false);
  const retry = () => {
    if (retried) return;
    setRetried(true);
    onRetry();
  };
  const title = outcome.offerOtherAccount ? t("titleAccount") : outcome.retryable ? t("titleRetry") : t("titleLink");
  // The dashboard's hint is English: only the masked address is taken from it.
  const masked = failure.code === "email_mismatch" ? maskedEmailIn(failure.message) : null;

  // The token stays saved, so after signing out the sign-in card shows and the claim resumes.
  const session = useCampaignSession();
  const userId = session.status === "signedIn" ? session.userId : null;
  const useAnother = () => void signOutHere(userId, { keepInvitation: true }).finally(() => window.location.assign("/campaign"));

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <div role="alert" className="flex flex-col gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
        <p>{masked ? t("accountFor", { email: masked }) : outcome.showServerMessage ? errors(outcome.messageKey) : failureText(failure)}</p>
      </div>
      {outcome.offerOtherAccount ? (
        <>
          {email ? <p className="text-sm text-slate-600">{t("signedInAs", { email })}</p> : null}
          <p className="text-sm text-slate-600">{t("otherAccountHint")}</p>
          <button type="button" onClick={useAnother} className={PRIMARY}>
            {t("useAnother")}
          </button>
          <p className="text-sm text-slate-600">{t("noAccountHint")}</p>
        </>
      ) : null}
      {outcome.retryable ? (
        <>
          <button type="button" onClick={retry} disabled={retried} className={PRIMARY}>
            {common("retry")}
          </button>
          <p className="text-sm text-slate-600">{t("autoRetry")}</p>
        </>
      ) : null}
      {!outcome.retryable ? <p className="text-sm text-slate-600">{t("contact")}</p> : null}
      <button type="button" onClick={onContinue} className={SECONDARY}>
        {t("continue")}
      </button>
    </section>
  );
}
