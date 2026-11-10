"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { reportException } from "@/lib/analytics/client";

export default function Error({ error, unstable_retry }: { error: globalThis.Error & { digest?: string }; unstable_retry: () => void }) {
  const t = useTranslations("campaign.common");

  useEffect(() => {
    reportException(error, { boundary: "app/error.tsx", digest: error.digest });
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-slate-900">
      <p role="alert" className="text-base font-semibold">
        {t("errors.generic")}
      </p>
      <button type="button" onClick={() => unstable_retry()} className="min-h-12 rounded-xl bg-primary px-6 font-semibold text-white">
        {t("retry")}
      </button>
    </main>
  );
}
