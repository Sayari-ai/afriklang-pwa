"use client";

/**
 * Onboarding screen two-page intro/language-picker flow (flat
 * redesign).
 *
 * The Flutter version uses a PageView with optional swipe; on the web
 * we drive page changes purely from CTAs + the indicator (no swipe
 * gesture handling feels right for a click-first UX and keeps the
 * implementation small).
 *
 * Pages:
 *   1. intro          mascot hero + "Get rewarded" hook + green CTA.
 *                       (Copy deliberately promises no specific dollar
 *                       amount there is no payout mechanism yet.)
 *   2. languagePicker full-width language rows (flag + name +
 *                       country) with the blue selected treatment.
 *                       CTA is gated on a selection.
 *
 * On finish:
 *   - Persist onboarding-complete (`useOnboarding.complete()`).
 *   - Punt to `/login`. Google sign-in is mandatory (no guest mode);
 *     once a session exists the login screen bounces to the splash
 *     gate, which forwards to path-setup / consent / home.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { IconButton } from "@/components/ui/icon-button";
import { Mascot } from "@/components/ui/mascot";
import { track } from "@/lib/api/events";
import {
  type LearningLanguage,
  SUPPORTED_LEARNING_LANGUAGES,
  useLearningLanguage,
} from "@/stores/learning-language";
import { useOnboarding } from "@/stores/onboarding";

const PAGES = ["intro", "languagePicker"] as const;
type PageId = (typeof PAGES)[number];

export default function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations();

  const [index, setIndex] = useState(0);
  const current: PageId = PAGES[index];

  // Surface any prior choice so the row starts highlighted on a
  // returning visit.
  const selectedIso = useLearningLanguage((s) => s.iso);
  const select = useLearningLanguage((s) => s.select);
  const hydrated = useLearningLanguage((s) => s.hydrated);

  // Re-entry guard. A user can type `/onboarding` after the fact, so
  // we bounce them to `/home`. We render `null` while the onboarding
  // store is still hydrating to avoid a flash of the intro page on a
  // deep link.
  const onboardingHydrated = useOnboarding((s) => s.hydrated);
  const onboardingDone = useOnboarding((s) => s.complete);
  useEffect(() => {
    if (onboardingHydrated && onboardingDone) {
      router.replace("/home");
    }
  }, [onboardingHydrated, onboardingDone, router]);

  // Hydration is normally driven by <AppHydration> in the root layout,
  // but if a user deep-links straight to /onboarding before the root
  // effect runs we force-hydrate here as belt-and-braces. Cheap (LS
  // read), idempotent.
  useEffect(() => {
    if (!hydrated) useLearningLanguage.getState().hydrate();
  }, [hydrated]);

  // Hold render while we figure out whether to bounce. Mirrors the
  // pattern in `<AppRouteGuard>`.
  if (!onboardingHydrated) return null;
  if (onboardingDone) return null;

  const canAdvance =
    current === "languagePicker" ? selectedIso !== null : true;

  const goNext = () => {
    if (!canAdvance) return;
    if (index === PAGES.length - 1) {
      finish();
      return;
    }
    setIndex(index + 1);
  };

  const goBack = () => {
    if (index === 0) return;
    setIndex(index - 1);
  };

  const skip = () => {
    if (!canAdvance) return;
    finish();
  };

  const finish = () => {
    useOnboarding.getState().markComplete();
    track("onboarding_complete", {
      learning_language: useLearningLanguage.getState().iso,
    });
    router.replace("/login");
  };

  // Skip is hidden on the language picker (mandatory choice).
  const showSkip = current !== "languagePicker";
  const showBack = index > 0;

  return (
    <div className="flex min-h-dvh w-full flex-col">
      {/* Top bar */}
      <div className="flex h-14 items-center px-3 pt-[env(safe-area-inset-top)]">
        {showBack && (
          <IconButton
            icon={ArrowLeft}
            label={t("commonBack")}
            size={44}
            onClick={goBack}
          />
        )}
        <div className="flex-1" />
        {showSkip && (
          <button
            type="button"
            onClick={skip}
            className="px-4 py-2 text-[14px] font-extrabold uppercase tracking-[0.8px] text-text-faint transition-opacity active:opacity-60"
          >
            {t("commonSkip")}
          </button>
        )}
      </div>

      {/* Pager */}
      <div className="relative flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          <div className="flex h-full w-full shrink-0 px-8 phone-sm:px-5">
            <IntroPage onCta={goNext} />
          </div>
          <div className="flex h-full w-full shrink-0 px-6 phone-sm:px-4">
            <LanguagePickerPage
              selectedIso={selectedIso}
              onSelect={(lang) => select(lang.iso)}
              onNext={goNext}
              canAdvance={canAdvance}
            />
          </div>
        </div>
      </div>

      {/* Page indicator */}
      <PageIndicator count={PAGES.length} currentIndex={index} />
      <div className="h-8 pb-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function IntroPage({ onCta }: { onCta: () => void }) {
  const t = useTranslations();
  return (
    <div className="flex w-full flex-col items-center justify-center gap-10 text-center phone-sm:gap-7">
      {/* Mascot hero. Decorative; the headline carries meaning. */}
      <Mascot size={170} className="phone-sm:hidden" />
      <Mascot size={130} className="hidden phone-sm:block" />
      <div className="flex flex-col gap-3">
        <h1 className="text-[34px] font-extrabold leading-tight text-text phone-sm:text-[27px]">
          {t("onboardingIntroTitle")}
        </h1>
        <p className="text-[19px] font-semibold leading-snug text-text-muted phone-sm:text-[16px]">
          {t("onboardingIntroSubtitle")}
        </p>
      </div>
      <Button variant="primary" size="lg" fullWidth onClick={onCta}>
        {t("onboardingIntroCta")}
      </Button>
    </div>
  );
}

