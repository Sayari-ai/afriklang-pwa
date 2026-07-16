/**
 * Layout for the protected app shell `/home`, `/leaderboard`,
 * `/notifications`, `/profile`, and the level/celebration routes.
 *
 * Mirrors `lib/features/home/home_screen.dart:131-134` (Scaffold +
 * bottomNavigationBar) plus the `_AppRoot` gate from
 * `lib/main.dart:79-167` (we never render the home shell unless
 * onboarding/path-setup/consent are complete).
 *
 * Why a Server Component wrapping a client guard?
 *   - The guard has to read Zustand state, so it must be a client
 *     component. We keep this layout as a Server Component so the
 *     route segments below can stay servery by default and only
 *     opt-in to the client when they need to.
 *   - Level + celebration pages live under this group too. They
 *     don't render the bottom nav themselves, but they still benefit
 *     from the auth-style guard. We hide the nav for them in their
 *     own page bodies via a different layout pattern in Phase 6.7
 *     (probably absolute-positioning the nav as it is, and just
 *     adding bottom padding only on the tab pages).
 */

import type { ReactNode } from "react";

import { AppRouteGuard } from "@/components/app-route-guard";
import { SnackbarHost } from "@/components/snackbar-host";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <AppRouteGuard>
      {children}
      {/* Single host for ephemeral notices ("Level locked", upload
          errors, etc.) replaces Flutter's `ScaffoldMessenger`. */}
      <SnackbarHost />
    </AppRouteGuard>
  );
}
