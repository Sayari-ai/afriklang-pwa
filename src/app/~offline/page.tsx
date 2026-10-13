"use client";

/**
 * Shown by the service worker when the phone is offline and the page asked for was never saved
 * on it (next.config.ts, `fallbacks`). Precached at install, so it always opens.
 */

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";

export default function OfflinePage() {
  const t = useTranslations("campaign.common.offlinePage");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-amber-100 text-amber-800">
        <CloudOff size={32} aria-hidden />
      </span>
      <h1 className="text-xl font-black text-slate-900">{t("title")}</h1>
      <p className="max-w-sm text-slate-700">{t("body")}</p>
      {/* A plain link on purpose: a full page load, which the service worker serves from the saved pages. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/campaign" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-primary px-6 font-bold text-white">
        {t("open")}
      </a>
      <button type="button" onClick={() => window.location.reload()} className="min-h-12 rounded-2xl px-6 font-semibold text-primary">
        {t("retry")}
      </button>
    </main>
  );
}
