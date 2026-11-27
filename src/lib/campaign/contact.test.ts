import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, CONTACT_MESSAGES, asksForContact, contactMailto } from "./contact";

const dir = path.resolve(__dirname, "../../messages/campaign");
const load = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;

/** Every leaf of a message tree as [path, text]. */
function leaves(o: unknown, prefix = ""): [string, string][] {
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [[prefix, String(o)]];
}

/** A sentence that asks the speaker to get in touch with the team (not "the team will contact you"). */
const ASKS = { en: /\b(contact|ask|tell)\b[^.!?]*\bteam\b/i, fr: /\b(contact(ez|er)|demand(ez|er)|prévenir|prévenez|dites)\b[^.!?]*l'équipe/i };

describe("contact the team (APP-05)", () => {
  const areas = [...new Set(readdirSync(dir).map((f) => f.split(".")[0]))];

  it.each(["en", "fr"] as const)("every %s message that asks to contact the team is registered, so its screen shows the address", (locale) => {
    const asking = areas.flatMap((area) => leaves(load(`${area}.${locale}.json`)).filter(([, text]) => ASKS[locale].test(text)).map(([key]) => `${area}.${key}`));
    // The registry is the list each screen reads; a new sentence must be added there (and given a ContactTeam).
    expect(asking.filter((k) => !(CONTACT_MESSAGES as readonly string[]).includes(k))).toEqual([]);
    // And the registry has no stale key: each one still asks, in both languages.
    expect([...CONTACT_MESSAGES].sort()).toEqual([...new Set(asking)].sort());
  });

  it("the address is the one the dashboard and the website use", () => {
    expect(CONTACT_EMAIL).toBe("contact@afriklang.com");
    const contact = load("common.en.json").contact as Record<string, string>;
    expect(contact.address).not.toMatch(/@/); // the address is code, not copy: one place to change it
  });

  it("failures whose sentence asks for the team are flagged; the others are not", () => {
    expect(asksForContact("account_conflict")).toBe(true);
    expect(asksForContact("invalid_link")).toBe(true);
    expect(asksForContact("link_expired")).toBe(true);
    expect(asksForContact("invalid_input")).toBe(true);
    expect(asksForContact("misconfigured")).toBe(true);
    expect(asksForContact("unknown")).toBe(true); // the generic sentence
    expect(asksForContact("network")).toBe(false);
    expect(asksForContact("campaign_paused")).toBe(false);
  });

  it("builds a mailto link with spaces as %20 and the speaker ID in the body", () => {
    expect(contactMailto()).toBe("mailto:contact@afriklang.com");
    const href = contactMailto({ subject: "Help with the app", body: "Speaker ID: SPK-1 & co" });
    expect(href).toBe("mailto:contact@afriklang.com?subject=Help%20with%20the%20app&body=Speaker%20ID%3A%20SPK-1%20%26%20co");
    expect(contactMailto({ subject: "Aide", body: null })).toBe("mailto:contact@afriklang.com?subject=Aide");
  });
});
