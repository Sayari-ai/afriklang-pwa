/**
 * The optional samples consent (decision A, SAY2-32): "my recordings may be played as samples to
 * prospective customers". Separate from the required consents, opt-in, never required: nothing here
 * ever blocks recording or uploads. Pure: the screens call the bridge.
 */

import type { CampaignCard } from "./types";

export type SamplesConsent = { campaignId: string; version: string; textUrl: string | null; signed: boolean };

/** The card's samples consent when the dashboard offers one (a version), else null. */
export function samplesConsentOf(card: Pick<CampaignCard, "campaign_id" | "samples_consent">): SamplesConsent | null {
  const s = card.samples_consent;
  if (!s || typeof s !== "object" || typeof s.version !== "string" || !s.version.trim()) return null;
  return { campaignId: card.campaign_id, version: s.version, textUrl: typeof s.text_url === "string" && s.text_url ? s.text_url : null, signed: s.signed === true };
}

/** The speaker's samples consent across their cards (one account-wide choice): the first card that offers it. */
export function accountSamplesConsent(cards: readonly Pick<CampaignCard, "campaign_id" | "samples_consent">[]): SamplesConsent | null {
  for (const c of cards) {
    const s = samplesConsentOf(c);
    if (s) return s;
  }
  return null;
}

/** Whether a consent step offers the optional samples box: the campaign step, an offered and unsigned samples consent. */
export function offersSamplesBox(type: "account" | "campaign", card: Pick<CampaignCard, "campaign_id" | "samples_consent">): boolean {
  const s = samplesConsentOf(card);
  return type === "campaign" && s !== null && !s.signed;
}
