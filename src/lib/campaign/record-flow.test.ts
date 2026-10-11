import { describe, expect, it } from "vitest";
import { buildMetadata, canStop, deviceLabel, formatClock, guardMission, nextTodo, problemMessageKey, submitFailureAction, takeRules } from "./record-flow";
import type { CampaignCard, Mission } from "./types";

const card = (over: Partial<CampaignCard> = {}): CampaignCard =>
  ({
    next_step: "ready",
    instructions: { recording: { min_level_dbfs: -30, silence_margin_s: 2 }, speech_types: [{ type: "spontaneous", duration_min_s: 20, duration_max_s: 60 }] },
    ...over,
  }) as CampaignCard;
const mission = (over: Partial<Mission> = {}): Mission =>
  ({ mission_id: "m1", code: "S-1", type: "spontaneous", position: 1, status: "todo", duration_s: { min: 10, max: 90 }, partner_ready: true, ...over }) as Mission;

describe("guardMission", () => {
  it("allows a todo mission", () => expect(guardMission(card(), mission())).toBeNull());
  it("allows a rejected mission", () => expect(guardMission(card(), mission({ status: "rejected" }))).toBeNull());
  it("missing", () => expect(guardMission(card(), undefined)).toBe("missing"));
  it("campaign states", () => {
    expect(guardMission(card({ next_step: "paused" }), mission())).toBe("paused");
    expect(guardMission(card({ next_step: "closed" }), mission())).toBe("closed");
    expect(guardMission(card({ next_step: "campaign_consent" }), mission())).toBe("consent");
    expect(guardMission(card({ next_step: "blocked" }), mission())).toBe("blocked");
  });
  it("done missions", () => {
    expect(guardMission(card(), mission({ status: "accepted" }))).toBe("done");
    expect(guardMission(card(), mission({ status: "submitted" }))).toBe("done");
  });
  it("conversational needs the partner", () => {
    expect(guardMission(card(), mission({ type: "conversational", partner_ready: false }))).toBe("partner");
    expect(guardMission(card(), mission({ type: "conversational", partner_ready: true }))).toBeNull();
  });
});

describe("canStop", () => {
  it("read can stop at once", () => expect(canStop("read", 0, 5)).toBe(true));
  it("timed waits for the minimum", () => {
    expect(canStop("spontaneous", 19, 20)).toBe(false);
    expect(canStop("conversational", 20, 20)).toBe(true);
    expect(canStop("spontaneous", 0, null)).toBe(true);
  });
});

describe("takeRules", () => {
  it("uses the speech type and recording settings", () => expect(takeRules(card(), mission())).toEqual({ durationMinS: 20, durationMaxS: 60, minLevelDbfs: -30, silenceMarginS: 2 }));
  it("falls back to the mission and defaults", () => {
    const c = card({ instructions: undefined as never });
    expect(takeRules(c, mission())).toEqual({ durationMinS: 10, durationMaxS: 90, minLevelDbfs: -35, silenceMarginS: 1 });
  });
});

describe("problemMessageKey", () => {
  it("prefixes", () => expect(problemMessageKey("clipped")).toBe("problem.clipped"));
});

describe("submitFailureAction", () => {
  it("rejection goes back to recording with the reason", () => expect(submitFailureAction({ code: "recording_rejected", reason: "level" }, { uploaded: true })).toEqual({ kind: "rerecord", reason: "level" }));
  it("rejection without reason", () => expect(submitFailureAction({ code: "recording_rejected" }, { uploaded: true })).toEqual({ kind: "rerecord", reason: "other" }));
  it("already submitted", () => expect(submitFailureAction({ code: "already_submitted" }, { uploaded: true }).kind).toBe("already"));
  it("consent/pause codes link to the hub", () => {
    for (const code of ["partner_consent", "campaign_paused", "campaign_not_open", "account_consent", "campaign_consent", "blocked", "not_assigned"] as const) {
      expect(submitFailureAction({ code }, { uploaded: true }).kind).toBe("hub");
    }
  });
  it("unauthorized", () => expect(submitFailureAction({ code: "unauthorized" }, { uploaded: true }).kind).toBe("signin"));
  it("retry never re-uploads once uploaded", () => {
    expect(submitFailureAction({ code: "network" }, { uploaded: true })).toEqual({ kind: "retry", reupload: false });
    expect(submitFailureAction({ code: "rate_limited" }, { uploaded: true })).toEqual({ kind: "retry", reupload: false });
  });
  it("retry re-uploads when the upload failed", () => expect(submitFailureAction({ code: "network" }, { uploaded: false })).toEqual({ kind: "retry", reupload: true }));
});

describe("nextTodo", () => {
  const list = [
    mission({ mission_id: "a", position: 1, status: "accepted" }),
    mission({ mission_id: "b", position: 2 }),
    mission({ mission_id: "c", position: 3, status: "submitted" }),
    mission({ mission_id: "d", position: 4, status: "rejected" }),
  ];
  it("picks the next open one after the current", () => {
    expect(nextTodo(list, "b")?.mission_id).toBe("d");
    expect(nextTodo(list, "a")?.mission_id).toBe("b");
  });
  it("ignores order of the array", () => expect(nextTodo([...list].reverse(), "a")?.mission_id).toBe("b"));
  it("null when none is left", () => expect(nextTodo(list, "d")).toBeNull());
});

describe("misc", () => {
  it("deviceLabel", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Chrome/120 Mobile Safari/537")).toBe("Android Chrome");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Mobile Safari/604")).toBe("iOS Safari");
    expect(deviceLabel("")).toBe("unknown");
  });
  it("formatClock", () => expect(formatClock(65)).toBe("1:05"));
  it("buildMetadata includes the Sayari id only when present", () => {
    const a = { duration_s: 5, level_dbfs: -20, peak_dbfs: -3, silence_before_s: 1, silence_after_s: 1, sample_rate: 16000, channels: 1 };
    expect(buildMetadata(a, "x", "d", null)).not.toHaveProperty("sayari_recording_id");
    expect(buildMetadata(a, "x", "d", "id1").sayari_recording_id).toBe("id1");
  });
});
