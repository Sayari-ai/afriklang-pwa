/**
 * Pure rules of pool campaigns (dispatch "pool") and of pay per hour.
 *
 * A pool campaign does not hand every mission out up front: the speaker draws a small batch when
 * they want to record, holds it under a lease (`lease_until`), and a mission not submitted before
 * its lease ends goes back to the pool. Planned campaigns never pass through anything here except
 * `isPool` (false) and the time formatting.
 *
 * Contract: afriklang-landing-page/docs/CAMPAIGN_BRIDGE_CONTRACT.md ("Pool dispatch").
 */

import type { CampaignCard, Mission, PoolStatus, PoolView, Rewards, CampaignErrorCode } from "./types";

/** A card from a dashboard older than pool dispatch has no `dispatch`: it is planned. */
export const isPool = (c: Pick<CampaignCard, "dispatch">) => c.dispatch === "pool";

/** The dashboard's default when a pool card does not say. */
export const DEFAULT_REFILL_BELOW = 5;

export const refillBelow = (c: Pick<CampaignCard, "refill_below">) =>
  typeof c.refill_below === "number" && c.refill_below > 0 ? c.refill_below : DEFAULT_REFILL_BELOW;

const isOpen = (m: Pick<Mission, "status">) => m.status === "todo" || m.status === "rejected";

/** ms since epoch of the lease end, or null without a (readable) lease. */
function leaseEnd(m: Pick<Mission, "lease_until">): number | null {
  if (!m.lease_until) return null;
  const t = Date.parse(m.lease_until);
  return Number.isFinite(t) ? t : null;
}

/**
 * An open pool mission whose lease ended: it is back in the pool and the dashboard no longer lists
 * it. The phone hides it too (the saved list may be older than the lease), and never starts it.
 * Submitted missions are never "over": the dashboard keeps them.
 */
export function leaseOver(m: Pick<Mission, "status" | "lease_until">, now: number): boolean {
  if (!isOpen(m)) return false;
  const end = leaseEnd(m);
  return end != null && end <= now;
}

/** The missions still the speaker's: without the open ones whose lease ended. Same array when nothing changed. */
export function liveMissions<M extends Pick<Mission, "status" | "lease_until">>(missions: readonly M[], now: number): readonly M[] {
  return missions.some((m) => leaseOver(m, now)) ? missions.filter((m) => !leaseOver(m, now)) : missions;
}

/** When the earliest lease among the open missions ends (ms), or null when none is leased. */
export function earliestLease(missions: readonly Pick<Mission, "status" | "lease_until">[], now: number): number | null {
  let best: number | null = null;
  for (const m of missions) {
    if (!isOpen(m)) continue;
    const end = leaseEnd(m);
    if (end != null && end > now && (best == null || end < best)) best = end;
  }
  return best;
}

/** A lease ending within this is shown as urgent. */
export const LEASE_URGENT_MS = 24 * 3_600_000;

/** Whole hours left until `end` (at least 1 while it has not passed), for "ends in N h". */
export const hoursLeft = (end: number, now: number) => Math.max(1, Math.ceil((end - now) / 3_600_000));

// ── When to draw ─────────────────────────────────────────────────────────

/**
 * The last draw for a campaign, kept on the phone so a reload does not draw again at once.
 * "error": the call failed; "returned": the speaker just gave missions back (do not hand them
 * new ones straight away).
 */
/** "clock": the draw worked but its missions looked expired at once (the phone's date is wrong, APP-011). */
/** `code`: why a draw call failed ("error"), so the screen says it instead of "check your connection" (N-19). */
export type LastDraw = { at: number; status: PoolStatus | "error" | "returned" | "clock"; added: number; code?: CampaignErrorCode };

/** No automatic draw sooner than this after the previous one (the batch is full or just drawn). */
export const DRAW_PAUSE_MS = 60_000;
/** After a refusal (cell full, cap, hold) or a return, wait this long before asking again by itself. */
export const DRAW_BACKOFF_MS = 15 * 60_000;
/** After a failed call (network, server), try again by itself after this. */
export const DRAW_RETRY_MS = 2 * 60_000;

/**
 * Should the app draw now, by itself? Only for a pool campaign that is open for recording, when
 * the speaker holds fewer than `refill_below` missions they can still record, and not right after
 * a draw (the dashboard would answer the same). `open` counts what the speaker can still record
 * (takes waiting on the phone are not open: they are done for the speaker).
 */
