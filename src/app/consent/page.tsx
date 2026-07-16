"use client";

/**
 * Consent screen one-time recording-consent gate (flat redesign).
 *
 * The app's whole point is recording voice, so there is no in-app
 * "decline and continue" mode but the gate is honest about that
 * instead of silent:
 *
 *   - Four bullets explain what the user is agreeing to.
 *   - A "What if I don't agree?" disclosure states plainly that
 *     nothing is recorded or uploaded until they agree, and that they
 *     can leave and come back anytime (autonomy without a fake
 *     alternative path).
 *   - The "18+" term is an *active* checkbox consent to the age
 *     term is confirmed, not just displayed. The "I agree" CTA stays
 *     disabled until it's ticked.
 *
 * On grant:
 *   - `useConsent.grant()` stamps `granted=true` + `granted_at` (if not
 *     already set) and persists to localStorage.
 *   - We `router.replace('/home')`. The splash gate would also forward
 *     to `/home` from here, but skipping that round-trip avoids a
 *     visible re-render flash.
 *
 * `busy` guards against double-taps. The `grant()` call is synchronous
 * on the web (writes to localStorage), but we still flip the busy flag
 * so the spinner shows for one frame and the user sees feedback.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { track } from "@/lib/api/events";
import { useConsent } from "@/stores/consent";

export default function ConsentPage() {
  const router = useRouter();
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const whatIfBodyId = useId();

  // Re-entry guard. Mirrors the onboarding screen's: a returning user
  // who manually navigates to `/consent` after granting should be sent
  // straight to `/home`, not shown the (mandatory) gate again. We
  // can't read `granted` synchronously during render the store is
  // hydrated by `<AppHydration>` in the root layout so we wait for
  // the hydrated flag and then either bounce or render the screen.
  const consentHydrated = useConsent((s) => s.hydrated);
  const consentGranted = useConsent((s) => s.granted);
  useEffect(() => {
    if (consentHydrated && consentGranted) {
      router.replace("/home");
    }
  }, [consentHydrated, consentGranted, router]);

  const accept = () => {
    if (busy || !ageConfirmed) return;
    setBusy(true);
    useConsent.getState().grant();
    track("consent_granted");
    router.replace("/home");
  };

  const agreeLabel = t("consentAgreeButton");

  // Hold render while we figure out whether to bounce. Same pattern as
  // `<AppRouteGuard>` avoids a flash of the consent gate on a deep
  // link from an already-onboarded user.
  if (!consentHydrated) return null;
  if (consentGranted) return null;

  return (
    <div className="flex min-h-dvh w-full flex-col px-6 pt-[env(safe-area-inset-top)] phone-sm:px-4">
      <div className="h-4" />
      {/* Privacy shield flat brand-blue feature icon. */}
      <div className="flex justify-center">
        <span className="flex h-[96px] w-[96px] items-center justify-center rounded-full bg-blue-light">
          <ShieldCheck size={52} strokeWidth={2.25} color="#00539F" aria-hidden />
        </span>
      </div>
      <div className="h-4" />
      <h1 className="whitespace-pre-line text-[30px] font-extrabold leading-tight text-text phone-sm:text-[25px]">
        {t("consentTitle")}
      </h1>
      <div className="h-2" />
      <p className="text-[16px] font-semibold leading-snug text-text-muted phone-sm:text-[14px]">
        {t("consentSubtitle")}
      </p>
      <div className="h-6" />

      {/* Bulleted explanation. Scrollable so short viewports don't
          squeeze the CTA off-screen. */}
      <div className="flex-1 overflow-y-auto">
        <ul className="flex flex-col">
          <Bullet>{t("consentBulletDatasets")}</Bullet>
          <Bullet>{t("consentBulletReview")}</Bullet>
          <Bullet>{t("consentBulletAnonymous")}</Bullet>
          <Bullet>{t("consentBulletRevoke")}</Bullet>
        </ul>

        {/* Honest "no consent, no missions" disclosure. Not a decline
            CTA (there is no alternative mode to route to) but a plain
            statement of what happens if the user walks away. */}
        <button
          type="button"
          onClick={() => setWhatIfOpen((v) => !v)}
          aria-expanded={whatIfOpen}
          aria-controls={whatIfBodyId}
          className="py-1 text-[14px] font-extrabold text-blue underline underline-offset-4 phone-sm:text-[13px]"
        >
          {t("consentWhatIfDeclineAction")}
        </button>
        {whatIfOpen && (
          <p
            id={whatIfBodyId}
            className="pt-2 text-[14px] font-semibold leading-snug text-text-muted phone-sm:text-[13px]"
          >
            {t("consentWhatIfDeclineBody")}
          </p>
        )}
      </div>

      <div className="h-4" />

      {/* Active age confirmation gates the CTA. A checkbox the user
          must tick beats a bullet they may never read: the age term
          is *confirmed*, not just displayed. */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={ageConfirmed}
          onChange={(e) => setAgeConfirmed(e.target.checked)}
          className="peer sr-only"
        />
        {/* Custom flat checkbox: gray outline → green fill + check. */}
        <span
          aria-hidden
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue ${
            ageConfirmed ? "border-primary bg-primary" : "border-border bg-bg"
          }`}
        >
          {ageConfirmed && (
            <Check size={16} strokeWidth={4} color="#FFFFFF" />
          )}
        </span>
        <span className="text-[14px] font-semibold leading-snug text-text phone-sm:text-[13px]">
          {t("consentAgeConfirmLabel")}
        </span>
      </label>

      <div className="h-4" />
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={accept}
        disabled={busy || !ageConfirmed}
        loading={busy}
        aria-busy={busy}
      >
        {agreeLabel}
      </Button>
      <div className="h-3" />
      <p className="text-center text-[13px] font-semibold text-text-faint">
        {/* `consentDisclaimer` takes one ICU param the literal label
            of the agree button so the disclaimer self-references
            the CTA without us hardcoding "I agree" twice. */}
        {t("consentDisclaimer", { action: agreeLabel })}
      </p>
      <div className="h-4 pb-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 pb-3.5">
      <span
        aria-hidden
        className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-light"
      >
        <Check size={13} strokeWidth={4} color="#00539F" />
      </span>
      <span className="text-[15px] font-semibold leading-snug text-text phone-sm:text-[13px]">
        {children}
      </span>
    </li>
  );
}
