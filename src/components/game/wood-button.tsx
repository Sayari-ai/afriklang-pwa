"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { GrassEdge } from "./grass";

/**
 * WoodButton the mockup's PLAY / SHOP / BUY button.
 *
 * Anatomy (bottom → top):
 *   - grass clumps poking out around the pill (optional)
 *   - dark rim slab with a chunky bottom edge (the "3D" base)
 *   - lit wood body (gradient + top bevel + bottom shade), inset from
 *     the rim, more at the bottom so the base reads as depth
 *   - chunky Lilita label in cream with a dark outline
 *
 * Pressing squashes the body down onto the base (classic game-button
 * press) via `group-active` transforms no JS.
 *
 * Tones: `wood` (default), `green` (grass confirm/positive),
 * `red` (destructive). The uneven border radii keep the edge organic.
 */

type Tone = "wood" | "green" | "red";
type Size = "lg" | "md" | "sm";

const SIZE_CLASSES: Record<Size, { root: string; label: string }> = {
  lg: {
    root: "h-16 px-8 phone-sm:h-14 phone-sm:px-6",
    label: "text-[23px] phone-sm:text-[19px]",
  },
  md: { root: "h-12 px-7", label: "text-[19px]" },
  sm: { root: "h-10 px-5", label: "text-[16px]" },
};

const TONE_STYLES: Record<
  Tone,
  { rim: string; body: string; bevel: string; outline: string }
> = {
  wood: {
    rim: "linear-gradient(180deg, #7d4423 0%, #5c3018 100%)",
    body: "linear-gradient(180deg, #e9a05b 0%, #d2854a 52%, #b96a31 100%)",
    bevel: "rgba(255,235,205,0.5)",
    outline: "var(--color-ink)",
  },
  green: {
    rim: "linear-gradient(180deg, #4c8f2f 0%, #35641f 100%)",
    body: "linear-gradient(180deg, #b5e162 0%, #8cc63f 55%, #6fac33 100%)",
    bevel: "rgba(240,255,210,0.55)",
    outline: "var(--color-grass-deep)",
  },
  red: {
    rim: "linear-gradient(180deg, #8a2a20 0%, #611c14 100%)",
    body: "linear-gradient(180deg, #f0705e 0%, #e04b3c 55%, #c03428 100%)",
    bevel: "rgba(255,220,210,0.45)",
    outline: "#611c14",
  },
};

/** Slightly uneven radii so the pill edge doesn't look machined. */
const RIM_RADIUS = "34px 30px 33px 31px / 30px 34px 29px 33px";
const BODY_RADIUS = "30px 27px 29px 28px / 26px 30px 25px 29px";

export interface WoodButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  fullWidth?: boolean;
  /** Show a spinner in place of the label (implies disabled). */
  loading?: boolean;
  /** Grass clumps behind the pill (mockup default). */
  grass?: boolean;
  className?: string;
}

export function WoodButton({
  children,
  tone = "wood",
  size = "lg",
  fullWidth = false,
  loading = false,
  grass = true,
  disabled,
  className,
  ...rest
}: WoodButtonProps) {
  const t = TONE_STYLES[tone];
  const s = SIZE_CLASSES[size];
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={`group relative isolate inline-flex select-none items-center justify-center outline-offset-4 disabled:opacity-60 ${
        fullWidth ? "w-full" : ""
      } ${s.root} ${className ?? ""}`}
      {...rest}
    >
      {grass && <GrassEdge variant="pill" />}

      {/* Base slab fixed; the body squashes onto it when pressed. */}
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: t.rim,
          borderRadius: RIM_RADIUS,
          boxShadow: "0 6px 10px rgba(0,0,0,0.35)",
        }}
      />
      {/* Lit wood body. */}
      <span
        aria-hidden="true"
        className="absolute transition-transform duration-75 group-active:translate-y-[3px]"
        style={{
          inset: "3px 4px 8px 4px",
          background: t.body,
          borderRadius: BODY_RADIUS,
          boxShadow: `inset 0 3px 0 ${t.bevel}, inset 0 -5px 8px rgba(0,0,0,0.18)`,
        }}
      />
      {/* Label. `leading-tight` + centered so long i18n strings (e.g.
          FR "Démarrer le prochain parcours") can wrap to two lines
          inside the pill instead of overflowing it. */}
      <span
        className={`text-outline relative z-10 text-center font-game leading-tight tracking-wide text-cream transition-transform duration-75 group-active:translate-y-[3px] ${s.label}`}
        style={{ "--outline-color": t.outline } as React.CSSProperties}
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="block h-[1.1em] w-[1.1em] animate-spin rounded-full border-[3px] border-cream/40 border-t-cream"
          />
        ) : (
          children
        )}
      </span>
    </button>
  );
}
