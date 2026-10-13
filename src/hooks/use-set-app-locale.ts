"use client";

/**
 * `useSetAppLocale()` single API the Profile screen (and the smoke
 * test) calls when the user picks a language.
 *
 * Flow:
 *   1. Persist the override into the locale store. The store writes
 *      both the cookie (`afriklang.app_locale.v1`) AND the localStorage
 *      mirror, in that order.
 *   2. Call `router.refresh()` Next 16's documented way to re-run
 *      Server Components in the current route without losing client
 *      React state. Our `src/i18n/request.ts` reads the cookie on
 *      every server render, so the next render swaps message bundles.
 *   3. The `<NextIntlClientProvider>` in `RootLayout` receives the new
 *      `messages` prop and re-broadcasts. `useTranslations()` inside
 *      Client Components re-renders automatically.
 *
 * Why not write a Server Action?
 *   - We already have to write the cookie from the client (so we can
 *     also mirror to localStorage in the same atomic step).
 *   - `router.refresh()` re-runs the request config server-side, which
 *     reads the cookie we just wrote. There's nothing for a Server
 *     Action to add we'd just be paying a round-trip for no work.
 *
 * Reference: `node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/use-router.md`, line 46 (router.refresh semantics).
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { forgetInvitationLocale, useAppLocale, type LocaleOverride } from "@/stores/app-locale";

export function useSetAppLocale(): (override: LocaleOverride) => void {
  const router = useRouter();
  const setOverride = useAppLocale((s) => s.setOverride);

  return useCallback(
    (override: LocaleOverride) => {
      // The speaker chose: the invitation's language no longer applies (useInvitationLocale).
      forgetInvitationLocale();
      setOverride(override);
      // Re-runs Server Components in this route → next-intl picks up
      // the new cookie value → fresh `messages` are pushed through
      // <NextIntlClientProvider>.
      router.refresh();
    },
    [router, setOverride],
  );
}
