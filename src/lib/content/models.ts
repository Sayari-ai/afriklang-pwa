/**
 * Domain models for path content + progress.
 *
 * Mirrors `lib/core/content/models.dart` and the JSON shapes returned
 * by the `paths_get` and `progress_get` Supabase Edge Functions. We
 * keep parser code (`parseXxx`) separate from the type definitions so
 * the cached payload (read from localStorage) and the network payload
 * go through the same validation path.
 *
 * Network-image-first: there is no `imageAsset` field every question
 * resolves to a Supabase Storage URL.
 */

export interface LevelQuestionData {
  qIndex: number;
  promptEn: string;
  imageUrl: string;
  /** ISO 639-1 (or 639-3 fallback for Fon). Defaults to `'wo'`. */
  languageIso: string;
}

export interface LevelDefinition {
  levelId: number;
  theme: string;
  pointsReward: number;
  questions: LevelQuestionData[];
}

export interface PathDefinition {
  pathId: number;
  cycle: number;
  levels: LevelDefinition[];
}

export type LevelProgressStatus = "locked" | "current" | "completed";

export interface ProgressEntry {
  levelId: number;
  status: LevelProgressStatus;
  /** ISO-8601 UTC. `null` while the level is locked or current. */
  completedAt: string | null;
  points: number;
  /**
   * Cycle this entry belongs to. Tolerant default `1` for the legacy
   * single-cycle backend response (or a cached payload from before the
   * multi-cycle refactor) that doesn't carry the field. Once cycle 2 is
   * issued the server stamps each row, and we group by `cycle` to
   * detect "all 8 of the active cycle done".
   */
  cycle: number;
  /**
   * Client-only: number of questions the user actually submitted
   * (i.e. uploaded a recording for) within this level. Skipped questions
   * don't count. Used to render a 3-star "completion quality" rating on
   * the home map. Undefined for levels that came from the backend with
   * no client-side completion event recorded yet (legacy / cross-device
   * progress) UI must treat undefined as "fully completed" to stay
   * compatible with the backend-only state.
   */
  submittedCount?: number;
  /**
   * Client-only: total number of questions in the level at the moment
   * of completion. Stored alongside `submittedCount` so the rating
   * remains stable even if the level definition is later edited.
   */
  totalSteps?: number;
}

export interface ProgressVector {
  entries: ProgressEntry[];
  totalPoints: number;
}

export interface PathAssignment {
  pathId: number;
  cycle: number;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Throws a `TypeError` rather than silently coercing Edge Function
 * payload bugs should be loud, not hidden.
 */
function asInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new TypeError(`Expected integer at ${field}, got ${typeof v}`);
  }
  return v;
}

function asString(v: unknown, field: string): string {
  if (typeof v !== "string") {
    throw new TypeError(`Expected string at ${field}, got ${typeof v}`);
  }
  return v;
}

function asObject(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new TypeError(`Expected object at ${field}, got ${typeof v}`);
  }
  return v as Record<string, unknown>;
}

function asArray(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new TypeError(`Expected array at ${field}, got ${typeof v}`);
  }
  return v;
}

export function parseLevelQuestion(raw: unknown): LevelQuestionData {
  const o = asObject(raw, "question");
  return {
    qIndex: asInt(o.q_index, "question.q_index"),
    promptEn: asString(o.prompt_en, "question.prompt_en"),
    imageUrl: asString(o.image_url, "question.image_url"),
    languageIso: typeof o.language === "string" ? o.language : "wo",
  };
}

export function parseLevel(raw: unknown): LevelDefinition {
  const o = asObject(raw, "level");
  return {
    levelId: asInt(o.level_id, "level.level_id"),
    theme: asString(o.theme, "level.theme"),
    pointsReward: asInt(o.points_reward, "level.points_reward"),
    questions: asArray(o.questions, "level.questions").map(parseLevelQuestion),
  };
}

export function parsePath(raw: unknown): PathDefinition {
  const o = asObject(raw, "path");
  return {
    pathId: asInt(o.path_id, "path.path_id"),
    cycle: asInt(o.cycle, "path.cycle"),
    levels: asArray(o.levels, "path.levels").map(parseLevel),
  };
}

export function parsePathAssignment(raw: unknown): PathAssignment {
  const o = asObject(raw, "assignment");
  return {
    pathId: asInt(o.path_id, "assignment.path_id"),
    cycle: asInt(o.cycle, "assignment.cycle"),
  };
}

/**
 * Parse `paths_get`'s response. Tolerates two shapes:
 *
 *   - **Legacy** (single cycle): `{ path_id, cycle, levels[] }` →
 *     wrapped as a one-element array `[parsePath(it)]`.
 *   - **Multi-cycle**: `{ cycles: [{ path_id, cycle, levels[] }, ...] }`
 *     → each entry parsed and returned in cycle-ascending order.
 *
 * Always returns at least one element (caller can rely on `[0]`).
 * Cycles are sorted ascending so downstream code that flattens
 * `levels[]` doesn't have to re-sort.
 */
