"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button the flat "2.5D pressed" primary control of the redesign.
 *
 * Anatomy: flat fill, 16px radius, bold uppercase label, and a hard
 * bottom edge drawn with `box-shadow: 0 4px 0 <deep>`. Pressing
 * translates the button down onto the edge and removes the shadow 
 * the classic tactile game-button press, no JS.
 *
 * Variants:
 *   - `primary`   green fill, white label (main CTA)
 *   - `secondary` white fill, gray border, blue label
 *   - `danger`    red fill, white label (destructive)
 *   - `blue`      blue fill, white label (info actions)
 *
 * Disabled (or loading): flat gray slab, no edge, no press.
 */

type Variant = "primary" | "secondary" | "danger" | "blue";
type Size = "lg" | "md" | "sm";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-white shadow-[0_4px_0_var(--color-primary-deep)] active:translate-y-[4px]",
  secondary:
    "bg-bg text-blue border-2 border-border shadow-[0_2px_0_var(--color-border)] active:translate-y-[2px] disabled:border-transparent",
  danger:
    "bg-red text-white shadow-[0_4px_0_var(--color-red-deep)] active:translate-y-[4px]",
  blue: "bg-blue text-white shadow-[0_4px_0_var(--color-blue-deep)] active:translate-y-[4px]",
};

const SIZE_CLASSES: Record<Size, string> = {
  lg: "h-[52px] px-6 text-[15px] phone-sm:h-[48px] phone-sm:px-4 phone-sm:text-[13px]",
  md: "h-[46px] px-5 text-[14px]",
  sm: "h-[38px] px-4 text-[13px]",
};

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  /** Show a spinner in place of the label (implies disabled). */
  loading?: boolean;
  className?: string;
}

export function Button({
  children,
  variant = "primary",
  size = "lg",
  fullWidth = false,
  loading = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={`inline-flex select-none items-center justify-center rounded-2xl font-extrabold uppercase leading-tight tracking-[0.8px] transition-all duration-100 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-border disabled:text-text-faint disabled:shadow-none ${
        VARIANT_CLASSES[variant]
      } ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className ?? ""}`}
      // Kill the iOS Safari 300ms tap delay.
      style={{ touchAction: "manipulation" }}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="block h-[1.2em] w-[1.2em] animate-spin rounded-full border-[3px] border-current/25 border-t-current"
        />
      ) : (
        children
      )}
    </button>
  );
}
