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
import { languageInText } from "@/lib/campaign/language-name";
import {
  AGE_BANDS,
  GENDERS,
  VARIETY_SEPARATOR,
  canAddVarieties,
  MAX_TEXT,
  countryOptions,
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
  contributor: ContributorView;
  onSaved: () => void;
  heading?: string;
};

export function ProfileForm({ card, contributor, onSaved, heading }: Props) {
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
  const sameLanguage = values.native_language === card.language.code;
  const choices = useMemo(() => varietyChoices(card, values.native_language), [card, values.native_language]);
  const suggestions = suggestVarieties(values.variety, choices);
  const typedVariety = tidyVariety(values.variety);
  // While suggestions still match, the speaker is probably mid-word: say nothing about the value yet.
  const settled = suggestions.length === 0;
  const canAdd = canAddVarieties(card, values.native_language);
  const isNewVariety =
    sameLanguage && canAdd && settled && typedVariety !== "" && /\p{L}/u.test(typedVariety) && !VARIETY_SEPARATOR.test(typedVariety) && !matchVariety(typedVariety, choices);
  const outside = settled ? outsideTargets(typedVariety, card) : null;
  // The language the variety belongs to, by name: the card's, the first language of the form, or the code.
  const nativeName = useMemo(() => {
    const code = values.native_language;
    if (code === card.language.code) return card.language.name;
    const first = contributor.first_language;
    if (first?.code === code && typeof first.name === "string" && first.name) return first.name;
    return languageDisplayName(code, locale);
  }, [values.native_language, card.language, contributor.first_language, locale]);
  // Inside a sentence (« Quelle variété de wolof parlez-vous ? »).
  const nameInText = languageInText(nativeName, locale);

  const set = (k: keyof ProfileInput) => (v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const focusFirst = (found: ProfileErrors) => {
    const first = Object.keys(found)[0];
    // The native language has no field: its message sits by the variety.
    const id = first === "native_language" ? "variety" : first;
    if (id) document.getElementById(`${uid}-${id}`)?.focus();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    const { input, errors: found } = validateProfile(values, choices, canAdd);
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
        // Never over a stored native language (A5): nativeLanguageFallback refuses then.
        const again = nativeLanguageFallback(input, res.fieldErrors, card, languageCodeOf(contributor.profile.values?.nativeLanguage));
        if (again) {
          setValues((s) => ({ ...s, native_language: again.native_language }));
          res = await saveProfile(again);
        }
      }
      if (res.ok) return onSaved();
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

      {errors.native_language ? (
        <p role="alert" className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">
          {t("errors.server.native_language", { language: nameInText })}
          {locale === "en" && serverSaid ? ` (${serverSaid})` : ""}
        </p>
      ) : null}
      {field(
        "variety",
        t("variety", { language: nameInText }),
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
