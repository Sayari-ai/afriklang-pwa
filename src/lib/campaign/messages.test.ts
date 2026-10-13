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
