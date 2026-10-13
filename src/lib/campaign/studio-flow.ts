/**
 * Pure decisions of the recording studio (a session of missions recorded one after the other).
 */

import type { OutboxState } from "./outbox-logic";
import type { CampaignCard, Mission } from "./types";

/**
 * Can this mission be recorded now? To do or to redo, no take of it already waiting on the phone
 * (a failed one may be replaced), and a conversation needs its partner's consents.
 */
export function canRecordNow(m: Mission, onPhone: ReadonlyMap<string, OutboxState>): boolean {
  if (m.status !== "todo" && m.status !== "rejected") return false;
  const local = onPhone.get(m.mission_id);
  if (local && local !== "failed") return false;
  return m.type !== "conversational" || m.partner_ready;
}

/**
 * The session's order: the missions to redo first (they were already attempted), then the rest
 * by position. `startId`, when recordable, comes first.
 */
export function sessionQueue(missions: readonly Mission[], onPhone: ReadonlyMap<string, OutboxState>, startId: string | null): string[] {
  const open = missions.filter((m) => canRecordNow(m, onPhone));
  const redo = open.filter((m) => m.status === "rejected").sort((a, b) => a.position - b.position);
  const todo = open.filter((m) => m.status === "todo").sort((a, b) => a.position - b.position);
  const ids = [...redo, ...todo].map((m) => m.mission_id);
  if (startId && ids.includes(startId)) return [startId, ...ids.filter((id) => id !== startId)];
  return ids;
}

/** The next mission of the queue after `currentId` that can still be recorded (wraps around to skipped ones). */
export function nextInQueue(queue: readonly string[], currentId: string | null, isOpen: (id: string) => boolean): string | null {
  const start = currentId ? queue.indexOf(currentId) : -1;
  for (let i = 1; i <= queue.length; i++) {
    const id = queue[(start + i + queue.length) % queue.length];
    if (id !== currentId && isOpen(id)) return id;
  }
  return null;
}

/** Move a skipped mission to the end of the queue. */
export function skip(queue: readonly string[], id: string): string[] {
  return [...queue.filter((x) => x !== id), id];
}

/**
 * How many takes make a good session, from the campaign's "missions per session" (the smallest
 * minimum among the speech types that define one). Null when the campaign says nothing.
 */
export function sessionGoal(card: CampaignCard): number | null {
  const mins = (card.instructions?.speech_types ?? []).map((s) => s.missions_per_session?.min).filter((n): n is number => typeof n === "number" && n > 0);
  return mins.length ? Math.min(...mins) : null;
}

/**
 * Silence the studio adds around the voice so takes pass the silence check: it records this long
 * before saying "speak now", and keeps recording this long after Stop. Slightly above the
 * campaign's margin; 1 s when the campaign says nothing.
 */
export function paddingS(card: CampaignCard): number {
  const m = card.instructions?.recording?.silence_margin_s;
  const base = typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 1;
  return Math.min(3, Math.round((base + 0.2) * 10) / 10);
}

/** The live level is too low for this long while speaking: tell the speaker. */
export const QUIET_HINT_AFTER_S = 1.5;

/** Text size steps for the prompt. */
export const TEXT_SIZES = ["text-xl", "text-2xl", "text-3xl"] as const;

/** No take runs longer than this, whatever the campaign allows: memory and upload size on low-end phones (APP-005). */
export const MAX_TAKE_S = 600;

/**
 * When the studio stops a take by itself, in seconds from the start of the recording (the silent
 * tail then follows). Timed types stop at their maximum (tail included, so the take is exactly
 * that long). A read sentence has no timer on screen: it stops 1 s past its maximum, so a
 * recording the speaker forgot to stop ends (as "too long") instead of growing until the phone
 * runs out of memory.
 */
export function autoStopAtS(timed: boolean, maxS: number, pad: number): number {
  const cap = Math.min(MAX_TAKE_S, maxS > 0 ? maxS : MAX_TAKE_S);
  return timed ? Math.max(pad, cap - pad) : Math.min(MAX_TAKE_S - pad, cap + 1);
}
