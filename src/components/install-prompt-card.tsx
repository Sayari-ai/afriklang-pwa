"use client";

/**
 * Add-to-home-screen offer card (Phase 1 of the retention roadmap).
 *
 * Rendered inline on the level-complete celebration screen the
 * moment of peak motivation and the moment the user has something
 * worth protecting (their identity is device-local storage; installing
 * exempts it from Safari's 7-day eviction see `install-prompt.ts`).
 *
 * Behaviour by platform:
 *   * Chromium with a captured `beforeinstallprompt`: the CTA replays
 *     the native install sheet.
 *   * iOS Safari: the CTA expands two Share → "Add to Home Screen"
 *     instruction steps inline (no API exists).
 *   * Everything else (or already installed): renders nothing.
 *
 * Anti-nagging: "Not now" persists a 14-day cool-off (store-enforced);
 * declining the native sheet counts as a dismissal too. The card is
 * never modal and never blocks the primary CTA.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { WoodButton } from "@/components/game/wood-button";
import { WoodPanel } from "@/components/game/wood-panel";
import { track } from "@/lib/api/events";
import { useInstallPrompt } from "@/stores/install-prompt";

export function InstallPromptCard() {
  const t = useTranslations();

  // Reactive visibility: `canOffer()` derives from store state, so the
  // selector re-evaluates whenever capture/dismiss/installed changes.
  const visible = useInstallPrompt((s) => s.canOffer());
  const isIos = useInstallPrompt((s) => s.isIos);
  const hasNativePrompt = useInstallPrompt((s) => s.deferredEvent !== null);

  const [showIosSteps, setShowIosSteps] = useState(false);

  // Analytics: one `install_prompt_shown` per appearance, not per
  // re-render.
  const shownTrackedRef = useRef(false);
  useEffect(() => {
    if (visible && !shownTrackedRef.current) {
      shownTrackedRef.current = true;
      track("install_prompt_shown", { platform: isIos ? "ios" : "native" });
    }
  }, [visible, isIos]);

  if (!visible) return null;

  const onPrimary = () => {
    if (hasNativePrompt) {
      void useInstallPrompt.getState().promptNative();
      return;
    }
    // iOS (or any browser without the native event): show the manual
    // instructions instead.
    setShowIosSteps((v) => !v);
  };

  const onNotNow = () => {
    useInstallPrompt.getState().dismiss();
  };

  return (
    <WoodPanel grass={false} contentClassName="p-4 text-left">
      <h2
        className="font-game text-[17px] tracking-wide text-cream"
        style={{ textShadow: "0 1.5px 0 rgba(92,48,24,0.7)" }}
      >
        {t("installCardTitle")}
      </h2>
      <div className="h-1" />
      <p className="text-[13px] font-medium leading-snug text-cream/90">
        {t("installCardBody")}
      </p>

      {showIosSteps && (
        <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-[13px] font-medium leading-snug text-cream">
          <li>{t("installCardIosStep1")}</li>
          <li>{t("installCardIosStep2")}</li>
        </ol>
      )}

      <div className="mt-3 flex items-center gap-3">
        <WoodButton
          tone="green"
          size="sm"
          grass={false}
          fullWidth
          className="flex-1"
          onClick={onPrimary}
        >
          {t("installCardCta")}
        </WoodButton>
        <button
          type="button"
          onClick={onNotNow}
          className="h-11 shrink-0 px-3 text-[14px] font-bold text-cream/75"
          style={{ textShadow: "0 1px 0 rgba(92,48,24,0.6)" }}
        >
          {t("installCardNotNow")}
        </button>
      </div>
    </WoodPanel>
  );
}
