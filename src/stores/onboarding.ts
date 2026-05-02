"use client";

/**
 * Onboarding-completion flag.
 *
 * Replaces Flutter's `OnboardingStatus` SharedPreferences key.
 * Boolean-only; no payload needed.
 */

import { create } from "zustand";

import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

interface OnboardingState {
  complete: boolean;
  hydrated: boolean;
  hydrate: () => void;
  markComplete: () => void;
  reset: () => void;
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  complete: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const raw = safeStorage.getItem(StorageKeys.onboardingComplete);
    set({ complete: raw === "true", hydrated: true });
  },

  markComplete: () => {
    safeStorage.setItem(StorageKeys.onboardingComplete, "true");
    set({ complete: true, hydrated: true });
  },

  reset: () => {
    safeStorage.removeItem(StorageKeys.onboardingComplete);
    set({ complete: false, hydrated: true });
  },
}));
