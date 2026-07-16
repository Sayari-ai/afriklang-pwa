import { Check, Star } from "lucide-react";

import { LockIcon } from "./icons";
import { StarRating } from "./star-rating";

/**
 * PathNode a level node on the learning path.
 *
 * Fat flat circle with a hard bottom edge (3D press look), glyph-only
 * faces in the Duolingo style:
 *   - `current`   green, white star, ripple ring, optional bouncing
 *                 "START" speech bubble.
 *   - `completed` gold, white check, earned 1-3 star arc overhanging
 *                 the top edge.
 *   - `locked`    gray slab with a gray padlock.
 *
 * Presentational only the parent wraps it in a <button> (marked
 * `group` so the face depresses onto the edge while pressed).
 */

type NodeState = "completed" | "current" | "locked";

const NODE_COLORS: Record<NodeState, { fill: string; edge: string }> = {
  current: { fill: "var(--color-primary)", edge: "var(--color-primary-deep)" },
  completed: { fill: "var(--color-yellow)", edge: "var(--color-yellow-deep)" },
  locked: { fill: "var(--color-border)", edge: "var(--color-text-faint)" },
};

/** Height of the hard bottom edge in px. */
const EDGE = 8;

export function PathNode({
  state,
  stars = 3,
  size = 72,
  bubbleLabel,
}: {
  state: NodeState;
  /** Earned stars (completed nodes), 0-3. */
  stars?: number;
  /** Face circle diameter in px (total height = size + edge). */
  size?: number;
  /** When set (current node), renders the floating START bubble. */
  bubbleLabel?: string;
}) {
  const { fill, edge } = NODE_COLORS[state];
  const glyphSize = Math.round(size * 0.46);
  const pressable = state !== "locked";

  return (
    <span
      className="relative block"
      style={{ width: size, height: size + EDGE }}
    >
      {/* START speech bubble floats above the current node. */}
      {bubbleLabel && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 block -translate-x-1/2 motion-safe:animate-[afk-float_0.9s_ease-in-out_infinite_alternate]">
          <span className="relative block w-max max-w-[70vw] rounded-2xl border-2 border-border bg-bg px-4 py-2 text-[13px] font-extrabold uppercase tracking-[1px] text-primary phone-sm:max-w-[150px] phone-sm:px-3 phone-sm:text-[12px]">
            {bubbleLabel}
            {/* Caret: rotated square tucked under the bubble edge. */}
            <span
              aria-hidden
              className="absolute left-1/2 top-full block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-border bg-bg"
            />
          </span>
        </span>
      )}

      {/* Ripple ring around the current node. */}
      {state === "current" && (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-full border-4 border-primary/40 motion-safe:animate-[afk-ripple_1.8s_ease-out_infinite]"
          style={{ inset: `-6px -6px ${EDGE - 6}px -6px` }}
        />
      )}

      {/* Hard bottom edge (fixed). */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 rounded-full"
        style={{ height: size, background: edge }}
      />
      {/* Face circle depresses onto the edge while pressed. */}
      <span
        className={`absolute inset-x-0 top-0 flex items-center justify-center rounded-full transition-transform duration-100 ${
          pressable ? "group-active:translate-y-[6px]" : ""
        }`}
        style={{ height: size, background: fill }}
      >
        {state === "locked" ? (
          <LockIcon
            className="block"
            style={{ width: glyphSize, height: glyphSize }}
          />
        ) : state === "completed" ? (
          <Check
            size={glyphSize}
            strokeWidth={4.5}
            color="#FFFFFF"
            aria-hidden
          />
        ) : (
          <Star
            size={glyphSize}
            color="#FFFFFF"
            fill="#FFFFFF"
            strokeWidth={1}
            aria-hidden
          />
        )}
      </span>

      {/* Earned stars overhang the top edge of completed nodes. */}
      {state === "completed" && (
        <span className="pointer-events-none absolute -top-3.5 left-1/2 z-10 -translate-x-1/2">
          <StarRating filled={stars} size={13} />
        </span>
      )}
    </span>
  );
}
