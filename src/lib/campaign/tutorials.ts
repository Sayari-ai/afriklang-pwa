/**
 * The tutorial videos shown on campaign pages (TutorialVideo): 720p, silent, captions on screen,
 * one file per language in public/tutorials/<file>.<en|fr>.mp4 with a .jpg poster. They are the
 * S1–S3 renders of the tutorial-videos Remotion project (Engineering Handbook in Notion).
 * public/tutorials is kept out of the service worker's precache (next.config.ts publicExcludes).
 */

export type TutorialId = "s1" | "s2" | "s3";
export type VideoLocale = "en" | "fr";

/** Each video: its file name, length in seconds and size in megabytes per language (one decimal; a test checks them). */
export const TUTORIALS: Record<TutorialId, { file: string; seconds: number; mb: Record<VideoLocale, number> }> = {
  s1: { file: "s1-qualification-test", seconds: 89, mb: { en: 2.5, fr: 2.7 } },
  s2: { file: "s2-record-campaign", seconds: 86, mb: { en: 2.6, fr: 3 } },
  s3: { file: "s3-pool-campaigns", seconds: 65, mb: { en: 1.9, fr: 2.1 } },
};

/** French for a French app, English for any other language (the videos exist in these two only). */
export function videoLocale(locale: string): VideoLocale {
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The video and poster paths of a tutorial in a language. */
export function tutorialFiles(id: TutorialId, locale: string): { video: string; poster: string } {
  const base = `/tutorials/${TUTORIALS[id].file}.${videoLocale(locale)}`;
  return { video: `${base}.mp4`, poster: `${base}.jpg` };
}

/** 89 → "1:29". */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