export function shouldDraw(input: { card: Pick<CampaignCard, "dispatch" | "refill_below" | "next_step">; open: number; last: LastDraw | null; now: number; online: boolean }): boolean {
  const { card, open, last, now, online } = input;
  if (!isPool(card) || card.next_step !== "ready" || !online) return false;
  if (open >= refillBelow(card)) return false;
  if (!last) return true;
  const since = now - last.at;
  if (since < 0) return true; // the clock moved back: do not stay stuck
  if (last.status === "ok") return since >= DRAW_PAUSE_MS;
  if (last.status === "error") return since >= DRAW_RETRY_MS;
  return since >= DRAW_BACKOFF_MS;
}

/** A refusal that means "no more work for you here for now" (as opposed to "your batch is full"). */
export const isRefusal = (s: LastDraw["status"] | null | undefined): s is Exclude<PoolStatus, "ok"> =>
  s === "cell_full" || s === "campaign_full" || s === "speaker_cap" || s === "quality_hold";

/** The other campaigns a full cell points to, without the current one and without duplicates. */
export function elsewhereOf(pool: Pick<PoolView, "elsewhere"> | null | undefined, currentId: string): NonNullable<PoolView["elsewhere"]> {
  const seen = new Set<string>([currentId]);
  const out: NonNullable<PoolView["elsewhere"]> = [];
  for (const e of pool?.elsewhere ?? []) {
    if (!e || typeof e.campaign_id !== "string" || seen.has(e.campaign_id)) continue;
    seen.add(e.campaign_id);
    out.push(e);
  }
  return out;
}

/** Add drawn missions to a list, skipping any already there (a repeated answer). */
export function mergeDrawn<M extends Pick<Mission, "mission_id">>(current: readonly M[], drawn: readonly M[]): { missions: M[]; added: number } {
  const have = new Set(current.map((m) => m.mission_id));
  const fresh = drawn.filter((m) => m && typeof m.mission_id === "string" && !have.has(m.mission_id));
  return { missions: [...current, ...fresh], added: fresh.length };
}

/** Progress counts after `added` missions were drawn (they are all to do). */
export const addDrawn = (p: CampaignCard["progress"], added: number): CampaignCard["progress"] =>
  added > 0 ? { ...p, total: p.total + added, todo: p.todo + added } : p;

/** Progress counts after open missions were given back (`todo` and `rejected` of them). */
export function removeReturned(p: CampaignCard["progress"], gone: readonly Pick<Mission, "status">[]): CampaignCard["progress"] {
  const todo = gone.filter((m) => m.status === "todo").length;
  const rejected = gone.filter((m) => m.status === "rejected").length;
  return { ...p, total: Math.max(0, p.total - todo - rejected), todo: Math.max(0, p.todo - todo), rejected: Math.max(0, p.rejected - rejected) };
}

// ── Pay per hour ─────────────────────────────────────────────────────────

/** Seconds of accepted and pending audio, or null when the dashboard does not send them yet. */
export function paidTime(r: Rewards | null | undefined): { acceptedS: number; pendingS: number } | null {
  if (!r || typeof r.accepted_s !== "number" || !Number.isFinite(r.accepted_s)) return null;
  const pending = typeof r.pending_s === "number" && Number.isFinite(r.pending_s) ? r.pending_s : 0;
  return { acceptedS: Math.max(0, r.accepted_s), pendingS: Math.max(0, pending) };
}

/** The cards' paid time added up, or null when any card lacks it (an older dashboard): then show counts. */
export function totalPaidTime(cards: readonly Pick<CampaignCard, "rewards">[]): { acceptedS: number; pendingS: number } | null {
  let acceptedS = 0;
  let pendingS = 0;
  for (const c of cards) {
    const t = paidTime(c.rewards);
    if (!t) return null;
    acceptedS += t.acceptedS;
    pendingS += t.pendingS;
  }
  return { acceptedS, pendingS };
}

/**
 * A duration as hours and minutes, for the message "time.*". Rounded DOWN to the minute: the app
 * never shows more than the speaker will be paid for. Under a minute (but not zero) is "less than
 * a minute"; zero is "0 min".
 */
export type TimeParts = { key: "hm"; h: number; m: number } | { key: "m"; m: number } | { key: "underMinute" };

export function timeParts(seconds: number): TimeParts {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (s > 0 && s < 60) return { key: "underMinute" };
  const total = Math.floor(s / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? { key: "hm", h, m } : { key: "m", m };
}
