/** Pure parts of the profile form: allowed values, validation, defaults. No React, no DOM. */

import { isQualification, type CampaignCard, type ContributorView, type ProfileInput } from "./types";

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
//
// The variety belongs to the speaker's NATIVE language (the dashboard adds a new name to that
// language), and the card's lists belong to the card's language. They are the same list only when
// the two languages are the same; on a test card in a second language the form has no list, so it
// takes free text without chips.

/** Several varieties typed at once ("Zezuru, Ndau / Manyika"): the profile holds one. */
export const VARIETY_SEPARATOR = /[,;/|+&]/;

/**
 * Whether a name outside the suggestions may be sent. With the card's own language, that is
 * whether the dashboard adds a variety it does not know: an older dashboard sends no
 * `known_varieties` and refuses unknown names, so the form must not promise to add one. With
 * another native language there is no list at all, so every name may be sent: the dashboard
 * checks it against that language's own list.
 */
export const canAddVarieties = (card: Pick<CampaignCard, "language">, nativeLanguage: string) =>
  nativeLanguage !== card.language.code || card.language.known_varieties !== undefined;

/** One space between words and none at the ends (the dashboard tidies the same way). */
export const tidyVariety = (s: string) => s.trim().replace(/\s+/g, " ");

/** Comparison key: no case, no accents, spaces / hyphens / apostrophes alike ("Baol-Baol" ~ "baol baol"). */
export function varietyKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s\-'’‘_.]+/g, " ").trim();
}

/**
 * What the form suggests: the campaign's varieties first, then the language's others, no
 * duplicates. Nothing when the speaker's native language is not the card's: those lists are
 * another language's.
 */
export function varietyChoices(card: Pick<CampaignCard, "language">, nativeLanguage: string): string[] {
  if (nativeLanguage !== card.language.code) return [];
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
 * `nativeChoices`: the language codes the form asks the first language among
 * (firstLanguageChoices), when it asks; the answer must be one of them.
 */
export function validateProfile(v: ProfileValues, choices: readonly string[], canAdd = true, nativeChoices: readonly string[] | null = null): { input: ProfileInput | null; errors: ProfileErrors } {
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
  // Asked only when it is unknown and the speaker has tests in several languages (firstLanguageChoices);
  // otherwise filled by initialValues. The server checks it again.
  need("native_language", (s) => !nativeChoices || nativeChoices.includes(s));
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
 * has no field of its own on the form (it is not asked): the form shows its message by the variety.
 */
export function profileErrorsFromServer(fieldErrors: Record<string, string> | undefined): ProfileErrors {
  const out: ProfileErrors = {};
  for (const key of Object.keys(fieldErrors ?? {})) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) as keyof ProfileInput;
    if (PROFILE_FIELDS.includes(snake)) out[snake] = "server";
  }
  return out;
}

/**
 * The profile to send again when the dashboard refused `native_language` (a code it does not
 * know: the application form may name a language the campaigns' list lacks): the same input with
 * this card's language, as the form filled it before the first language existed, rather than a
 * speaker stuck on a field they cannot see. Null when there is nothing to retry: the refusal
 * names other fields, the input already carries the card's language, or a native language is
 * stored on the profile (`stored`), which the app never overwrites (A5): the speaker then reads
 * the server's words.
 */
export function nativeLanguageFallback(input: ProfileInput, fieldErrors: Record<string, string> | undefined, card: Pick<CampaignCard, "language">, stored: string | null): ProfileInput | null {
  if (stored || !profileErrorsFromServer(fieldErrors).native_language) return null;
  if (input.native_language === card.language.code) return null;
  return { ...input, native_language: card.language.code };
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
 * `v` when it is a language code as the dashboard writes them (three lowercase ISO 639-3
 * letters), else null. The bridge's `first_language.code` and the stored native language are
 * checked here rather than trusted by type: a number or a malformed code must not reach the
 * form, where it would crash the validation or the language name.
 */
export const languageCodeOf = (v: unknown): string | null => (typeof v === "string" && /^[a-z]{3}$/.test(v) ? v : null);

/**
 * The language's name in `locale` from its code, or the code in capitals when the engine has no
 * name for it. Never throws, whatever the engine or the code does: the fallback is computed
 * before anything that can fail.
 */
export function languageDisplayName(code: string, locale: string): string {
  const fallback = typeof code === "string" ? code.toUpperCase() : "";
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
  } catch {
    // an older engine, a locale or a code it refuses: the capitalised code still says which language
  }
  return name && name !== code ? name : fallback;
}

