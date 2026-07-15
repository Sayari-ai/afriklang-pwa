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
        className="relative max-w-md px-5 py-3 text-[15px] font-bold text-cream transition-all duration-200"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(8px)",
        }}
      >
        {/* Wooden slat backdrop (carved rim + lit face). */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{
            background: "linear-gradient(180deg, #7d4423 0%, #56301a 100%)",
            borderRadius: "16px 14px 15px 14px / 14px 16px 13px 15px",
            boxShadow: "0 6px 12px rgba(0,0,0,0.45)",
          }}
        />
        <span
          aria-hidden="true"
          className="absolute -z-10"
          style={{
            inset: "3px 3px 6px 3px",
            background:
              "linear-gradient(180deg, var(--color-wood-light) 0%, var(--color-wood-mid) 60%, var(--color-wood-dark) 100%)",
            borderRadius: "13px 11px 12px 11px / 11px 13px 10px 12px",
            boxShadow:
              "inset 0 2px 0 rgba(255,235,205,0.4), inset 0 -3px 5px rgba(0,0,0,0.18)",
          }}
        />
        <span style={{ textShadow: "0 1px 0 rgba(92,48,24,0.6)" }}>
          {message ?? "\u00a0"}
        </span>
      </div>
    </div>
  );
}
