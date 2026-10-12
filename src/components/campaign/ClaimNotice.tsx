"use client";

/** Small full-width states of the landing screen: a spinner message, the "no campaign link yet" screen and a broken link. */

import { useTranslations } from "next-intl";

export function ClaimSpinner({ title, body }: { title: string; body?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-center">
      <span aria-hidden className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {body ? <p className="text-sm text-slate-600">{body}</p> : null}
    </div>
  );
}

export function ClaimNotLinked() {
  const t = useTranslations("campaign.claim.notLinked");
  return (
    <section className="flex flex-col gap-3 py-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      <p className="text-base text-slate-800">{t("body")}</p>
      <p className="text-sm text-slate-600">{t("lost")}</p>
    </section>
  );
}

/** The link in the address bar was not a whole invitation (often cut when copied from the email). */
export function ClaimBrokenLink({ onContinue }: { onContinue: () => void }) {
  const t = useTranslations("campaign.claim.brokenLink");
  return (
    <section className="flex flex-col gap-4 py-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">{t("body")}</p>
      <p className="text-sm text-slate-600">{t("help")}</p>
      <button type="button" onClick={onContinue} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 px-5 text-base font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {t("continue")}
      </button>
    </section>
  );
}
