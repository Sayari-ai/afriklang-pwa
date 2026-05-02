"use client";

/**
 * Path-setup screen — port of `lib/features/onboarding/path_setup_screen.dart`.
 *
 * Drives the path-repository boot (assign + getPath + getProgress with
 * a localStorage cache fast-path) and shows either a loading spinner
 * or a retry-able error state. On success, hands off to the splash
 * gate which forwards to /consent or /home depending on consent
 * state.
 *
 * Why bounce back to `/` instead of going straight to `/home`?
 *   The splash gate is the single source of truth for the onboarding
 *   funnel decisions. Sending users through it again on success means
 *   we never need to duplicate the "consent granted? → /home else
 *   /consent" branch in this screen.
 *
 * The component is intentionally idempotent: if the user clicks
 * "Try again" multiple times, `usePathRepo.boot()` is reentrant-safe
 * (returns the in-flight promise).
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { ScreenBackground } from "@/components/screen-background";
import { isSupabaseConfigured } from "@/lib/supabase";
import { usePathRepo } from "@/stores/path-repo";

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string; configMissing: boolean };

export default function PathSetupPage() {
  const router = useRouter();
  const t = useTranslations();

  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  // Boot routine. Pulled out into a stable callback so the retry
  // button can re-invoke it. Note that we intentionally do NOT reset
  // `stage` to loading at the top — the synchronous setState would
  // trip `react-hooks/set-state-in-effect` on first mount. Instead
  // each entry point flips to loading itself just before calling
  // `start()`. Initial state is already loading, so the cold-start
  // path is a no-op.
  const start = useCallback(async () => {
    // Same short-circuit as `path_setup_screen.dart:47-53`. On the
    // web a missing config is just as fatal — the Supabase client
    // never gets constructed.
    if (!isSupabaseConfigured) {
      setStage({
        kind: "error",
        message: t("pathSetupBackendNotConfigured"),
        configMissing: true,
      });
      return;
    }

    try {
      await usePathRepo.getState().boot();
      // Re-enter the gate so it can decide consent vs home.
      router.replace("/");
    } catch (e) {
      const message = e instanceof Error ? e.message : t("commonUnknownError");
      setStage({ kind: "error", message, configMissing: false });
    }
  }, [router, t]);

  // Kick off boot once on mount.
  //
  // We wrap in `queueMicrotask` to keep the synchronous setState
  // inside the config-missing branch out of the effect body proper —
  // otherwise `react-hooks/set-state-in-effect` flags it. The boot
  // itself is async anyway; deferring by a microtask is invisible.
  useEffect(() => {
    queueMicrotask(() => void start());
  }, [start]);

  const retry = () => {
    setStage({ kind: "loading" });
    void start();
  };

  return (
    <ScreenBackground overlay="soft">
      <div className="flex min-h-dvh w-full items-center justify-center px-8">
        {stage.kind === "loading" ? (
          <LoadingBody />
        ) : (
          <ErrorBody message={stage.message} onRetry={retry} />
        )}
      </div>
    </ScreenBackground>
  );
}

function LoadingBody() {
  const t = useTranslations();
  return (
    <div className="flex max-w-sm flex-col items-center gap-6 text-center">
      <Spinner />
      <h1
        className="whitespace-pre-line text-[32px] font-black leading-tight text-white"
        style={{ letterSpacing: "-0.5px" }}
      >
        {t("pathSetupLoadingTitle")}
      </h1>
      <p className="text-[16px] font-medium text-white">
        {t("pathSetupLoadingSubtitle")}
      </p>
    </div>
  );
}

function ErrorBody({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex w-full max-w-sm flex-col items-stretch gap-4 text-center">
      {/* Cloud-off icon — inline SVG so we don't pull a per-icon dep
          for one screen. */}
      <svg
        viewBox="0 0 24 24"
        width="64"
        height="64"
        fill="none"
        className="self-center text-white"
        aria-hidden
      >
        <path
          d="M22 16.5a4.5 4.5 0 00-4.5-4.5H17a5.5 5.5 0 00-9.78-2M2 2l20 20M5 8.5A4.5 4.5 0 005 17h11"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h1
        className="whitespace-pre-line text-[32px] font-black leading-tight text-white"
        style={{ letterSpacing: "-0.5px" }}
      >
        {t("pathSetupErrorTitle")}
      </h1>
      <p className="whitespace-pre-line text-[14px] font-medium leading-snug text-white">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 h-14 rounded-[28px] bg-white text-[20px] font-bold"
        style={{ color: "var(--color-brand-primary)" }}
      >
        {t("pathSetupRetryButton")}
      </button>
    </div>
  );
}

function Spinner() {
  // 48 px white ring with a transparent quadrant — pure CSS so we
  // don't drag in another dependency.
  return (
    <span
      role="progressbar"
      aria-label="Loading"
      className="block h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white"
    />
  );
}
