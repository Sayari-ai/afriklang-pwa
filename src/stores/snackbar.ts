"use client";

/**
 * Lightweight snackbar replacement for Flutter's `ScaffoldMessenger`.
 *
 * Design:
 *   - Single-slot stack: a new `show()` replaces the previous message
 *     (matches `ScaffoldMessenger.showSnackBar` default behaviour where
 *     a fresh call animates the existing one out and the new one in).
 *   - Auto-dismiss after `durationMs` (default 2400 ms — close to
 *     Flutter's 4 s minus the entry/exit animation).
 *   - Imperative API only (`useSnackbar.getState().show(...)`); we do
 *     not subscribe consumers to the message because nobody needs to
 *     read it — only the host renders.
 *
 * The accompanying `<SnackbarHost>` component is mounted once in
 * `(app)/layout.tsx` so every authenticated screen gets it for free.
 */

import { create } from "zustand";

interface SnackbarState {
  /** Current message (or `null` if the snackbar is hidden). */
  message: string | null;
  /** Monotonically-increasing token; lets the host key the animation. */
  seq: number;
  /** Show a message for `durationMs` (default 2400). */
  show: (message: string, durationMs?: number) => void;
  /** Force-dismiss. Rarely needed — auto-dismiss covers most cases. */
  dismiss: () => void;
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export const useSnackbar = create<SnackbarState>((set, get) => ({
  message: null,
  seq: 0,
  show: (message, durationMs = 2400) => {
    if (dismissTimer) clearTimeout(dismissTimer);
    set({ message, seq: get().seq + 1 });
    dismissTimer = setTimeout(() => {
      // Only clear if we're still showing the same message — defends
      // against a stale timer racing a fresh show() call.
      set({ message: null });
      dismissTimer = null;
    }, durationMs);
  },
  dismiss: () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    set({ message: null });
  },
}));
