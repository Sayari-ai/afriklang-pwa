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
import {
  AGE_BANDS,
  GENDERS,
  MAX_TEXT,
  OTHER_VARIETY,
  countryOptions,
  initialValues,
  languageOptions,
  profileErrorsFromServer,
  validateProfile,
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
  const languages = useMemo(() => languageOptions(), []);
  // The "other" option is UI only: it blocks submit and explains, it is never sent.
  const otherVariety = values.variety === OTHER_VARIETY;

  const set = (k: keyof ProfileInput) => (v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const focusFirst = (found: ProfileErrors) => {
    const first = Object.keys(found)[0];
    if (first) document.getElementById(`${uid}-${first}`)?.focus();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current || otherVariety) return;
    const { input, errors: found } = validateProfile(
      values,
      card.language.varieties,
    );
    setErrors(found);
    if (!input) {
      setFailure(null);
      focusFirst(found);
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const res = await saveProfile(input);
      if (res.ok) return onSaved();
      // A 400 that names fields: mark them (with each field's own hint) rather than one vague line.
      const fromServer = res.code === "invalid_input" ? profileErrorsFromServer(res.fieldErrors) : {};
      if (Object.keys(fromServer).length) {
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
    extra?: { value: string; label: string },
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
          {extra ? <option value={extra.value}>{extra.label}</option> : null}
        </select>
      );
    };
  const text = (k: "region" | "device", autoComplete: string) =>
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

      {field(
        "native_language",
        t("nativeLanguage"),
        select("native_language", languages),
      )}
      {field(
        "variety",
        t("variety"),
        select(
          "variety",
          card.language.varieties.map((v) => ({ value: v, label: v })),
          { value: OTHER_VARIETY, label: t("varietyOther") },
        ),
      )}
      {card.language.varieties.length === 0 ? (
        <Notice title={t("noVarietiesTitle")} tone="warn">
          <p>{t("noVarietiesBody")}</p>
        </Notice>
      ) : null}
      {otherVariety ? (
        <Notice title={t("varietyOtherTitle")} tone="warn">
          <p>{t("varietyOtherBody")}</p>
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
        disabled={busy || otherVariety}
        className={buttonPrimary}
      >
        {busy ? t("saving") : t("save")}
      </button>
    </form>
  );
}
