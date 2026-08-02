"use client";

/**
 * Silently syncs the signed-in Google account's display name to the
 * backend as this device's leaderboard name.
 *
 * Why this exists: leaderboard identity is stored *server-side* per
 * device (`device_nicknames`) other players only ever see what the
 * server has. There is no user-facing nickname flow anymore (Google
 * sign-in is mandatory, so we already know what to call the user);
 * without this push every row would render the server's deterministic
 * fallback ("Brave Lion 9F3A").
 *
 * Behaviour:
 *   - Runs inside the authed `(app)` shell (mounted from its layout),
 *     so a Google session and a device id are both guaranteed.
 *   - Pushes only when the normalised name differs from the last
 *     name the server confirmed (localStorage marker). First boot
 *     after sign-in syncs once; later boots are a single localStorage
 *     compare. Switching Google accounts re-syncs automatically.
 *   - Failures are silent no snackbar. The marker is only written
 *     after the server confirms, so the next boot retries. Meanwhile
 *     the leaderboard UI patches the caller's own rows client-side
 *     (see leaderboard page), so the user still sees their name.
 *   - Google accounts without a display name (`user.name === null`)
 *     or with a name that normalises below 2 code points keep the
 *     server-assigned fallback we never push the email address,
 *     which would leak PII onto a public surface.
 *
 * Renders nothing; it's a side-effect boundary like `<AppHydration>`.
 */

import { useEffect } from "react";

import { track } from "@/lib/api/events";
import { setNickname, toLeaderboardName } from "@/lib/api/nickname";
import { safeStorage } from "@/lib/safe-storage";
import { StorageKeys } from "@/lib/storage-keys";
import { useAuth } from "@/stores/auth";
import { useDeviceIdentity } from "@/stores/device-identity";

/**
 * Module-level in-flight latch. React 19 StrictMode double-fires
 * effects in dev; the server upsert is idempotent so a double POST
 * is harmless, but there's no reason to spend the request.
 */
let inFlightName: string | null = null;

export function DisplayNameSync() {
  const name = useAuth((s) => s.user?.name ?? null);
  const deviceId = useDeviceIdentity((s) => s.deviceId);

  useEffect(() => {
    if (!deviceId) return;
    const cleaned = toLeaderboardName(name);
    if (!cleaned) return;
    const previous = safeStorage.getItem(StorageKeys.displayNameSynced);
    if (previous === cleaned) return;
    if (inFlightName === cleaned) return;

    inFlightName = cleaned;
    setNickname({ deviceId, nickname: cleaned })
      .then(() => {
        // Record what we *sent*, not the server echo: the marker is
        // compared against `toLeaderboardName(user.name)` on the next
        // boot, so it must be in client-normalised form.
        safeStorage.setItem(StorageKeys.displayNameSynced, cleaned);
        track("display_name_synced", {
          // First sync vs. a later account/name change (no PII).
          had_previous: previous !== null,
        });
      })
      .catch(() => {
        // Silent by design retry next boot. The user's own screens
        // already show the Google name via the client-side override.
      })
      .finally(() => {
        if (inFlightName === cleaned) inFlightName = null;
      });
  }, [name, deviceId]);

  return null;
}
