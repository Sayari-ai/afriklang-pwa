// The dev mock's upload tickets follow the shared contract (docs/contracts) byte for byte.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { signMockTicket } from "./dev-mock";
import type { CampaignCard } from "./types";

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
