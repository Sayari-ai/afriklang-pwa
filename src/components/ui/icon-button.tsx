"use client";

import type { LucideIcon } from "lucide-react";

/**
 * IconButton small square/round icon control.
 *
 * Variants:
 *   - `ghost`   bare gray glyph (quit-X, back arrows) Duolingo's
 *               lesson chrome style. Press dims it.
 *   - `outline` white tile with gray border + hard bottom edge
 *               (refresh, secondary in-content actions).
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  size = 44,
  variant = "ghost",
  iconColor,
  className,
}: {
  icon: LucideIcon;
  /** Accessible name (aria-label). */
  label: string;
  onClick?: () => void;
  /** Outer square size in px. */
  size?: number;
  variant?: "ghost" | "outline";
  /** Override glyph color (hex lucide sets SVG `stroke`). */
  iconColor?: string;
  className?: string;
}) {
  const isOutline = variant === "outline";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center transition-all duration-100 ${
        isOutline
          ? "rounded-xl border-2 border-border bg-bg shadow-[0_2px_0_var(--color-border)] active:translate-y-[2px] active:shadow-none"
          : "rounded-xl active:opacity-60"
      } ${className ?? ""}`}
      style={{ width: size, height: size, touchAction: "manipulation" }}
    >
      <Icon
        size={Math.round(size * 0.55)}
        strokeWidth={3}
        // Hex, not var(): lucide's `color` prop becomes the SVG
        // `stroke` attribute, which doesn't resolve CSS vars.
        // Default = purple-tinted faint neutral (--color-text-faint).
        color={iconColor ?? "#A9A1BC"}
      />
    </button>
  );
}
