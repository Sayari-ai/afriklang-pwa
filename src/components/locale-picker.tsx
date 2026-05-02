"use client";

/**
 * Three-way locale picker (System / English / Français).
 *
 * This is the same widget used inside the Profile screen's "App
 * language" row in Flutter (`lib/features/profile/profile_screen.dart`).
 * Building it as a standalone component now means Phase 6 can drop it
 * straight in, and we can render it on the placeholder home page for
 * a smoke test before any real screens exist.
 *
 * Visual style is gamified, matching the Flutter chips:
 *   - rounded full pill
 *   - 1px white/30 border for the inactive state
 *   - solid white-on-primary for the active state
 *   - bold typography
 *
 * The selected pill is derived from `useAppLocale().override`. A
 * `null` override means "follow system" — that pill highlights when
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
  const t = useTranslations();
  const override = useAppLocale((s) => s.override);
  const setLocale = useSetAppLocale();

  const pills: PillSpec[] = [
    { value: null, label: t("profileAppLanguageSystem") },
    { value: "en" satisfies Locale, label: t("profileAppLanguageEnglish") },
    { value: "fr" satisfies Locale, label: t("profileAppLanguageFrench") },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("profileAppLanguageLabel")}
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
            className="rounded-full px-4 py-2 text-sm font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            style={{
              backgroundColor: isActive
                ? "#ffffff"
                : "rgba(255,255,255,0.10)",
              color: isActive ? "var(--color-primary)" : "#ffffff",
              border: isActive
                ? "1px solid #ffffff"
                : "1px solid rgba(255,255,255,0.30)",
            }}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
