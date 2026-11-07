import { describe, expect, it } from "vitest";
import { AFRICAN_COUNTRIES, ALL_COUNTRIES, canAddVarieties, countryOptions, guessDevice, initialValues, languageCodeOf, languageDisplayName, matchVariety, nativeLanguageFallback, outsideTargets, profileErrorsFromServer, suggestVarieties, validateProfile, varietyChoices, varietyKey, type ProfileValues } from "./profile-form";

const ok: ProfileValues = { native_language: "wol", variety: "Baol-Baol", country: "SN", region: " Thiès ", gender: "female", age_band: "30-44", device: "Android" };
const varieties = ["Baol-Baol", "Saloum-Saloum"];

describe("validateProfile", () => {
  it("trims and accepts a complete profile", () => {
    const r = validateProfile(ok, varieties);
    expect(r.errors).toEqual({});
    expect(r.input?.region).toBe("Thiès");
  });
  it("flags empty and unknown values per field", () => {
    const r = validateProfile({ ...ok, variety: "  ", country: "", region: "  ", gender: "undisclosed", age_band: "10-17" }, varieties);
    expect(r.input).toBeNull();
    expect(r.errors).toEqual({ variety: "required", country: "required", region: "required", gender: "invalid", age_band: "invalid" });
  });
  it("limits free text", () => {
    expect(validateProfile({ ...ok, device: "x".repeat(81) }, varieties).errors.device).toBe("tooLong");
    expect(validateProfile({ ...ok, device: "x".repeat(80) }, varieties).errors.device).toBeUndefined();
  });
});

describe("variety", () => {
  it("accepts a variety no list has yet, tidied", () => {
    const r = validateProfile({ ...ok, variety: "  Ndiambour   Wolof " }, varieties);
    expect(r.errors).toEqual({});
    expect(r.input?.variety).toBe("Ndiambour Wolof");
  });
  it("sends a known variety under the list's spelling", () => {
    expect(validateProfile({ ...ok, variety: "baol baol" }, varieties).input?.variety).toBe("Baol-Baol");
    expect(validateProfile({ ...ok, variety: "SALOUM-saloum" }, varieties).input?.variety).toBe("Saloum-Saloum");
  });
  it("wants letters, one line and at most 80 characters", () => {
    expect(validateProfile({ ...ok, variety: "123" }, varieties).errors.variety).toBe("noLetters");
    expect(validateProfile({ ...ok, variety: "Baol\nBaol" }, varieties).errors.variety).toBeUndefined(); // newline is whitespace: tidied to one space
    expect(validateProfile({ ...ok, variety: "Baol\u0007" }, varieties).errors.variety).toBe("control");
    expect(validateProfile({ ...ok, variety: "x".repeat(81) }, varieties).errors.variety).toBe("tooLong");
  });
  it("asks for one variety when several are typed at once", () => {
    expect(validateProfile({ ...ok, variety: "Zezuru ,Ndau ,Manyika Karanga" }, varieties).errors.variety).toBe("oneVariety");
    expect(validateProfile({ ...ok, variety: "Baol-Baol / Lebou" }, varieties).errors.variety).toBe("oneVariety");
    expect(validateProfile({ ...ok, variety: "Manyika Karanga" }, varieties).errors.variety).toBeUndefined();
  });
  it("against a dashboard that cannot add varieties, only a listed one is sent", () => {
    expect(canAddVarieties({ language: { code: "sna", name: "Shona", varieties: [] } }, "sna")).toBe(false);
    expect(canAddVarieties({ language: { code: "sna", name: "Shona", varieties: [], known_varieties: [] } }, "sna")).toBe(true);
    expect(validateProfile({ ...ok, variety: "Zezuru" }, varieties, false).errors.variety).toBe("notListed");
    expect(validateProfile({ ...ok, variety: "baol baol" }, varieties, false).input?.variety).toBe("Baol-Baol");
  });
  it("compares without case, accents or punctuation between words", () => {
    expect(varietyKey("  Baol-Baol ")).toBe("baol baol");
    expect(varietyKey("Lébou")).toBe(varietyKey("lebou"));
    expect(matchVariety("lebou", ["Lébou"])).toBe("Lébou");
    expect(matchVariety("Lebu", ["Lébou"])).toBeNull();
  });
  it("suggests the campaign's varieties first, then the language's others, once each", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties: ["Saloum-Saloum"], known_varieties: ["Baol-Baol", "saloum saloum", "Lebou"] } };
    expect(varietyChoices(card, "wol")).toEqual(["Saloum-Saloum", "Baol-Baol", "Lebou"]);
    expect(varietyChoices({ language: { code: "wol", name: "Wolof", varieties } }, "wol")).toEqual(varieties);
  });
  it("on a card in another language than the native one, offers no chips and refuses nothing as unlisted (A5)", () => {
    const fuc = { language: { code: "fuc", name: "Pulaar", varieties: ["Fuuta Tooro"], known_varieties: ["Fuuta Tooro", "Fuuta Jalon"] } };
    expect(varietyChoices(fuc, "wol")).toEqual([]);
    expect(canAddVarieties(fuc, "wol")).toBe(true);
    // Even against an older dashboard without `known_varieties`: there is no list to pick from.
    expect(canAddVarieties({ language: { code: "fuc", name: "Pulaar", varieties: ["Fuuta Tooro"] } }, "wol")).toBe(true);
    const choices = varietyChoices(fuc, "wol");
    const r = validateProfile({ ...ok, variety: "Lebou" }, choices, canAddVarieties(fuc, "wol"));
    expect(r.errors).toEqual({});
    expect(r.input?.variety).toBe("Lebou");
    // The same language: today's behaviour.
    expect(varietyChoices(fuc, "fuc")).toEqual(["Fuuta Tooro", "Fuuta Jalon"]);
    expect(canAddVarieties(fuc, "fuc")).toBe(true);
  });
  it("suggests names starting with the text first, hides the list on an exact match", () => {
    const choices = ["Dakar urban", "Baol-Baol", "Lebou", "Bao"];
    expect(suggestVarieties("", choices, 2)).toEqual(["Dakar urban", "Baol-Baol"]);
    expect(suggestVarieties("ba", choices)).toEqual(["Baol-Baol", "Bao"]);
    expect(suggestVarieties("urb", choices)).toEqual(["Dakar urban"]);
    expect(suggestVarieties("lebou", choices)).toEqual([]);
    expect(suggestVarieties("zz", choices)).toEqual([]);
  });
  it("warns when a collection campaign targets other varieties, never for a qualification test", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties }, kind: "collection" as const };
    expect(outsideTargets("Lebou", card)).toEqual(varieties);
    expect(outsideTargets("baol baol", card)).toBeNull();
    expect(outsideTargets("", card)).toBeNull();
    expect(outsideTargets("Lebou", { ...card, kind: "qualification" })).toBeNull();
    expect(outsideTargets("Lebou", { ...card, language: { ...card.language, varieties: [] } })).toBeNull();
  });
});

