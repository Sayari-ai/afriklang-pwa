"use client";

/**
 * Splash + gate. Web equivalent of `_AppRoot` in
 * `lib/main.dart:79-167`.
 *
 * The Flutter version is a single in-memory state machine
 * (splash → onboarding → pathSetup → consent → done). On the web we
 * map each stage to its own route so back/refresh/share-link
 * behaviour is sane:
 *
 *     /              ← this file (splash + decide-where-to-go)
 *     /onboarding
 *     /path-setup
 *     /consent
 *     /home          ← (app)/home/page.tsx
 *
 * Decision logic mirrors the Flutter handlers exactly:
 *
 *     onboarding done? ──no──► /onboarding
 *                       │yes
 *                       ▼
 *                 path booted?  ──no──► /path-setup
 *                       │yes
 *                       ▼
 *                 consent granted? ──no──► /consent
 *                       │yes
 *                       ▼
 *                     /home
 *
 * The minimum splash time matches Flutter's 2 s `Future.delayed`
 * (`splash_screen.dart:20`). We start the timer the moment the
 * stores have hydrated so a slow IO read doesn't push us over 2 s —
 * same behaviour as the mobile app.
 *
 * "Hydrated" signal: `<AppHydration>` runs every store's `hydrate()`
 * inside a single `useEffect`, so we can key off any one of the
 * post-hydration flags. We use the onboarding flag because it's the
 * last one set in that block — by the time it's true the others are
 * already populated.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { GameBoardBackdrop } from "@/components/screen-background";
import { useConsent } from "@/stores/consent";
import { useOnboarding } from "@/stores/onboarding";
import { usePathRepo } from "@/stores/path-repo";

const SPLASH_MIN_MS = 2000;

export default function SplashGatePage() {
  const router = useRouter();

  const hydrated = useOnboarding((s) => s.hydrated);
  const onboardingDone = useOnboarding((s) => s.complete);
  const consentGranted = useConsent((s) => s.granted);
  const pathReady = usePathRepo((s) => s.isReady);

  // Anchor the splash min-duration to the moment hydration finished
  // (not to first mount), so on a fresh load with slow IO we never
  // undershoot the 2 s the designers expect. The ref is written in
  // an effect (not during render) to satisfy react-hooks/purity.
  const hydratedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (hydrated && hydratedAtRef.current === null) {
      hydratedAtRef.current = Date.now();
    }
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const anchor = hydratedAtRef.current ?? Date.now();
    const elapsed = Date.now() - anchor;
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed);

    const id = window.setTimeout(() => {
      // Decision tree — keep in lockstep with `_AppRoot` handlers.
      if (!onboardingDone) {
        router.replace("/onboarding");
        return;
      }
      // After onboarding the Flutter app *always* runs path-setup,
      // even on returning installs, because that's where the cached
      // path is rehydrated and missing assignments are repaired. We
      // do the same: if the repo isn't booted yet, send to
      // /path-setup. If it is, jump consent / home directly.
      if (!pathReady) {
        router.replace("/path-setup");
        return;
      }
      if (!consentGranted) {
        router.replace("/consent");
        return;
      }
      router.replace("/home");
    }, wait);

    return () => window.clearTimeout(id);
  }, [hydrated, onboardingDone, pathReady, consentGranted, router]);

  // Splash UI: dark game-board backdrop, centred logo. Same geometry
  // as `splash_screen.dart:27-43` (Align(0, -0.15), 45 % width).
  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-surface">
      <GameBoardBackdrop />
      <div
        className="relative flex w-full justify-center"
        style={{ transform: "translateY(-7.5%)" }}
      >
        <div className="w-[45vw] max-w-[280px]">
          <Image
            src="/logo/logo.png"
            alt="Afriklang"
            width={560}
            height={560}
            priority
            className="h-auto w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
