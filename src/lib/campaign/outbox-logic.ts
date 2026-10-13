/**
 * Pure decisions of the recording outbox: what happens to a queued take after an upload or a
 * submit attempt, and when to try again. Kept apart from IndexedDB and fetch so it can be tested.
 *
 * The life of a take:   pending ──ticket──► ──upload──► uploaded ──submit──► (removed, mission "submitted")
 *                          │         │                         │
 *                          └── retry later / held / failed (the contributor decides)
 *
 * The ticket is the dashboard's signed permission to upload this one file (docs/contracts). It is
 * kept on the item and reused while it has more than TICKET_REUSE_MIN_MS left.
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
  /**
   * The upload ticket for this file, kept so a retry or an app restart reuses it. Never read by
   * the app (it is passed through as is). Absent on items saved before tickets existed.
   */
  ticket?: StoredTicket | null;
};

/** A ticket as the outbox keeps it: the opaque value and when it stops being reused (ms, phone clock). */
export type StoredTicket = { value: string; expiresAt: number };

/** What the UI sees of an item (no audio): `bytes` is the audio's size. */
export type OutboxSummary = Omit<OutboxItem, "blob"> & { bytes: number };

export type UploadOutcome = { status: number; isNetwork: boolean; retryAfterS?: number | null };

export type Decision =
  | { kind: "done"; duplicate?: boolean }
  | { kind: "retry"; code: string; delayMs: number }
  | { kind: "hold"; code: string; delayMs: number }
  | { kind: "fail"; code: string }
  /** The dashboard refused the take for the specification: the mission is to record again. */
  | { kind: "rejected"; reason: NonNullable<CampaignFailure["reason"]> }
  /** The mission already has another recording: nothing more to send. */
  | { kind: "superseded" }
  /** The take must not be kept (the speaker withdrew their consent for the campaign): delete it. */
  | { kind: "drop"; code: string };

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** 5 s, 10 s, 20 s … capped at `capMs` (5 minutes), with ±20% jitter so many phones do not retry together. */
export function backoffMs(attempts: number, random: () => number = Math.random, capMs = 5 * MINUTE): number {
  const base = Math.min(capMs, 5 * SECOND * 2 ** Math.max(0, attempts));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * After an upload that died on the network: every attempt sends the whole file again from byte 0,
 * so on a weak link each retry costs the speaker data. Start at 15 s and stretch to 15 minutes.
 * Coming back online, the app returning to the foreground and "Send now" still try at once.
 */
export const UPLOAD_RETRY_CAP_MS = 15 * MINUTE;
export function uploadBackoffMs(attempts: number, random: () => number = Math.random): number {
  return Math.max(15 * SECOND, backoffMs(attempts + 1, random, UPLOAD_RETRY_CAP_MS));
}

/** Network codes after which the next take would fail the same way: stop the run, save the data. */
export const STOP_RUN_CODES: ReadonlySet<string> = new Set(["offline", "network", "timeout", "bridge_unreachable"]);

/** Upload answers that refuse the file itself: retrying the same bytes cannot help. */
const FINAL_UPLOAD_STATUSES: ReadonlySet<number> = new Set([400, 415, 422]);

/** After a failed audio upload. `online`: what the device says about its network. */
export function decideUploadFailure(e: UploadOutcome, attempts: number, online: boolean, random?: () => number): Decision {
  if (!online) return { kind: "retry", code: "offline", delayMs: 0 };
  if (e.isNetwork || e.status === 0) return { kind: "retry", code: "network", delayMs: uploadBackoffMs(attempts, random) };
  if (e.status === 413) return { kind: "fail", code: "tooLarge" };
  // Signed out (or the session could not be renewed): keep the take until they sign in again.
  if (e.status === 401) return { kind: "hold", code: "unauthorized", delayMs: MINUTE };
  // The server said how long to wait (429, 503): do that, not less (each try resends the file).
  const asked = e.retryAfterS && e.retryAfterS > 0 ? Math.min(3600, e.retryAfterS) * SECOND : 0;
  if (e.status === 429) return { kind: "retry", code: "rateLimited", delayMs: Math.max(asked, 30 * SECOND, backoffMs(attempts, random)) };
  if (e.status >= 500) return { kind: "retry", code: "server", delayMs: Math.max(asked, backoffMs(attempts, random)) };
  // Only a refusal of the file itself is final (APP-018). 404, 408, 409, 411, 425… come from a proxy,
  // the CDN or a deploy in progress: try again later.
  if (FINAL_UPLOAD_STATUSES.has(e.status)) return { kind: "fail", code: "refused" };
  return { kind: "retry", code: e.status >= 400 ? "server" : "other", delayMs: backoffMs(attempts, random) };
}

/** A ticket is reused only while it has more than this left (an upload on a slow link takes a while). */
export const TICKET_REUSE_MIN_MS = 2 * MINUTE;
/** Tickets live about 30 minutes: an `expires_at` further out (a phone clock behind) is not trusted. */
export const TICKET_MAX_LIFETIME_MS = 30 * MINUTE;
/** The shape the contract gives a ticket: base64url segments (2, or 3 for a JWS), at most 4 KB. */
const TICKET_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,2}$/;

/** The item's saved ticket when it can be reused now, else null. */
export function reusableTicket(item: Pick<OutboxItem, "ticket">, now: number): string | null {
  const t = item.ticket;
  return t && typeof t.value === "string" && t.expiresAt - now > TICKET_REUSE_MIN_MS ? t.value : null;
}

/**
 * The dashboard's `{ ticket, expires_at }` as the outbox keeps it, or null when it is not usable.
 * `expires_at`: an ISO 8601 time (unix seconds also accepted). Only the shape is checked: the app
 * cannot and does not verify a ticket.
 */
