import { buildUtcStamp } from "@/lib/audio/filename";

const MAX_LENGTH = 120;

/** Keep only [A-Za-z0-9-]: the name ends up in a storage path, so no separators, dots or spaces. */
export function sanitizePart(value: string, maxLen: number, fallback: string): string {
  const clean = value.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLen);
  return clean || fallback;
}

/** `${lang}_${speakerId}_${YYYYMMDDTHHMMSSZ}_${missionCode}.wav`, at most 120 characters. */
export function buildCampaignFilename(args: { languageCode: string; speakerId: string; missionCode: string; now?: Date }): string {
  const lang = sanitizePart(args.languageCode, 12, "xx");
  const speaker = sanitizePart(args.speakerId, 64, "unknown");
  const stamp = buildUtcStamp(args.now ?? new Date());
  const fixed = lang.length + speaker.length + stamp.length + 3 + ".wav".length;
  const code = sanitizePart(args.missionCode, Math.max(1, MAX_LENGTH - fixed), "mission");
  return `${lang}_${speaker}_${stamp}_${code}.wav`;
}
