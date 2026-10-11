"use client";

/**
 * HomeInstallSheet the proactive "install the app" ask.
 *
 * The celebration-screen card catches peak motivation; this sheet is
 * the explicit ask on the home path for users who haven't hit that
 * moment yet. Installing is the progress-preservation feature on iOS
 * (identity is device-local storage; installed apps are exempt from
 * Safari's 7-day eviction), so one respectful, dismissible ask is
 * justified.
 *
 * Anti-nagging contract (shared with the card via the store):
 *   - At most once per session (module latch), after a short delay so
 *     the map paints first.
 *   - ANY exit scrim tap, Escape, "Not now" persists the 14-day
 *     cool-off (`dismiss()`), which also hides the celebration card.
 *     Declining the native OS sheet does the same (store-side).
 *   - Renders nothing when installed, recently dismissed, or no
 *     install path exists on this browser (`canOffer()`).
 *
 * Platform paths mirror `install-prompt-card.tsx`:
 *   - Chromium: replay the captured `beforeinstallprompt`.
 *   - iOS Safari: reveal the two Share → "Add to Home Screen" steps.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/ui/mascot";
import { Sheet } from "@/components/ui/sheet";
import { track } from "@/lib/api/events";
import { useInstallPrompt } from "@/stores/install-prompt";

/** Once per app session, across route revisits. */
let offeredThisSession = false;

/** Delay before the ask let the path render and settle first. */
const OPEN_DELAY_MS = 1200;

export function HomeInstallSheet() {
  const t = useTranslations();

  const canOffer = useInstallPrompt((s) => s.canOffer());
  const isIos = useInstallPrompt((s) => s.isIos);
  const hasNativePrompt = useInstallPrompt((s) => s.deferredEvent !== null);

  const [open, setOpen] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (offeredThisSession || !canOffer || open) return;
    const id = window.setTimeout(() => {
      offeredThisSession = true;
      setOpen(true);
      track("install_prompt_shown", {
        platform: isIos ? "ios" : "native",
        surface: "home_sheet",
      });
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [canOffer, open, isIos]);

  if (!open) return null;

  /** Every exit is an answer: start the cool-off and close. */
  const declineAndClose = () => {
    useInstallPrompt.getState().dismiss();
    setOpen(false);
  };

  const onPrimary = async () => {
    if (hasNativePrompt) {
      // The store tracks accepted/dismissed and starts the cool-off
      // on decline; either way this surface's job is done.
      await useInstallPrompt.getState().promptNative();
      setOpen(false);
      return;
    }
    // iOS (or any browser without the native event): reveal the
    // manual instructions instead.
    setShowIosSteps((v) => !v);
  };

  return (
    <Sheet title={t("installCardTitle")} onClose={declineAndClose}>
      <div className="flex items-start gap-4 px-5">
        <Mascot size={72} animated={false} className="shrink-0" />
        <p className="pt-1 text-[14px] font-semibold leading-snug text-text-muted">
          {t("installCardBody")}
        </p>
      </div>

      {showIosSteps && (
        <ol className="mt-3 flex list-decimal flex-col gap-1 px-5 pl-10 text-[14px] font-semibold leading-snug text-text">
          <li>{t("installCardIosStep1")}</li>
          <li>{t("installCardIosStep2")}</li>
        </ol>
      )}

      <div className="flex flex-col gap-2 px-5 pt-4">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => void onPrimary()}
        >
          {t("installCardCta")}
        </Button>
        <button
          type="button"
          onClick={declineAndClose}
          className="h-11 rounded-xl text-[14px] font-extrabold uppercase tracking-[0.8px] text-text-faint transition-opacity active:opacity-60"
        >
          {t("installCardNotNow")}
        </button>
      </div>
    </Sheet>
  );
}
