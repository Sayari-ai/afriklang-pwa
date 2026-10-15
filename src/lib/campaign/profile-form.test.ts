import { describe, expect, it } from "vitest";
import { AFRICAN_COUNTRIES, ALL_COUNTRIES, countryOptions, guessDevice, initialValues, matchVariety, outsideTargets, profileErrorsFromServer, suggestVarieties, validateProfile, varietyChoices, varietyKey, type ProfileValues } from "./profile-form";

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
  it("compares without case, accents or punctuation between words", () => {
    expect(varietyKey("  Baol-Baol ")).toBe("baol baol");
    expect(varietyKey("Lébou")).toBe(varietyKey("lebou"));
    expect(matchVariety("lebou", ["Lébou"])).toBe("Lébou");
    expect(matchVariety("Lebu", ["Lébou"])).toBeNull();
  });
  it("suggests the campaign's varieties first, then the language's others, once each", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties: ["Saloum-Saloum"], known_varieties: ["Baol-Baol", "saloum saloum", "Lebou"] } };
    expect(varietyChoices(card)).toEqual(["Saloum-Saloum", "Baol-Baol", "Lebou"]);
    expect(varietyChoices({ language: { code: "wol", name: "Wolof", varieties } })).toEqual(varieties);
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
    // The native language has no field on the form: its error shows on the variety.
    expect(profileErrorsFromServer({ nativeLanguage: "unknown" })).toEqual({ variety: "server" });
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
  it("prefers stored values, but the native language is always the campaign's", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties } };
    const none = initialValues(card, { profile: { complete: false, missing: [], values: null } }, "Android");
    expect(none.native_language).toBe("wol");
    expect(none.device).toBe("Android");
    const stored = initialValues(card, { profile: { complete: false, missing: [], values: { nativeLanguage: "fra", variety: null, country: "SN", region: null, gender: null, ageBand: null, device: "Tecno" } } }, "Android");
    expect(stored.native_language).toBe("wol");
    expect(stored.device).toBe("Tecno");
  });
  it("asks the sex again when the stored value is not Female or Male", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties } };
    const withGender = (gender: string) => initialValues(card, { profile: { complete: true, missing: [], values: { nativeLanguage: "wol", variety: null, country: null, region: null, gender, ageBand: null, device: null } } }, "");
    expect(withGender("male").gender).toBe("male");
    expect(withGender("undisclosed").gender).toBe("");
    expect(withGender("other").gender).toBe("");
  });
});
