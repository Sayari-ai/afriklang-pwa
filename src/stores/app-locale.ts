"use client";

/**
 * App-locale store.
 *
 * Equivalent of `lib/core/locale/app_locale_controller.dart`.
 *
 * Three states, mirrored from Flutter:
 *   - `null`  -> follow system (browser Accept-Language)
 *   - 'en'    -> force English
 *   - 'fr'    -> force French
 *
 * Persistence is split between two layers, by design:
 *   1. A cookie (`afriklang.app_locale.v1`) read by `src/i18n/request.ts`
 *      on the server so the very first SSR render uses the right
 *      messages no FOUC of English text on a French phone.
 *   2. localStorage under the same key for parity with Flutter's
 *      SharedPreferences and to survive cookie clears on iOS Safari.
 *
 * When the user changes locale we write *both*, then call
 *   `router.refresh()`
 * from the calling component so the server re-renders with the new
 * messages. (We can't do that here because hooks are component-scoped.)
 */

import { create } from "zustand";

import { DEFAULT_LOCALE, isSupportedLocale, LOCALE_COOKIE, type Locale } from "@/i18n/locales";
import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

/** `null` means "follow system" / unset. */
export type LocaleOverride = Locale | null;

interface AppLocaleState {
  /** User-chosen override, or `null` if following system. */
  override: LocaleOverride;
  /**
   * Effective locale once the system fallback has been resolved.
   * Hydrated by `<AppHydration>` on mount; before that we conservatively
   * report `DEFAULT_LOCALE` so server and client match.
   */
  effective: Locale;
  /** Replace the override and persist. Pass `null` to fall back to system. */
  setOverride: (override: LocaleOverride) => void;
  /** Used by the hydration component to flag the resolved system locale. */
  setEffective: (locale: Locale) => void;
}

function readPersistedOverride(): LocaleOverride {
  const raw = safeStorage.getItem(StorageKeys.appLocale);
  return isSupportedLocale(raw) ? raw : null;
}

/**
 * Cookie writer. We use a 1-year max-age and `SameSite=Lax` so it
 * survives top-level navigations but not cross-site iframes same
 * profile next-intl recommends in `node_modules/next-intl/.../docs`.
 *
 * `path=/` so every route sees it, including the manifest endpoint.
 */
function writeLocaleCookie(value: LocaleOverride): void {
  if (typeof document === "undefined") return;
  if (value === null) {
    document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    return;
  }
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

export const useAppLocale = create<AppLocaleState>((set) => ({
  override: readPersistedOverride(),
  effective: DEFAULT_LOCALE,

  setOverride: (override) => {
    if (override === null) {
      safeStorage.removeItem(StorageKeys.appLocale);
    } else {
      safeStorage.setItem(StorageKeys.appLocale, override);
    }
    writeLocaleCookie(override);
    set({ override });
  },

  setEffective: (locale) => set({ effective: locale }),
}));

// ── The invitation's language (APP-029) ─────────────────────────────────

/** "1": the language was taken from the invitation; "chosen": the speaker picked one in the app (System included). */
const FROM_INVITATION_KEY = "afriklang.app_locale.v1.from_invitation";

/** The speaker picked a language in the app: never replace it with the invitation's. */
export function forgetInvitationLocale(): void {
  safeStorage.setItem(FROM_INVITATION_KEY, "chosen");
}

/**
 * Use the language the speaker was invited (and consented) in, unless they chose one in the app.
 * Returns true when the language changed (the caller refreshes the page's messages).
 */
export function applyInvitationLocale(locale: Locale, current: string): boolean {
  const { override, setOverride } = useAppLocale.getState();
  const mark = safeStorage.getItem(FROM_INVITATION_KEY);
  if (mark === "chosen") return false;
  if (override !== null && mark !== "1") return false; // a choice made before this existed
  if (current === locale && override === locale) return false;
  safeStorage.setItem(FROM_INVITATION_KEY, "1");
  setOverride(locale);
  return current !== locale;
}
