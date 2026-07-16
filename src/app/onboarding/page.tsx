"use client";

/**
 * Onboarding screen two-page intro/language-picker flow.
 *
 * Direct port of `lib/features/onboarding/onboarding_screen.dart`.
 * The Flutter version uses a PageView with optional swipe; on the web
 * we drive page changes purely from CTAs + the indicator (no swipe
 * gesture handling feels right for a click-first UX and keeps the
 * implementation small).
 *
 * Pages (matches `_pages` in the Dart file):
 *   1. intro          illustration + "Get rewarded" hook + filled CTA.
 *                       (Copy deliberately promises no specific dollar
 *                       amount there is no payout mechanism yet.)
 *   2. languagePicker chip grid + outline CTA. CTA is gated on a
 *                       selection (`onboarding_screen.dart:113-119`).
 *
 * Wallet + passcode pages stay disabled (PoC scope, see Dart comments).
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

import { RewardIllustration } from "@/components/game/reward-illustration";
import { WoodButton } from "@/components/game/wood-button";
import { WoodIconButton } from "@/components/game/wood-icon-button";
import { ScreenBackground } from "@/components/screen-background";
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
    track("onboarding_complete", {
      learning_language: useLearningLanguage.getState().iso,
    });
    router.replace("/login");
  };

  // Skip is hidden on the language picker (mandatory choice) same
  // logic as `onboarding_screen.dart:160-164`.
  const showSkip = current !== "languagePicker";
  const showBack = index > 0;

  return (
    <ScreenBackground>
      <div className="flex min-h-dvh w-full flex-col">
        {/* Top bar */}
        <div className="flex h-14 items-center px-3 pt-[env(safe-area-inset-top)]">
          {showBack && (
            <WoodIconButton
              icon={ArrowLeft}
              label="Back"
              size={44}
              grass={false}
              onClick={goBack}
            />
          )}
          <div className="flex-1" />
          {showSkip && (
            <button
              type="button"
              onClick={skip}
              className="px-4 py-2 font-game text-[20px] tracking-wide text-cream phone-sm:text-[17px]"
              style={{ textShadow: "0 1.5px 0 rgba(0,0,0,0.5)" }}
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
      {/* Glossy treasure-coin hero (SVG replaces the old flat
          Dollar-Coin PNG). Decorative; the headline carries meaning. */}
      <RewardIllustration className="h-[230px] w-auto phone-sm:h-[180px]" />
      <div className="flex flex-col gap-3">
        <h1 className="text-outline font-game text-[38px] leading-tight tracking-wide text-cream phone-sm:text-[29px]">
          {t("onboardingIntroTitle")}
        </h1>
        <p
          className="text-[22px] font-medium leading-snug text-cream/95 phone-sm:text-[17px]"
          style={{ textShadow: "0 1px 0 rgba(0,0,0,0.4)" }}
        >
          {t("onboardingIntroSubtitle")}
        </p>
      </div>
      <WoodButton tone="green" size="lg" fullWidth onClick={onCta}>
        {t("onboardingIntroCta")}
      </WoodButton>
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
        <h1 className="text-outline whitespace-pre-line font-game text-[38px] leading-tight tracking-wide text-cream phone-sm:text-[29px]">
          {t("onboardingLanguagePickerTitle")}
        </h1>
        <p
          className="text-[18px] font-medium text-cream/80 phone-sm:text-[15px]"
          style={{ textShadow: "0 1px 0 rgba(0,0,0,0.4)" }}
        >
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
        <WoodButton
          tone="wood"
          size="lg"
          fullWidth
          onClick={onNext}
          disabled={!canAdvance}
        >
          {t("commonNext")}
        </WoodButton>
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
      className="flex items-center gap-2.5 rounded-full px-5 py-3 transition-all duration-200 phone-sm:px-3.5 phone-sm:py-2.5"
      style={
        selected
          ? {
              background:
                "linear-gradient(180deg, var(--color-ribbon-light) 0%, var(--color-ribbon-mid) 100%)",
              border: "2px solid var(--color-grass-dark)",
              boxShadow: "0 3px 0 var(--color-grass-deep)",
            }
          : {
              background: "rgba(0,0,0,0.25)",
              border: "2px solid rgba(233,160,91,0.4)",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)",
            }
      }
    >
      <span className="text-[22px] leading-none phone-sm:text-[18px]">{language.flagEmoji}</span>
      <span className="flex flex-col items-start leading-tight">
        <span
          className="text-[22px] font-bold phone-sm:text-[17px]"
          style={{
            color: selected ? "var(--color-grass-deep)" : "var(--color-cream)",
          }}
        >
          {language.displayName}
        </span>
        <span
          className="text-[13px] font-medium phone-sm:text-[11px]"
          style={{
            color: selected
              ? "rgba(62,122,38,0.8)"
              : "rgba(255,246,224,0.7)",
          }}
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
            className="h-2 rounded-full transition-all duration-250"
            style={{
              width: active ? 22 : 8,
              background: active
                ? "linear-gradient(180deg, var(--color-ribbon-light) 0%, var(--color-grass-light) 100%)"
                : "rgba(255,246,224,0.45)",
              boxShadow: active ? "0 1.5px 0 var(--color-grass-deep)" : "none",
            }}
          />
        );
      })}
    </div>
  );
}
