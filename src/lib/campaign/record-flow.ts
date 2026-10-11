/** Pure decisions of the recording screen (kept out of the component so they can be tested). */

import type { TakeAnalysis, TakeProblem, TakeRules } from "@/lib/audio/analyze";
import { isRetryable } from "./errors";
import type { CampaignCard, CampaignFailure, Mission, RecordingMetadata, SpeechType } from "./types";

export type GuardReason = "missing" | "profile" | "blocked" | "consent" | "paused" | "closed" | "done" | "partner";

/** Why this mission cannot be recorded right now, or null when it can. */
export function guardMission(card: CampaignCard, mission: Mission | undefined): GuardReason | null {
  if (!mission) return "missing";
  switch (card.next_step) {
    case "ready":
      break;
    case "paused":
      return "paused";
    case "closed":
      return "closed";
    case "blocked":
      return "blocked";
    case "profile":
      return "profile";
    default:
      return "consent";
  }
  if (mission.status === "accepted" || mission.status === "submitted") return "done";
  if (mission.type === "conversational" && !mission.partner_ready) return "partner";
  return null;
}

export const isTimed = (type: SpeechType) => type !== "read";

/** Stop is allowed once a timed take reached its minimum; a read sentence can stop any time. */
export function canStop(type: SpeechType, elapsedS: number, minS: number | null): boolean {
  if (!isTimed(type)) return true;
  return elapsedS >= (minS ?? 0);
}

export const problemMessageKey = (p: TakeProblem): `problem.${TakeProblem}` => `problem.${p}`;

export function takeRules(card: CampaignCard, mission: Mission): TakeRules {
  const entry = card.instructions?.speech_types?.find((s) => s.type === mission.type);
  const rec = card.instructions?.recording;
  const num = (...c: (number | null | undefined)[]) => c.find((n): n is number => typeof n === "number" && Number.isFinite(n));
  return {
    durationMinS: num(entry?.duration_min_s, mission.duration_s.min) ?? 0,
    durationMaxS: num(entry?.duration_max_s, mission.duration_s.max) ?? 600,
    minLevelDbfs: num(rec?.min_level_dbfs) ?? -35,
    silenceMarginS: num(rec?.silence_margin_s) ?? 1,
  };
}

/** The longest a take may run before auto-stop (null for a read sentence without a limit). */
export const autoStopS = (mission: Mission, rules: TakeRules): number | null => (isTimed(mission.type) ? (mission.duration_s.max ?? rules.durationMaxS) : null);

export type SubmitAction =
  | { kind: "rerecord"; reason: "duration" | "level" | "silence" | "other" }
  | { kind: "already" }
  | { kind: "hub" }
  | { kind: "signin" }
  | { kind: "retry"; reupload: boolean };

const HUB_CODES = ["partner_consent", "campaign_paused", "campaign_not_open", "account_consent", "campaign_consent", "blocked", "not_assigned", "campaign_closed", "profile_incomplete"];

/** What to do after a failed upload/submit. `uploaded`: the audio already reached Sayari, so a retry must not upload it again. */
export function submitFailureAction(failure: Pick<CampaignFailure, "code" | "reason">, ctx: { uploaded: boolean }): SubmitAction {
  if (failure.code === "recording_rejected") return { kind: "rerecord", reason: failure.reason ?? "other" };
  if (failure.code === "already_submitted") return { kind: "already" };
  if (failure.code === "unauthorized") return { kind: "signin" };
  if (HUB_CODES.includes(failure.code)) return { kind: "hub" };
  if (isRetryable(failure.code)) return { kind: "retry", reupload: !ctx.uploaded };
  // invalid_input and the like: the take cannot be saved as is
  return { kind: "rerecord", reason: "other" };
}

/** Next mission to record after `currentId` (todo or rejected), in position order. Null when none. */
export function nextTodo(missions: Mission[], currentId: string): Mission | null {
  const sorted = [...missions].sort((a, b) => a.position - b.position);
  const idx = sorted.findIndex((m) => m.mission_id === currentId);
  const open = (m: Mission) => m.mission_id !== currentId && (m.status === "todo" || m.status === "rejected");
  const after = sorted.slice(idx + 1).find(open);
  return after ?? null;
}

/** Short device label from the user agent, e.g. "Android Chrome". */
export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [os, browser].filter(Boolean).join(" ").slice(0, 60) || "unknown";
}

export function buildMetadata(a: TakeAnalysis & { sample_rate: number; channels: number }, sha: string, device: string, sayariId: string | null): RecordingMetadata {
  return {
    format: "wav",
    sample_rate: a.sample_rate,
    channels: a.channels,
    duration_s: a.duration_s,
    level_dbfs: a.level_dbfs,
    source_sha256: sha,
    peak_dbfs: a.peak_dbfs,
    silence_before_s: a.silence_before_s,
    silence_after_s: a.silence_after_s,
    device,
    ...(sayariId ? { sayari_recording_id: sayariId } : {}),
  };
}

export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
