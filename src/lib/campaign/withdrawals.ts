/**
 * Campaigns whose consent was withdrawn from this app (APP-004, H-1).
 *
 * A submit or ticket refused with `campaign_consent` deletes the take only when the speaker
 * withdrew here: then the audio must not stay on the phone. Any other `campaign_consent` (a
 * withdrawal on another device, or a dashboard that answers it for a new consent version) only
 * holds the take, which goes once the consent is signed again. Kept on the phone (localStorage)
 * so it survives a restart; signing the campaign consent again clears it.
 */

const KEY = "afriklang.campaign.withdrawn.v1";
const MAX = 200;

type Store = Pick<Storage, "getItem" | "setItem">;

function storage(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const entry = (userId: string, campaignId: string) => `${userId}:${campaignId}`;

function read(s: Store | null): string[] {
  try {
    const v: unknown = JSON.parse(s?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(s: Store | null, list: string[]) {
  try {
    s?.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    // storage full or blocked: the take is held instead of deleted, never lost
  }
}

/** The speaker withdrew this campaign's consent from this app. */
export function markWithdrawn(userId: string, campaignId: string, s: Store | null = storage()) {
  const list = read(s).filter((x) => x !== entry(userId, campaignId));
  write(s, [...list, entry(userId, campaignId)]);
}

/** The campaign consent was signed again: its takes may go. */
export function clearWithdrawn(campaignId: string, s: Store | null = storage()) {
  const list = read(s);
  const kept = list.filter((x) => !x.endsWith(`:${campaignId}`));
  if (kept.length !== list.length) write(s, kept);
}

export function withdrawnHere(userId: string, campaignId: string, s: Store | null = storage()): boolean {
  return read(s).includes(entry(userId, campaignId));
}
