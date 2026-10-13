/**
 * Centralised localStorage key registry.
 *
 * Mirrors the SharedPreferences keys used by the Flutter app
 * (`lib/core/...` and `lib/main.dart`) so the two platforms could in
 * principle share storage if we ever bridge them through a WebView.
 *
 * Treat these keys as forward-compatible contracts: bump the `vN`
 * suffix when the value shape changes, never silently re-purpose a
 * key.
 */
export const StorageKeys = {
  /** App-language override. `'en' | 'fr'` or absent (== follow system). */
  appLocale: "afriklang.app_locale.v1.language_code",

  /**
   * ISO-8601 timestamp of the last time the user dismissed the
   * add-to-home-screen prompt. Used to respect the dismissal for a
   * cool-off window instead of nagging. Absent == never dismissed.
   */
  installPromptDismissedAt: "afriklang.install_prompt.v1.dismissed_at",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
