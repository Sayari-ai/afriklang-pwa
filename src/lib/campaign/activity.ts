/**
 * The contributor's recent activity on this phone: takes sent, takes the checks refused, consents
 * signed, profile saved. The dashboard keeps the authoritative state (mission statuses); this log
 * adds the "when" for the History screen. Kept per user, newest first, at most MAX entries.
 */

export type ActivityType = "sent" | "rejected" | "failed" | "profile" | "consent" | "withdrawn";

export type Activity = {
  at: number;
  type: ActivityType;
  campaignId?: string;
  missionId?: string;
  missionCode?: string;
  /** A reason or code, when there is one. */
  detail?: string;
};

const MAX = 200;
const PREFIX = "afriklang.campaign.activity.v1:";

type Store = Pick<Storage, "getItem" | "setItem">;
const listeners = new Set<() => void>();
const memo = new Map<string, Activity[]>();

function storage(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readActivity(userId: string, s: Store | null = storage()): Activity[] {
  const hit = memo.get(userId);
  if (hit) return hit;
  let list: Activity[] = [];
  try {
    const raw = s?.getItem(PREFIX + userId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) list = parsed.filter((a): a is Activity => !!a && typeof a === "object" && typeof (a as Activity).at === "number" && typeof (a as Activity).type === "string");
  } catch {
    list = [];
  }
  memo.set(userId, list);
  return list;
}

export function logActivity(userId: string, a: Omit<Activity, "at"> & { at?: number }, s: Store | null = storage()) {
  const next = [{ ...a, at: a.at ?? Date.now() }, ...readActivity(userId, s)].slice(0, MAX);
  memo.set(userId, next);
  try {
    s?.setItem(PREFIX + userId, JSON.stringify(next));
  } catch {
    // memory only
  }
  for (const l of [...listeners]) l();
}

export function subscribeActivity(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Group by calendar day (local time), newest day first. `dayKey` is YYYY-MM-DD. */
export function byDay(list: readonly Activity[]): { dayKey: string; items: Activity[] }[] {
  const out: { dayKey: string; items: Activity[] }[] = [];
  for (const a of [...list].sort((x, y) => y.at - x.at)) {
    const d = new Date(a.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const last = out[out.length - 1];
    if (last && last.dayKey === key) last.items.push(a);
    else out.push({ dayKey: key, items: [a] });
  }
  return out;
}

/** Consecutive days, ending today or yesterday, with at least one take sent. */
export function streakDays(list: readonly Activity[], now = Date.now()): number {
  const days = new Set(list.filter((a) => a.type === "sent").map((a) => new Date(a.at).toDateString()));
  const d = new Date(now);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
