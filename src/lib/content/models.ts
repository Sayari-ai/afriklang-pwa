/**
 * Domain models for path content + progress.
 *
 * Mirrors `lib/core/content/models.dart` and the JSON shapes returned
 * by the `paths_get` and `progress_get` Supabase Edge Functions. We
 * keep parser code (`parseXxx`) separate from the type definitions so
 * the cached payload (read from localStorage) and the network payload
 * go through the same validation path.
 *
 * Network-image-first: there is no `imageAsset` field — every question
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
 * Throws a `TypeError` rather than silently coercing — Edge Function
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

function parseStatus(v: unknown, field: string): LevelProgressStatus {
  const s = asString(v, field);
  if (s === "locked" || s === "current" || s === "completed") return s;
  // Unknown future values fall back to `locked` (safer than crashing).
  return "locked";
}

export function parseProgressEntry(raw: unknown): ProgressEntry {
  const o = asObject(raw, "progress_entry");
  const completedAt = o.completed_at;
  return {
    levelId: asInt(o.level_id, "progress_entry.level_id"),
    status: parseStatus(o.status, "progress_entry.status"),
    completedAt: typeof completedAt === "string" ? completedAt : null,
    points: typeof o.points === "number" ? Math.trunc(o.points) : 0,
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
  levelId: number,
): ProgressEntry | null {
  return vector.entries.find((e) => e.levelId === levelId) ?? null;
}
