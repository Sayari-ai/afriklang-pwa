/**
 * AppBackdrop the app-wide canvas decor.
 *
 * Cure for the "empty white page" feel: the phone column's canvas is
 * the purple-tinted off-white (`--color-bg-subtle`) and this layer
 * adds two whisper-quiet brand tints (blue glow falling from the
 * top, warm orange rising from the bottom corner) plus a faint
 * brand-ink dot grid the light-mode descendant of the old game
 * board texture. True surfaces (cards, stat bar, nav, sheets) stay
 * pure white on top, which restores depth and hierarchy.
 *
 * Rendered once in the root layout as the column's first child at
 * `-z-10` (the column is `isolate`, so negative z reliably sits
 * behind every screen while staying above the column background).
 * Decorative only: `aria-hidden`, `pointer-events-none`.
 */
export function AppBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Soft brand glows cool at the top, warm at the bottom. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 55% at 50% 0%, rgba(0,83,159,0.06) 0%, rgba(0,83,159,0) 60%), radial-gradient(95% 55% at 100% 100%, rgba(248,141,67,0.08) 0%, rgba(248,141,67,0) 55%)",
        }}
      />
      {/* Faint brand-ink dot grid quiet texture, not noise. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(50,30,83,0.05) 1.6px, transparent 1.6px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}
