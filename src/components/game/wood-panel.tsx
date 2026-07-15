import type { ReactNode } from "react";

import { GrassEdge } from "./grass";
import { RibbonBanner } from "./ribbon";

/**
 * WoodPanel — the mockup's big wooden board: dark carved rim, lit
 * plank face with subtle grain streaks, grass poking out around the
 * edges, and an optional green ribbon title banner overlapping the
 * top edge.
 *
 * Content renders inside with sensible padding; override via
 * `contentClassName`. When a `ribbon` is passed the panel reserves
 * headroom for it (the banner overhangs the board by half its
 * height, like the mockup).
 */
export function WoodPanel({
  children,
  ribbon,
  grass = true,
  className,
  contentClassName,
}: {
  children: ReactNode;
  /** Optional title rendered in a green ribbon over the top edge. */
  ribbon?: ReactNode;
  grass?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={`relative ${ribbon != null ? "mt-6" : ""} ${className ?? ""}`}>
      <div className="relative isolate">
        {grass && <GrassEdge variant="panel" />}

        {/* Carved rim slab. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, #7d4423 0%, #56301a 100%)",
            borderRadius: "30px 26px 29px 27px / 27px 30px 26px 29px",
            boxShadow: "0 8px 14px rgba(0,0,0,0.4)",
          }}
        />
        {/* Lit plank face. */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            inset: "5px 5px 9px 5px",
            background:
              "linear-gradient(180deg, var(--color-wood-panel-light) 0%, var(--color-wood-panel-dark) 100%)",
            borderRadius: "25px 22px 24px 23px / 22px 25px 21px 24px",
            boxShadow:
              "inset 0 3px 0 rgba(255,235,200,0.35), inset 0 -5px 8px rgba(0,0,0,0.18)",
          }}
        />
        {/* Grain streaks — stretchy, clipped to the face. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 300 200"
          preserveAspectRatio="none"
          className="absolute"
          style={{
            inset: "5px 5px 9px 5px",
            borderRadius: "24px",
            overflow: "hidden",
          }}
        >
          <g fill="none" strokeLinecap="round">
            <path d="M14 44 Q150 34 286 46" stroke="rgba(158,91,44,0.4)" strokeWidth="3" />
            <path d="M10 98 Q150 108 290 96" stroke="rgba(158,91,44,0.34)" strokeWidth="3" />
            <path d="M16 152 Q150 144 284 154" stroke="rgba(158,91,44,0.4)" strokeWidth="3" />
            <path d="M12 70 Q150 78 288 68" stroke="rgba(255,235,205,0.18)" strokeWidth="2.5" />
            <path d="M14 126 Q150 120 286 128" stroke="rgba(255,235,205,0.14)" strokeWidth="2.5" />
          </g>
        </svg>

        {/* Content. */}
        <div
          className={`relative z-10 ${
            contentClassName ?? (ribbon != null ? "p-5 pt-9" : "p-5")
          }`}
        >
          {children}
        </div>
      </div>

      {ribbon != null && (
        <RibbonBanner
          className="absolute left-1/2 top-0 z-20 h-12 w-[76%] max-w-[300px] -translate-x-1/2 -translate-y-[55%]"
          textClassName="text-[19px] phone-sm:text-[17px]"
        >
          {ribbon}
        </RibbonBanner>
      )}
    </div>
  );
}
