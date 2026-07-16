"use client";

/**
 * Device identity store.
 *
 * Mirrors `lib/core/identity/device_identity.dart`: a single UUID v4,
 * generated on first need and persisted to localStorage. Every Edge
 * Function we call expects this `device_id` query param / body field,
 * so the store exposes both a reactive hook and a synchronous getter.
 *
 * Reinstall semantics:
 *   - Flutter: clearing app data wipes SharedPreferences -> new UUID
 *   - Web:     clearing site data wipes localStorage -> new UUID
 * Both cases consume a fresh path slot on the backend, which is the
 * documented "reinstall == new path" behaviour from the PoC spec.
 */

import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";

import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";

interface DeviceIdentityState {
  /** Cached UUID. `null` until `ensure()` has run at least once. */
  deviceId: string | null;
  /**
   * Read-or-create. Idempotent. Safe to call from effects on every
   * render only generates + persists on the first call per session.
   */
  ensure: () => string;
  /** Dev-only helper: rotate to a fresh UUID (also clears caller cache). */
  rotate: () => string;
}

function readPersisted(): string | null {
  return safeStorage.getItem(StorageKeys.deviceUuid);
}

export const useDeviceIdentity = create<DeviceIdentityState>((set, get) => ({
  deviceId: readPersisted(),

  ensure: () => {
    const cached = get().deviceId ?? readPersisted();
    if (cached) {
      // Sync the in-memory copy if we read straight from storage.
      if (get().deviceId !== cached) set({ deviceId: cached });
      return cached;
    }
    const fresh = uuidv4();
    safeStorage.setItem(StorageKeys.deviceUuid, fresh);
    set({ deviceId: fresh });
    return fresh;
  },

  rotate: () => {
    const fresh = uuidv4();
    safeStorage.setItem(StorageKeys.deviceUuid, fresh);
    set({ deviceId: fresh });
    return fresh;
  },
}));

/**
 * Synchronous accessor for non-React call sites (API clients, etc.).
 * Throws if called on the server every caller should be downstream
 * of a `'use client'` boundary by the time they need a device id.
 */
export function getDeviceIdSync(): string {
  if (typeof window === "undefined") {
    throw new Error(
      "getDeviceIdSync() called on the server. Device identity is " +
        "client-only gate the call behind a 'use client' component or " +
        "a useEffect.",
    );
  }
  return useDeviceIdentity.getState().ensure();
}