export function storedTicketFrom(data: unknown, now: number): StoredTicket | null {
  if (!data || typeof data !== "object") return null;
  const { ticket, expires_at } = data as Record<string, unknown>;
  if (typeof ticket !== "string" || ticket.length > 4096 || !TICKET_RE.test(ticket)) return null;
  const at = typeof expires_at === "number" && Number.isFinite(expires_at) ? expires_at * 1000 : typeof expires_at === "string" ? Date.parse(expires_at) : NaN;
  if (!Number.isFinite(at)) return null;
  return { value: ticket, expiresAt: Math.min(at, now + TICKET_MAX_LIFETIME_MS) };
}

/** After a ticket request failed: as a submit would, except where noted. */
export type TicketDecision = Decision | { kind: "without" };
export function decideTicket(res: Pick<CampaignFailure, "ok" | "code" | "reason" | "retryAfterS">, attempts: number, random?: () => number): TicketDecision {
  // An older dashboard or Edge Function: upload without a ticket, as before tickets existed.
  if (res.code === "unsupported") return { kind: "without" };
  // Can never clear for this take (campaign closed, mission no longer theirs...): final, never looped.
  if (DEAD_CODES.has(res.code)) return { kind: "fail", code: res.code };
  const d = decideSubmit(res, attempts, random);
  // A ticket call is small, but it is not retried faster than the upload it leads to.
  if (d.kind === "retry" && d.code !== "offline") return { ...d, delayMs: Math.max(d.delayMs, uploadBackoffMs(attempts, random)) };
  return d;
}

/** Codes that may clear by themselves: keep the take and try again later. */
const HOLD_CODES = new Set(["campaign_paused", "partner_consent", "unauthorized", "account_consent", "profile_incomplete", "consent_version_changed"]);
/**
 * Codes after which the audio must not stay on the phone: the take was recorded with the campaign
 * consent (the studio requires it), so "no campaign consent" now means it was withdrawn (APP-004).
 * A new consent version answers consent_version_changed, which only holds the take.
 */
const DROP_CODES = new Set(["campaign_consent"]);
/** Codes after which the take can never be saved for this mission. */
export const DEAD_CODES: ReadonlySet<string> = new Set(["campaign_closed", "not_assigned", "campaign_not_open", "blocked", "not_linked"]);

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
  if (DROP_CODES.has(res.code)) return { kind: "drop", code: res.code };
  // Signed out: a minute (signing in again restarts the runner at once anyway). Never 0: a due-now hold would loop.
  if (HOLD_CODES.has(res.code)) return { kind: "hold", code: res.code, delayMs: res.code === "unauthorized" ? MINUTE : 10 * MINUTE };
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

/** The item after a retry/hold/fail decision (done, rejected, superseded and drop remove it). */
export function applyDecision(item: OutboxItem, d: Decision, now: number): OutboxItem | null {
  switch (d.kind) {
    case "done":
    case "rejected":
    case "superseded":
    case "drop":
      return null;
    case "retry":
      return { ...item, state: "pending", attempts: item.attempts + 1, nextAttemptAt: now + d.delayMs, lastCode: d.code };
    case "hold":
      return { ...item, state: "held", attempts: item.attempts + 1, nextAttemptAt: now + d.delayMs, lastCode: d.code };
    case "fail":
      return { ...item, state: "failed", lastCode: d.code };
  }
}

/**
 * Items to send now. Failed ones wait for the contributor; held ones wait for their time.
 * Takes already uploaded go first (only the small metadata is left), then the smallest files, so
 * on a weak link as many takes as possible get through before the link drops; oldest first on a tie.
 */
export function dueItems<T extends Pick<OutboxItem, "state" | "nextAttemptAt" | "createdAt" | "userId"> & { uploaded?: boolean; blob?: Blob }>(items: readonly T[], userId: string, now: number): T[] {
  const cost = (i: T) => (i.uploaded ? 0 : (i.blob?.size ?? 0));
  return items
    .filter((i) => i.userId === userId && i.state !== "failed" && i.nextAttemptAt <= now)
    .sort((a, b) => cost(a) - cost(b) || a.createdAt - b.createdAt);
}

/** The runner never sleeps less than this between passes (a due-now take must not make it spin). */
export const MIN_WAKE_MS = 5 * SECOND;

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

/**
 * Before spending data on an upload: what the saved campaign card already says about this take's
 * campaign, as a submit code, or null to go ahead. Uploading audio the dashboard will refuse (a
 * withdrawn consent above all: that audio must not reach Sayari) is avoided; the card may be a
 * little old, so these only hold the take until the card says otherwise.
 */
export function precheckFromCard(nextStep: string | null | undefined): string | null {
  switch (nextStep) {
    case "campaign_consent":
      return "campaign_consent";
    case "account_consent":
      return "account_consent";
    case "paused":
      return "campaign_paused";
    default:
      return null;
  }
}

/** A take that can never be sent stays this long (for the speaker to see why), then goes (APP-024). */
export const DEAD_TAKE_KEEP_MS = 30 * 24 * 60 * MINUTE;

/** Failed takes that can never be sent (campaign closed, mission no longer theirs) and are older than DEAD_TAKE_KEEP_MS. */
export function expiredDeadTakes<T extends Pick<OutboxItem, "state" | "lastCode" | "createdAt">>(items: readonly T[], now: number): T[] {
  return items.filter((i) => i.state === "failed" && i.lastCode != null && DEAD_CODES.has(i.lastCode) && now - i.createdAt > DEAD_TAKE_KEEP_MS);
}
