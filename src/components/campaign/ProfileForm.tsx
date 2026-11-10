"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { saveProfile } from "@/lib/campaign/api";
import { track } from "@/lib/analytics/events";
import { languageInText } from "@/lib/campaign/language-name";
import {
  AGE_BANDS,
  GENDERS,
  VARIETY_SEPARATOR,
  canAddVarieties,
  MAX_TEXT,
  countryOptions,
  firstLanguageChoices,
  formNativeLanguage,
  initialValues,
  languageCodeOf,
  languageDisplayName,
  matchVariety,
  nativeLanguageFallback,
  outsideTargets,
  profileErrorsFromServer,
  suggestVarieties,
  tidyVariety,
  validateProfile,
  varietyChoices,
  type FieldError,
  type LanguageChoice,
  type ProfileErrors,
  type ProfileValues,
} from "@/lib/campaign/profile-form";
import type {
  CampaignCard,
  CampaignFailure,
  ContributorView,
  ProfileInput,
} from "@/lib/campaign/types";
import { FailureMessage, Notice, buttonPrimary } from "./CampaignHubParts";

const control =
  "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-primary aria-[invalid=true]:border-red-500";

type Props = {
  card: CampaignCard;
  /** Every card of the speaker's list: their tests' languages, when the first language must be asked. */
  cards: readonly CampaignCard[];
  contributor: ContributorView;
  onSaved: () => void;
  heading?: string;
};

