"use client";

/**
 * Boots all client-side stores once the React tree mounts.
 *
 * Why a dedicated component instead of doing it inside `RootLayout`?
 *
 *   - `RootLayout` is a Server Component (it uses `getLocale()` /
 *     `getMessages()`), so it can't run `useEffect`.
 *   - We don't want `'use client'` at the top of `layout.tsx`; that
 *     would force every page into the client bundle.
 *   - Centralising hydration in one place keeps the order explicit:
 *     device id first (every other call ultimately needs it), then
 *     consent / language / onboarding flags, finally the resolved
 *     system locale.
 *
 * This component renders nothing it's a side-effect boundary.
 */

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";

import { isSupportedLocale, type Locale } from "@/i18n/locales";
import { track } from "@/lib/api/events";
import { runStorageMigrations } from "@/lib/storage/migrations";
import { startProgressQueueRunner } from "@/lib/storage/progress-queue-runner";
import { useAppLocale } from "@/stores/app-locale";
import { useAuth } from "@/stores/auth";
import { useConsent } from "@/stores/consent";
import { useDeviceIdentity } from "@/stores/device-identity";
import {
  initInstallPromptCapture,
  useInstallPrompt,
} from "@/stores/install-prompt";
import { useLearningLanguage } from "@/stores/learning-language";
import { useNickname } from "@/stores/nickname";
import { useOnboarding } from "@/stores/onboarding";

// Session-once guard for the `app_open` event. The hydration effect
// re-runs on locale switches (deps include `t`); the analytics event
// must not.
let appOpenTracked = false;

export function AppHydration() {
  // `useLocale()` returns the locale that next-intl resolved server-side
  // exactly the one our request.ts handed to the provider. We forward
  // it to the locale store so client components have a synchronous
  // source of truth without re-doing the resolution.
  const serverLocale = useLocale();
  // Translator handle used by the upload-queue runner to surface a
  // localised snackbar when an item is permanently dropped. We pass
  // the current `t` via a closure, so a locale switch at runtime is
  // reflected on the next drain (start-up call is idempotent).
  const t = useTranslations();

  useEffect(() => {
    // 0. Storage migrations. Runs *before* any store hydrates so the
    //    on-disk shape matches what the hydration code expects. The
    //    runner is idempotent (reads a stored version key first), so
    //    on every boot after the first this is a single localStorage
    //    read and an early return. Fire-and-forget async cleanup
    //    (e.g. orphan IDB deletes) shouldn't block first paint, and
    //    the synchronous parts (path-cache wipe) complete before
    //    `pathRepo.boot()` reads the cache anyway because that runs
    //    later, on a separate trigger.
    void runStorageMigrations();

    // 1. Identity is the prerequisite for every API call.
    useDeviceIdentity.getState().ensure();

    // 2. Persisted user choices.
    useConsent.getState().hydrate();
    useLearningLanguage.getState().hydrate();
    useOnboarding.getState().hydrate();
    useNickname.getState().hydrate();

    // 2b. Auth session (Google sign-in). Async, unlike the localStorage
    //     stores: `getSession()` awaits the Supabase client's init,
    //     which is also where an OAuth `?code=` redirect gets
    //     exchanged for a session. The splash gate and route guard
    //     wait on `useAuth.hydrated` before routing. Idempotent.
    void useAuth.getState().hydrate();

    // 2c. Install-prompt state: hydrate the dismissal window +
    //     standalone/iOS detection, and start capturing the Chromium
    //     `beforeinstallprompt` event (it can fire before any screen
    //     that wants to offer installation mounts). Both idempotent.
    useInstallPrompt.getState().hydrate();
    initInstallPromptCapture();

    // 3. Locale: server already picked one record it as the
    //    `effective` value. The persisted override (if any) is read
    //    eagerly inside the store's initializer, so no work needed here
    //    beyond announcing the effective value.
    if (isSupportedLocale(serverLocale)) {
      useAppLocale.getState().setEffective(serverLocale as Locale);
    }

    // 4. Boot the offline progress-queue drain loop. Idempotent on
    //    repeat mounts; copy refreshes on every effect run so locale
    //    switches don't strand the snackbar text in the old language.
    //    Audio uploads no longer have a queue submission is now an
    //    online-only operation (see `audio.ts` "at-most-once policy"),
    //    so only progress writes get queued here.
    startProgressQueueRunner({
      getCopy: () => ({
        syncFailed: t("progressQueuedSyncFailedSnack"),
      }),
    });

    // 5. Analytics: one `app_open` per browser session. `standalone`
    //    distinguishes installed-PWA launches from plain tab visits 
    //    the key metric for the Phase-1 install prompt.
    if (!appOpenTracked) {
      appOpenTracked = true;
      track("app_open", {
        standalone: window.matchMedia("(display-mode: standalone)").matches,
      });
    }
  }, [serverLocale, t]);

  return null;
}