describe("free text and server answers", () => {
  it("wants letters or digits and no control characters", () => {
    expect(validateProfile({ ...ok, region: "--- ..." }, varieties).errors.region).toBe("noLetters");
    expect(validateProfile({ ...ok, device: "Tecno\nSpark" }, varieties).errors.device).toBe("control");
    expect(validateProfile({ ...ok, region: "Saint-Louis 2" }, varieties).errors).toEqual({});
  });
  it("marks the fields a 400 named, in either naming style, and ignores the rest", () => {
    expect(profileErrorsFromServer({ variety: "unknown", ageBand: "bad", "recording.duration_s": "x", user_id: "x" })).toEqual({ variety: "server", age_band: "server" });
    expect(profileErrorsFromServer(undefined)).toEqual({});
    // The native language has no field on the form: its error is named as its own, and shown by the variety.
    expect(profileErrorsFromServer({ nativeLanguage: "unknown" })).toEqual({ native_language: "server" });
    expect(profileErrorsFromServer({ native_language: "unknown", variety: "x" })).toEqual({ native_language: "server", variety: "server" });
  });
  it("falls back to the card's language once when the dashboard does not know the native language, unless one is stored (A5)", () => {
    const fuc = { language: { code: "fuc", name: "Pulaar", varieties: [] } };
    const input = { native_language: "wol", variety: "Dakar", country: "SN", region: "Thiès", gender: "female", age_band: "30-44", device: "Android" };
    const refused = { native_language: "Native language must be one of the known languages." };
    // The code came from the application form or the card, nothing is stored yet: this card's language stands in.
    expect(nativeLanguageFallback(input, refused, fuc, null)).toEqual({ ...input, native_language: "fuc" });
    expect(nativeLanguageFallback(input, { nativeLanguage: "unknown" }, fuc, null)).toEqual({ ...input, native_language: "fuc" });
    // A stored native language is never overwritten by the app (A5): the speaker reads the server's words instead.
    expect(nativeLanguageFallback(input, refused, fuc, "wol")).toBeNull();
    // Already the card's language, so nothing else to try; or another field refused: no retry.
    expect(nativeLanguageFallback({ ...input, native_language: "fuc" }, refused, fuc, null)).toBeNull();
    expect(nativeLanguageFallback(input, { variety: "unknown" }, fuc, null)).toBeNull();
    expect(nativeLanguageFallback(input, undefined, fuc, null)).toBeNull();
  });
});

describe("countries", () => {
  it("lists African countries first and has no duplicates", () => {
    const opts = countryOptions((c) => c, "en");
    expect(opts.slice(0, AFRICAN_COUNTRIES.length).map((o) => o.value).sort()).toEqual([...AFRICAN_COUNTRIES].sort());
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
    expect(ALL_COUNTRIES.size).toBe(opts.length);
    expect(AFRICAN_COUNTRIES).toHaveLength(54);
  });
});

