import { describe, expect, it } from "vitest";
import { accountSamplesConsent, offersSamplesBox, samplesConsentOf } from "./samples-consent";

const card = (campaign_id: string, samples_consent?: unknown) => ({ campaign_id, samples_consent }) as never;

describe("samples consent (decision A)", () => {
  it("reads the card's offer, or nothing from an older dashboard", () => {
    expect(samplesConsentOf(card("c1", { version: "v1", text_url: "https://x/s", signed: false }))).toEqual({ campaignId: "c1", version: "v1", textUrl: "https://x/s", signed: false });
    expect(samplesConsentOf(card("c1"))).toBeNull();
    expect(samplesConsentOf(card("c1", { version: "", text_url: null, signed: false }))).toBeNull();
  });
  it("the campaign consent step offers the unticked box only while it is not signed", () => {
    expect(offersSamplesBox("campaign", card("c1", { version: "v1", text_url: null, signed: false }))).toBe(true);
    expect(offersSamplesBox("campaign", card("c1", { version: "v1", text_url: null, signed: true }))).toBe(false);
    expect(offersSamplesBox("account", card("c1", { version: "v1", text_url: null, signed: false }))).toBe(false);
    expect(offersSamplesBox("campaign", card("c1"))).toBe(false);
  });
  it("the account toggle reads the first card that offers it", () => {
    expect(accountSamplesConsent([card("c1"), card("c2", { version: "v1", text_url: null, signed: true })])).toMatchObject({ campaignId: "c2", signed: true });
    expect(accountSamplesConsent([card("c1")])).toBeNull();
  });
});
