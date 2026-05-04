/**
 * Composite (cycle, levelId) helpers.
 *
 * The PWA route `/level/[cycleLevel]` encodes BOTH the cycle and the
 * level id in a single URL segment, formatted as `${cycle}-${levelId}`.
 * Examples:
 *   - `/level/1-1` — cycle 1, level 1
 *   - `/level/2-3` — cycle 2, level 3
 *
 * Why a single segment instead of two?
 *   - Keeps the route directory shape unchanged (just a rename of `[id]`
 *     to `[cycleLevel]`); no new dynamic-route nesting to think about.
 *   - Old bookmarks of the form `/level/3` can still be detected and
 *     redirected by `parseCycleLevelParam` — which gracefully falls back
 *     to `cycle = 1` so single-cycle users don't get a 404.
 *
 * NEVER hand-build the URL by string concatenation; always go through
 * `formatCycleLevelParam` so we have a single place to evolve the format
 * if we ever decide to switch (e.g. to "?c=2"-style query params).
 */

export interface CycleLevelKey {
  cycle: number;
  levelId: number;
}

/**
 * Build the URL path segment for a (cycle, levelId) pair. Always emits
 * the canonical `${cycle}-${levelId}` form regardless of cycle value.
 *
 * Throws on non-positive integers — those are not legal anywhere in the
 * domain and emitting `0-3` or `-1-2` would only push the failure
 * downstream into a confusing "level not found" state.
 */
export function formatCycleLevelParam(key: CycleLevelKey): string {
  if (
    !Number.isInteger(key.cycle) ||
    !Number.isInteger(key.levelId) ||
    key.cycle < 1 ||
    key.levelId < 1
  ) {
    throw new RangeError(
      `formatCycleLevelParam: cycle and levelId must be positive ` +
        `integers (got cycle=${key.cycle}, levelId=${key.levelId})`,
    );
  }
  return `${key.cycle}-${key.levelId}`;
}

/**
 * Parse a `[cycleLevel]` route param. Tolerates two shapes:
 *
 *   - `${cycle}-${levelId}` — canonical, e.g. "2-3" → { cycle: 2, levelId: 3 }
 *   - `${levelId}`           — bare integer, e.g. "3" → { cycle: 1, levelId: 3 }
 *
 * Bare-integer parsing keeps any pre-multi-cycle deep-links and bookmarks
 * working: a single-cycle device's home map still produces the canonical
 * form (it'll emit `1-3`), but a user who landed on `/level/3` from a
 * shared link before the rename should still see level 3 of cycle 1.
 *
 * Returns `null` on any parse failure (negative numbers, non-numeric
 * segments, more than two parts). The route page treats `null` as a 404.
 */
export function parseCycleLevelParam(raw: string): CycleLevelKey | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parts = raw.split("-");
  if (parts.length === 1) {
    // Legacy single-integer form: assume cycle 1.
    const lvl = Number.parseInt(parts[0], 10);
    if (!Number.isInteger(lvl) || lvl < 1) return null;
    return { cycle: 1, levelId: lvl };
  }
  if (parts.length === 2) {
    const cyc = Number.parseInt(parts[0], 10);
    const lvl = Number.parseInt(parts[1], 10);
    if (!Number.isInteger(cyc) || cyc < 1) return null;
    if (!Number.isInteger(lvl) || lvl < 1) return null;
    return { cycle: cyc, levelId: lvl };
  }
  return null;
}

/**
 * Strict equality on the composite key. Use everywhere a `.find()` /
 * `.filter()` over progress entries is keyed on (cycle, levelId), so the
 * intent is explicit at the call site (and grep-able).
 */
export function cycleLevelEquals(
  a: CycleLevelKey,
  b: CycleLevelKey,
): boolean {
  return a.cycle === b.cycle && a.levelId === b.levelId;
}
