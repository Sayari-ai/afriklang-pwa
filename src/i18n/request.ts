import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  resolveLocale,
  type Locale,
} from "./locales";

/** One message file per screen group (see src/messages/campaign). */
const CAMPAIGN_AREAS = ["common", "claim", "flow", "record"] as const;

/**
 * Per-request locale resolver for next-intl.
 *
 * Resolution order, mirroring the Flutter app's `AppLocaleController`:
 *   1. Explicit user preference, persisted in the `afriklang.app_locale.v1`
 *      cookie (set by the in-app picker on the Profile screen).
 *   2. Browser-reported `Accept-Language` (the web equivalent of the
 *      device locale that Flutter resolves to via `WidgetsBinding`).
 *   3. Hard-coded `DEFAULT_LOCALE` ("en").
 *
 * Unsupported values get coerced to the default.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = headerStore.get("accept-language");
  // First language tag, before any quality factor: "fr-FR,en;q=0.5" -> "fr-FR".
  const acceptPrimary = acceptLanguage?.split(",")[0]?.trim();

  const locale: Locale =
    resolveLocale(cookieValue) !== DEFAULT_LOCALE
      ? resolveLocale(cookieValue)
      : resolveLocale(acceptPrimary);

  // Lazy-load the message bundle to keep cold-start small.
  const messages = (await import(`../messages/${locale}.json`)).default;

  // Campaign screens keep their strings in src/messages/campaign/<area>.<locale>.json,
  // all under one "campaign" namespace: useTranslations("campaign.<area>").
  const campaign = Object.fromEntries(
    await Promise.all(
      CAMPAIGN_AREAS.map(async (area) => [area, (await import(`../messages/campaign/${area}.${locale}.json`)).default] as const),
    ),
  );

  return { locale, messages: { ...messages, campaign } };
});
