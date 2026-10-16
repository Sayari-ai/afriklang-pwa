/** Pure parts of the profile form: allowed values, validation, defaults. No React, no DOM. */

import type { CampaignCard, ContributorView, ProfileInput } from "./types";

// Mirror the dashboard's closed lists (src/lib/campaigns/reference.ts); the server validates again.
// The app asks Female or Male only; the dashboard also knows "other" / "undisclosed" (set by an admin).
export const GENDERS = ["female", "male"] as const;
export const AGE_BANDS = ["18-29", "30-44", "45-59", "60+"] as const;

// The dashboard stores region and device in 80 characters; stay under that so a save never truncates.
export const MAX_TEXT = 80;
/** Suggestions shown under the variety field at most. */
export const MAX_SUGGESTIONS = 8;

export const AFRICAN_COUNTRIES = [
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW",
  "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG",
  "TN", "UG", "ZM", "ZW",
];
const OTHER_COUNTRIES = [
  "AF", "AL", "AD", "AG", "AR", "AM", "AU", "AT", "AZ", "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BT", "BO", "BA", "BR", "BN", "BG", "KH", "CA", "CL", "CN",
  "CO", "CR", "HR", "CU", "CY", "CZ", "DK", "DM", "DO", "EC", "SV", "EE", "FJ", "FI", "FR", "GE", "DE", "GR", "GD", "GT", "GY", "HT", "HN", "HU", "IS", "IN",
  "ID", "IR", "IQ", "IE", "IL", "IT", "JM", "JP", "JO", "KZ", "KI", "KW", "KG", "LA", "LV", "LB", "LI", "LT", "LU", "MY", "MV", "MT", "MH", "MX", "FM", "MD",
  "MC", "MN", "ME", "MM", "NR", "NP", "NL", "NZ", "NI", "KP", "MK", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PL", "PT", "QA", "RO", "RU",
  "KN", "LC", "VC", "WS", "SM", "SA", "RS", "SG", "SK", "SI", "SB", "KR", "ES", "LK", "SR", "SE", "CH", "SY", "TW", "TJ", "TH", "TL", "TO", "TT", "TR", "TM",
  "TV", "UA", "AE", "GB", "US", "UY", "UZ", "VU", "VA", "VE", "VN", "YE",
];
export const ALL_COUNTRIES = new Set([...AFRICAN_COUNTRIES, ...OTHER_COUNTRIES]);

export type Option = { value: string; label: string };

/** African countries first, then the rest, each block sorted by its display name in `locale`. */
export function countryOptions(nameOf: (code: string) => string, locale: string): Option[] {
  const toOptions = (codes: string[]) =>
    codes.map((value) => ({ value, label: nameOf(value) })).sort((a, b) => a.label.localeCompare(b.label, locale));
  return [...toOptions(AFRICAN_COUNTRIES), ...toOptions(OTHER_COUNTRIES)];
}

export type ProfileValues = { [K in keyof ProfileInput]: string };
/**
 * What is wrong with one field. "server": the field was refused by the server (a 400 with
 * `fieldErrors`) although it passed the checks here; the screen shows that field's own hint.
 */
export type FieldError = "required" | "tooLong" | "invalid" | "noLetters" | "control" | "server" | "oneVariety" | "notListed";
export type ProfileErrors = Partial<Record<keyof ProfileInput, FieldError>>;

export const PROFILE_FIELDS: readonly (keyof ProfileInput)[] = ["native_language", "variety", "country", "region", "gender", "age_band", "device"];
/** Letters or digits somewhere in a free-text answer (the Edge Function applies the same rule). */
const HAS_WORD = /[\p{L}\p{N}]/u;
const CONTROL = /[\u0000-\u001f\u007f]/;

// ── Variety ──────────────────────────────────────────────────────────────
// The speaker types their variety. The form suggests the ones the dashboard knows; a name it
// does not know is added by the dashboard on save (so nobody is stuck when an admin has not
// listed their variety yet).

/** Several varieties typed at once ("Zezuru, Ndau / Manyika"): the profile holds one. */
export const VARIETY_SEPARATOR = /[,;/|+&]/;

/**
 * Whether the dashboard adds a variety it does not know. An older dashboard sends no
 * `known_varieties` and refuses unknown names, so the form must not promise to add one.
 */
export const canAddVarieties = (card: Pick<CampaignCard, "language">) => card.language.known_varieties !== undefined;

/** One space between words and none at the ends (the dashboard tidies the same way). */
export const tidyVariety = (s: string) => s.trim().replace(/\s+/g, " ");

/** Comparison key: no case, no accents, spaces / hyphens / apostrophes alike ("Baol-Baol" ~ "baol baol"). */
export function varietyKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s\-'’‘_.]+/g, " ").trim();
}

