"use client";

/**
 * Consent screen — port of `lib/features/consent/consent_screen.dart`.
 *
 * One-time gate after path-setup. The app's whole point is recording
 * voice, so there is no in-app "decline and continue" mode — but the
 * gate is honest about that instead of silent:
 *
 *   - Four bullets explain what the user is agreeing to.
 *   - A "What if I don't agree?" disclosure states plainly that
 *     nothing is recorded or uploaded until they agree, and that they
 *     can leave and come back anytime (autonomy without a fake
 *     alternative path).
 *   - The former "18+" bullet is now an *active* checkbox — consent
 *     to the age term is confirmed, not just displayed. The "I agree"
 *     CTA stays disabled until it's ticked.
 *
 * On grant:
 *   - `useConsent.grant()` stamps `granted=true` + `granted_at` (if not
 *     already set) and persists to localStorage.
 *   - We `router.replace('/home')`. The splash gate would also forward
 *     to `/home` from here, but skipping that round-trip avoids a
 *     visible re-render flash.
 *
 * `_busy` mirrors the Flutter state — guards against double-taps. The
 * `grant()` call is synchronous on the web (writes to localStorage),
 * but we still flip the busy flag so the spinner shows for one frame
 * and the user sees feedback. The `router.replace` is what actually
 * takes time perceptibly.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { ScreenBackground } from "@/components/screen-background";
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
  // can't read `granted` synchronously during render — the store is
  // hydrated by `<AppHydration>` in the root layout — so we wait for
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
  // `<AppRouteGuard>` — avoids a flash of the consent gate on a deep
  // link from an already-onboarded user.
  if (!consentHydrated) return null;
  if (consentGranted) return null;

  return (
    <ScreenBackground overlay="strong">
      <div className="flex min-h-dvh w-full flex-col px-6">
        <div className="h-6" />
        <h1
          className="whitespace-pre-line text-[40px] font-black leading-tight text-white phone-sm:text-[30px]"
          style={{ letterSpacing: "-0.5px" }}
        >
          {t("consentTitle")}
        </h1>
        <div className="h-3" />
        <p className="text-[18px] font-normal leading-snug text-white phone-sm:text-[15px]">
          {t("consentSubtitle")}
        </p>
        <div className="h-8" />

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
            className="py-1 text-[15px] font-bold text-white underline underline-offset-4 phone-sm:text-[13px]"
          >
            {t("consentWhatIfDeclineAction")}
          </button>
          {whatIfOpen && (
            <p
              id={whatIfBodyId}
              className="pt-2 text-[15px] font-normal leading-snug text-white/85 phone-sm:text-[13px]"
            >
              {t("consentWhatIfDeclineBody")}
            </p>
          )}
        </div>

        <div className="h-4" />

        {/* Active age confirmation — gates the CTA. A checkbox the user
            must tick beats a bullet they may never read: the age term
            is *confirmed*, not just displayed. */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-white"
          />
          <span className="text-[15px] font-medium leading-snug text-white phone-sm:text-[13px]">
            {t("consentAgeConfirmLabel")}
          </span>
        </label>

        <div className="h-4" />
        <button
          type="button"
          onClick={accept}
          disabled={busy || !ageConfirmed}
          aria-busy={busy}
          className="flex h-16 w-full items-center justify-center rounded-[36px] text-[24px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-60 phone-sm:h-14 phone-sm:text-[18px]"
          style={{
            backgroundColor: busy ? "rgba(255,255,255,0.7)" : "#FFFFFF",
            color: "var(--color-brand-primary)",
          }}
        >
          {busy ? <Spinner /> : agreeLabel}
        </button>
        <div className="h-3" />
        <p className="text-center text-[13px] font-normal text-white/70">
          {/* `consentDisclaimer` takes one ICU param — the literal label
              of the agree button — so the disclaimer self-references
              the CTA without us hardcoding "I agree" twice. */}
          {t("consentDisclaimer", { action: agreeLabel })}
        </p>
        <div className="h-4" />
      </div>
    </ScreenBackground>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 pb-3.5">
      {/* 8-px dot, vertically nudged to sit on the cap height of the
          first line. Matches `_Bullet` `EdgeInsets.only(top: 8)`. */}
      <span
        aria-hidden
        className="mt-2 inline-block h-2 w-2 shrink-0 rounded-full bg-white"
      />
      <span className="text-[17px] font-medium leading-snug text-white phone-sm:text-[14px]">
        {children}
      </span>
    </li>
  );
}

function Spinner() {
  // 22-px brand-blue ring on white, matching the Flutter
  // `CircularProgressIndicator` swap-in (`consent_screen.dart:118-126`).
  return (
    <span
      role="progressbar"
      aria-label="Working"
      className="block h-[22px] w-[22px] animate-spin rounded-full border-[2.5px] border-transparent"
      style={{
        borderTopColor: "var(--color-brand-primary)",
        borderRightColor: "var(--color-brand-primary)",
      }}
    />
  );
}
