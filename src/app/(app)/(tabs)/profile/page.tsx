"use client";

/**
 * Profile tab — port of `lib/features/profile/profile_screen.dart`.
 *
 * Three sections, each rendered as a labelled white rounded card:
 *   1. Preferences
 *      - App language: System / English / Français → bottom-sheet picker
 *        wired to `useSetAppLocale()` (writes cookie + localStorage,
 *        then `router.refresh()` so next-intl swaps message bundles).
 *      - Learning language: Twi / Fon / Wolof → bottom-sheet picker.
 *   2. Privacy
 *      - Recording consent toggle. Re-grant is one-tap (the user has
 *        already seen the disclosure during onboarding). Revoking
 *        opens a confirm dialog with a red "Revoke" CTA.
 *   3. About
 *      - Version row. Pulled from `package.json` via a build-time
 *        constant (`process.env.NEXT_PUBLIC_APP_VERSION`) with a
 *        fallback to the `package.json` `version` baked at compile
 *        time. Web has no `buildNumber`; we render `version (web)`.
 *
 * Differences from Flutter:
 *   - `showModalBottomSheet` → fixed-position overlay with a
 *     translucent scrim. Tapping the scrim cancels (same UX).
 *   - `Switch.adaptive` → custom CSS toggle in brand primary.
 *   - `package_info_plus` → static `APP_VERSION` (Next 16 doesn't
 *     bundle native package metadata; this is honest about the runtime).
 *   - `_LocaleOverride` is `Locale | null`; the sheet returns
 *     `LocaleOverride | undefined` (undefined = dismissed).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ScreenBackground } from "@/components/screen-background";
import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { WoodButton } from "@/components/game/wood-button";
import { WoodPanel } from "@/components/game/wood-panel";
import { NicknameSheet } from "@/components/nickname-sheet";
import { useSetAppLocale } from "@/hooks/use-set-app-locale";
import type { Locale } from "@/i18n/locales";
import { useAppLocale, type LocaleOverride } from "@/stores/app-locale";
import { useConsent } from "@/stores/consent";
import {
  SUPPORTED_LEARNING_LANGUAGES,
  type LearningLanguage,
  useLearningLanguage,
} from "@/stores/learning-language";
import { useNickname } from "@/stores/nickname";

// Baked at build time. The PWA has no native package metadata, so
// we expose the package.json version directly. (Next inlines
// `process.env.NEXT_PUBLIC_*` at build, but `npm_package_version`
// is only set during scripts; we read it via a fallback constant
// updated by hand on release. Honest, simple, no native deps.)
const APP_VERSION = "0.1.0";
const APP_BUILD = "web";

type SheetSpec =
  | { kind: "app-language" }
  | { kind: "learning-language" }
  | { kind: "nickname" }
  | { kind: "revoke-confirm" }
  | null;

export default function ProfilePage() {
  const t = useTranslations();

  // Sheet state. Only one is open at a time; we model that as a
  // discriminated union rather than three booleans.
  const [sheet, setSheet] = useState<SheetSpec>(null);

  return (
    <ScreenBackground overlay="strong">
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{ paddingBottom: BOTTOM_NAV_RESERVED_PX + 16 }}
      >
        <h1 className="text-outline px-1 font-game text-[30px] tracking-wide text-cream">
          {t("profileTitle")}
        </h1>
        <div className="h-4" />

        <SectionCard title={t("profileSectionPreferences")}>
          <AppLanguageRow onTap={() => setSheet({ kind: "app-language" })} />
          <Divider />
          <LearningLanguageRow
            onTap={() => setSheet({ kind: "learning-language" })}
          />
          <Divider />
          <NicknameRow onTap={() => setSheet({ kind: "nickname" })} />
        </SectionCard>

        <div className="h-4" />

        <SectionCard title={t("profileSectionPrivacy")}>
          <ConsentRow
            onRequestRevoke={() => setSheet({ kind: "revoke-confirm" })}
          />
        </SectionCard>

        <div className="h-4" />

        <SectionCard title={t("profileSectionAbout")}>
          <VersionRow />
        </SectionCard>
      </div>

      {sheet?.kind === "app-language" && (
        <AppLanguageSheet onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "learning-language" && (
        <LearningLanguageSheet onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "nickname" && (
        <NicknameSheet mode="edit" onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "revoke-confirm" && (
        <RevokeConfirmDialog onClose={() => setSheet(null)} />
      )}
    </ScreenBackground>
  );
}

// ---------------------------------------------------------------------------
// Section primitives
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span
        className="px-2 pb-1.5 text-[12px] font-extrabold text-cream/75"
        style={{ letterSpacing: "1.2px", textShadow: "0 1px 0 rgba(0,0,0,0.4)" }}
      >
        {title.toUpperCase()}
      </span>
      <WoodPanel grass={false} contentClassName="overflow-hidden py-1">
        {children}
      </WoodPanel>
    </div>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-ink/20" />;
}

function Tile({
  leading,
  label,
  trailing,
  onTap,
}: {
  leading: React.ReactNode;
  label: string;
  trailing: React.ReactNode;
  onTap?: (() => void) | null;
}) {
  const tappable = !!onTap;
  return (
    <button
      type="button"
      onClick={onTap ?? undefined}
      disabled={!tappable}
      className="flex w-full items-center px-4 py-3.5 text-left transition-colors active:bg-black/10 disabled:cursor-default"
    >
      <span
        className="flex h-6 w-6 items-center justify-center"
        style={{
          color: "var(--color-grass-deep)",
          filter: "drop-shadow(0 1px 0 rgba(255,235,205,0.4))",
        }}
      >
        {leading}
      </span>
      <div className="w-3" />
      <span className="flex-1 text-[16px] font-bold text-ink">{label}</span>
      <TrailingValue>{trailing}</TrailingValue>
      {tappable && (
        <>
          <span className="w-1" />
          <ChevronRightIcon />
        </>
      )}
    </button>
  );
}

function TrailingValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="line-clamp-1 max-w-[55%] text-right text-[14px] font-semibold text-ink/70">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// App-language row
// ---------------------------------------------------------------------------

function AppLanguageRow({ onTap }: { onTap: () => void }) {
  const t = useTranslations();
  const override = useAppLocale((s) => s.override);

  let label: string;
  if (override === null) label = t("profileAppLanguageSystem");
  else if (override === "en") label = t("profileAppLanguageEnglish");
  else if (override === "fr") label = t("profileAppLanguageFrench");
  else label = t("profileAppLanguageSystem");

  return (
    <Tile
      leading={<TranslateIcon />}
      label={t("profileAppLanguageLabel")}
      trailing={label}
      onTap={onTap}
    />
  );
}

// ---------------------------------------------------------------------------
// Learning-language row
// ---------------------------------------------------------------------------

function LearningLanguageRow({ onTap }: { onTap: () => void }) {
  const t = useTranslations();
  const selected = useLearningLanguage((s) => s.selected);
  const trailing = selected
    ? `${selected.flagEmoji} ${selected.displayName}`
    : t("profileLearningLanguageNotSet");
  return (
    <Tile
      leading={<SchoolIcon />}
      label={t("profileLearningLanguageLabel")}
      trailing={trailing}
      onTap={onTap}
    />
  );
}

// ---------------------------------------------------------------------------
// Nickname row
// ---------------------------------------------------------------------------

function NicknameRow({ onTap }: { onTap: () => void }) {
  const t = useTranslations();
  // Reactive — flips from "Not set" to the chosen value as soon as
  // the user submits the sheet. We don't show the server-assigned
  // fallback here because it's not known on the profile screen
  // (would require a leaderboard fetch); keep this row strictly
  // about the *user-chosen* override.
  const value = useNickname((s) => s.value);
  const trailing = value && value.length > 0
    ? value
    : t("profileNicknameNotSet");
  return (
    <Tile
      leading={<PersonIcon />}
      label={t("profileNicknameLabel")}
      trailing={trailing}
      onTap={onTap}
    />
  );
}

// ---------------------------------------------------------------------------
// Consent row
// ---------------------------------------------------------------------------

function ConsentRow({
  onRequestRevoke,
}: {
  onRequestRevoke: () => void;
}) {
  const t = useTranslations();
  const granted = useConsent((s) => s.granted);
  const grant = useConsent((s) => s.grant);

  const onToggle = () => {
    if (granted) {
      // Revoking requires a confirm dialog.
      onRequestRevoke();
    } else {
      grant();
    }
  };

  return (
    <div className="flex items-center px-4 py-3">
      <span
        style={{
          color: "var(--color-grass-deep)",
          filter: "drop-shadow(0 1px 0 rgba(255,235,205,0.4))",
        }}
      >
        <MicIcon />
      </span>
      <div className="w-3" />
      <div className="flex flex-1 flex-col">
        <span className="text-[16px] font-bold text-ink">
          {t("profileConsentLabel")}
        </span>
        <div className="h-0.5" />
        <span className="text-[12px] font-medium text-ink/70">
          {granted
            ? t("profileConsentSublabelGranted")
            : t("profileConsentSublabelRevoked")}
        </span>
      </div>
      <ToggleSwitch checked={granted} onChange={onToggle} />
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors"
      style={
        checked
          ? {
              background:
                "linear-gradient(180deg, var(--color-grass-dark) 0%, var(--color-grass-light) 100%)",
              boxShadow: "inset 0 1.5px 3px rgba(0,0,0,0.25)",
            }
          : {
              background: "rgba(0,0,0,0.3)",
              boxShadow: "inset 0 1.5px 3px rgba(0,0,0,0.35)",
            }
      }
    >
      <span
        className="inline-block h-6 w-6 rounded-full bg-cream shadow transition-transform"
        style={{
          transform: checked ? "translateX(22px)" : "translateX(2px)",
          boxShadow: "0 1.5px 2px rgba(0,0,0,0.35)",
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Version row
// ---------------------------------------------------------------------------

function VersionRow() {
  const t = useTranslations();
  return (
    <Tile
      leading={<InfoIcon />}
      label={t("profileVersionLabel")}
      trailing={t("profileVersionValue", {
        version: APP_VERSION,
        build: APP_BUILD,
      })}
      onTap={null}
    />
  );
}

// ---------------------------------------------------------------------------
// Bottom sheets
// ---------------------------------------------------------------------------

function SheetShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Lock body scroll while open + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Scrim. Tapping it dismisses. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative mx-auto flex w-full max-w-[480px] flex-col pb-safe">
        {/* Wooden sheet: carved rim + lit plank face (top corners only). */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{
            background: "linear-gradient(180deg, #7d4423 0%, #56301a 100%)",
            borderRadius: "24px 22px 0 0 / 22px 24px 0 0",
            boxShadow: "0 -6px 18px rgba(0,0,0,0.4)",
          }}
        />
        <span
          aria-hidden="true"
          className="absolute -z-10"
          style={{
            inset: "4px 4px 0 4px",
            background:
              "linear-gradient(180deg, var(--color-wood-panel-light) 0%, var(--color-wood-panel-dark) 100%)",
            borderRadius: "20px 18px 0 0 / 18px 20px 0 0",
            boxShadow: "inset 0 3px 0 rgba(255,235,200,0.35)",
          }}
        />
        <div className="flex justify-center pt-2.5">
          <span className="block h-1.5 w-10 rounded-full bg-ink/40" />
        </div>
        <div className="h-3" />
        <h2
          className="px-4 font-game text-[19px] tracking-wide text-cream"
          style={{ textShadow: "0 1.5px 0 rgba(92,48,24,0.7)" }}
        >
          {title}
        </h2>
        <div className="h-2" />
        <div className="flex flex-col">{children}</div>
        <div className="h-3" />
      </div>
    </div>
  );
}

