import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { campaignMicDistance, cardOpenCount, daysLeft, hasMissions, historyGroups, waitsForPartner, isTestRecording, micDistance, outboxReasonKey, rejectionReasonCode, setupStep, testRedoCount, toRecordCount, totals } from "./view";
import { REJECTION_REASONS, type CampaignCard, type SpeechType } from "./types";
import en from "../../messages/campaign/common.en.json";
import fr from "../../messages/campaign/common.fr.json";
import flowEn from "../../messages/campaign/flow.en.json";
import flowFr from "../../messages/campaign/flow.fr.json";
import homeEn from "../../messages/campaign/home.en.json";
import homeFr from "../../messages/campaign/home.fr.json";

describe("speaker view facts", () => {
  it("counts days to the deadline in local days", () => {
    const now = new Date(2026, 9, 12, 23, 30);
    expect(daysLeft("2026-10-12", now)).toBe(0);
    expect(daysLeft("2026-10-20", now)).toBe(8);
    expect(daysLeft("2026-10-01", now)).toBe(-11);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft("soon", now)).toBeNull();
  });
  it("knows the setup step", () => {
    expect(setupStep("profile")).toBe(1);
    expect(setupStep("account_consent")).toBe(2);
    expect(setupStep("campaign_consent")).toBe(3);
    expect(setupStep("ready")).toBeNull();
  });
  it("hides planned campaigns without assigned missions", () => {
    const none = { total: 0, todo: 0, submitted: 0, accepted: 0, rejected: 0 };
    expect(hasMissions({ progress: none, next_step: "ready" })).toBe(false);
    expect(hasMissions({ progress: none, next_step: "profile", dispatch: "planned" })).toBe(false);
    expect(hasMissions({ progress: { ...none, total: 3, todo: 3 }, next_step: "profile" })).toBe(true);
  });
  it("shows a pool campaign before anything is drawn, unless it is paused or over", () => {
    const none = { total: 0, todo: 0, submitted: 0, accepted: 0, rejected: 0 };
    for (const next_step of ["profile", "blocked", "account_consent", "campaign_consent", "ready"] as const) expect(hasMissions({ progress: none, next_step, dispatch: "pool" }), next_step).toBe(true);
    expect(hasMissions({ progress: none, next_step: "paused", dispatch: "pool" })).toBe(false);
    expect(hasMissions({ progress: none, next_step: "closed", dispatch: "pool" })).toBe(false);
    expect(hasMissions({ progress: { ...none, total: 2, accepted: 2 }, next_step: "closed", dispatch: "pool" })).toBe(true);
  });
  it("explains outbox codes briefly", () => {
    expect(outboxReasonKey("campaign_paused")).toBe("paused");
    expect(outboxReasonKey("refused")).toBe("file");
    expect(outboxReasonKey("language_unsupported")).toBe("language");
    expect(outboxReasonKey("not_assigned")).toBe("unassigned");
    expect(outboxReasonKey("campaign_closed")).toBe("closed");
    expect(outboxReasonKey("offline")).toBe("network");
    expect(outboxReasonKey(null)).toBe("generic");
    // A missing profile is not a consent, and a block waits for the team, not a closed campaign (N-16).
    expect(outboxReasonKey("profile_incomplete")).toBe("profile");
    expect(outboxReasonKey("blocked")).toBe("blocked");
    // a fault on our side says so (APP2-02, APP2-04)
    expect(outboxReasonKey("misconfigured")).toBe("fixing");
    expect(outboxReasonKey("ticket_required")).toBe("fixing");
  });
  it("does not count a conversation waiting for the partner as to record (N-12)", () => {
    const mk = (id: string, over: Record<string, unknown> = {}) => ({ mission_id: id, status: "todo" as const, type: "read" as const, partner_ready: false, ...over });
    const missions = [mk("a"), mk("b", { type: "conversational" }), mk("c", { type: "conversational", partner_ready: true }), mk("d", { status: "accepted" })];
    expect(toRecordCount(missions as never, new Map())).toBe(2);
    expect(toRecordCount(missions as never, new Map([["a", "pending" as const]]))).toBe(1);
    expect(toRecordCount(missions as never, new Map([["a", "failed" as const]]))).toBe(2);
  });
  it("sums progress", () => {
    const p = (n: number) => ({ progress: { total: n, todo: 0, submitted: n, accepted: n, rejected: 0 } });
    expect(totals([p(1), p(2)])).toEqual({ accepted: 3, submitted: 3, rejected: 0, total: 3 });
  });
  it("counts a test's clips to record again only while it is recording (R28)", () => {
    const q = (stage: "recording" | "in_review" | "decided" | "cancelled") => ({ attempt_no: 1, stage, decision: null, accepted: null, total: 10, retry_after: null });
    const progress = { total: 10, todo: 7, submitted: 1, accepted: 0, rejected: 2 };
    expect(testRedoCount({ progress, qualification: q("recording") })).toBe(2);
    expect(testRedoCount({ progress, qualification: null })).toBe(2);
    expect(testRedoCount({ progress: { ...progress, rejected: 0 }, qualification: q("recording") })).toBe(0);
    for (const stage of ["in_review", "decided", "cancelled"] as const) expect(testRedoCount({ progress, qualification: q(stage) }), stage).toBe(0);
  });
  it("reads a test without a view as still recording, the one rule of the card, its chip and the history", () => {
    const q = (stage: "recording" | "in_review" | "decided" | "cancelled") => ({ attempt_no: 1, stage, decision: null, accepted: null, total: 10, retry_after: null });
    expect(isTestRecording(null)).toBe(true);
    expect(isTestRecording(undefined)).toBe(true);
    expect(isTestRecording(q("recording"))).toBe(true);
    for (const stage of ["in_review", "decided", "cancelled"] as const) expect(isTestRecording(q(stage)), stage).toBe(false);
    const progress = { total: 10, todo: 7, submitted: 1, accepted: 0, rejected: 2 };
    for (const qualification of [null, q("recording"), q("decided")]) expect(testRedoCount({ progress, qualification })).toBe(isTestRecording(qualification) ? 2 : 0);
  });
});

