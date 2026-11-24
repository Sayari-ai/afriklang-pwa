"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { reportException } from "@/lib/analytics/client";
import { retryAction, type ErrorBoundaryActions } from "@/lib/campaign/error-recovery";

// Next 16.4 passes `retry` and `reset` (no more `unstable_retry`): retryAction picks what is there.
export default function Error({ error, ...actions }: { error: globalThis.Error & { digest?: string } } & ErrorBoundaryActions) {
  const t = useTranslations("campaign.common");

  useEffect(() => {
    reportException(error, { boundary: "app/error.tsx", digest: error.digest });
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-slate-900">
      <p role="alert" className="text-base font-semibold">
        {t("errors.generic")}
      </p>
      <button type="button" onClick={retryAction(actions)} className="min-h-12 rounded-xl bg-primary px-6 font-semibold text-white">
        {t("retry")}
      </button>
      {/* A file of an older version missing after an update (ChunkLoadError): only a full reload helps (APP2-22). */}
      <button type="button" onClick={() => window.location.reload()} className="min-h-12 rounded-xl px-6 font-semibold text-primary">
        {t("reloadApp")}
      </button>
    </main>
  );
}
