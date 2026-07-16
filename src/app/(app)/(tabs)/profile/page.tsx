"use client";

/**
 * Profile tab settings (flat redesign).
 *
 * Three sections, each a labelled white bordered card:
 *   1. Preferences
 *      - App language: System / English / Français → bottom-sheet picker
 *        wired to `useSetAppLocale()` (writes cookie + localStorage,
 *        then `router.refresh()` so next-intl swaps message bundles).
 *      - Learning language: Twi / Fon / Wolof → bottom-sheet picker.
 *      - Nickname → shared NicknameSheet (edit mode).
 *   2. Privacy
 *      - Recording consent toggle. Re-grant is one-tap (the user has
 *        already seen the disclosure during onboarding). Revoking
 *        opens a confirm dialog with a red "Revoke" CTA.
 *   3. About
 *      - Version row. Web has no `buildNumber`; we render `version (web)`.
 *
 * Sheets are built on the shared `<Sheet>` shell; the confirm dialog
 * is a centered white card over a scrim.
 */

import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { BOTTOM_NAV_RESERVED_PX } from "@/components/bottom-nav";
import { NicknameSheet } from "@/components/nickname-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CountryFlag } from "@/components/ui/country-flag";
import { Sheet } from "@/components/ui/sheet";
import { useSetAppLocale } from "@/hooks/use-set-app-locale";
import type { Locale } from "@/i18n/locales";
import { track } from "@/lib/api/events";
import { useAppLocale, type LocaleOverride } from "@/stores/app-locale";
import { useAuth } from "@/stores/auth";
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
  | { kind: "logout-confirm" }
  | null;

export default function ProfilePage() {
  const t = useTranslations();

  // Sheet state. Only one is open at a time; we model that as a
  // discriminated union rather than three booleans.
  const [sheet, setSheet] = useState<SheetSpec>(null);

  return (
    <div
      className="flex h-dvh w-full flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className="flex-1 overflow-y-auto px-4 pt-4"
        style={{ paddingBottom: BOTTOM_NAV_RESERVED_PX + 16 }}
      >
        <h1 className="px-1 text-[26px] font-extrabold text-text">
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

        <SectionCard title={t("profileSectionAccount")}>
          <AccountRow />
          <Divider />
          <LogoutRow onTap={() => setSheet({ kind: "logout-confirm" })} />
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
      {sheet?.kind === "logout-confirm" && (
        <LogoutConfirmDialog onClose={() => setSheet(null)} />
      )}
    </div>
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
      <span className="px-2 pb-1.5 text-[12px] font-extrabold uppercase tracking-[1.2px] text-text-faint">
        {title}
      </span>
      <Card className="overflow-hidden py-1">{children}</Card>
    </div>
  );
}

