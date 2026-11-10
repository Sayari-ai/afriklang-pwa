"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isCampaignAuthConfigured, signInWithGoogle } from "@/lib/campaign/auth-client";
import { isInAppBrowser } from "@/lib/campaign/in-app-browser";
import { signInFailed, signInStarted } from "@/lib/analytics/client";
import { takeSignInReturnProblem, type SignInReturnProblem } from "@/lib/campaign/sign-in-return";

export function SignInCard({ hasInvitation }: { hasInvitation: boolean }) {
  const t = useTranslations("campaign.claim.signIn");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Read after mounting (the server has no user agent).
  const [inApp, setInApp] = useState(false);
  // Back from Google without a session: say why, once (APP2-11).
  const [returned, setReturned] = useState<SignInReturnProblem | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() => {
      setInApp(isInAppBrowser(navigator.userAgent));
      // Taken once: StrictMode runs this effect twice, and the second read must not erase the first.
      const problem = takeSignInReturnProblem();
      if (problem) setReturned(problem);
    });
  }, []);

  async function start() {
    setBusy(true);
    setFailed(false);
    setReturned(null);
    signInStarted({ in_app_browser: inApp, has_invitation: hasInvitation });
    try {
      await signInWithGoogle("/campaign");
      // The browser is leaving for Google; keep the button busy.
    } catch (e) {
      signInFailed(signInStartError(e));
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
      {inApp ? (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {t("inApp")}
        </p>
      ) : null}
      {returned ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {t(`return.${returned}`)}
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

/** A short code for a sign-in that could not start (never the error's text). */
function signInStartError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z0-9_.-]{1,40}$/i.test(code)) return code;
  return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "start_failed";
}
