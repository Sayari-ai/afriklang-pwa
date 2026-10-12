/** Small pure facts the speaker screens show (kept out of the components so they can be tested). */

import type { CampaignCard, NextStep } from "./types";

/** A campaign has something for the speaker only once missions were assigned to them. */
export const hasMissions = (c: Pick<CampaignCard, "progress">) => c.progress.total > 0;

/** Left to record (to do + to redo). */
export const openCount = (c: Pick<CampaignCard, "progress">) => c.progress.todo + c.progress.rejected;

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

/** The short reason shown for a take held or failed on the phone (key under campaign.home.outbox.reason). */
export function outboxReasonKey(code: string | null): "paused" | "consent" | "signin" | "partner" | "closed" | "file" | "server" | "network" | "generic" {
  switch (code) {
    case "campaign_paused":
      return "paused";
    case "account_consent":
    case "campaign_consent":
    case "consent_version_changed":
    case "profile_incomplete":
      return "consent";
    case "unauthorized":
      return "signin";
    case "partner_consent":
      return "partner";
    case "campaign_closed":
    case "campaign_not_open":
    case "not_assigned":
    case "blocked":
    case "not_linked":
      return "closed";
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