export function ProfileForm({ card, cards, contributor, onSaved, heading }: Props) {
  const t = useTranslations("campaign.flow.profile");
  const locale = useLocale();
  const uid = useId();
  const [values, setValues] = useState<ProfileValues>(() =>
    initialValues(
      card,
      contributor,
      typeof navigator === "undefined" ? "" : navigator.userAgent,
    ),
  );
  // The languages to ask the first one among, or null (not asked: profile-form.ts). Follows the
  // list: the hub paints from the last saved copy and refreshes it behind, so the question may come
  // or go after the form opened. While it is asked, the native language is the speaker's answer
  // (empty until they give one); otherwise the live contributor's (formNativeLanguage).
  const firstChoices = useMemo(() => firstLanguageChoices(cards, contributor, locale), [cards, contributor, locale]);
  const [firstAnswer, setFirstAnswer] = useState("");
  const native = formNativeLanguage(contributor, firstChoices, firstAnswer, values.native_language);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [failure, setFailure] = useState<CampaignFailure | null>(null);
  // What the dashboard said about the native language, when it refused it (shown to English readers).
  const [serverSaid, setServerSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // State updates are not synchronous: a ref stops a second tap from sending the form twice.
  const sending = useRef(false);

  const countries = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      // older engines: fall back to the code
    }
    return countryOptions((c) => names?.of(c) ?? c, locale);
  }, [locale]);
  // The variety is the native language's. On a card in another language the form has no list for
  // it: free text, no chips, and no promise about what is new (profile-form.ts).
  const sameLanguage = native === card.language.code;
  const choices = useMemo(() => varietyChoices(card, native), [card, native]);
  const suggestions = suggestVarieties(values.variety, choices);
  const typedVariety = tidyVariety(values.variety);
  // While suggestions still match, the speaker is probably mid-word: say nothing about the value yet.
  const settled = suggestions.length === 0;
  const canAdd = canAddVarieties(card, native);
  const isNewVariety =
    sameLanguage && canAdd && settled && typedVariety !== "" && /\p{L}/u.test(typedVariety) && !VARIETY_SEPARATOR.test(typedVariety) && !matchVariety(typedVariety, choices);
  const outside = settled ? outsideTargets(typedVariety, card) : null;
  // The language the variety belongs to, by name: the card's, the one chosen in the question, the
  // first language of the application form, or the code.
  const nativeName = useMemo(() => {
    const code = native;
    if (code === card.language.code) return card.language.name;
    const chosen = firstChoices?.find((c) => c.code === code);
    if (chosen) return chosen.name;
    const first = contributor.first_language;
    if (first?.code === code && typeof first.name === "string" && first.name) return first.name;
    return languageDisplayName(code, locale);
  }, [native, card.language, firstChoices, contributor.first_language, locale]);
  // Inside a sentence (« Quelle variété de wolof parlez-vous ? »).
  const nameInText = languageInText(nativeName, locale);

  const set = (k: keyof ProfileInput) => (v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const answerFirst = (code: string) => {
    setFirstAnswer(code);
    setErrors((e) => ({ ...e, native_language: undefined }));
  };

  const focusFirst = (found: ProfileErrors) => {
    const first = Object.keys(found)[0];
    // The native language has a field only when it is asked (its first choice takes the focus);
    // otherwise its message sits by the variety.
    const id = first === "native_language" && !firstChoices ? "variety" : first;
    if (id) document.getElementById(`${uid}-${id}`)?.focus();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    const { input, errors: found } = validateProfile({ ...values, native_language: native }, choices, canAdd, firstChoices?.map((c) => c.code) ?? null);
    setErrors(found);
    if (!input) {
      setFailure(null);
      focusFirst(found);
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailure(null);
    setServerSaid(null);
    try {
      let res = await saveProfile(input);
      if (!res.ok && res.code === "invalid_input") {
        // The dashboard does not know the native language (one the application form named): this
        // card's language stands in, once, rather than a speaker stuck on a field they cannot see.
        // Never over a stored native language (A5): nativeLanguageFallback refuses then. Never over
        // the speaker's own answer to the first-language question either: they read the refusal.
        const again = firstChoices ? null : nativeLanguageFallback(input, res.fieldErrors, card, languageCodeOf(contributor.profile.values?.nativeLanguage));
        if (again) {
          setValues((s) => ({ ...s, native_language: again.native_language }));
          res = await saveProfile(again);
        }
      }
      if (res.ok) {
        track("profile_saved", { first_time: !contributor.profile.complete });
        return onSaved();
      }
      // A 400 that names fields: mark them (with each field's own hint) rather than one vague line.
      const fromServer = res.code === "invalid_input" ? profileErrorsFromServer(res.fieldErrors) : {};
      if (Object.keys(fromServer).length) {
        setServerSaid(res.fieldErrors?.native_language ?? res.fieldErrors?.nativeLanguage ?? null);
        setErrors(fromServer);
        focusFirst(fromServer);
      } else setFailure(res);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const errorText = (k: keyof ProfileInput, err: FieldError) => {
    switch (err) {
      case "required":
        return t(`errors.required.${k}`);
      case "server":
        return t(`errors.server.${k}`);
      case "tooLong":
        return t("errors.tooLong", { max: MAX_TEXT, count: values[k].trim().length });
      default:
        return t(`errors.${err}`);
    }
  };

  const field = (
    k: keyof ProfileInput,
    label: string,
    input: (p: {
      id: string;
      describedBy?: string;
      invalid: boolean;
    }) => ReactNode,
    hint?: string,
  ) => {
    const id = `${uid}-${k}`;
    const err = errors[k];
    const describedBy =
      [err ? `${id}-err` : "", hint ? `${id}-hint` : ""]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div className="space-y-1">
        <label
          htmlFor={id}
          className="block text-sm font-semibold text-slate-800"
        >
          {label}
        </label>
        {input({ id, describedBy, invalid: !!err })}
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-slate-500">
            {hint}
          </p>
        ) : null}
        {err ? (
          <p id={`${id}-err`} role="alert" className="text-sm text-red-700">
            {errorText(k, err)}
          </p>
        ) : null}
      </div>
    );
  };

  const select = (
    k: keyof ProfileInput,
    options: { value: string; label: string }[],
  ) =>
    function selectControl(p: {
      id: string;
      describedBy?: string;
      invalid: boolean;
    }) {
      return (
        <select
          id={p.id}
          aria-describedby={p.describedBy}
          aria-invalid={p.invalid}
          required
          value={values[k]}
          onChange={(e) => set(k)(e.target.value)}
          className={control}
        >
          <option value="">{t("choose")}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    };
  const text = (k: "variety" | "region" | "device", autoComplete: string) =>
    function textControl(p: {
      id: string;
      describedBy?: string;
      invalid: boolean;
    }) {
      return (
        <input
          id={p.id}
          type="text"
          maxLength={MAX_TEXT + 20}
          autoComplete={autoComplete}
          required
          aria-describedby={p.describedBy}
          aria-invalid={p.invalid}
          value={values[k]}
          onChange={(e) => set(k)(e.target.value)}
          className={control}
        />
      );
    };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">
          {heading ?? t("title")}
        </h1>
        <p className="text-sm text-slate-600">{t("intro")}</p>
        <p className="text-sm text-slate-600">{t("privacy")}</p>
      </div>

      {/* Only the server's refusal: a "required" left over from a question the refreshed list took away is not one. */}
      {errors.native_language === "server" && !firstChoices ? (
        <p role="alert" className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">
          {t("errors.server.native_language", { language: nameInText })}
          {locale === "en" && serverSaid ? ` (${serverSaid})` : ""}
        </p>
      ) : null}
      {firstChoices ? (
        <FirstLanguageQuestion
          id={`${uid}-native_language`}
          legend={t("firstLanguage")}
          choices={firstChoices}
          value={native}
          onChange={answerFirst}
          error={
            errors.native_language
              ? errors.native_language === "server"
                ? t("errors.server.native_language", { language: nameInText }) + (locale === "en" && serverSaid ? ` (${serverSaid})` : "")
                : errorText("native_language", errors.native_language)
              : null
          }
        />
      ) : null}
      {field(
        "variety",
        // Until the first language is chosen, the variety is of "your first language".
        native ? t("variety", { language: nameInText }) : t("varietyOfFirst"),
        text("variety", "off"),
        t(canAdd ? "varietyHint" : "varietyHintPick"),
      )}
      {suggestions.length ? (
        <div role="group" aria-label={t("varietySuggestions")} className="-mt-2 flex flex-wrap gap-2">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => set("variety")(name)}
              className="min-h-10 rounded-full border border-slate-300 bg-white px-3 text-sm text-slate-800 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {isNewVariety && !errors.variety ? (
        <p className="-mt-2 text-sm text-slate-600" aria-live="polite">
          {t("varietyNew", { name: typedVariety, language: nameInText })}
        </p>
      ) : null}
      {outside ? (
        <Notice title={t("varietyOutsideTitle")} tone="warn">
          <p>{t("varietyOutsideBody", { varieties: outside.join(", ") })}</p>
        </Notice>
      ) : null}
      {field("country", t("country"), select("country", countries))}
      {field(
        "region",
        t("region"),
        text("region", "address-level1"),
        t("regionHint"),
      )}
      {field(
        "gender",
        t("gender"),
        select(
          "gender",
          GENDERS.map((g) => ({ value: g, label: t(`genders.${g}`) })),
        ),
      )}
      {field(
        "age_band",
        t("age"),
        select(
          "age_band",
          AGE_BANDS.map((a) => ({ value: a, label: a })),
        ),
      )}
      {field("device", t("device"), text("device", "off"), t("deviceHint"))}

      {Object.keys(errors).some((k) => errors[k as keyof ProfileInput]) ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {t("formError")}
        </p>
      ) : null}
      {failure ? <FailureMessage failure={failure} /> : null}
      <button
        type="submit"
        disabled={busy}
        className={buttonPrimary}
      >
        {busy ? t("saving") : t("save")}
      </button>
    </form>
  );
}

/**
 * Which of the speaker's test languages is their first one: one radio per language, by its name.
 * The first radio carries `id`, so the form can focus it when the answer is missing.
 */
function FirstLanguageQuestion({ id, legend, choices, value, onChange, error }: { id: string; legend: string; choices: readonly LanguageChoice[]; value: string; onChange: (code: string) => void; error: string | null }) {
  const errId = `${id}-err`;
  return (
    // A radiogroup (allowed on fieldset) carries the required and invalid states the radios cannot.
    <fieldset role="radiogroup" aria-required aria-invalid={!!error} aria-describedby={error ? errId : undefined} className="space-y-2">
      <legend className="mb-1 block text-sm font-semibold text-slate-800">{legend}</legend>
      {choices.map((c, i) => (
        <label
          key={c.code}
          className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
        >
          <input
            id={i === 0 ? id : `${id}-${c.code}`}
            type="radio"
            name={id}
            value={c.code}
            required
            checked={value === c.code}
            onChange={() => onChange(c.code)}
            aria-describedby={error ? errId : undefined}
            className="size-5 accent-primary"
          />
          {/* A name alone keeps the catalogue's capital, in French too. */}
          <span>{c.name}</span>
        </label>
      ))}
      {error ? (
        <p id={errId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