describe("rejection reasons (MAN-002)", () => {
  it("recognises the dashboard's eight codes and leaves a reviewer's own words alone", () => {
    expect(rejectionReasonCode("level")).toBe("level");
    expect(rejectionReasonCode(" Speaker_Balance ")).toBe("speaker_balance");
    expect(rejectionReasonCode("Background noise (a radio)")).toBeNull();
    expect(rejectionReasonCode(null)).toBeNull();
  });
  it("has one sentence per reason in English and French", () => {
    for (const r of REJECTION_REASONS) {
      expect(en.rejection[r]).toMatch(/\.$/);
      expect(fr.rejection[r]).toMatch(/\.$/);
    }
  });
});

describe("microphone distance", () => {
  // What the dashboard's bridge sends: the campaign spec's recording.mic_distance_cm, here its
  // defaults (in every campaign built from its example campaign file), [from, to] cm per kind.
  const BRIDGE_MIC = { read: [20, 30], conversational: [30, 50] };
  const card = (types: SpeechType[], mic: { mic_distance_cm?: unknown } = { mic_distance_cm: BRIDGE_MIC }) =>
    ({
      instructions: {
        recording: { min_level_dbfs: -35, silence_margin_s: 1, ...mic },
        speech_types: types.map((type) => ({ type, duration_min_s: 3, duration_max_s: 15 })),
      },
    }) as Pick<CampaignCard, "instructions">;

  /** The hub tip and the Instructions rule, worded as CampaignHub and Instructions word them. */
  function texts(c: Pick<CampaignCard, "instructions">, locale: "en" | "fr") {
    const tip = createTranslator({ locale, messages: { home: locale === "en" ? homeEn : homeFr }, namespace: "home.hub.tips" });
    const rule = createTranslator({ locale, messages: { flow: locale === "en" ? flowEn : flowFr }, namespace: "flow.instructions" });
    const { main, conversation } = campaignMicDistance(c);
    return {
      tip: main && conversation ? tip("distanceConversation", { ...main, convMin: conversation.min, convMax: conversation.max }) : main ? tip("distance", main) : tip("distanceDefault"),
      rule: main && !conversation ? rule("mic", main) : null,
    };
  }

  it("reads the dashboard's [from, to] pairs, not a {min, max} it never sends", () => {
    expect(texts(card(["read"]), "en")).toEqual({ tip: "Phone 20–30 cm from your mouth", rule: "Hold the phone 20 to 30 cm from your mouth." });
    expect(texts(card(["read"]), "fr")).toEqual({ tip: "Téléphone à 20–30 cm de la bouche", rule: "Tenez le téléphone à 20 à 30 cm de votre bouche." });
  });
  it("gives speaking freely the reading distance, and conversations their own", () => {
    expect(micDistance(card(["spontaneous"]), "spontaneous")).toEqual({ min: 20, max: 30 });
    expect(micDistance(card(["conversational"]), "conversational")).toEqual({ min: 30, max: 50 });
    expect(campaignMicDistance(card(["read", "spontaneous"]))).toEqual({ main: { min: 20, max: 30 }, conversation: null });
    expect(campaignMicDistance(card(["conversational"]))).toEqual({ main: { min: 30, max: 50 }, conversation: null });
  });
  it("names both distances when the campaign's conversations are held further away", () => {
    const mixed = card(["read", "spontaneous", "conversational"]);
    expect(campaignMicDistance(mixed)).toEqual({ main: { min: 20, max: 30 }, conversation: { min: 30, max: 50 } });
    expect(texts(mixed, "en")).toEqual({ tip: "Phone 20–30 cm from your mouth, 30–50 cm in a conversation", rule: null });
    // The same distance for both kinds is one rule.
    expect(campaignMicDistance(card(["read", "conversational"], { mic_distance_cm: { read: [25, 40], conversational: [25, 40] } }))).toEqual({ main: { min: 25, max: 40 }, conversation: null });
  });
  it("falls back to the generic advice without a usable distance", () => {
    // An older card without the field, and the {min, max} the app used to expect.
    const none = [{}, { mic_distance_cm: null }, { mic_distance_cm: { min: 15, max: 30 } }];
    const broken = [{ read: [10] }, { read: "near" }, { read: [30, 20] }, { read: [0, 10] }, { read: ["20", "30"] }].map((m) => ({ mic_distance_cm: m }));
    for (const mic of [...none, ...broken]) {
      expect(campaignMicDistance(card(["read"], mic)), JSON.stringify(mic)).toEqual({ main: null, conversation: null });
      expect(texts(card(["read"], mic), "en"), JSON.stringify(mic)).toEqual({ tip: "Phone a hand's width from your mouth", rule: null });
    }
  });
});

