"use client";

import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { GameColors } from "@/lib/colors";

import { GrassRing } from "./grass";
import { WoodMedallion } from "./wood-medallion";

/**
 * WoodIconButton — the mockup's round wooden icon buttons (home,
 * gear, arrows). A wobbly wood medallion nested in grass with a
 * green lucide glyph on top.
 *
 * The glyph gets a hard 1-px drop shadow in deep green, which reads
 * as the outlined "sticker" look at UI sizes without needing filled
 * icon variants. Glyph colors are hex (lucide's `color` prop lands
 * on the SVG `stroke` attribute, which doesn't resolve CSS `var()`).
 */

export interface WoodIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  icon: LucideIcon;
  /** Accessible name — required, icon-only button. */
  label: string;
  /** Outer size in px (medallion + grass fit inside). */
  size?: number;
  /** Glyph color override (defaults to grass green). */
  iconColor?: string;
  /** Shadow/outline color under the glyph. */
  iconShadow?: string;
  grass?: boolean;
  className?: string;
}

export function WoodIconButton({
  icon: Icon,
  label,
  size = 56,
  iconColor = GameColors.grassLight,
  iconShadow = GameColors.grassDeep,
  grass = true,
  disabled,
  className,
  ...rest
}: WoodIconButtonProps) {
  const iconSize = Math.round(size * 0.44);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`relative isolate inline-flex shrink-0 select-none items-center justify-center rounded-full outline-offset-4 transition-transform duration-75 active:scale-95 disabled:opacity-60 ${
        className ?? ""
      }`}
      style={{ width: size, height: size }}
      {...rest}
    >
      {grass && <GrassRing />}
      <WoodMedallion className="absolute inset-0 h-full w-full" />
      <Icon
        aria-hidden="true"
        size={iconSize}
        strokeWidth={2.75}
        color={iconColor}
        className="relative z-10"
        style={{
          filter: `drop-shadow(0 1.5px 0 ${iconShadow})`,
          marginTop: -Math.round(size * 0.03),
        }}
      />
    </button>
  );
}
