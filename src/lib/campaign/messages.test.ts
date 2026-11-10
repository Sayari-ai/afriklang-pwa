import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_KEY } from "./errors";

const dir = path.resolve(__dirname, "../../messages/campaign");
const load = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;

/** Every leaf key path of a message tree, like "errors.generic". */
function leaves(o: unknown, prefix = ""): string[] {
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

describe("campaign messages", () => {
  const areas = [...new Set(readdirSync(dir).map((f) => f.split(".")[0]))];

  it.each(areas)("%s has the same keys in English and French, none empty", (area) => {
    const en = load(`${area}.en.json`);
    const fr = load(`${area}.fr.json`);
    expect(leaves(fr).sort()).toEqual(leaves(en).sort());
    const empty = (o: unknown): boolean => (typeof o === "string" ? o.trim() === "" : o && typeof o === "object" ? Object.values(o).some(empty) : false);
    expect(empty(en) || empty(fr)).toBe(false);
  });

  it("the reason 'level' does not say 'too quiet' alone: Sayari also uses it for a take too loud (X-06, APP2-18)", () => {
    const en = (load("common.en.json").rejection as Record<string, string>).level;
    const fr = (load("common.fr.json").rejection as Record<string, string>).level;
    expect(en).toMatch(/too loud/i);
    expect(fr).toMatch(/trop fort/i);
    // automatic refusals use 'other' too: no reviewer named
    expect((load("common.en.json").rejection as Record<string, string>).other).not.toMatch(/reviewer/i);
  });

  it("the instructions give plain advice, no dBFS number (APP2-17)", () => {
    for (const locale of ["en", "fr"]) {
      const ins = load(`flow.${locale}.json`).instructions as Record<string, string>;
      expect(ins.level).not.toMatch(/dBFS|\{/);
      expect(ins.silence).not.toMatch(/\{/);
    }
  });

  it("a translated 404 page and a full reload on the error page exist (APP2-22)", () => {
    for (const locale of ["en", "fr"]) {
      const c = load(`common.${locale}.json`) as { notFoundPage?: Record<string, string>; reloadApp?: string };
      expect(c.notFoundPage?.title && c.notFoundPage.open && c.reloadApp).toBeTruthy();
    }
    const app = path.resolve(__dirname, "../../app");
    expect(readFileSync(path.join(app, "not-found.tsx"), "utf8")).toContain("notFoundPage");
    expect(readFileSync(path.join(app, "error.tsx"), "utf8")).toContain("location.reload()");
    expect(readFileSync(path.join(app, "global-error.tsx"), "utf8")).toContain("Recharger");
  });

  it("the home has no streak tile any more (APP2-25)", () => {
    for (const locale of ["en", "fr"]) expect((load(`home.${locale}.json`).home as { stats: Record<string, string> }).stats.streak).toBeUndefined();
    const home = readFileSync(path.resolve(__dirname, "../../components/campaign/ClaimCampaignList.tsx"), "utf8");
    expect(home).not.toMatch(/streakDays|stats\.streak/);
  });

  it("the test-submitted screens say when to expect a reply (APP2-32)", () => {
    const at = (o: unknown, path: string) => path.split(".").reduce((x, k) => (x as Record<string, unknown>)[k], o) as string;
    for (const [locale, words] of [["en", "within 5 working days"], ["fr", "sous 5 jours ouvrés"]]) {
      const home = load(`home.${locale}.json`);
      const studio = load(`studio.${locale}.json`);
      for (const text of [at(home, "hub.allRecordedTest"), at(home, "qualification.inReview"), at(studio, "done.bodyTest"), at(studio, "guard.testClosed.body")]) expect(text).toContain(words);
    }
  });

  it("every error code has a message in both languages", () => {
    for (const locale of ["en", "fr"]) {
      const errors = (load(`common.${locale}.json`).errors ?? {}) as Record<string, string>;
      for (const key of new Set(Object.values(ERROR_KEY))) expect(errors[key], `${locale}: errors.${key}`).toBeTruthy();
    }
  });

  it("the Edge Function's French and English use the same placeholders", () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
    for (const area of areas) {
      const en = load(`${area}.en.json`);
      const fr = load(`${area}.fr.json`);
      const flat = (o: unknown, p = ""): [string, string][] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, String(o)]]);
      const frMap = new Map(flat(fr));
      for (const [k, v] of flat(en)) expect(placeholders(frMap.get(k) ?? ""), `${area}.${k}`).toBe(placeholders(v));
    }
  });

  it("counts are ICU plurals, never \"{n} takes\" (MAN-005)", () => {
    // A range ("{min} to {max} seconds") reads fine; a single count needs a plural.
    const counted = /(?<!(?:to|à) )\{(\w+)\} (takes?|recordings?|missions?|seconds?|minutes?|hours?|prises?|enregistrements?|secondes?|heures?)\b/i;
    for (const area of areas) {
      for (const locale of ["en", "fr"]) {
        const flat = (o: unknown, p = ""): [string, string][] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, String(o)]]);
        for (const [k, v] of flat(load(`${area}.${locale}.json`))) expect(counted.test(v), `${area}.${locale}: ${k} = ${v}`).toBe(false);
      }
    }
  });
});
