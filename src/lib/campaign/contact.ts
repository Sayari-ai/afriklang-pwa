import { ERROR_KEY } from "./errors";
import type { CampaignErrorCode } from "./types";

/** The team's public address, the one the dashboard and the website give (lp Footer, booking copy). */
export const CONTACT_EMAIL = "contact@afriklang.com";

/**
 * Every message that asks the speaker to contact, ask or tell the team (APP-05), as
 * `<area>.<path>` under the "campaign" messages. Each is shown with the address (ContactTeam).
 * contact.test.ts fails on a message that asks for the team and is not listed here.
 */
export const CONTACT_MESSAGES = [
  "common.errors.generic",
  "common.errors.invalidLink",
  "common.errors.linkExpired",
  "common.errors.accountConflict",
  "common.errors.invalidInput",
  "common.errors.misconfigured",
  "home.shell.withdrawAccount",
  "claim.signIn.return.signupsClosed",
  "claim.failure.contact",
  "claim.failure.noAccountHint",
  "claim.brokenLink.help",
  "claim.notLinked.lost",
  "flow.profile.errors.notListed",
  "flow.profile.errors.server.native_language",
  "flow.profile.errors.server.variety",
  "flow.consent.notConfigured",
  "flow.consent.noLink",
] as const;

const CONTACT_ERROR_KEYS: ReadonlySet<string> = new Set(CONTACT_MESSAGES.filter((k) => k.startsWith("common.errors.")).map((k) => k.slice("common.errors.".length)));

/** Whether a failure's sentence asks the speaker to write to the team (its screen then gives the address). */
export const asksForContact = (code: CampaignErrorCode): boolean => CONTACT_ERROR_KEYS.has(ERROR_KEY[code]);

/** A mailto link to the team. Encoded with %20, not "+": some mail apps show a "+" as written. */
export function contactMailto({ subject, body }: { subject?: string | null; body?: string | null } = {}): string {
  const parts = [subject ? `subject=${encodeURIComponent(subject)}` : null, body ? `body=${encodeURIComponent(body)}` : null].filter(Boolean);
  return `mailto:${CONTACT_EMAIL}${parts.length ? `?${parts.join("&")}` : ""}`;
}
