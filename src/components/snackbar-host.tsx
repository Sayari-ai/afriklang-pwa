"use client";

/**
 * Renders the current snackbar message from `useSnackbar`.
 *
 * Mounted once in `(app)/layout.tsx`. We deliberately render even when
 * `message` is null so the in/out transitions stay smooth the
 * container's `opacity` and `translate-y` reflect presence.
 *
 * Flat redesign: white toast card with the standard 2px border and a
 * soft drop shadow, dark text.
 *
 * Position:
 *   - Bottom-anchored, above the fixed bottom-nav (which reserves
 *     `BOTTOM_NAV_RESERVED_PX`). We add a 12px gap on top of that.
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
        // card whenever a fresh message arrives, restarting the entry
        // transition from scratch.
        key={seq}
        className="max-w-md rounded-2xl border-2 border-border bg-bg px-5 py-3 text-[15px] font-bold text-text shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-all duration-200"
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
