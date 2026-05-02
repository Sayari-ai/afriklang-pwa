"use client";

/**
 * Guard for the protected app shell (everything behind the bottom nav
 * + the level/celebration screens).
 *
 * If a user lands on `/home`, `/level/3`, etc. without having
 * completed the onboarding/path-setup/consent funnel, we bounce them
 * back to the splash gate, which then forwards them to the right
 * step. Same effect as Flutter's `_AppRoot` refusing to render
 * `HomeScreen` until `_stage == done`.
 *
 * The guard is intentionally permissive while stores are still
 * hydrating: we render `null` instead of redirecting, otherwise a
 * fresh visit to `/home` would always bounce on the first paint
 * before the cache has been read into the store.
 */

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useConsent } from "@/stores/consent";
import { useOnboarding } from "@/stores/onboarding";
import { usePathRepo } from "@/stores/path-repo";

export function AppRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();

  const hydrated = useOnboarding((s) => s.hydrated);
  const onboardingDone = useOnboarding((s) => s.complete);
  const consentGranted = useConsent((s) => s.granted);
  const pathReady = usePathRepo((s) => s.isReady);

  useEffect(() => {
    if (!hydrated) return;
    // Any missing precondition → punt to the splash gate, which owns
    // the canonical decision tree. We don't replicate it here: doing
    // so would be a second source of truth that drifts.
    if (!onboardingDone || !pathReady || !consentGranted) {
      router.replace("/");
    }
  }, [hydrated, onboardingDone, pathReady, consentGranted, router]);

  // Block rendering until we know the user is allowed to be here.
  // This avoids a flash of authenticated UI on a cold deep link.
  if (!hydrated) return null;
  if (!onboardingDone || !pathReady || !consentGranted) return null;

  return <>{children}</>;
}
