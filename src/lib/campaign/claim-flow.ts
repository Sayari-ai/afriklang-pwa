/** Pure decisions for the landing screen (no React): what to do with a claim result, which view to show. */

import { ERROR_KEY, isRetryable } from "./errors";
import type { CampaignErrorCode, CampaignFailure, NextStep } from "./types";

export type ClaimOutcome = {
  /** Forget the invitation token (it can never work, or it was used). */
  clearToken: boolean;
  /** Show the dashboard's own message (only where it carries a masked address hint). */
  showServerMessage: boolean;
  retryable: boolean;
  /** Key under the "campaign.common" `errors` namespace. */
  messageKey: string;
  /** Offer to sign out and pick another Google account (the token stays saved). */
  offerOtherAccount: boolean;
};

export function claimOutcome(failure: Pick<CampaignFailure, "code">): ClaimOutcome {
  const code: CampaignErrorCode = failure.code;
  const messageKey = ERROR_KEY[code];
  if (code === "email_mismatch" || code === "email_unverified") {
    return { clearToken: false, showServerMessage: true, retryable: false, messageKey, offerOtherAccount: true };
  }
  if (isRetryable(code)) return { clearToken: false, showServerMessage: false, retryable: true, messageKey, offerOtherAccount: false };
  // unauthorized: the session is gone, not the invitation; the sign-in card takes over.
  if (code === "unauthorized") return { clearToken: false, showServerMessage: false, retryable: false, messageKey, offerOtherAccount: false };
  // invalid_link, link_expired, campaign_closed, account_conflict and anything else: the token is of no further use.
  return { clearToken: true, showServerMessage: false, retryable: false, messageKey, offerOtherAccount: false };
}

export type ClaimState = { status: "idle" } | { status: "claiming" } | { status: "done" } | { status: "failed"; failure: CampaignFailure };

export type View = "waiting" | "signIn" | "claiming" | "claimFailed" | "claimed" | "home";

/**
 * `hasToken` is null until the URL/storage has been read. A signed-in contributor with a held
 * token goes through the claim first; without one, straight to their list.
 */
export function nextView(input: { session: "waiting" | "signedOut" | "signedIn"; hasToken: boolean | null; claim: ClaimState }): View {
  const { session, hasToken, claim } = input;
  if (session === "waiting" || hasToken === null) return "waiting";
  if (session === "signedOut") return "signIn";
  if (claim.status === "done") return "claimed";
  if (claim.status === "failed") return claim.failure.code === "unauthorized" ? "signIn" : "claimFailed";
  if (claim.status === "claiming" || hasToken) return "claiming";
  return "home";
}

export type ChipKey = "profile" | "blocked" | "consent" | "paused" | "closed" | "ready";
export type ChipTone = "action" | "warn" | "muted" | "good";

export function chipFor(step: NextStep): { key: ChipKey; tone: ChipTone } {
  switch (step) {
    case "profile": return { key: "profile", tone: "action" };
    case "account_consent":
    case "campaign_consent": return { key: "consent", tone: "action" };
    case "blocked": return { key: "blocked", tone: "warn" };
    case "paused": return { key: "paused", tone: "muted" };
    case "closed": return { key: "closed", tone: "muted" };
    case "ready": return { key: "ready", tone: "good" };
  }
}

/** Share of missions accepted, 0..100, safe for an empty campaign. */
export function acceptedPercent(p: { total: number; accepted: number }): number {
  if (p.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((p.accepted / p.total) * 100)));
}
