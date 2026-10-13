"use client";

/**
 * Boots the few client-side stores the speaker app shares across screens, once the React tree
 * mounts: the effective locale (for the language picker) and the install prompt (installing keeps
 * the recordings waiting on the phone safe from storage eviction).
 *
 * `RootLayout` is a Server Component (it uses `getLocale()` / `getMessages()`), so this effect
 * boundary lives here. It renders nothing.
 *
 * The retired learning app's boot steps (device identity, its own Supabase session, storage
 * migrations, the progress queue, sound effects and the `app_open` analytics call) are gone
 * (APP-010): the campaign area has its own session, outbox and cache. What it stored on phones is
 * removed once (retire-learning-app.ts).
 */

import { useEffect } from "react";
import { useLocale } from "next-intl";

import { isSupportedLocale, type Locale } from "@/i18n/locales";
import { retireLearningAppData } from "@/lib/storage/retire-learning-app";
import { useAppLocale } from "@/stores/app-locale";
import { initInstallPromptCapture, useInstallPrompt } from "@/stores/install-prompt";

export function AppHydration() {
  // The locale next-intl resolved server-side, forwarded to the locale store so client
  // components have a synchronous source of truth.
  const serverLocale = useLocale();

  useEffect(() => {
    // Once per phone: remove what the retired learning app left behind.
    retireLearningAppData();

    // Install-prompt state, and capture of Chromium's `beforeinstallprompt` (it can fire before
    // any screen that offers installation mounts). Both idempotent.
    useInstallPrompt.getState().hydrate();
    initInstallPromptCapture();

    if (isSupportedLocale(serverLocale)) {
      useAppLocale.getState().setEffective(serverLocale as Locale);
    }
  }, [serverLocale]);

  return null;
}
