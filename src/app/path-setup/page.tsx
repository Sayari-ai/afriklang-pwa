"use client";

/**
 * Path-setup screen boot gate (flat redesign).
 *
 * Drives the path-repository boot (assign + getPath + getProgress with
 * a localStorage cache fast-path) and shows either a loading state
 * (mascot + green spinner) or a retry-able error state. On success,
 * hands off to the splash gate which forwards to /consent or /home
 * depending on consent state.
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
import { CloudOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { Mascot } from "@/components/ui/mascot";
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
  // `stage` to loading at the top the synchronous setState would
  // trip `react-hooks/set-state-in-effect` on first mount. Instead
  // each entry point flips to loading itself just before calling
  // `start()`. Initial state is already loading, so the cold-start
  // path is a no-op.
  const start = useCallback(async () => {
    // On the web a missing config is fatal the Supabase client
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
  // inside the config-missing branch out of the effect body proper 
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
    <div className="flex min-h-dvh w-full items-center justify-center px-8">
      {stage.kind === "loading" ? (
        <LoadingBody />
      ) : (
        <ErrorBody message={stage.message} onRetry={retry} />
      )}
    </div>
  );
}

function LoadingBody() {
  const t = useTranslations();
  return (
    <div className="flex max-w-sm flex-col items-center gap-6 text-center">
      <Mascot size={110} />
      <span className="text-primary">
        <Spinner className="h-10 w-10" />
      </span>
      <h1 className="whitespace-pre-line text-[26px] font-extrabold leading-tight text-text">
        {t("pathSetupLoadingTitle")}
      </h1>
      <p className="text-[15px] font-semibold text-text-muted">
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
      <CloudOff
        size={64}
        strokeWidth={2}
        color="#A9A1BC"
        className="self-center"
        aria-hidden
      />
      <h1 className="whitespace-pre-line text-[26px] font-extrabold leading-tight text-text">
        {t("pathSetupErrorTitle")}
      </h1>
      <p className="whitespace-pre-line text-[14px] font-semibold leading-snug text-text-muted">
        {message}
      </p>
      <Button
        variant="primary"
        size="md"
        fullWidth
        className="mt-4"
        onClick={onRetry}
      >
        {t("pathSetupRetryButton")}
      </Button>
    </div>
  );
}
