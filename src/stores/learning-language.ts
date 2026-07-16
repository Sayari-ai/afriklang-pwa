"use client";

/**
 * Learning-language store + catalogue.
 *
 * Mirrors `lib/core/language/learning_language.dart`:
 *   - Same three languages, same ISO codes (`tw`, `fon` (639-3), `wo`).
 *   - Same SharedPreferences key (`afriklang.learning_language.v1.iso`).
 *   - Same fallbacks: `isoOrDefault === 'wo'`, `displayNameOrDefault === 'Wolof'`.
 *
 * The store deliberately holds only the ISO code; the full record is
 * resolved through `findLanguageByIso()` so the catalogue stays the
 * single source of truth for emoji + country labels.
 *
 * The catalogue is exported as a frozen array so React's referential
 * equality on selectors holds no accidental rerenders if a caller
 * does `useLearningLanguage(s => s.list)`.
 */

import { create } from "zustand";

import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

export interface LearningLanguage {
  /**
   * ISO 639-1, falling back to 639-3 where 639-1 has no entry (Fon).
   * This is what Sayari and the recording filename consume.
   */
  iso: "tw" | "fon" | "wo";
  /** Localisation-independent display name. */
  displayName: string;
  /** Country of origin, shown under the chip in the picker. */
  country: string;
  /** Country flag emoji. */
  flagEmoji: string;
}

export const SUPPORTED_LEARNING_LANGUAGES: readonly LearningLanguage[] = Object.freeze([
  { iso: "tw", displayName: "Twi", country: "Ghana", flagEmoji: "🇬🇭" },
  { iso: "fon", displayName: "Fon", country: "Benin", flagEmoji: "🇧🇯" },
  { iso: "wo", displayName: "Wolof", country: "Senegal", flagEmoji: "🇸🇳" },
]);

/** Lookup by ISO. Returns `null` if unknown caller decides default. */
export function findLanguageByIso(iso: string | null): LearningLanguage | null {
  if (!iso) return null;
  return SUPPORTED_LEARNING_LANGUAGES.find((l) => l.iso === iso) ?? null;
}

interface LearningLanguageState {
  /** Selected ISO, or `null` if the user has not yet chosen. */
  iso: LearningLanguage["iso"] | null;
  /** Resolved record `null` until selection. */
  selected: LearningLanguage | null;
  /** True once we've read from localStorage. */
  hydrated: boolean;
  hydrate: () => void;
  select: (iso: LearningLanguage["iso"]) => void;
  /** Convenience matching Flutter's `isoOrDefault`. */
  isoOrDefault: () => LearningLanguage["iso"];
  /** Convenience matching Flutter's `displayNameOrDefault`. */
  displayNameOrDefault: () => string;
}

function readPersistedIso(): LearningLanguage["iso"] | null {
  const raw = safeStorage.getItem(StorageKeys.learningLanguage);
  const found = findLanguageByIso(raw);
  return found?.iso ?? null;
}

export const useLearningLanguage = create<LearningLanguageState>((set, get) => ({
  iso: null,
  selected: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const iso = readPersistedIso();
    set({
      iso,
      selected: findLanguageByIso(iso),
      hydrated: true,
    });
  },

  select: (iso) => {
    safeStorage.setItem(StorageKeys.learningLanguage, iso);
    set({ iso, selected: findLanguageByIso(iso), hydrated: true });
  },

  isoOrDefault: () => get().iso ?? "wo",
  displayNameOrDefault: () => get().selected?.displayName ?? "Wolof",
}));
