"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { isCampaignAuthConfigured, signInWithGoogle } from "@/lib/campaign/auth-client";

export function SignInCard({ hasInvitation }: { hasInvitation: boolean }) {
  const t = useTranslations("campaign.claim.signIn");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    setBusy(true);
    setFailed(false);
    try {
      await signInWithGoogle("/campaign");
      // The browser is leaving for Google; keep the button busy.
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      {hasInvitation ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {t("invitationDetected")}
        </p>
      ) : null}
      <p className="text-base text-slate-800">{t("intro")}</p>
      <p className="text-sm text-slate-600">{t("why")}</p>
      {isCampaignAuthConfigured ? (
        <button type="button" onClick={() => void start()} disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">
          {busy ? t("starting") : t("button")}
        </button>
      ) : (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("notConfigured")}
        </p>
      )}
      {failed ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {t("error")}
        </p>
      ) : null}
    </section>
  );
}
