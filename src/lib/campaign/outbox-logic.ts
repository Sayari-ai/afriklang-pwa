/**
 * Pure decisions of the recording outbox: what happens to a queued take after an upload or a
 * submit attempt, and when to try again. Kept apart from IndexedDB and fetch so it can be tested.
 *
 * The life of a take:   pending ──upload──► uploaded ──submit──► (removed, mission "submitted")
 *                          │                      │
 *                          └── retry later / held / failed (the contributor decides)
 */

import { isRetryable } from "./errors";
import type { CampaignFailure, RecordingMetadata, SpeechType } from "./types";

export type OutboxState =
  /** Waiting for its turn (or for the network). */
  | "pending"
  /** Cannot go now for a reason that may pass (campaign paused, partner consent, signed out). Retried later. */
  | "held"
  /** Will not go as is: the contributor records again or discards it. */
  | "failed";

export type OutboxItem = {
  v: 1;
  /** sha-256 of the WAV: also the dashboard's duplicate check. */
  id: string;
  userId: string;
  campaignId: string;
  missionId: string;
  missionCode: string;
  missionType: SpeechType;
  createdAt: number;
  blob: Blob;
  filename: string;
  upload: {
    languageIso: string;
    dialect?: string;
    englishDescription: string;
    speakerId: string;
    extraFields: Record<string, string>;
  };
  /** Without sayari_recording_id: that is added once the upload answered. */
  metadata: RecordingMetadata;
  uploaded: boolean;
  sayariId: string | null;
  state: OutboxState;
  attempts: number;
  /** Not before this time (ms). */
  nextAttemptAt: number;
  /** Why it is held or failed: a campaign error code, or an upload failure key. */
  lastCode: string | null;
};

/** What the UI sees of an item (no audio). */
export type OutboxSummary = Omit<OutboxItem, "blob">;

export type UploadOutcome = { status: number; isNetwork: boolean };

export type Decision =
  | { kind: "done"; duplicate?: boolean }
  | { kind: "retry"; code: string; delayMs: number }
  | { kind: "hold"; code: string; delayMs: number }
  | { kind: "fail"; code: string }
  /** The dashboard refused the take for the specification: the mission is to record again. */
  | { kind: "rejected"; reason: NonNullable<CampaignFailure["reason"]> }
  /** The mission already has another recording: nothing more to send. */
  | { kind: "superseded" };

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** 5 s, 10 s, 20 s … capped at 5 minutes, with ±20% jitter so many phones do not retry together. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(5 * MINUTE, 5 * SECOND * 2 ** Math.max(0, attempts));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** After a failed audio upload. `online`: what the device says about its network. */
export function decideUploadFailure(e: UploadOutcome, attempts: number, online: boolean, random?: () => number): Decision {
  if (!online) return { kind: "retry", code: "offline", delayMs: 0 };
  if (e.isNetwork || e.status === 0) return { kind: "retry", code: "network", delayMs: backoffMs(attempts, random) };
  if (e.status === 413) return { kind: "fail", code: "tooLarge" };
  if (e.status === 429) return { kind: "retry", code: "rateLimited", delayMs: Math.max(30 * SECOND, backoffMs(attempts, random)) };
  if (e.status >= 500) return { kind: "retry", code: "server", delayMs: backoffMs(attempts, random) };
  if (e.status >= 400) return { kind: "fail", code: "refused" };
  return { kind: "retry", code: "other", delayMs: backoffMs(attempts, random) };
}

/** Codes that may clear by themselves: keep the take and try again later. */
const HOLD_CODES = new Set(["campaign_paused", "partner_consent", "unauthorized", "account_consent", "campaign_consent", "profile_incomplete", "consent_version_changed"]);
/** Codes after which the take can never be saved for this mission. */
const DEAD_CODES = new Set(["campaign_closed", "not_assigned", "campaign_not_open", "blocked", "not_linked"]);

/** After the metadata submit answered (or failed). */
export function decideSubmit(
  res: { ok: true; duplicate?: boolean } | Pick<CampaignFailure, "ok" | "code" | "reason" | "retryAfterS">,
  attempts: number,
  random?: () => number,
): Decision {
  if (res.ok) return { kind: "done", duplicate: Boolean(res.duplicate) };
  if (res.code === "recording_rejected") return { kind: "rejected", reason: res.reason ?? "other" };
  if (res.code === "already_submitted") return { kind: "superseded" };
  if (res.code === "offline") return { kind: "retry", code: "offline", delayMs: 0 };
  if (HOLD_CODES.has(res.code)) return { kind: "hold", code: res.code, delayMs: res.code === "unauthorized" ? 0 : 10 * MINUTE };
  if (DEAD_CODES.has(res.code)) return { kind: "fail", code: res.code };
  if (res.code === "rate_limited") {
    const wait = res.retryAfterS && res.retryAfterS > 0 ? res.retryAfterS * SECOND : 30 * SECOND;
    return { kind: "retry", code: res.code, delayMs: wait };
  }
  // The server is not set up: keep the take until it is.
  if (res.code === "misconfigured") return { kind: "hold", code: res.code, delayMs: 10 * MINUTE };
  if (isRetryable(res.code)) return { kind: "retry", code: res.code, delayMs: backoffMs(attempts, random) };
  // invalid_input and anything unexpected: this take cannot be saved as is.
  return { kind: "fail", code: res.code };
}

/** The item after a retry/hold/fail decision (done, rejected and superseded remove it). */
export function applyDecision(item: OutboxItem, d: Decision, now: number): OutboxItem | null {
  switch (d.kind) {
    case "done":
    case "rejected":
    case "superseded":
      return null;
    case "retry":
      return { ...item, state: "pending", attempts: item.attempts + 1, nextAttemptAt: now + d.delayMs, lastCode: d.code };
    case "hold":
      return { ...item, state: "held", attempts: item.attempts + 1, nextAttemptAt: now + d.delayMs, lastCode: d.code };
    case "fail":
      return { ...item, state: "failed", lastCode: d.code };
  }
}

/** Items to send now, oldest first. Failed ones wait for the contributor; held ones wait for their time. */
export function dueItems<T extends Pick<OutboxItem, "state" | "nextAttemptAt" | "createdAt" | "userId">>(items: readonly T[], userId: string, now: number): T[] {
  return items
    .filter((i) => i.userId === userId && i.state !== "failed" && i.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** When the runner should wake up next for this user (ms), or null when nothing is waiting on a timer. */
export function nextWake(items: readonly Pick<OutboxItem, "state" | "nextAttemptAt" | "userId">[], userId: string): number | null {
  const times = items.filter((i) => i.userId === userId && i.state !== "failed").map((i) => i.nextAttemptAt);
  return times.length ? Math.min(...times) : null;
}

/** Missions that already have a take on the device (they are not offered for recording again). */
export function missionsInOutbox(items: readonly Pick<OutboxItem, "missionId" | "state">[]): Map<string, OutboxState> {
  const m = new Map<string, OutboxState>();
  for (const i of items) m.set(i.missionId, i.state);
  return m;
}
