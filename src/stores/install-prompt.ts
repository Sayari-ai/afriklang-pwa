"use client";

/**
 * Install-prompt store (Phase 1 of the retention roadmap).
 *
 * Why installing matters here more than for most PWAs: identity is a
 * localStorage UUID (`device-identity.ts`), and Safari evicts
 * script-writable storage after ~7 days of inactivity for
 * NON-installed sites. Installing to the home screen exempts the app
 * from that eviction (and marks the storage bucket durable on
 * Chromium), so "install" is literally the progress-preservation
 * feature on iOS — not just an engagement nicety.
 *
 * Two install paths, one store:
 *   * Chromium (Android/desktop): the browser fires
 *     `beforeinstallprompt`; we `preventDefault()` and stash the event
 *     so the UI can re-trigger the native sheet at a moment of our
 *     choosing (the celebration screen — peak motivation).
 *   * iOS Safari: no API. We can only detect iOS + not-installed and
 *     show Share → "Add to Home Screen" instructions.
 *
 * Anti-nagging contract (see the Intent anti-pattern catalog —
 * "Nagging", Category 5): a dismissal is persisted with a timestamp
 * and respected for `REOFFER_AFTER_DAYS`. The card never interrupts —
 * it renders inline on the celebration screen, never as a modal.
 *
 * Store follows the project's dual-API idiom: reactive via
 * `useInstallPrompt(selector)`, imperative via
 * `useInstallPrompt.getState()`. Persistence is manual `safeStorage`
 * (+ `hydrate()`), matching every other store.
 */

import { create } from "zustand";

import { track } from "@/lib/api/events";
import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

/** Chromium's non-standard event. Not in TS's DOM lib. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

/** How long a dismissal suppresses the card. */
const REOFFER_AFTER_DAYS = 14;
const REOFFER_AFTER_MS = REOFFER_AFTER_DAYS * 24 * 60 * 60 * 1000;

interface InstallPromptState {
  hydrated: boolean;
  /** Captured `beforeinstallprompt` event (Chromium only). */
  deferredEvent: BeforeInstallPromptEvent | null;
  /** Already running as an installed app (any platform). */
  isStandalone: boolean;
  /** iOS device (Safari's manual A2HS flow is the only install path). */
  isIos: boolean;
  /** ISO-8601 of the last "Not now", or null. */
  dismissedAt: string | null;

  hydrate: () => void;
  /**
   * True when the card should be offered: not installed, an install
   * path exists on this browser, and no recent dismissal.
   */
  canOffer: () => boolean;
  /**
   * Re-trigger the native Chromium install sheet. Resolves with the
   * user's outcome; "unavailable" when the deferred event is missing
   * (iOS, or already consumed — Chromium only lets it fire once).
   */
  promptNative: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** Persist a "Not now" and start the re-offer cool-off window. */
  dismiss: () => void;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // `navigator.standalone` is iOS Safari's legacy flag.
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (
    window.matchMedia("(display-mode: standalone)").matches || iosStandalone
  );
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const classic = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // iPadOS 13+ masquerades as macOS but exposes multi-touch.
  const modernIpad =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return classic || modernIpad;
}

export const useInstallPrompt = create<InstallPromptState>((set, get) => ({
  hydrated: false,
  deferredEvent: null,
  isStandalone: false,
  isIos: false,
  dismissedAt: null,

  hydrate: () => {
    if (get().hydrated) return;
    set({
      dismissedAt: safeStorage.getItem(StorageKeys.installPromptDismissedAt),
      isStandalone: detectStandalone(),
      isIos: detectIos(),
      hydrated: true,
    });
  },

  canOffer: () => {
    const s = get();
    if (!s.hydrated || s.isStandalone) return false;
    // No install path: not iOS and no captured Chromium event
    // (e.g. Firefox, or Chrome decided the app is ineligible).
    if (!s.deferredEvent && !s.isIos) return false;
    if (s.dismissedAt) {
      const t = Date.parse(s.dismissedAt);
      if (Number.isFinite(t) && Date.now() - t < REOFFER_AFTER_MS) {
        return false;
      }
    }
    return true;
  },

  promptNative: async () => {
    const evt = get().deferredEvent;
    if (!evt) return "unavailable";
    // The event is single-use: clear it up-front so a re-render can't
    // double-prompt while `userChoice` is pending.
    set({ deferredEvent: null });
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === "accepted") {
        track("install_prompt_accepted");
      } else {
        // Declining the OS sheet counts as a dismissal — start the
        // cool-off window rather than re-offering next level.
        get().dismiss();
      }
      return outcome;
    } catch {
      return "unavailable";
    }
  },

  dismiss: () => {
    const stamp = new Date().toISOString();
    safeStorage.setItem(StorageKeys.installPromptDismissedAt, stamp);
    set({ dismissedAt: stamp });
    track("install_prompt_dismissed");
  },
}));

// ---------------------------------------------------------------------------
// Global capture — called once from <AppHydration>
// ---------------------------------------------------------------------------

let captureRegistered = false;

/**
 * Registers the window-level listeners that feed the store. Idempotent;
 * safe to call from an effect that re-runs.
 *
 *   * `beforeinstallprompt` fires early (often before any UI wants it)
 *     — we stash the event for later replay.
 *   * `appinstalled` fires on successful install from ANY path (our
 *     prompt, browser menu, iOS Share sheet) — flip standalone state
 *     and record the win.
 */
export function initInstallPromptCapture(): void {
  if (captureRegistered || typeof window === "undefined") return;
  captureRegistered = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    // Suppress Chrome's mini-infobar; we choose the moment instead.
    e.preventDefault();
    useInstallPrompt.setState({
      deferredEvent: e as BeforeInstallPromptEvent,
    });
  });

  window.addEventListener("appinstalled", () => {
    useInstallPrompt.setState({ deferredEvent: null, isStandalone: true });
    track("app_installed");
  });
}