function Divider() {
  return <div className="mx-4 h-0.5 bg-border/70" />;
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
      className="flex w-full items-center px-4 py-3.5 text-left transition-colors active:bg-bg-subtle disabled:cursor-default"
    >
      {/* Leading glyphs wear the mid brand purple decorative accent;
          blue stays reserved for interactive/selected states. */}
      <span className="flex h-6 w-6 items-center justify-center text-purple">
        {leading}
      </span>
      <div className="w-3" />
      <span className="flex-1 text-[16px] font-bold text-text">{label}</span>
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
    <span className="line-clamp-1 max-w-[55%] text-right text-[14px] font-semibold text-text-muted">
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
  const trailing = selected ? (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <CountryFlag iso={selected.iso} size={24} className="shrink-0" />
      <span>{selected.displayName}</span>
    </span>
  ) : (
    t("profileLearningLanguageNotSet")
  );
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
  // Reactive flips from "Not set" to the chosen value as soon as
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
      <span className="flex h-6 w-6 items-center justify-center text-purple">
        <MicGlyph />
      </span>
      <div className="w-3" />
      <div className="flex flex-1 flex-col">
        <span className="text-[16px] font-bold text-text">
          {t("profileConsentLabel")}
        </span>
        <div className="h-0.5" />
        <span className="text-[12px] font-semibold text-text-muted">
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
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        className="inline-block h-6 w-6 rounded-full bg-white transition-transform"
        style={{
          transform: checked ? "translateX(22px)" : "translateX(2px)",
          boxShadow: "0 1.5px 2px rgba(0,0,0,0.25)",
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Account rows
// ---------------------------------------------------------------------------

/**
 * Signed-in identity row (non-interactive): purple monogram disc +
 * Google display name with the email as a sublabel. Falls back to
 * the email as the headline (then to a generic label) Google
 * accounts don't always expose a name.
 */
function AccountRow() {
  const t = useTranslations();
  const user = useAuth((s) => s.user);

  const headline = user?.name ?? user?.email ?? t("profileAccountGoogleFallback");
  const sublabel = user?.name ? user.email : null;
  const monogram = (headline[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple">
        <span className="text-[17px] font-extrabold text-white">
          {monogram}
        </span>
      </span>
      <div className="w-3" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-1 text-[16px] font-bold text-text">
          {headline}
        </span>
        {sublabel && (
          <span className="line-clamp-1 text-[12px] font-semibold text-text-muted">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Log-out trigger row. Red the one leave-the-app action on the
 * screen so it must not read like just another preference. Opens
 * the confirm dialog (an accidental tap costs a full OAuth
 * round-trip to undo).
 */
function LogoutRow({ onTap }: { onTap: () => void }) {
  const t = useTranslations();
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center px-4 py-3.5 text-left transition-colors active:bg-bg-subtle"
    >
      <span className="flex h-6 w-6 items-center justify-center">
        {/* lucide defaults stroke to currentColor hex not needed here. */}
        <LogOut size={22} strokeWidth={2.5} className="text-red" aria-hidden />
      </span>
      <div className="w-3" />
      <span className="flex-1 text-[16px] font-bold text-red">
        {t("profileLogoutLabel")}
      </span>
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

function SheetOption({
  label,
  selected,
  onTap,
  leading,
}: {
  label: string;
  selected: boolean;
  onTap: () => void;
  /** Optional glyph before the label (e.g. a country flag). */
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors active:bg-bg-subtle"
    >
      {leading}
      <span
        className={`flex-1 text-[16px] ${
          selected ? "font-extrabold text-blue" : "font-semibold text-text"
        }`}
      >
        {label}
      </span>
      {selected && (
        <span className="text-blue">
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
    <Sheet title={t("profileAppLanguageLabel")} onClose={onClose}>
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
    </Sheet>
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
    <Sheet
      title={t("profileLearningLanguageSheetTitle")}
      onClose={onClose}
    >
      {SUPPORTED_LEARNING_LANGUAGES.map((lang) => (
        <SheetOption
          key={lang.iso}
          leading={
            <CountryFlag iso={lang.iso} size={30} className="shrink-0" />
          }
          label={`${lang.displayName} ${lang.country}`}
          selected={selected?.iso === lang.iso}
          onTap={() => pick(lang)}
        />
      ))}
    </Sheet>
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
        aria-label={t("commonCancel")}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <Card className="relative w-full max-w-sm p-5">
        <h2 className="text-[19px] font-extrabold text-text">
          {t("profileConsentRevokeTitle")}
        </h2>
        <div className="h-2" />
        <p className="text-[14px] font-semibold leading-snug text-text-muted">
          {t("profileConsentRevokeBody")}
        </p>
        <div className="h-4" />
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-[14px] font-extrabold uppercase tracking-[0.8px] text-text-faint transition-opacity active:opacity-60"
          >
            {t("commonCancel")}
          </button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              revoke();
              onClose();
            }}
          >
            {t("profileConsentRevokeConfirm")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logout-confirm dialog
// ---------------------------------------------------------------------------

/**
 * Confirm dialog for logging out. Reassures that device-local
 * progress survives (the Google session is only the access key 
 * `device_id` keys all backend data, so nothing is wiped).
 *
 * On confirm: `useAuth.signOut()`. The auth listener flips `user` to
 * null, `<AppRouteGuard>` bounces to the splash gate, and the gate
 * forwards to `/login` no manual navigation needed here. Errors
 * are swallowed: the store clears the local session in its `finally`
 * even when the server round-trip fails, so the redirect happens
 * regardless.
 */
function LogoutConfirmDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);

  // Body-lock + Escape, same as the sheet (but not while signing out).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, busy]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    track("logout");
    try {
      await useAuth.getState().signOut();
      // No onClose(): the route guard unmounts this screen the
      // moment `user` goes null closing early would flash the
      // profile without its dialog for a frame.
    } catch {
      // Local session is already cleared by the store's `finally`;
      // the guard redirect proceeds regardless.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <button
        type="button"
        aria-label={t("commonCancel")}
        onClick={() => {
          if (!busy) onClose();
        }}
        className="absolute inset-0 bg-black/40"
      />
      <Card className="relative w-full max-w-sm p-5">
        <h2 className="text-[19px] font-extrabold text-text">
          {t("profileLogoutConfirmTitle")}
        </h2>
        <div className="h-2" />
        <p className="text-[14px] font-semibold leading-snug text-text-muted">
          {t("profileLogoutConfirmBody")}
        </p>
        <div className="h-4" />
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-[14px] font-extrabold uppercase tracking-[0.8px] text-text-faint transition-opacity active:opacity-60 disabled:opacity-50"
          >
            {t("commonCancel")}
          </button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void confirm()}
            disabled={busy}
            loading={busy}
          >
            {t("profileLogoutConfirmAction")}
          </Button>
        </div>
      </Card>
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

function MicGlyph() {
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#A9A1BC" aria-hidden>
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
