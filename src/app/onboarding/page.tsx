"use client";

/**
 * Onboarding screen — two-page intro/language-picker flow.
 *
 * Direct port of `lib/features/onboarding/onboarding_screen.dart`.
 * The Flutter version uses a PageView with optional swipe; on the web
 * we drive page changes purely from CTAs + the indicator (no swipe
 * gesture handling — feels right for a click-first UX and keeps the
 * implementation small).
 *
 * Pages (matches `_pages` in the Dart file):
 *   1. intro          — illustration + "Get your first $20" + filled CTA.
 *   2. languagePicker — chip grid + outline CTA. CTA is gated on a
 *                       selection (`onboarding_screen.dart:113-119`).
 *
 * Wallet + passcode pages stay disabled (PoC scope, see Dart comments).
 *
 * On finish:
 *   - Persist onboarding-complete (`useOnboarding.complete()`).
 *   - Punt to `/path-setup`. The path-setup screen will boot the
 *     repository, then the splash gate logic (re-entered from there)
 *     decides where to go next.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ScreenBackground } from "@/components/screen-background";
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

  // Surface any prior choice so the chip starts highlighted on a
  // returning visit (parity with `_OnboardingScreenState.initState`).
  const selectedIso = useLearningLanguage((s) => s.iso);
  const select = useLearningLanguage((s) => s.select);
  const hydrated = useLearningLanguage((s) => s.hydrated);

  // Re-entry guard. Flutter's `_AppRoot` never *shows* this screen once
  // onboarding is complete (it's a single-stage state machine). On the
  // web a user can type `/onboarding` after the fact, so we bounce
  // them to `/home`. We render `null` while the onboarding store is
  // still hydrating to avoid a flash of the intro page on a deep link.
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
    router.replace("/path-setup");
  };

  // Skip is hidden on the language picker (mandatory choice) — same
  // logic as `onboarding_screen.dart:160-164`.
  const showSkip = current !== "languagePicker";
  const showBack = index > 0;

  return (
    <ScreenBackground>
      <div className="flex min-h-dvh w-full flex-col">
        {/* Top bar */}
        <div className="flex h-14 items-center px-2 pt-[env(safe-area-inset-top)]">
          {showBack && (
            <button
              type="button"
              onClick={goBack}
              aria-label="Back"
              className="flex h-12 w-12 items-center justify-center rounded-full text-white"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                  d="M15 18l-6-6 6-6"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <div className="flex-1" />
          {showSkip && (
            <button
              type="button"
              onClick={skip}
              className="px-4 py-2 text-[22px] font-bold text-white"
            >
              {t("commonSkip")}
            </button>
          )}
        </div>

        {/* Pager */}
        <div className="relative flex-1">
          <div
            className="flex h-full transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            <div className="flex h-full w-full shrink-0 px-8">
              <IntroPage onCta={goNext} />
            </div>
            <div className="flex h-full w-full shrink-0 px-6">
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
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function IntroPage({ onCta }: { onCta: () => void }) {
  const t = useTranslations();
  return (
    <div className="flex w-full flex-col items-center justify-center gap-10 text-center">
      <Image
        src="/images/Dollar Coin.png"
        alt=""
        width={440}
        height={440}
        priority
        className="h-[220px] w-auto object-contain"
      />
      <div className="flex flex-col gap-3">
        <h1
          className="text-[40px] font-black leading-tight text-white"
          style={{ letterSpacing: "-0.5px" }}
        >
          {t("onboardingIntroTitle")}
        </h1>
        <p className="text-[24px] font-medium leading-snug text-white">
          {t("onboardingIntroSubtitle")}
        </p>
      </div>
      <PrimaryButton filled onClick={onCta}>
        {t("onboardingIntroCta")}
      </PrimaryButton>
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
    <div className="flex w-full flex-col justify-center gap-8">
      <div className="flex flex-col gap-3">
        <h1
          className="whitespace-pre-line text-[40px] font-black leading-tight text-white"
          style={{ letterSpacing: "-0.5px" }}
        >
          {t("onboardingLanguagePickerTitle")}
        </h1>
        <p className="text-[18px] font-medium text-white/70">
          {t("onboardingLanguagePickerSubtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {SUPPORTED_LEARNING_LANGUAGES.map((language) => (
          <LanguageChip
            key={language.iso}
            language={language}
            selected={selectedIso === language.iso}
            onClick={() => onSelect(language)}
          />
        ))}
      </div>

      <div
        style={{ opacity: canAdvance ? 1 : 0.5 }}
        className="transition-opacity duration-200"
      >
        <PrimaryButton
          filled={false}
          onClick={onNext}
          disabled={!canAdvance}
        >
          {t("commonNext")}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function LanguageChip({
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
      className="flex items-center gap-2.5 rounded-full border-[1.5px] border-white px-5 py-3 transition-colors duration-200"
      style={{
        backgroundColor: selected ? "var(--color-brand-primary)" : "transparent",
      }}
    >
      <span className="text-[22px] leading-none">{language.flagEmoji}</span>
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[22px] font-bold text-white">
          {language.displayName}
        </span>
        <span className="text-[13px] font-medium text-white/70">
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
            className="h-2 rounded-full transition-all duration-250"
            style={{
              width: active ? 22 : 8,
              backgroundColor: active
                ? "var(--color-brand-primary)"
                : "#FFFFFF",
            }}
          />
        );
      })}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  filled,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  filled: boolean;
  disabled?: boolean;
}) {
  // Match `_PrimaryButton` (`onboarding_screen.dart:925-960`):
  //   filled  → brand-blue background, white text
  //   outline → white background, brand-blue text
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-16 w-full rounded-[36px] text-[24px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        backgroundColor: filled ? "var(--color-brand-primary)" : "#FFFFFF",
        color: filled ? "#FFFFFF" : "var(--color-brand-primary)",
      }}
    >
      {children}
    </button>
  );
}