/** `v` when it is one of the genders the form offers, else null (not trusted by type). */
const offeredGender = (v: unknown): string | null => (typeof v === "string" && (GENDERS as readonly string[]).includes(v) ? v : null);

/**
 * The native language the form sends. While the first language is asked (`firstChoices`), the
 * speaker's answer when it is one of the choices, else empty. Otherwise the live contributor's:
 * the stored one, then the application form's first language, then `filled` (what initialValues
 * filled from the hub's first copy, or the card's language a refused save fell back to). Live,
 * because the hub paints from a saved copy and refreshes behind it: a refresh that brings a stored
 * native language or a first language must win over the stale copy's card language.
 */
export function formNativeLanguage(contributor: Pick<ContributorView, "profile" | "first_language">, firstChoices: readonly LanguageChoice[] | null, answer: string, filled: string): string {
  if (firstChoices) return firstChoices.some((c) => c.code === answer) ? answer : "";
  return languageCodeOf(contributor.profile.values?.nativeLanguage) ?? languageCodeOf(contributor.first_language?.code) ?? filled;
}

/** A language the speaker may name as their first one: its code and its catalogue name. */
export type LanguageChoice = { code: string; name: string };

/**
 * The languages the form asks the first language among, or null when it does not ask (the form
 * then fills the native language itself, see initialValues). It asks only when nothing else says
 * which language is the speaker's first: no native language is stored, the dashboard sends no
 * first language (null, or absent on an older dashboard), and the speaker has qualification tests
 * in two or more languages. Otherwise an applicant tested in Wolof and Pulaar with neither known
 * would get whichever test they open first as their native language, and their variety filed
 * under it for good.
 *
 * The choices are the languages of every test card in the list (one per language, whatever its
 * state or whether it still has missions: each is a language the applicant chose), sorted by name.
 * A first language the dashboard knows only by name (`code` null) still counts as known: the
 * tests' languages are then not the speaker's first, and the form keeps its old behaviour.
 */
export function firstLanguageChoices(cards: readonly Pick<CampaignCard, "kind" | "language">[], contributor: Pick<ContributorView, "profile" | "first_language">, locale: string): LanguageChoice[] | null {
  if (languageCodeOf(contributor.profile.values?.nativeLanguage)) return null;
  if (contributor.first_language != null) return null;
  const byCode = new Map<string, LanguageChoice>();
  for (const c of cards) {
    if (!isQualification(c)) continue;
    const code = languageCodeOf(c.language?.code);
    if (!code || byCode.has(code)) continue;
    const name = typeof c.language.name === "string" && c.language.name.trim() ? c.language.name.trim() : languageDisplayName(code, locale);
    byCode.set(code, { code, name });
  }
  if (byCode.size < 2) return null;
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Stored values win, except a stored gender the form does not offer ("other", "undisclosed"),
 * which is asked again. The gender is the stored one; else the one the applicant gave on the
 * application form (`contributor.gender`, when the form offers it); else empty. Either way the
 * field stays on the form, so the speaker sees it and can change it.
 *
 * The native language (see also formNativeLanguage): the stored one wins; then the language the applicant marked as first on
 * the application form; then this card's language. A speaker tested in Wolof (native) and Pulaar
 * keeps Wolof whichever test card they open first: the profile is one per speaker, and the
 * dashboard files the variety under the native language. When none of the first two is known and
 * the tests span several languages, the form asks instead (firstLanguageChoices), and the
 * speaker's answer replaces this value.
 */
export function initialValues(card: Pick<CampaignCard, "language">, contributor: Pick<ContributorView, "profile" | "first_language" | "gender">, ua: string): ProfileValues {
  const s = contributor.profile.values;
  return {
    native_language: languageCodeOf(s?.nativeLanguage) ?? languageCodeOf(contributor.first_language?.code) ?? card.language.code,
    variety: s?.variety ?? "",
    country: s?.country ?? "",
    region: s?.region ?? "",
    gender: offeredGender(s?.gender) ?? offeredGender(contributor.gender) ?? "",
    age_band: s?.ageBand ?? "",
    device: s?.device ?? guessDevice(ua),
  };
}
