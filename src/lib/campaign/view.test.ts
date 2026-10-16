import { describe, expect, it } from "vitest";
import { daysLeft, hasMissions, outboxReasonKey, rejectionReasonCode, setupStep, totals } from "./view";
import { REJECTION_REASONS } from "./types";
import en from "../../messages/campaign/common.en.json";
import fr from "../../messages/campaign/common.fr.json";

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
  });
  it("sums progress", () => {
    const p = (n: number) => ({ progress: { total: n, todo: 0, submitted: n, accepted: n, rejected: 0 } });
    expect(totals([p(1), p(2)])).toEqual({ accepted: 3, submitted: 3, rejected: 0, total: 3 });
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
