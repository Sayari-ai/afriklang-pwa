import { isInAppBrowser } from "@/lib/campaign/in-app-browser";

/**
 * Which "how to allow the microphone" steps fit this phone. Speakers wrote in saying the
 * microphone stayed "blocked" after they changed a setting (contributor concerns, 2026-11): the
 * one-line message did not say where the switch is, nor that Android also has a switch for
 * Chrome itself, nor that an app opened inside WhatsApp or Facebook never gets the microphone.
 */
export type MicHelp = "inApp" | "android" | "ios" | "desktop";

export function micHelpFor(userAgent: string | null | undefined): MicHelp {
  const ua = userAgent ?? "";
  if (isInAppBrowser(ua)) return "inApp";
  if (/Android/i.test(ua)) return "android";
  // iPadOS 13+ reports itself as a Mac; touch points tell them apart where it matters.
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "desktop";
}

/**
 * The recording did not start within this time after the countdown: the browser never answered
 * the microphone request (a prompt left open or hidden, or an in-app browser that never shows it),
 * or the audio pipeline hung. Without a limit the studio stayed on "Get ready…" for good.
 */
export const MIC_START_TIMEOUT_MS = 15_000;
/** After this long, the label says to answer the browser's microphone question. */
export const MIC_START_HINT_MS = 2_500;
