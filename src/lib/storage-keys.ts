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

  /**
   * User-chosen display name for the leaderboard. Optional override of
   * the server-assigned nickname returned by `leaderboard_get`. UTF-8
   * string, trimmed and length-validated client-side before write.
   */
  nickname: "afriklang.nickname.v1",

  /**
   * Boolean flag: has the first-run nickname prompt been shown on the
   * map screen? Persisted separately from `nickname` itself so a user
   * who dismisses the prompt without entering a name doesn't get asked
   * again on every cold start.
   */
  nicknamePrompted: "afriklang.nickname.v1.prompted",

  /**
   * ISO-8601 timestamp of the last time the user dismissed the
   * add-to-home-screen prompt card. Used to respect the dismissal for
   * a cool-off window instead of nagging on every celebration screen.
   * Absent == never dismissed.
   */
  installPromptDismissedAt: "afriklang.install_prompt.v1.dismissed_at",

  /**
   * Integer schema version for client-side persisted state. Bumped
   * whenever a non-additive change to localStorage / IndexedDB layout
   * ships, and read on every boot by `runStorageMigrations()` to
   * decide whether one-shot cleanup is needed. See
   * `src/lib/storage/migrations.ts` for the migration list.
   *
   * Stored as a base-10 integer string ("1", "2", ...). Absent on
   * pre-migration installs treated as version 0 by the runner so
   * the first migration always fires.
   */
  schemaVersion: "afriklang.schema_version",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
