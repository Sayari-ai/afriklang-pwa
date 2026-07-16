import { GrassRing } from "./grass";
import { PadlockIcon } from "./game-icons";
import { StarRating } from "./star-rating";
import { WoodMedallion } from "./wood-medallion";

/**
 * LevelBadge the mockup's circular wooden level medallion, used as
 * the map node. Fills its parent box (the map reserves an 80×80 slot)
 * and decorates outward: stars overhang the top on completed levels,
 * the green padlock overlaps the corner on locked ones.
 *
 * States:
 *   - completed → star arc (1–3 earned) above the disc + level number
 *   - current   → lively disc: cream ripple + gentle pulse + gold glow
 *   - locked    → muted wood, dimmed numeral, padlock badge
 */
export function LevelBadge({
  level,
  state,
  stars = 3,
  className,
}: {
  level: number;
  state: "completed" | "current" | "locked";
  /** Earned stars (completed state only), 0–3. */
  stars?: number;
  className?: string;
}) {
  return (
    <div className={`relative isolate h-full w-full ${className ?? ""}`}>
      {/* Current-level ripple ring (respects reduced motion). */}
      {state === "current" && (
        <span
          aria-hidden="true"
          className="absolute -inset-2 rounded-full border-[3px] border-cream/70 motion-safe:animate-[afk-ripple_1.4s_ease-in-out_infinite_alternate]"
        />
      )}

      <GrassRing />

      {/* Disc + numeral pulse together on the current level. */}
      <div
        className={`absolute inset-0 ${
          state === "current"
            ? "motion-safe:animate-[afk-pulse_1.4s_ease-in-out_infinite_alternate]"
            : ""
        }`}
        style={
          state === "current"
            ? { filter: "drop-shadow(0 0 10px rgba(255,201,60,0.55))" }
            : undefined
        }
      >
        <WoodMedallion
          muted={state === "locked"}
          className="absolute inset-0 h-full w-full"
        />
        <span
          className={`text-outline absolute inset-0 flex items-center justify-center pb-[6%] font-game text-[34px] leading-none ${
            state === "locked" ? "text-cream/60" : "text-cream"
          }`}
        >
          {level}
        </span>
      </div>

      {/* Earned-stars arc overhanging the top edge. */}
      {state === "completed" && (
        <StarRating
          filled={stars}
          size={20}
          className="absolute -top-[26%] left-1/2 z-20 w-max -translate-x-1/2"
        />
      )}

      {/* Padlock badge overlapping the lower-right edge. */}
      {state === "locked" && (
        <PadlockIcon className="absolute -bottom-1 -right-1.5 z-20 h-[52%] w-auto" />
      )}
    </div>
  );
}
