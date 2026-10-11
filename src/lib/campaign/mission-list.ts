/** Pure grouping and "what next" logic for the mission list. */

import type { Mission } from "./types";

export type MissionGroups = { toRecord: Mission[]; toRedo: Mission[]; done: Mission[] };

const byPosition = (a: Mission, b: Mission) => a.position - b.position;

export function groupMissions(missions: readonly Mission[]): MissionGroups {
  const sorted = [...missions].sort(byPosition);
  return {
    toRecord: sorted.filter((m) => m.status === "todo"),
    toRedo: sorted.filter((m) => m.status === "rejected"),
    done: sorted.filter((m) => m.status === "submitted" || m.status === "accepted"),
  };
}

/** A mission can be started: still to do or to redo, and a conversation needs its partner's consents. */
export const isRecordable = (m: Mission) => (m.status === "todo" || m.status === "rejected") && (m.type !== "conversational" || m.partner_ready);

/**
 * The next mission to record after `currentId`: the first recordable one that comes later in
 * position order, otherwise the first recordable one before it. Null when nothing is left.
 * The current mission is skipped even if it still reads as todo (its upload may not be reflected yet).
 */
export function nextMissionId(missions: readonly Mission[], currentId: string | null): string | null {
  const sorted = [...missions].sort(byPosition);
  const cur = sorted.find((m) => m.mission_id === currentId);
  const open = sorted.filter((m) => m.mission_id !== currentId && isRecordable(m));
  if (!cur) return open[0]?.mission_id ?? null;
  return (open.find((m) => m.position > cur.position) ?? open[0])?.mission_id ?? null;
}

/** Share of missions the contributor has finished (submitted or accepted), 0..100. */
export function percentDone(progress: { total: number; submitted: number; accepted: number }): number {
  return progress.total > 0 ? Math.round(((progress.submitted + progress.accepted) / progress.total) * 100) : 0;
}

export function truncate(text: string, max = 90): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
