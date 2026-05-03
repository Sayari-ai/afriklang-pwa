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
  /** UUID v4, generated on first load. Equivalent to Flutter's `DeviceIdentity`. */
  deviceUuid: "afriklang.device_uuid",

  /** Boolean flag: has the user finished the onboarding flow at least once? */
  onboardingComplete: "afriklang.onboarding_complete",

  /** Recording-consent state. Two keys to match Flutter's ConsentService. */
  consentGranted: "afriklang.consent.v1.granted",
  consentGrantedAt: "afriklang.consent.v1.granted_at",

  /** App-language override. `'en' | 'fr'` or absent (== follow system). */
  appLocale: "afriklang.app_locale.v1.language_code",

  /** Selected learning language ISO ('tw' | 'fon' | 'wo'). */
  learningLanguage: "afriklang.learning_language.v1.iso",

  /** Cached path payload (PathDefinition JSON). */
  pathCache: "afriklang.path.v1",

  /** Cached progress payload (ProgressVector JSON). */
  progressCache: "afriklang.progress.v1",

  /**
   * IndexedDB store name for the offline progress-write queue. Holds
   * pending `progress_set` calls (e.g. level completions made while
   * the device was offline). Items are small JSON, but living in IDB
   * lets us share the runner's drain machinery and keeps the data
   * model uniform with the upload queue.
   */
  progressQueueStore: "afriklang.progress_queue.v1",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
