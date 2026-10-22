/** Small pure facts the speaker screens show (kept out of the components so they can be tested). */

import type { OutboxState } from "./outbox-logic";
import { REJECTION_REASONS, type CampaignCard, type Mission, type NextStep, type RejectionReason, type SpeechType } from "./types";

/**
 * A mission's `rejection_reason` as one of the dashboard's reason codes, or null when it is not one
 * (empty, or a reviewer's own words, which are shown as they are).
 */
export function rejectionReasonCode(reason: string | null | undefined): RejectionReason | null {
  const r = reason?.trim().toLowerCase() ?? "";
  return (REJECTION_REASONS as readonly string[]).includes(r) ? (r as RejectionReason) : null;
}

/**
 * A campaign has something for the speaker once missions were assigned to them (planned), or,
 * for a pool campaign, as long as it is not over: its missions are drawn only once the speaker is
 * set up, so its card must show from the first setup step on. A paused or ended pool campaign
 * from which nothing was drawn has nothing to show.
 */
export const hasMissions = (c: Pick<CampaignCard, "progress" | "dispatch" | "next_step"> & Partial<Pick<CampaignCard, "kind" | "qualification">>) =>
  c.progress.total > 0 ||
  (c.dispatch === "pool" && c.next_step !== "paused" && c.next_step !== "closed") ||
  // A test cancelled before any take still says so, instead of vanishing (L-23).
  (c.kind === "qualification" && c.qualification != null);

/** Left to record (to do + to redo), by the server's counts. */
export const openCount = (c: Pick<CampaignCard, "progress">) => c.progress.todo + c.progress.rejected;

/**
 * Left to record, the one count every screen shows (MAN-004): to do + to redo, minus the missions
 * whose take is already waiting on the phone (a failed take still needs the speaker). From the
 * mission list when it is known; from the card's counts otherwise (`waitingOnPhone`: takes of the
 * campaign on the phone, failed ones excluded).
 */
export function toRecordCount(missions: readonly Pick<Mission, "mission_id" | "status" | "type" | "partner_ready">[], onPhone: ReadonlyMap<string, OutboxState>): number {
  // Same rule as the studio (canRecordNow): a conversation waits for the partner's consent, so it
  // is not "to record" yet; counting it sent the speaker to a studio that had nothing to record (N-12).
  return missions.filter(
    (m) => (m.status === "todo" || m.status === "rejected") && !(onPhone.has(m.mission_id) && onPhone.get(m.mission_id) !== "failed") && (m.type !== "conversational" || m.partner_ready),
  ).length;
}
export const openCountOnPhone = (c: Pick<CampaignCard, "progress">, waitingOnPhone: number) => Math.max(0, openCount(c) - waitingOnPhone);

/** Which of the three setup steps the speaker is on (1-3), or null when setup is over. */
export function setupStep(step: NextStep): 1 | 2 | 3 | null {
  if (step === "profile" || step === "blocked") return 1;
  if (step === "account_consent") return 2;
  if (step === "campaign_consent") return 3;
  return null;
}

/** Whole days until the deadline (0 on the day itself, negative once past), or null without one. */
export function daysLeft(deadline: string | null, now = new Date()): number | null {
  if (!deadline) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

export type MicRange = { min: number; max: number };

/**
 * How far to hold the phone (cm) for one speech type. The card carries the campaign spec's
 * `{ read: [from, to], conversational: [from, to] }`; speaking freely is a monologue, so it follows
 * `read`. Null when the card has none (the field is optional) or the pair is not two numbers.
 */
export function micDistance(card: Pick<CampaignCard, "instructions">, type: SpeechType): MicRange | null {
  const pair: unknown = card.instructions.recording.mic_distance_cm?.[type === "conversational" ? "conversational" : "read"];
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const [min, max] = pair as unknown[];
  return typeof min === "number" && typeof max === "number" && min > 0 && min <= max ? { min, max } : null;
}

/**
 * The campaign's distance for all its missions (`main`), or, when its conversations are held at
 * another distance than reading and speaking freely, `main` for those and `conversation` for the
 * conversations. `main` null: no distance on the card, the screens give the generic advice.
 */
export function campaignMicDistance(card: Pick<CampaignCard, "instructions">): { main: MicRange | null; conversation: MicRange | null } {
  const types = new Set(card.instructions.speech_types.map((s) => s.type));
  const alone = types.has("read") || types.has("spontaneous") ? micDistance(card, "read") : null;
  const together = types.has("conversational") ? micDistance(card, "conversational") : null;
  if (alone && together && (alone.min !== together.min || alone.max !== together.max)) return { main: alone, conversation: together };
  return { main: alone ?? together, conversation: null };
}

/** The short reason shown for a take held or failed on the phone (key under campaign.home.outbox.reason). */
export function outboxReasonKey(code: string | null): "paused" | "consent" | "profile" | "blocked" | "signin" | "partner" | "closed" | "unassigned" | "file" | "server" | "network" | "generic" | "testClosed" | "duplicate" | "language" {
  switch (code) {
    case "test_closed":
      return "testClosed";
    case "duplicate_audio":
      return "duplicate";
    case "campaign_paused":
      return "paused";
    case "account_consent":
    case "campaign_consent":
    case "consent_version_changed":
      return "consent";
    case "profile_incomplete":
      return "profile";
    case "blocked":
      return "blocked";
    case "unauthorized":
      return "signin";
    case "partner_consent":
      return "partner";
    case "not_assigned":
      return "unassigned";
    case "campaign_closed":
    case "campaign_not_open":
    case "not_linked":
      return "closed";
    case "language_unsupported":
      return "language";
    case "tooLarge":
    case "refused":
    case "invalid_input":
      return "file";
    case "server":
    case "server_error":
    case "bridge_error":
    case "bridge_unreachable":
    case "misconfigured":
    case "rateLimited":
    case "rate_limited":
      return "server";
    case "offline":
    case "network":
    case "timeout":
      return "network";
    default:
      return "generic";
  }
}

/** Sum of the cards' counts, for the home and history headers. */
export function totals(cards: readonly Pick<CampaignCard, "progress">[]) {
  return cards.reduce(
    (a, c) => ({ accepted: a.accepted + c.progress.accepted, submitted: a.submitted + c.progress.submitted, rejected: a.rejected + c.progress.rejected, total: a.total + c.progress.total }),
    { accepted: 0, submitted: 0, rejected: 0, total: 0 },
  );
}
