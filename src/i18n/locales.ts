/**
 * Locale model for the PWA.
 *
 * Mirrors `lib/core/locale/app_locale_controller.dart` from the Flutter
 * app: the only override values are `'en'` and `'fr'`. Anything else
 * (including the absence of a preference) falls back to the device /
 * browser locale, with English as the ultimate fallback.
 *
 * Keep this list in sync with `src/messages/*.json`.
 */
export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale used when no preference + no compatible browser locale. */
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie name read by the server to pick a message bundle.  */
export const LOCALE_COOKIE = "afriklang.app_locale.v1";

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Resolve a candidate locale string (cookie value, `Accept-Language`
 * primary tag, etc.) to one of our supported locales, or fall back to
 * the default. Strips any region subtag `'en-US'` becomes `'en'`.
 */
export function resolveLocale(candidate: string | undefined | null): Locale {
  if (!candidate) return DEFAULT_LOCALE;
  const primary = candidate.toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(primary) ? primary : DEFAULT_LOCALE;
}
