// The dev mock's upload tickets follow the shared contract (docs/contracts) byte for byte.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { signMockTicket } from "./dev-mock";
import type { CampaignCard, ContributorView, Mission } from "./types";

type Vector = { key: string; payload: Record<string, unknown>; payload_json: string; ticket: string };
const vectors = JSON.parse(readFileSync("docs/contracts/test-vectors.json", "utf8")) as { upload_ticket: Vector[] };
const schema = JSON.parse(readFileSync("docs/contracts/upload-ticket.schema.json", "utf8")) as { required: string[]; properties: Record<string, unknown> };

describe("dev mock upload tickets", () => {
  it("reproduces the contract's test vectors exactly", async () => {
    expect(vectors.upload_ticket.length).toBeGreaterThan(0);
    for (const v of vectors.upload_ticket) {
      expect(JSON.stringify(v.payload)).toBe(v.payload_json);
      expect(await signMockTicket(v.payload_json, v.key)).toBe(v.ticket);
    }
  });

  it("the vectors' payloads have exactly the schema's fields", () => {
    for (const v of vectors.upload_ticket) {
      for (const k of schema.required) expect(v.payload, k).toHaveProperty(k);
      for (const k of Object.keys(v.payload)) expect(Object.keys(schema.properties)).toContain(k);
    }
  });
});

