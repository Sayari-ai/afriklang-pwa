"use client";

/**
 * Sound-effects preference store.
 *
 * One persisted boolean: are UI feedback chimes (see
 * `src/lib/audio/sfx.ts`) enabled? Default is **on** absent key
 * means enabled, only an explicit `"false"` disables. That way the
 * feature lights up for existing installs without a migration, and
 * only a deliberate opt-out is remembered.
 *
 * Consumed two ways (the standard dual API):
 *   - reactively by the profile toggle row (`useSoundSettings(s => s.enabled)`);
 *   - imperatively by the sfx engine at play time
 *     (`useSoundSettings.getState().enabled`), which is why this store
 *     must never import `sfx.ts` back (cycle).
 */

import { create } from "zustand";

import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

interface SoundSettingsState {
  enabled: boolean;
  /** True once we've read from localStorage at least once. */
  hydrated: boolean;
  hydrate: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const useSoundSettings = create<SoundSettingsState>((set, get) => ({
  enabled: true,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const enabled = safeStorage.getItem(StorageKeys.soundEnabled) !== "false";
    set({ enabled, hydrated: true });
  },

  setEnabled: (enabled: boolean) => {
    safeStorage.setItem(StorageKeys.soundEnabled, enabled ? "true" : "false");
    set({ enabled, hydrated: true });
  },
}));
