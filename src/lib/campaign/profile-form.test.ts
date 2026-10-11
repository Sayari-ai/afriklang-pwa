import { describe, expect, it } from "vitest";
import { AFRICAN_COUNTRIES, ALL_COUNTRIES, countryOptions, guessDevice, initialValues, validateProfile, type ProfileValues } from "./profile-form";

const ok: ProfileValues = { native_language: "wol", variety: "Baol-Baol", country: "SN", region: " Thiès ", gender: "female", age_band: "30-44", device: "Android" };
const varieties = ["Baol-Baol", "Saloum-Saloum"];

describe("validateProfile", () => {
  it("trims and accepts a complete profile", () => {
    const r = validateProfile(ok, varieties);
    expect(r.errors).toEqual({});
    expect(r.input?.region).toBe("Thiès");
  });
  it("flags empty and unknown values per field", () => {
    const r = validateProfile({ ...ok, variety: "Other", country: "", region: "  ", gender: "x", age_band: "10-17", native_language: "zzz" }, varieties);
    expect(r.input).toBeNull();
    expect(r.errors).toEqual({ variety: "invalid", country: "required", region: "required", gender: "invalid", age_band: "invalid", native_language: "invalid" });
  });
  it("limits free text", () => {
    expect(validateProfile({ ...ok, device: "x".repeat(81) }, varieties).errors.device).toBe("tooLong");
    expect(validateProfile({ ...ok, device: "x".repeat(80) }, varieties).errors.device).toBeUndefined();
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
  it("prefers stored values, else the campaign language", () => {
    const card = { language: { code: "wol", name: "Wolof", varieties } };
    const none = initialValues(card, { profile: { complete: false, missing: [], values: null } }, "Android");
    expect(none.native_language).toBe("wol");
    expect(none.device).toBe("Android");
    const stored = initialValues(card, { profile: { complete: false, missing: [], values: { nativeLanguage: "fra", variety: null, country: "SN", region: null, gender: null, ageBand: null, device: "Tecno" } } }, "Android");
    expect(stored.native_language).toBe("fra");
    expect(stored.device).toBe("Tecno");
  });
});