describe("dev mock upload_ticket answer", () => {
  it("answers { ticket, expires_at } whose payload meets upload-ticket.schema.json, and refuses like the dashboard", async () => {
    const mem = new Map<string, string>();
    const win: Record<string, unknown> = { fetch: async () => new Response("{}"), XMLHttpRequest: class {} };
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    vi.stubEnv("NEXT_PUBLIC_CAMPAIGN_MOCK", "1");
    const { installCampaignMock } = await import("./dev-mock");
    installCampaignMock();
    const bridge = async (body: Record<string, unknown>) => {
      const res = await (win.fetch as typeof fetch)("https://mock.supabase.co/functions/v1/campaigns", { method: "POST", body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const mission = "00000000-0000-4000-8000-000000000010";
    const ask = () => bridge({ action: "upload_ticket", mission_id: mission, source_sha256: "e".repeat(64), duration_s: 5 });
    // Not onboarded yet: the gate's 403, as for missions.
    expect(await ask()).toMatchObject({ status: 403, body: { code: "profile_incomplete" } });
    await bridge({ action: "profile", variety: "Baol-Baol" });
    await bridge({ action: "consent", type: "account", version: "v2", locale: "en" });
    await bridge({ action: "consent", type: "campaign", campaign_id: "00000000-0000-4000-8000-0000000000c1", version: "v1", locale: "en" });

    const ok = await ask();
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(["expires_at", "ticket"]);
    const [head, mac] = String(ok.body.ticket).split(".");
    expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const payload = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const k of schema.required) expect(payload, k).toHaveProperty(k);
    for (const k of Object.keys(payload)) expect(Object.keys(schema.properties)).toContain(k);
    expect(payload).toMatchObject({ v: 1, mission_id: mission, source_sha256: "e".repeat(64), language: "wol", speaker_ids: ["SPK-7Q2M9X4D"] });
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(Date.parse(String(ok.body.expires_at)) / 1000).toBe(payload.exp);

    expect(await bridge({ action: "upload_ticket", mission_id: "00000000-0000-4000-8000-0000000009ff", source_sha256: "e".repeat(64), duration_s: 5 })).toMatchObject({ status: 404, body: { code: "not_assigned" } });
    (win.__afkMock as { tickets: (m: string) => void }).tickets("campaign_closed");
    expect(await ask()).toMatchObject({ status: 410, body: { code: "campaign_closed" } });
    (win.__afkMock as { tickets: (m: string) => void }).tickets("old_dashboard");
    expect(await ask()).toMatchObject({ status: 404, body: { error: "route_not_found" } });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("dev mock qualification tests (several languages, refusal details)", () => {
  /** A fresh mock on a fresh storage, with the bridge as the app calls it. */
  async function rig() {
    const mem = new Map<string, string>();
    const win: Record<string, unknown> = { fetch: async () => new Response("{}"), XMLHttpRequest: class {} };
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    vi.stubEnv("NEXT_PUBLIC_CAMPAIGN_MOCK", "1");
    const { installCampaignMock, QUAL_FUC_ID, QUAL_BAM_ID } = await import("./dev-mock");
    installCampaignMock();
    const bridge = async (body: Record<string, unknown>) => {
      const res = await (win.fetch as typeof fetch)("https://mock.supabase.co/functions/v1/campaigns", { method: "POST", body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const mock = win.__afkMock as { qcReject: (missionId: string, check?: string) => void; qualify: (d?: string, lang?: string) => void };
    return { bridge, mock, QUAL_FUC_ID, QUAL_BAM_ID };
  }
  const QUAL_ID = "00000000-0000-4000-8000-0000000000c3";
  const M1 = "00000000-0000-4000-8000-e00000000101";

  it("lists three test cards, each with its variety, and the speaker's first language", async () => {
    const { bridge, QUAL_FUC_ID, QUAL_BAM_ID } = await rig();
    const { body } = await bridge({ action: "campaigns" });
    const { contributor, campaigns } = body as { contributor: ContributorView; campaigns: CampaignCard[] };
    const tests = campaigns.filter((c) => c.kind === "qualification");
    expect(tests.map((c) => [c.campaign_id, c.language.code, c.qualification?.variety])).toEqual([
      [QUAL_ID, "wol", "Dakar urban"],
      [QUAL_FUC_ID, "fuc", "Fuuta Tooro"],
      [QUAL_BAM_ID, "bam", "Bamako"],
    ]);
    for (const c of tests) expect(c.progress.total, c.code).toBe(10);
    expect(contributor.first_language).toEqual({ code: "wol", name: "Wolof" });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("qcReject sends a mission back with the check's reason and what it measured, on the mission and its recording", async () => {
    const { bridge, mock } = await rig();
    await bridge({ action: "profile", variety: "Baol-Baol", native_language: "wol" });
    await bridge({ action: "consent", type: "account", version: "v2", locale: "en" });
    await bridge({ action: "consent", type: "campaign", campaign_id: QUAL_ID, version: "v1", locale: "en" });
    expect(await bridge({ action: "submit", mission_id: M1, recording: { duration_s: 5 } })).toMatchObject({ status: 200, body: { mission_status: "submitted" } });
    mock.qcReject(M1, "low_snr");
    const { body } = await bridge({ action: "missions", campaign_id: QUAL_ID });
    const m = (body as { missions: Mission[] }).missions.find((x) => x.mission_id === M1)!;
    const detail = { check: "low_snr", measured: 7.3, limit: 10, unit: "dB", bound: "min" };
    expect(m).toMatchObject({ status: "rejected", rejection_reason: "level", rejection_detail: detail, recording: { status: "rejected", rejection_reason: "level", rejection_detail: detail } });
    expect((body as { campaign: CampaignCard }).campaign.progress.rejected).toBe(1);
    mock.qcReject(M1, "processing_failed");
    const again = (await bridge({ action: "missions", campaign_id: QUAL_ID })).body as { missions: Mission[] };
    expect(again.missions.find((x) => x.mission_id === M1)).toMatchObject({ rejection_reason: "other", rejection_detail: { check: "processing_failed", measured: null, limit: null, unit: null, bound: null } });
    expect(() => mock.qcReject(M1, "too_quiet")).toThrow(/unknown check/);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("a submit clearly shorter than the prompt's minimum answers 422 recording_rejected with a detail, and leaves the mission as it was", async () => {
    const { bridge } = await rig();
    await bridge({ action: "profile", variety: "Baol-Baol" });
    await bridge({ action: "consent", type: "account", version: "v2", locale: "en" });
    await bridge({ action: "consent", type: "campaign", campaign_id: QUAL_ID, version: "v1", locale: "en" });
    const refused = await bridge({ action: "submit", mission_id: M1, recording: { duration_s: 1.2 } });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: "recording_rejected", reason: "duration", detail: { check: "too_short", measured: 1.2, limit: 3, unit: "s", bound: "min" } });
    expect(typeof refused.body.error).toBe("string");
    const { body } = await bridge({ action: "missions", campaign_id: QUAL_ID });
    expect((body as { missions: Mission[] }).missions.find((x) => x.mission_id === M1)).toMatchObject({ status: "todo", recording: null });
    // Just under the minimum is the dashboard's tolerance: accepted.
    expect((await bridge({ action: "submit", mission_id: M1, recording: { duration_s: 2.6 } })).status).toBe(200);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("dev mock campaign cards", () => {
  it("send the microphone distance in the dashboard's shape, so the app shows a real one", async () => {
    const mem = new Map<string, string>();
    const win: Record<string, unknown> = { fetch: async () => new Response("{}"), XMLHttpRequest: class {} };
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    vi.stubEnv("NEXT_PUBLIC_CAMPAIGN_MOCK", "1");
    const { installCampaignMock } = await import("./dev-mock");
    const { campaignMicDistance } = await import("./view");
    installCampaignMock();
    const res = await (win.fetch as typeof fetch)("https://mock.supabase.co/functions/v1/campaigns", { method: "POST", body: JSON.stringify({ action: "campaigns" }) });
    const { campaigns } = (await res.json()) as { campaigns: CampaignCard[] };
    expect(campaigns.length).toBeGreaterThan(0);
    for (const c of campaigns) {
      expect(c.instructions.recording.mic_distance_cm, c.code).toEqual({ read: [20, 30], conversational: [30, 50] });
      expect(campaignMicDistance(c).main, c.code).toEqual({ min: 20, max: 30 });
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