describe("historyGroups (APP2-07)", () => {
  const card = (next_step: string, total: number, todo: number) => ({ next_step, progress: { total, todo, submitted: 0, accepted: total - todo, rejected: 0 } }) as never;
  it("a campaign with recordings waiting on a new consent is listed as locked, not hidden", () => {
    const ready = card("ready", 10, 2);
    const consent = card("campaign_consent", 10, 4);
    const blocked = card("blocked", 5, 1);
    const untouched = card("campaign_consent", 10, 10);
    const g = historyGroups([ready, consent, blocked, untouched]);
    expect(g.readable).toEqual([ready]);
    expect(g.locked).toEqual([consent, blocked]);
  });
});

describe("conversations waiting for the partner (APP2-08)", () => {
  const conv = (id: string, partner_ready: boolean, status: "todo" | "rejected" | "submitted" = "todo") => ({ mission_id: id, status, type: "conversational" as const, partner_ready });
  const read = (id: string) => ({ mission_id: id, status: "todo" as const, type: "read" as const, partner_ready: false });
  it("the home card counts what can be recorded now, as the hub, when the missions are saved", () => {
    const card = { progress: { total: 5, todo: 5, submitted: 0, accepted: 0, rejected: 0 } } as never;
    const missions = [read("a"), read("b"), read("c"), conv("d", false), conv("e", false)];
    expect(cardOpenCount(card, missions, new Map())).toBe(3);
    expect(cardOpenCount(card, missions, new Map([["a", "pending" as const]]))).toBe(2);
    // not saved on the phone yet: the card's counts, minus the takes waiting on the phone
    expect(cardOpenCount(card, null, new Map([["a", "pending" as const], ["b", "failed" as const]]))).toBe(4);
  });
  it("a waiting conversation is told apart from one that can be recorded", () => {
    expect(waitsForPartner(conv("d", false), undefined)).toBe(true);
    expect(waitsForPartner(conv("d", false, "rejected"), undefined)).toBe(true);
    expect(waitsForPartner(conv("d", true), undefined)).toBe(false);
    expect(waitsForPartner(conv("d", false, "submitted"), undefined)).toBe(false);
    expect(waitsForPartner(conv("d", false), "pending")).toBe(false);
    expect(waitsForPartner(read("a"), undefined)).toBe(false);
  });
});