function SheetOption({
  label,
  selected,
  onTap,
}: {
  label: string;
  selected: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center px-5 py-3.5 text-left transition-colors active:bg-black/10"
    >
      <span
        className="flex-1 text-[16px]"
        style={{
          color: selected ? "var(--color-ink)" : "rgba(92,48,24,0.8)",
          fontWeight: selected ? 800 : 500,
        }}
      >
        {label}
      </span>
      {selected && (
        <span
          style={{
            color: "var(--color-grass-deep)",
            filter: "drop-shadow(0 1px 0 rgba(255,235,205,0.4))",
          }}
        >
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

function AppLanguageSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const override = useAppLocale((s) => s.override);
  const setLocale = useSetAppLocale();

  const pick = (next: LocaleOverride) => {
    setLocale(next);
    onClose();
  };

  const isOverride = (v: Locale): boolean => override === v;

  return (
    <SheetShell title={t("profileAppLanguageLabel")} onClose={onClose}>
      <SheetOption
        label={t("profileAppLanguageSystem")}
        selected={override === null}
        onTap={() => pick(null)}
      />
      <SheetOption
        label={t("profileAppLanguageEnglish")}
        selected={isOverride("en")}
        onTap={() => pick("en")}
      />
      <SheetOption
        label={t("profileAppLanguageFrench")}
        selected={isOverride("fr")}
        onTap={() => pick("fr")}
      />
    </SheetShell>
  );
}

function LearningLanguageSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const selected = useLearningLanguage((s) => s.selected);
  const select = useLearningLanguage((s) => s.select);

  const pick = (lang: LearningLanguage) => {
    select(lang.iso);
    onClose();
  };

  return (
    <SheetShell
      title={t("profileLearningLanguageSheetTitle")}
      onClose={onClose}
    >
      {SUPPORTED_LEARNING_LANGUAGES.map((lang) => (
        <SheetOption
          key={lang.iso}
          label={`${lang.flagEmoji}  ${lang.displayName} — ${lang.country}`}
          selected={selected?.iso === lang.iso}
          onTap={() => pick(lang)}
        />
      ))}
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// Revoke-confirm dialog
// ---------------------------------------------------------------------------

function RevokeConfirmDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const revoke = useConsent((s) => s.revoke);

  // Body-lock + Escape, same as the sheet.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <WoodPanel grass={false} className="relative w-full max-w-sm" contentClassName="p-5">
        <h2
          className="font-game text-[20px] tracking-wide text-cream"
          style={{ textShadow: "0 1.5px 0 rgba(92,48,24,0.7)" }}
        >
          {t("profileConsentRevokeTitle")}
        </h2>
        <div className="h-2" />
        <p className="text-[14px] font-medium leading-snug text-cream/90">
          {t("profileConsentRevokeBody")}
        </p>
        <div className="h-4" />
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[14px] font-bold text-cream/90"
            style={{ textShadow: "0 1px 0 rgba(92,48,24,0.6)" }}
          >
            {t("commonCancel")}
          </button>
          <WoodButton
            tone="red"
            size="sm"
            grass={false}
            onClick={() => {
              revoke();
              onClose();
            }}
          >
            {t("profileConsentRevokeConfirm")}
          </WoodButton>
        </div>
      </WoodPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

function TranslateIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
    </svg>
  );
}

function SchoolIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-7 11.09v4l7 3.81 7-3.81v-4l-7 3.81-7-3.81z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 14c1.66 0 3-1.34 3-3V5a3 3 0 00-6 0v6c0 1.66 1.34 3 3 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(92,48,24,0.5)" aria-hidden>
      <path d="M9.29 6.71a1 1 0 000 1.41L13.17 12l-3.88 3.88a1 1 0 101.42 1.41l4.59-4.59a1 1 0 000-1.41L10.71 6.71a1 1 0 00-1.42 0z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z" />
    </svg>
  );
}
