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
    const mock = win.__afkMock as { qcReject: (missionId: string, check?: string) => void; qualify: (d?: string, lang?: string) => void; oldApplicant: (on?: boolean) => void };
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

  it("oldApplicant: no first language and two test languages, so the profile form asks; the answer is kept", async () => {
    const { bridge, mock, QUAL_FUC_ID } = await rig();
    const { firstLanguageChoices } = await import("./profile-form");
    // A filled profile first: the old applicant starts without one.
    await bridge({ action: "profile", variety: "Baol-Baol", native_language: "wol", gender: "male" });
    mock.oldApplicant();
    const before = (await bridge({ action: "campaigns" })).body as { contributor: ContributorView; campaigns: CampaignCard[] };
    expect(before.contributor.first_language).toBeNull();
    expect(before.contributor.profile.values).toBeNull();
    expect(before.contributor.gender).toBe("female");
    expect(before.campaigns.map((c) => [c.campaign_id, c.kind, c.next_step])).toEqual([[QUAL_ID, "qualification", "profile"], [QUAL_FUC_ID, "qualification", "profile"]]);
    expect(firstLanguageChoices(before.campaigns, before.contributor, "en")?.map((c) => c.code)).toEqual(["fuc", "wol"]);
    // The speaker answers Pulaar on the Wolof test: the profile keeps it, and the form no longer asks.
    await bridge({ action: "profile", variety: "Fuuta Tooro", native_language: "fuc", gender: "female" });
    const after = (await bridge({ action: "campaigns" })).body as { contributor: ContributorView; campaigns: CampaignCard[] };
    expect(after.contributor.profile.values).toMatchObject({ nativeLanguage: "fuc", variety: "Fuuta Tooro", gender: "female" });
    expect(firstLanguageChoices(after.campaigns, after.contributor, "en")).toBeNull();
    mock.oldApplicant(false);
    const usual = (await bridge({ action: "campaigns" })).body as { contributor: ContributorView; campaigns: CampaignCard[] };
    expect(usual.contributor.first_language).toEqual({ code: "wol", name: "Wolof" });
    expect(usual.campaigns).toHaveLength(5);
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
      // Sayari's default QC limits, as the dashboard sends them (decision B)
      expect(c.qc_limits, c.code).toEqual({ min_snr_db: 10, max_background_noise_db: -20, max_clipping_ratio: 0.01, max_silence_ratio: 0.5 });
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("dev mock mirrors the bridge contract (X-08)", () => {
  async function rig() {
    const mem = new Map<string, string>();
    const win: Record<string, unknown> = { fetch: async () => new Response("{}"), XMLHttpRequest: class {} };
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubEnv("NEXT_PUBLIC_CAMPAIGN_MOCK", "1");
    const { installCampaignMock } = await import("./dev-mock");
    installCampaignMock();
    const call = async (url: string, init: RequestInit) => (win.fetch as typeof fetch)(url, init);
    const bridge = async (body: Record<string, unknown>) => {
      const res = await call("https://mock.supabase.co/functions/v1/campaigns", { method: "POST", body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const mock = win.__afkMock as { claim: (m: string) => void; uploadDuplicate: (on?: boolean) => void; sweep: () => void; review: () => void };
    const onboard = async (campaignId: string) => {
      await bridge({ action: "profile", variety: "Baol-Baol", native_language: "wol" });
      await bridge({ action: "consent", type: "account", version: "v2", locale: "en" });
      await bridge({ action: "consent", type: "campaign", campaign_id: campaignId, version: "v1", locale: "en" });
    };
    return { bridge, mock, call, onboard };
  }
  const done = () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  };
  const PLANNED = "00000000-0000-4000-8000-0000000000c1";
  const QUAL = "00000000-0000-4000-8000-0000000000c3";
  const MISSION = "00000000-0000-4000-8000-000000000010";

  it("the ticket carries duration_min_s and refuses a length outside the prompt's limits before any upload", async () => {
    const { bridge, onboard } = await rig();
    await onboard(PLANNED);
    const ok = await bridge({ action: "upload_ticket", mission_id: MISSION, source_sha256: "e".repeat(64), duration_s: 5 });
    const payload = JSON.parse(Buffer.from(String(ok.body.ticket).split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(typeof payload.duration_min_s).toBe("number");
    const long = await bridge({ action: "upload_ticket", mission_id: MISSION, source_sha256: "e".repeat(64), duration_s: 999 });
    expect(long).toMatchObject({ status: 422, body: { code: "recording_rejected", reason: "duration", detail: { check: "too_long", bound: "max" } } });
    const short = await bridge({ action: "upload_ticket", mission_id: MISSION, source_sha256: "e".repeat(64), duration_s: 0.5 });
    expect(short).toMatchObject({ status: 422, body: { code: "recording_rejected", detail: { check: "too_short" } } });
    done();
  });

  it("claim can be refused as the dashboard refuses it", async () => {
    const { bridge, mock } = await rig();
    expect((await bridge({ action: "claim", token: "t" })).status).toBe(200);
    mock.claim("email_mismatch");
    expect(await bridge({ action: "claim", token: "t" })).toMatchObject({ status: 403, body: { code: "email_mismatch" } });
    mock.claim("link_expired");
    expect(await bridge({ action: "claim", token: "t" })).toMatchObject({ status: 410, body: { code: "link_expired" } });
    mock.claim("misconfigured");
    expect(await bridge({ action: "claim", token: "t" })).toMatchObject({ status: 500, body: { error: "server_misconfigured" } });
    expect(() => mock.claim("nope")).toThrow(/unknown claim mode/);
    done();
  });

  it("a test stays 'recording' after its last take until the sweep moves it to review", async () => {
    const { bridge, mock, onboard } = await rig();
    await onboard(QUAL);
    const list = (await bridge({ action: "missions", campaign_id: QUAL })).body as { missions: Mission[] };
    for (const m of list.missions) expect((await bridge({ action: "submit", mission_id: m.mission_id, recording: { duration_s: m.type === "read" ? 5 : 20 } })).status).toBe(200);
    const after = (await bridge({ action: "missions", campaign_id: QUAL })).body as { campaign: CampaignCard };
    expect(after.campaign.qualification?.stage).toBe("recording");
    mock.sweep();
    const swept = (await bridge({ action: "missions", campaign_id: QUAL })).body as { campaign: CampaignCard };
    expect(swept.campaign.qualification?.stage).toBe("in_review");
    done();
  });

  it("uploads get Sayari's answer shape, duplicate when asked; review() sends reason codes only", async () => {
    const { bridge, mock, call, onboard } = await rig();
    const form = new FormData();
    form.append("source_sha256", "a".repeat(64));
    form.append("files", new File([new Uint8Array(4)], "take.wav"));
    const first = (await (await call("/api/audio-upload", { method: "POST", body: form })).json()) as { results: { id: string; audio_sha256: string; duplicate: boolean; filename: string }[] };
    expect(first.results[0]).toMatchObject({ audio_sha256: "a".repeat(64), duplicate: false, filename: "take.wav" });
    mock.uploadDuplicate(true);
    const again = (await (await call("/api/audio-upload", { method: "POST", body: form })).json()) as { results: { duplicate: boolean }[] };
    expect(again.results[0].duplicate).toBe(true);

    await onboard(PLANNED);
    await bridge({ action: "submit", mission_id: MISSION, recording: { duration_s: 5 } });
    mock.review();
    const { body } = await bridge({ action: "missions", campaign_id: PLANNED });
    const m = (body as { missions: Mission[] }).missions.find((x) => x.mission_id === MISSION)!;
    expect(m).toMatchObject({ status: "rejected", rejection_reason: "level", recording: { status: "rejected" } });
    done();
  });
});

describe("dev mock samples consent (decision A)", () => {
  it("signs, puts sample_consent on tickets, and withdraws without touching recording", async () => {
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
    const PLANNED = "00000000-0000-4000-8000-0000000000c1";
    const MISSION = "00000000-0000-4000-8000-000000000010";
    const cards = async () => ((await bridge({ action: "campaigns" })).body as { campaigns: CampaignCard[] }).campaigns;
    const ticketPayload = async () => {
      const ok = await bridge({ action: "upload_ticket", mission_id: MISSION, source_sha256: "e".repeat(64), duration_s: 5 });
      return JSON.parse(Buffer.from(String(ok.body.ticket).split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
    };
    await bridge({ action: "profile", variety: "Baol-Baol" });
    await bridge({ action: "consent", type: "account", version: "v2", locale: "en" });
    await bridge({ action: "consent", type: "campaign", campaign_id: PLANNED, version: "v1", locale: "en" });
    for (const c of await cards()) expect(c.samples_consent, c.code).toMatchObject({ version: "v1", signed: false });
    expect(await ticketPayload()).not.toHaveProperty("sample_consent");

    await bridge({ action: "consent", type: "samples", campaign_id: PLANNED, version: "v1", locale: "fr" });
    for (const c of await cards()) expect(c.samples_consent?.signed, c.code).toBe(true);
    expect(await ticketPayload()).toMatchObject({ sample_consent: true });

    await bridge({ action: "withdraw", type: "samples" });
    const after = await cards();
    for (const c of after) expect(c.samples_consent?.signed, c.code).toBe(false);
    // still recording: the campaign consent stands
    expect(after.find((c) => c.campaign_id === PLANNED)?.next_step).toBe("ready");
    expect(await ticketPayload()).not.toHaveProperty("sample_consent");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