export function parsePathBundle(raw: unknown): PathDefinition[] {
  const o = asObject(raw, "path");
  if (Array.isArray(o.cycles)) {
    const cycles = o.cycles.map(parsePath);
    cycles.sort((a, b) => a.cycle - b.cycle);
    return cycles;
  }
  // Legacy: parse the whole object as a single cycle.
  return [parsePath(raw)];
}

function parseStatus(v: unknown, field: string): LevelProgressStatus {
  const s = asString(v, field);
  if (s === "locked" || s === "current" || s === "completed") return s;
  // Unknown future values fall back to `locked` (safer than crashing).
  return "locked";
}

export function parseProgressEntry(raw: unknown): ProgressEntry {
  const o = asObject(raw, "progress_entry");
  const completedAt = o.completed_at;
  const submitted = o.submitted_count;
  const total = o.total_steps;
  // `cycle` is optional on the wire so legacy single-cycle responses
  // (and any cached payload written before the multi-cycle parsers
  // shipped) round-trip without a re-fetch. Default to cycle 1.
  const cycleRaw = o.cycle;
  const cycle =
    typeof cycleRaw === "number" && Number.isFinite(cycleRaw)
      ? Math.max(1, Math.trunc(cycleRaw))
      : 1;
  return {
    levelId: asInt(o.level_id, "progress_entry.level_id"),
    status: parseStatus(o.status, "progress_entry.status"),
    completedAt: typeof completedAt === "string" ? completedAt : null,
    points: typeof o.points === "number" ? Math.trunc(o.points) : 0,
    cycle,
    submittedCount:
      typeof submitted === "number" && Number.isFinite(submitted)
        ? Math.max(0, Math.trunc(submitted))
        : undefined,
    totalSteps:
      typeof total === "number" && Number.isFinite(total)
        ? Math.max(0, Math.trunc(total))
        : undefined,
  };
}

export function parseProgressVector(raw: unknown): ProgressVector {
  const o = asObject(raw, "progress");
  const entries = asArray(o.levels, "progress.levels").map(parseProgressEntry);
  const totalRaw = o.total_points;
  const totalPoints =
    typeof totalRaw === "number"
      ? Math.trunc(totalRaw)
      : entries.reduce((sum, e) => sum + e.points, 0);
  return { entries, totalPoints };
}

// ---------------------------------------------------------------------------
// Helpers (mirror Flutter convenience getters)
// ---------------------------------------------------------------------------

export function levelById(
  path: PathDefinition,
  levelId: number,
): LevelDefinition | null {
  return path.levels.find((l) => l.levelId === levelId) ?? null;
}

export function progressByLevel(
  vector: ProgressVector,
  cycle: number,
  levelId: number,
): ProgressEntry | null {
  return (
    vector.entries.find(
      (e) => e.cycle === cycle && e.levelId === levelId,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Multi-cycle helpers
// ---------------------------------------------------------------------------

/**
 * Concatenate every level across every cycle in cycle-ascending,
 * level_id-ascending order. Used by the home map (continuous scroll
 * spec). Each emitted entry carries its enclosing `cycle` so callers
 * can key React lists / progress lookups on the composite identity
 * (level ids are 1..8 *within a cycle* and NOT globally unique).
 */
export interface FlatLevel extends LevelDefinition {
  readonly cycle: number;
}

export function flattenLevels(
  bundle: ReadonlyArray<PathDefinition>,
): FlatLevel[] {
  const out: FlatLevel[] = [];
  for (const c of bundle) {
    for (const l of c.levels) {
      out.push({ ...l, cycle: c.cycle });
    }
  }
  return out;
}

/**
 * The largest `cycle` value present in `bundle`. Treated as the
 * *active* cycle everything below it is historical. Returns `1` for
 * an empty bundle (defensive; callers should never see this).
 */
export function activeCycle(
  bundle: ReadonlyArray<PathDefinition>,
): number {
  let max = 1;
  for (const c of bundle) if (c.cycle > max) max = c.cycle;
  return max;
}

/**
 * True iff every entry in `vector` whose `cycle === targetCycle` has
 * status `"completed"`. Returns `false` when the cycle has zero
 * entries (a malformed vector shouldn't auto-trigger advance).
 */
export function isCycleComplete(
  vector: ProgressVector,
  targetCycle: number,
): boolean {
  let seen = 0;
  for (const e of vector.entries) {
    if (e.cycle !== targetCycle) continue;
    seen += 1;
    if (e.status !== "completed") return false;
  }
  return seen > 0;
}
