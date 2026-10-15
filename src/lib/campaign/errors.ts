import type { CampaignErrorCode } from "./types";

/**
 * Which message to show for a failure: a key under the "campaign.errors" i18n namespace.
 * email_mismatch and the dashboard's own text are handled by the screens (the dashboard's
 * message carries a masked hint of the invited address).
 */
export const ERROR_KEY: Record<CampaignErrorCode, string> = {
  invalid_input: "invalidInput",
  not_linked: "notLinked",
  not_assigned: "notAssigned",
  invalid_link: "invalidLink",
  link_expired: "linkExpired",
  campaign_closed: "campaignClosed",
  email_unverified: "emailUnverified",
  email_mismatch: "emailMismatch",
  account_conflict: "accountConflict",
  consent_version_changed: "consentChanged",
  already_submitted: "alreadySubmitted",
  recording_rejected: "recordingRejected",
  profile_incomplete: "profileIncomplete",
  blocked: "blocked",
  account_consent: "accountConsent",
  campaign_consent: "campaignConsent",
  partner_consent: "partnerConsent",
  campaign_paused: "campaignPaused",
  campaign_not_open: "campaignNotOpen",
  duplicate_audio: "duplicateAudio",
  test_closed: "testClosed",
  server_error: "serverError",
  unauthorized: "unauthorized",
  bridge_unreachable: "unreachable",
  bridge_error: "unreachable",
  network: "network",
  offline: "offline",
  timeout: "timeout",
  misconfigured: "misconfigured",
  conflict: "conflict",
  rate_limited: "rateLimited",
  unsupported: "generic",
  unknown: "generic",
};

/** Failures that mean "show the sign-in screen". */
export const needsSignIn = (code: CampaignErrorCode) => code === "unauthorized";

/** Failures worth a "try again" button (the call itself may succeed later). */
export const isRetryable = (code: CampaignErrorCode) => ["network", "offline", "timeout", "bridge_unreachable", "bridge_error", "server_error", "rate_limited", "unknown"].includes(code);