/** What the form suggests: the campaign's varieties first, then the language's others, no duplicates. */
export function varietyChoices(card: Pick<CampaignCard, "language">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...card.language.varieties, ...(card.language.known_varieties ?? [])]) {
    const k = varietyKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

/** The known name the typed value stands for, or null. */
export function matchVariety(value: string, choices: readonly string[]): string | null {
  const k = varietyKey(value);
  return (k && choices.find((c) => varietyKey(c) === k)) || null;
}

/**
 * Names for what the speaker typed: those starting with it, then those with a later word starting with it,
 * in the order of `choices`. Nothing typed: the first ones. An exact match hides the list.
 */
export function suggestVarieties(value: string, choices: readonly string[], max = MAX_SUGGESTIONS): string[] {
  const k = varietyKey(value);
  if (!k) return choices.slice(0, max);
  if (matchVariety(value, choices)) return [];
  const starts = choices.filter((c) => varietyKey(c).startsWith(k));
  const contains = choices.filter((c) => !starts.includes(c) && ` ${varietyKey(c)}`.includes(` ${k}`));
  return [...starts, ...contains].slice(0, max);
}

/**
 * The campaign's varieties when `variety` is not one of them, else null. A qualification test
 * and a campaign with no target varieties take any variety. Saving anyway is allowed: the
 * dashboard pauses that campaign for the speaker and tells the team.
 */
export function outsideTargets(variety: string, card: Pick<CampaignCard, "language" | "kind">): string[] | null {
  const targets = card.language.varieties;
  if (card.kind === "qualification" || targets.length === 0 || !varietyKey(variety)) return null;
  return matchVariety(variety, targets) ? null : targets;
}

/**
 * `choices`: the known varieties (varietyChoices); a known name is sent under its list spelling.
 * `canAdd`: whether a name outside `choices` may be sent (canAddVarieties).
 */
export function validateProfile(v: ProfileValues, choices: readonly string[], canAdd = true): { input: ProfileInput | null; errors: ProfileErrors } {
  const t = (s: string) => s.trim();
  const errors: ProfileErrors = {};
  const need = (k: keyof ProfileInput, ok: (s: string) => boolean) => {
    const s = t(v[k]);
    if (!s) errors[k] = "required";
    else if (!ok(s)) errors[k] = "invalid";
  };
  const text = (k: "region" | "device") => {
    const s = t(v[k]);
    if (!s) errors[k] = "required";
    else if (s.length > MAX_TEXT) errors[k] = "tooLong";
    else if (CONTROL.test(s)) errors[k] = "control";
    else if (!HAS_WORD.test(s)) errors[k] = "noLetters";
  };
  // Not asked: it is the campaign's language (see initialValues). The server checks it again.
  need("native_language", () => true);
  const variety = tidyVariety(v.variety);
  if (!variety) errors.variety = "required";
  else if (variety.length > MAX_TEXT) errors.variety = "tooLong";
  else if (CONTROL.test(variety)) errors.variety = "control";
  else if (!/\p{L}/u.test(variety)) errors.variety = "noLetters";
  else if (VARIETY_SEPARATOR.test(variety)) errors.variety = "oneVariety";
  else if (!canAdd && !matchVariety(variety, choices)) errors.variety = "notListed";
  need("country", (s) => ALL_COUNTRIES.has(s));
  text("region");
  need("gender", (s) => (GENDERS as readonly string[]).includes(s));
  need("age_band", (s) => (AGE_BANDS as readonly string[]).includes(s));
  text("device");
  if (Object.keys(errors).length) return { input: null, errors };
  return {
    errors,
    input: {
      native_language: t(v.native_language), variety: matchVariety(variety, choices) ?? variety, country: t(v.country), region: t(v.region),
      gender: t(v.gender), age_band: t(v.age_band), device: t(v.device),
    },
  };
}

/**
 * The profile fields a server 400 named in `fieldErrors`. Keys may be the body names
 * ("age_band") or the dashboard's camelCase ("ageBand"); others are ignored. The native language
 * has no field of its own on the form (it is the campaign's), so its error shows on the variety.
 */
export function profileErrorsFromServer(fieldErrors: Record<string, string> | undefined): ProfileErrors {
  const out: ProfileErrors = {};
  for (const key of Object.keys(fieldErrors ?? {})) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) as keyof ProfileInput;
    if (snake === "native_language") out.variety = "server";
    else if (PROFILE_FIELDS.includes(snake)) out[snake] = "server";
  }
  return out;
}

/** A short device name from the user agent, e.g. "Android". Editable by the person. */
export function guessDevice(ua: string): string {
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iPhone";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os x|macintosh/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux";
  return "";
}

/**
 * Stored values win, except:
 * - the native language is always the campaign's: the varieties offered belong to it, and the
 *   dashboard checks the variety against the native language;
 * - a stored gender the form does not offer ("other", "undisclosed") is asked again.
 */
export function initialValues(card: Pick<CampaignCard, "language">, contributor: Pick<ContributorView, "profile">, ua: string): ProfileValues {
  const s = contributor.profile.values;
  return {
    native_language: card.language.code,
    variety: s?.variety ?? "",
    country: s?.country ?? "",
    region: s?.region ?? "",
    gender: s?.gender && (GENDERS as readonly string[]).includes(s.gender) ? s.gender : "",
    age_band: s?.ageBand ?? "",
    device: s?.device ?? guessDevice(ua),
  };
}
