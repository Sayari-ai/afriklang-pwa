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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A studio link names at most this many recordings (`?m=a,b,…`). */
export const MAX_FOCUS = 10;

/**
 * The mission ids a studio link names (`?m=a,b`): well-formed ids only, lowercased (the
 * dashboard writes them so, and the queue matches them exactly), once each, at most MAX_FOCUS.
 * One id is where the session starts; several are a focus (sessionQueue). The "to record again"
 * email builds such links with exactly the refused clips.
 */
export function parseFocus(q: string | null): string[] {
  const out: string[] = [];
  for (const raw of (q ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (!UUID_RE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_FOCUS) break;
  }
  return out;
}

/** The missions of `focus` that can be recorded now, in the focus order. An id that is not a mission of the list is ignored. */
export function focusQueue(missions: readonly Mission[], onPhone: ReadonlyMap<string, OutboxState>, focus: readonly string[]): string[] {
  const byId = new Map(missions.map((m) => [m.mission_id, m]));
  return focus.filter((id) => {
    const m = byId.get(id);
    return m != null && canRecordNow(m, onPhone);
  });
}

/**
 * The session's order: the missions to redo first (they were already attempted), then the rest
 * by position. `start`: one id, when recordable, comes first; several ids are a focus, and the
 * session is those alone, in that order (focusQueue). A focus with nothing left to record (all
 * recorded again already, or waiting on the phone) gives the full order instead, so the link
 * never opens on an empty studio: the studio says so (focusDone).
 */
export function sessionQueue(missions: readonly Mission[], onPhone: ReadonlyMap<string, OutboxState>, start: string | readonly string[] | null): string[] {
  if (Array.isArray(start)) {
    const focused = focusQueue(missions, onPhone, start as readonly string[]);
    return focused.length ? focused : sessionQueue(missions, onPhone, null);
  }
  const startId = typeof start === "string" ? start : null;
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

/**
 * Where a focused session (`?m=a,b`) stands: the focus is the whole session, so the counter
 * counts its queue ("1 of 2"), not the campaign's missions. `left`: the queue's missions still to
 * record (the one on screen included); `position`: the one on screen, 1-based, never above `total`.
 */
export function queueProgress(queue: readonly string[], isOpen: (id: string) => boolean): { position: number; total: number; left: number } {
  const total = queue.length;
  const left = queue.filter(isOpen).length;
  return { position: Math.max(1, Math.min(total, total - left + 1)), total, left };
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
 * tail then follows): at the speech type's maximum, tail included, so the take is exactly that
 * long and is accepted. Read sentences too: they used to stop 1 s past their maximum, which made
 * every auto-stopped read take "too long" (N-10). `timed` is kept for callers; it no longer
 * changes the answer. Without a maximum: MAX_TAKE_S.
 */
export function autoStopAtS(_timed: boolean, maxS: number, pad: number): number {
  const cap = Math.min(MAX_TAKE_S, maxS > 0 ? maxS : MAX_TAKE_S);
  return Math.max(pad, cap - pad);
}

/**
 * What the studio does with a take when the app goes to the background (APP2-12). The voice may
 * be complete when only the silence after Stop was being recorded ("tail"), or the speaker may
 * want to keep what they said ("speaking"): the take is finished, not thrown away. Nothing was
 * said yet during the lead: dropped, with the usual message. A countdown is cancelled so the
 * recording never starts in the background.
 */
export type HideAction = "cancel" | "drop" | "finish" | "finishCut" | null;
export function onHideAction(phase: string): HideAction {
  switch (phase) {
    case "countdown":
      return "cancel";
    case "lead":
      return "drop";
    case "speaking":
      return "finishCut";
    case "tail":
      return "finish";
    default:
      return null;
  }
}

/** A take cut by the system (a call, the microphone lost): kept when only the closing silence was left, else dropped (it would have a gap, APP-032). */
export const onInterruptAction = (phase: string): "finish" | "drop" => (phase === "tail" ? "finish" : "drop");

/** The studio header's session line: "n of goal" up to the goal, then "goal reached · n takes", never "6 of 1" (APP2-14). */
export function sessionLabel(count: number, goal: number | null): { key: "session" | "sessionGoal" | "sessionGoalReached"; values: { n: number; goal?: number } } {
  if (!goal) return { key: "session", values: { n: count } };
  if (count > goal) return { key: "sessionGoalReached", values: { n: count } };
  return { key: "sessionGoal", values: { n: count, goal } };
}
