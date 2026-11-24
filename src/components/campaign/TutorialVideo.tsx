"use client";

/**
 * A short tutorial video (silent, with on-screen captions; English or French by the app's
 * language), folded behind one button until the speaker asks for it. Nothing is downloaded
 * before that: the poster is a small JPEG, the video loads only once opened, and the files are
 * kept out of the service worker's precache (next.config.ts, publicExcludes), so a phone on
 * mobile data never fetches 2–3 MB it did not ask for. The button says the size.
 * The files and their sizes: src/lib/campaign/tutorials.ts.
 */

import { ChevronDown, PlayCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { track } from "@/lib/analytics/events";
import { TUTORIALS, clock, tutorialFiles, videoLocale, type TutorialId } from "@/lib/campaign/tutorials";

export function TutorialVideo({ id }: { id: TutorialId }) {
  const t = useTranslations("campaign.home.tutorial");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const lang = videoLocale(locale);
  const { video, poster } = tutorialFiles(id, locale);
  const size = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(TUTORIALS[id].mb[lang]);

  return (
    <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) track("tutorial_opened", { video: id, language: lang });
          setOpen(!open);
        }}
        className="flex min-h-11 w-full items-center gap-3 text-left"
      >
        <PlayCircle size={28} className="shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-slate-900">{t(`${id}.title`)}</span>
          <span className="block text-xs font-semibold text-slate-600">{t("watch", { duration: clock(TUTORIALS[id].seconds), size })}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="mt-3">
          {/* Portrait 9:16; capped so the controls stay on screen on a short phone. */}
          <video
            key={video}
            src={video}
            poster={poster}
            controls
            playsInline
            autoPlay
            muted
            preload="metadata"
            className="mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-xs rounded-2xl bg-slate-900 object-contain"
          >
            <a href={video}>{t("download")}</a>
          </video>
          <p className="mt-2 text-center text-xs text-slate-600">{t("silent")}</p>
        </div>
      ) : null}
    </section>
  );
}
