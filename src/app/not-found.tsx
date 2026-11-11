"use client";

/**
 * Any address the app does not have (an old or mistyped link): in the app's frame and language,
 * with a way back, instead of Next's English "404" page (APP2-22).
 */

import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("campaign.common.notFoundPage");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-black text-slate-900">{t("title")}</h1>
      <p className="max-w-sm text-slate-700">{t("body")}</p>
      {/* A plain link: a full page load, which the service worker can serve from the saved pages. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/campaign" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-primary px-6 font-bold text-white">
        {t("open")}
      </a>
    </main>
  );
}
