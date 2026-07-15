"use client";

import type { ReactNode } from "react";

import { CoinIcon, EnergyIcon } from "./game-icons";
import { WoodMedallion } from "./wood-medallion";

/**
 * ResourceCounter — the mockup's coin/energy counter bar: a wooden
 * slat with a round medallion slot at the left holding the resource
 * icon, the amount in chunky game type, and an optional green "+"
 * chip at the right end.
 */
export function ResourceCounter({
  icon = "coin",
  value,
  suffix,
  onAdd,
  addLabel,
  className,
}: {
  /** Built-in icons, or pass any node (sized ~60% of the slot). */
  icon?: "coin" | "energy" | ReactNode;
  value: ReactNode;
  /** Small trailing unit label (body face, e.g. "points"). */
  suffix?: ReactNode;
  /** When set, renders the green plus chip. */
  onAdd?: () => void;
  /** Accessible name for the plus chip (required with onAdd). */
  addLabel?: string;
  className?: string;
}) {
  const iconNode =
    icon === "coin" ? (
      <CoinIcon className="h-[62%] w-[62%]" />
    ) : icon === "energy" ? (
      <EnergyIcon className="h-[62%] w-[62%]" />
    ) : (
      icon
    );

  return (
    <div className={`relative flex h-12 items-center ${className ?? ""}`}>
      {/* Wooden slat — starts under the medallion, rounded ends. */}
      <div aria-hidden="true" className="absolute inset-y-1 left-6 right-0">
        <span
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, #7d4423 0%, #5c3018 100%)",
            borderRadius: "18px 22px 20px 24px / 20px 18px 22px 19px",
            boxShadow: "0 4px 8px rgba(0,0,0,0.35)",
          }}
        />
        <span
          className="absolute"
          style={{
            inset: "3px 3px 6px 3px",
            background:
              "linear-gradient(180deg, var(--color-wood-light) 0%, var(--color-wood-mid) 55%, var(--color-wood-dark) 100%)",
            borderRadius: "15px 19px 17px 20px / 17px 15px 18px 16px",
            boxShadow:
              "inset 0 2px 0 rgba(255,235,205,0.45), inset 0 -3px 5px rgba(0,0,0,0.18)",
          }}
        />
      </div>

      {/* Medallion slot with the resource icon. */}
      <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center">
        <WoodMedallion className="absolute inset-0 h-full w-full" />
        <span className="relative z-10 flex h-full w-full items-center justify-center pb-[5%]">
          {iconNode}
        </span>
      </div>

      {/* Amount + unit. */}
      <div className="relative z-10 flex min-w-0 flex-1 items-baseline gap-1.5 pl-2.5 pr-2">
        <span className="text-outline truncate font-game text-[22px] leading-none text-cream phone-sm:text-[19px]">
          {value}
        </span>
        {suffix != null && (
          <span className="truncate text-[13px] font-bold text-cream/90 phone-sm:text-[12px]">
            {suffix}
          </span>
        )}
      </div>

      {/* Green plus chip. */}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="relative z-10 mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-75 active:scale-90"
          style={{
            background:
              "linear-gradient(180deg, #b5e162 0%, var(--color-grass-light) 55%, #6fac33 100%)",
            boxShadow:
              "0 2px 0 var(--color-grass-deep), inset 0 2px 0 rgba(240,255,210,0.55)",
          }}
        >
          <span
            aria-hidden="true"
            className="text-outline font-game text-[20px] leading-none text-cream"
            style={
              {
                "--outline-color": "var(--color-grass-deep)",
              } as React.CSSProperties
            }
          >
            +
          </span>
        </button>
      )}
    </div>
  );
}