describe("defaults", () => {
  it("guesses the device", () => {
    expect(guessDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
    expect(guessDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17)")).toBe("iPhone");
    expect(guessDevice("")).toBe("");
  });
  it("prefers stored values", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties } };
    const none = initialValues(card, { profile: { complete: false, missing: [], values: null } }, "Android");
    expect(none.device).toBe("Android");
    const stored = initialValues(card, { profile: { complete: false, missing: [], values: { nativeLanguage: "wol", variety: null, country: "SN", region: null, gender: null, ageBand: null, device: "Tecno" } } }, "Android");
    expect(stored.device).toBe("Tecno");
  });
  it("never overwrites the native language from a test card: stored, then the form's first language, then the card (A5)", () => {
    const fuc = { language: { code: "fuc", name: "Pulaar", varieties: ["Fuuta Tooro"] } };
    const values = (nativeLanguage: string | null) => ({ nativeLanguage, variety: null, country: null, region: null, gender: null, ageBand: null, device: null });
    expect(initialValues(fuc, { profile: { complete: true, missing: [], values: values("wol") } }, "").native_language).toBe("wol");
    expect(initialValues(fuc, { profile: { complete: true, missing: [], values: values("wol") }, first_language: { code: "bam", name: "Bambara" } }, "").native_language).toBe("wol");
    expect(initialValues(fuc, { profile: { complete: false, missing: [], values: null }, first_language: { code: "wol", name: "Wolof" } }, "").native_language).toBe("wol");
    expect(initialValues(fuc, { profile: { complete: false, missing: [], values: values(null) }, first_language: { code: "wol", name: "Wolof" } }, "").native_language).toBe("wol");
    // No stored value and no first language (an older dashboard, or an applicant from before the form asked): the card's.
    expect(initialValues(fuc, { profile: { complete: false, missing: [], values: null } }, "").native_language).toBe("fuc");
    expect(initialValues(fuc, { profile: { complete: false, missing: [], values: null }, first_language: null }, "").native_language).toBe("fuc");
    expect(initialValues(fuc, { profile: { complete: false, missing: [], values: null }, first_language: { code: null, name: "Unknown" } }, "").native_language).toBe("fuc");
  });
  it("trusts no language code by type: anything but three lowercase letters is treated as absent", () => {
    const fuc = { language: { code: "fuc", name: "Pulaar", varieties: [] } };
    const none = { complete: false, missing: [], values: null };
    // A bridge or a saved copy may carry a number or a malformed code: the form must not crash on it.
    const odd = (code: unknown) => initialValues(fuc, { profile: none, first_language: { code: code as string, name: "Wolof" } }, "").native_language;
    expect(odd(123)).toBe("fuc");
    expect(odd("WOL")).toBe("fuc");
    expect(odd("wo")).toBe("fuc");
    expect(odd("wol ")).toBe("fuc");
    expect(odd({})).toBe("fuc");
    expect(odd("wol")).toBe("wol");
    const stored = (nativeLanguage: unknown) => initialValues(fuc, { profile: { complete: true, missing: [], values: { nativeLanguage: nativeLanguage as string, variety: null, country: null, region: null, gender: null, ageBand: null, device: null } }, first_language: { code: "wol", name: "Wolof" } }, "");
    expect(stored(123).native_language).toBe("wol");
    expect(stored("bam").native_language).toBe("bam");
    expect(() => validateProfile(stored(123), [])).not.toThrow();
    expect(languageCodeOf("wol")).toBe("wol");
    for (const v of [123, null, undefined, "", "WOL", "wolof", "w-l", ["wol"]]) expect(languageCodeOf(v), String(v)).toBeNull();
  });
  it("names a language from its code without ever throwing", () => {
    expect(languageDisplayName("wol", "en")).toBe("Wolof");
    expect(languageDisplayName("wol", "fr").toLowerCase()).toBe("wolof");
    expect(languageDisplayName("zzz", "en")).toBe("ZZZ");
    expect(languageDisplayName(123 as unknown as string, "en")).toBe("");
    // An engine that refuses the locale tag: the fallback, never a throw.
    expect(languageDisplayName("wol", "not a locale!")).toBe("WOL");
  });
  it("asks the sex again when the stored value is not Female or Male", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties } };
    const withGender = (gender: string) => initialValues(card, { profile: { complete: true, missing: [], values: { nativeLanguage: "wol", variety: null, country: null, region: null, gender, ageBand: null, device: null } } }, "");
    expect(withGender("male").gender).toBe("male");
    expect(withGender("undisclosed").gender).toBe("");
    expect(withGender("other").gender).toBe("");
  });
});
