"use client";

/**
 * User-chosen leaderboard nickname.
 *
 * Two pieces of state live here:
 *   - `value`: the chosen string, or `null` if the user has not set
 *     one. Until that's `null` the leaderboard UI falls back to the
 *     server-assigned nickname returned by `leaderboard_get`.
 *   - `prompted`: a boolean flag tracking whether the first-run
 *     prompt on `/home` has been shown at least once. Persisting it
 *     separately from `value` lets a user dismiss the prompt without
 *     committing a name and not get re-prompted on every cold start.
 *
 * Why a dedicated store rather than folding this into `useOnboarding`?
 *   - The prompt fires *after* onboarding finished — it lives on the
 *     map screen, not in the `/onboarding` route. Coupling the two
 *     would muddy the gating logic in `<AppRouteGuard>` and the
 *     splash decision tree.
 *   - The nickname is also editable from `/profile` later, which is
 *     a long-lived concern; onboarding is a one-shot flag.
 *
 * Persistence: same `safeStorage` pattern as every other store, with
 * `StorageKeys.nickname` and `StorageKeys.nicknamePrompted`.
 *
 * Validation rules (kept in `validateNickname` so the prompt sheet
 * and the profile edit sheet share one source of truth):
 *   - Trim leading/trailing whitespace.
 *   - Collapse runs of whitespace to a single space.
 *   - Min 2 characters, max 20 characters after normalisation.
 *   - Unicode allowed — users will want to write their own names in
 *     non-Latin scripts.
 */

import { create } from "zustand";

import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

export type NicknameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "too_short" | "too_long" };

/**
 * Normalises and validates a nickname candidate.
 *
 * Pure — no store access — so the prompt UI can call it on every
 * keystroke to drive the inline error message and Submit-button
 * disabled state without dragging a hook in.
 */
export function validateNickname(raw: string): NicknameValidation {
  // Collapse interior whitespace runs (incl. tabs, NBSP) to a single
  // ASCII space, then trim. Doing collapse-before-trim catches the
  // edge case of `"   "` becoming `" "` then `""` cleanly.
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return { ok: false, reason: "empty" };
  // Code-point count, not UTF-16 code-unit count: an emoji or a
  // composed letter shouldn't burn 2 of the 20 slots.
  const cpLength = [...collapsed].length;
  if (cpLength < NICKNAME_MIN_LENGTH) return { ok: false, reason: "too_short" };
  if (cpLength > NICKNAME_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, value: collapsed };
}

interface NicknameState {
  value: string | null;
  prompted: boolean;
  hydrated: boolean;
  hydrate: () => void;
  /** Persists the value optimistically. Caller is expected to fire
   *  the network write and surface its outcome via snackbar. */
  set: (next: string) => void;
  /** Marks the first-run prompt as having been shown. Idempotent. */
  markPrompted: () => void;
  /** Test/reset hook — clears both keys. */
  reset: () => void;
}

export const useNickname = create<NicknameState>((set, get) => ({
  value: null,
  prompted: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const v = safeStorage.getItem(StorageKeys.nickname);
    const p = safeStorage.getItem(StorageKeys.nicknamePrompted);
    set({
      // Treat empty strings as "not set" so an old corrupt write
      // can't masquerade as a legitimate nickname.
      value: typeof v === "string" && v.length > 0 ? v : null,
      prompted: p === "true",
      hydrated: true,
    });
  },

  set: (next) => {
    safeStorage.setItem(StorageKeys.nickname, next);
    set({ value: next, hydrated: true });
  },

  markPrompted: () => {
    safeStorage.setItem(StorageKeys.nicknamePrompted, "true");
    set({ prompted: true, hydrated: true });
  },

  reset: () => {
    safeStorage.removeItem(StorageKeys.nickname);
    safeStorage.removeItem(StorageKeys.nicknamePrompted);
    set({ value: null, prompted: false, hydrated: true });
  },
}));
