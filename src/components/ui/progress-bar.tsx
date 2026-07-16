/**
 * ProgressBar the lesson progress bar.
 *
 * Flat gray track with a green rounded fill; the fill carries a
 * subtle white top-stripe highlight (the signature detail). Width
 * animates so step advances feel continuous.
 */
export function ProgressBar({
  value,
  max,
  className,
}: {
  /** Current progress (0..max). */
  value: number;
  max: number;
  className?: string;
}) {
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(1, value / safeMax)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.max(0, Math.min(safeMax, value))}
      className={`h-4 w-full overflow-hidden rounded-full bg-border ${className ?? ""}`}
    >
      {pct > 0 && (
        <div
          className="relative h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          // Keep the rounded cap legible on the very first step.
          style={{ width: `max(${pct}%, 12px)` }}
        >
          <span
            aria-hidden
            className="absolute inset-x-2 top-1 block h-1 rounded-full bg-white/30"
          />
        </div>
      )}
    </div>
  );
}
