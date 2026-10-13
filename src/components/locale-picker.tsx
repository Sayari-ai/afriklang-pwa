"use client";

/**
 * Three-way locale picker (System / English / Français).
 *
 * Flat redesign: pill radio group. Selected pill gets the light-blue
 * selection treatment (blue border + tint + blue label); idle pills
 * are white with the standard gray border.
 *
 * The selected pill is derived from `useAppLocale().override`. A
 * `null` override means "follow system" that pill highlights when
 * the user hasn't picked a manual override yet.
 */

import { useTranslations } from "next-intl";

import { useSetAppLocale } from "@/hooks/use-set-app-locale";
import { type Locale } from "@/i18n/locales";
import { useAppLocale, type LocaleOverride } from "@/stores/app-locale";

interface PillSpec {
  /** `null` = "follow system". */
  value: LocaleOverride;
  label: string;
}

export function LocalePicker({ className }: { className?: string }) {
  const t = useTranslations("campaign.home.shell");
  const override = useAppLocale((s) => s.override);
  const setLocale = useSetAppLocale();

  const pills: PillSpec[] = [
    { value: null, label: t("languages.system") },
    { value: "en" satisfies Locale, label: t("languages.english") },
    { value: "fr" satisfies Locale, label: t("languages.french") },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className={`flex flex-wrap gap-2 ${className ?? ""}`}
    >
      {pills.map((pill) => {
        const isActive = override === pill.value;
        return (
          <button
            key={pill.value ?? "system"}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setLocale(pill.value)}
            className={`rounded-full border-2 px-4 py-2 text-sm font-bold transition-all duration-150 ${
              isActive
                ? "border-blue-border bg-blue-light text-blue"
                : "border-border bg-bg text-text-muted"
            }`}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
