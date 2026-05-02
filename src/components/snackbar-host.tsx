"use client";

/**
 * Renders the current snackbar message from `useSnackbar`.
 *
 * Mounted once in `(app)/layout.tsx`. We deliberately render even when
 * `message` is null so the in/out transitions stay smooth — the
 * container's `opacity` and `translate-y` reflect presence.
 *
 * Position:
 *   - Bottom-anchored, above the floating bottom-nav (which reserves
 *     `BOTTOM_NAV_RESERVED_PX = 96`). We add a 12 px gap on top of
 *     that.
 *   - Centred horizontally with a max-width so very long messages
 *     wrap rather than spill across desktop viewports.
 *
 * `aria-live="polite"` so screen readers announce changes without
 * interrupting whatever the user is currently focused on.
 */

import { useSnackbar } from "@/stores/snackbar";
import { BOTTOM_NAV_RESERVED_PX } from "./bottom-nav";

export function SnackbarHost() {
  const message = useSnackbar((s) => s.message);
  const seq = useSnackbar((s) => s.seq);
  const visible = message !== null;

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: BOTTOM_NAV_RESERVED_PX + 12 }}
    >
      <div
        // Re-key on `seq` so React tears down + remounts the inner
        // pill whenever a fresh message arrives, restarting the entry
        // transition from scratch.
        key={seq}
        className="max-w-md rounded-2xl bg-[#323232] px-4 py-3 text-[15px] font-medium text-white shadow-lg transition-all duration-200"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(8px)",
        }}
      >
        {message ?? "\u00a0"}
      </div>
    </div>
  );
}
