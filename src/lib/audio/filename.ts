/**
 * Recording filename + topic-slug builders.
 *
 * Direct port of the helpers in
 * `lib/features/level/level_screen.dart:184-209`. Keeping the same
 * format on web means the Sayari labelling team sees identical
 * filenames regardless of which client uploaded the clip.
 *
 * Filename:
 *   `${LanguageCode}_${SpeakerID}_${Date}_${Topic}.wav`
 *   e.g. wo_f47ac10b-58cc-4372-a567-0e02b2c3d479_20260501T143005Z_p01-L3-q4.wav
 *
 * Topic slug:
 *   `pNN-Lx-qy`
 *   - pathId  → 2-digit zero-padded
 *   - levelId → 1+ digits, no padding (matches Flutter)
 *   - qIndex  → 1+ digits, no padding
 *
 * Date stamp:
 *   `YYYYMMDDTHHMMSSZ` UTC (filesystem-safe + sortable)
 */

export interface RecordingNameArgs {
  languageIso: string;
  speakerId: string;
  pathId: number;
  levelId: number;
  qIndex: number;
  /** Override for tests; defaults to `new Date()`. */
  now?: Date;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

/** `pNN-Lx-qy` */
export function buildTopicSlug(args: {
  pathId: number;
  levelId: number;
  qIndex: number;
}): string {
  return `p${pad(args.pathId, 2)}-L${args.levelId}-q${args.qIndex}`;
}

/** `YYYYMMDDTHHMMSSZ` in UTC. */
export function buildUtcStamp(now: Date = new Date()): string {
  const u = now;
  return (
    `${pad(u.getUTCFullYear(), 4)}` +
    `${pad(u.getUTCMonth() + 1, 2)}` +
    `${pad(u.getUTCDate(), 2)}` +
    `T` +
    `${pad(u.getUTCHours(), 2)}` +
    `${pad(u.getUTCMinutes(), 2)}` +
    `${pad(u.getUTCSeconds(), 2)}` +
    `Z`
  );
}

/** `${ISO}_${UUID}_${YYYYMMDDTHHMMSSZ}_${pNN-Lx-qy}.wav` */
export function buildRecordingFilename(args: RecordingNameArgs): string {
  const topic = buildTopicSlug(args);
  const stamp = buildUtcStamp(args.now);
  return `${args.languageIso}_${args.speakerId}_${stamp}_${topic}.wav`;
}