function LanguagePickerPage({
  selectedIso,
  onSelect,
  onNext,
  canAdvance,
}: {
  selectedIso: string | null;
  onSelect: (lang: LearningLanguage) => void;
  onNext: () => void;
  canAdvance: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="flex w-full flex-col justify-center gap-8 phone-sm:gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="whitespace-pre-line text-[32px] font-extrabold leading-tight text-text phone-sm:text-[26px]">
          {t("onboardingLanguagePickerTitle")}
        </h1>
        <p className="text-[16px] font-semibold text-text-muted phone-sm:text-[14px]">
          {t("onboardingLanguagePickerSubtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {SUPPORTED_LEARNING_LANGUAGES.map((language) => (
          <LanguageRow
            key={language.iso}
            language={language}
            selected={selectedIso === language.iso}
            onClick={() => onSelect(language)}
          />
        ))}
      </div>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={onNext}
        disabled={!canAdvance}
      >
        {t("commonNext")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function LanguageRow({
  language,
  selected,
  onClick,
}: {
  language: LearningLanguage;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-left transition-all duration-150 ${
        selected
          ? "border-blue-border bg-blue-light shadow-[0_2px_0_var(--color-blue-border)]"
          : "border-border bg-bg shadow-[0_2px_0_var(--color-border)] active:translate-y-[2px] active:shadow-none"
      }`}
    >
      <CountryFlag iso={language.iso} size={36} className="shrink-0" />
      <span className="flex flex-col items-start leading-tight">
        <span
          className={`text-[18px] font-extrabold phone-sm:text-[16px] ${
            selected ? "text-blue" : "text-text"
          }`}
        >
          {language.displayName}
        </span>
        <span
          className={`text-[13px] font-semibold phone-sm:text-[12px] ${
            selected ? "text-blue-deep" : "text-text-muted"
          }`}
        >
          {language.country}
        </span>
      </span>
    </button>
  );
}

function PageIndicator({
  count,
  currentIndex,
}: {
  count: number;
  currentIndex: number;
}) {
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {Array.from({ length: count }).map((_, i) => {
        const active = i === currentIndex;
        return (
          <span
            key={i}
            className={`h-2 rounded-full transition-all duration-250 ${
              active ? "bg-primary" : "bg-border"
            }`}
            style={{ width: active ? 22 : 8 }}
          />
        );
      })}
    </div>
  );
}
