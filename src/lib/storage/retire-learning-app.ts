"use client";

/**
 * One-time cleanup of what the retired learning app left on phones (APP-010): its device id
 * (an analytics identity the speaker consent does not cover), its own Google session, cached
 * paths and progress, and the IndexedDB of its offline progress queue. Nothing of the speaker
 * app is touched (its keys are under "afriklang.campaign.*", "afriklang.app_locale.*",
 * "afriklang.install_prompt.*" and "afriklang.instructions.*").
 */

const DONE_KEY = "afriklang.learning_retired.v1";

const LEARNING_KEYS = [
  "afriklang.device_uuid",
  "afriklang.onboarding_complete",
  "afriklang.consent.v1.granted",
  "afriklang.consent.v1.granted_at",
  "afriklang.learning_language.v1.iso",
  "afriklang.path.v1",
  "afriklang.progress.v1",
  "afriklang.display_name.v1.synced",
  "afriklang.sound.v1.enabled",
  "afriklang.schema_version",
  "afriklang.nickname.v1",
  "afriklang.nickname.v1.prompted",
];
const LEARNING_DATABASES = ["afriklang.progress", "afriklang"];
/** The learning app's Supabase client kept its Google session under supabase-js's default key. */
const isLearningSession = (k: string) => /^sb-[a-z0-9]+-auth-token(-code-verifier|-user)?$/.test(k);

export function retireLearningAppData(): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    if (ls.getItem(DONE_KEY)) return;
    const doomed = [...LEARNING_KEYS];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && isLearningSession(k)) doomed.push(k);
    }
    doomed.forEach((k) => ls.removeItem(k));
    for (const name of LEARNING_DATABASES) {
      try {
        indexedDB?.deleteDatabase(name);
      } catch {
        // not there, or blocked: harmless
      }
    }
    ls.setItem(DONE_KEY, "1");
  } catch {
    // storage blocked: nothing was kept there either
  }
}
