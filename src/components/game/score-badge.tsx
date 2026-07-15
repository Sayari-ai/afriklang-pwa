import type { ReactNode } from "react";

import { GrassRing } from "./grass";
import { RibbonBanner } from "./ribbon";
import { WoodMedallion } from "./wood-medallion";

/**
 * ScoreBadge — the mockup's "score 631" medallion: wooden disc in
 * grass with a caption carved near the top and a green ribbon
 * wrapping the lower half carrying the value.
 */
export function ScoreBadge({
  label,
  value,
  size = 104,
  className,
}: {
  /** Small caption above the ribbon (e.g. "score"). */
  label: ReactNode;
  /** Ribbon value (e.g. a points number). */
  value: ReactNode;
  /** Outer diameter in px. */
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`relative isolate ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <GrassRing />
      <WoodMedallion className="absolute inset-0 h-full w-full" />
      <span
        className="text-outline absolute inset-x-0 flex justify-center font-game leading-none text-cream"
        style={{ top: size * 0.22, fontSize: size * 0.155 }}
      >
        {label}
      </span>
      <div
        className="absolute z-10"
        style={{
          left: -size * 0.13,
          right: -size * 0.13,
          bottom: size * 0.06,
          height: size * 0.38,
        }}
      >
        <RibbonBanner className="h-full w-full" textClassName="text-[1em]">
          <span style={{ fontSize: size * 0.21 }}>{value}</span>
        </RibbonBanner>
      </div>
    </div>
  );
}
