"use client";

/**
 * Consent store.
 *
 * Mirrors `lib/core/consent/consent_service.dart`. Two persisted
 * fields under matching SharedPreferences keys:
 *   - `granted`     -> bool
 *   - `granted_at`  -> ISO-8601 UTC timestamp of the *first* grant
 *
 * Semantics:
 *   - Granting flips `granted=true` and stamps `granted_at` if it
 *     isn't already set (so we keep the original consent date even if
 *     the user toggles off and on again same as Flutter).
 *   - Revoking flips `granted=false` but **preserves** `granted_at` so
 *     audit logs / Sayari uploads can still report when the original
 *     consent was given.
 *
 * The store is the single source of truth for both the consent gate
 * (Phase 6) and the audio-upload pipeline (Phase 5), which refuses to
 * upload while `granted` is false.
 */

import { create } from "zustand";

import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

interface ConsentState {
  granted: boolean;
  /** ISO-8601 UTC. `null` until the user has ever granted consent. */
  grantedAt: string | null;
  grant: () => void;
  revoke: () => void;
  /** True once we've read from localStorage at least once. */
  hydrated: boolean;
  hydrate: () => void;
}

function readPersisted(): { granted: boolean; grantedAt: string | null } {
  const granted = safeStorage.getItem(StorageKeys.consentGranted) === "true";
  const grantedAt = safeStorage.getItem(StorageKeys.consentGrantedAt);
  return { granted, grantedAt };
}

export const useConsent = create<ConsentState>((set, get) => ({
  granted: false,
  grantedAt: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const persisted = readPersisted();
    set({ ...persisted, hydrated: true });
  },

  grant: () => {
    const existingAt = get().grantedAt ?? safeStorage.getItem(StorageKeys.consentGrantedAt);
    const stamp = existingAt ?? new Date().toISOString();
    safeStorage.setItem(StorageKeys.consentGranted, "true");
    safeStorage.setItem(StorageKeys.consentGrantedAt, stamp);
    set({ granted: true, grantedAt: stamp, hydrated: true });
  },

  revoke: () => {
    safeStorage.setItem(StorageKeys.consentGranted, "false");
    // Intentionally keep granted_at see file header.
    set({ granted: false, hydrated: true });
  },
}));
