/**
 * A pretend backend for trying the speaker app without Supabase, the dashboard or Sayari.
 * Development only: active when NEXT_PUBLIC_CAMPAIGN_MOCK=1 and NODE_ENV is not production.
 *
 *   NEXT_PUBLIC_CAMPAIGN_MOCK=1 NEXT_PUBLIC_SUPABASE_URL=https://mock.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=mock npm run dev
 *
 * It signs in a fake speaker, answers the campaign bridge from state kept in localStorage
 * (reset with `localStorage.removeItem("afriklang.mock.v1")`), and accepts audio uploads.
 * `window.__afkMock.review()` plays the reviewer: accepts some submitted takes, rejects one.
 */

import type { CampaignCard, Mission, NextStep } from "./types";

const KEY = "afriklang.mock.v1";
const USER = { id: "00000000-0000-4000-8000-00000000a11c", email: "awa.diop@example.com" };

type State = { profile: boolean; account: boolean; campaign: boolean; speakerId: string | null; missions: Mission[]; variety: string | null };

const PROMPTS: [Mission["type"], string][] = [
  ["read", "Dama bëgg yónnee xaalis ci sama doom bu nekk Dakar."],
  ["read", "Ndax mën nga ma wone fan la banka bi nekk?"],
  ["read", "Sama kontu bi dafa am benn junni ak juroom téeméer."],
  ["spontaneous", "Tell us how you usually send money to your family."],
  ["read", "Wone ma ni ñuy feye ndox ak kuuraŋ ak telefon bi."],
  ["read", "Dama soxla dem ci Wari ngir jot sama xaalis."],
  ["conversational", "You are at a mobile money kiosk. One of you wants to withdraw 20,000 francs; the other is the agent."],
  ["read", "Fukk ak ñaar fan ci weer wii laa feye sama bor."],
  ["spontaneous", "What would make mobile money easier for older people?"],
  ["read", "Sama kood bu sutura, duma ko wax kenn."],
  ["read", "Jaay bi dafa jël ñaar téeméer ci benn yónnee."],
  ["read", "Dinaa la woo ëllëg ci suba ngir wax ci mbir mi."],
];

function initial(): State {
  return {
    profile: false,
    account: false,
    campaign: false,
    speakerId: null,
    variety: null,
    missions: PROMPTS.map(([type, text], i) => ({
      mission_id: `00000000-0000-4000-8000-0000000000${String(i + 10)}`,
      code: `WOL_FIN_PILOT_01_M${String(i + 1).padStart(4, "0")}`,
      type,
      position: i + 1,
      status: "todo",
      rejection_reason: null,
      prompt: { id: `WOL_FIN_PILOT_01_P${String(i + 1).padStart(3, "0")}`, text_or_topic: text, category: "finance" },
      duration_s: type === "read" ? { min: 3, max: 15 } : { min: 8, max: 30 },
      partner_speaker_id: type === "conversational" ? "SPK-4H8K2P9W" : null,
      partner_ready: true,
      recording: null,
    })),
  };
}

const load = (): State => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    return s ?? initial();
  } catch {
    return initial();
  }
};
const save = (s: State) => localStorage.setItem(KEY, JSON.stringify(s));

function step(s: State): NextStep {
  if (!s.profile) return "profile";
  if (!s.account) return "account_consent";
  if (!s.campaign) return "campaign_consent";
  return "ready";
}

function card(s: State): CampaignCard {
  const count = (st: Mission["status"]) => s.missions.filter((m) => m.status === st).length;
  return {
    assignment_id: "00000000-0000-4000-8000-0000000000a1",
    campaign_id: "00000000-0000-4000-8000-0000000000c1",
    code: "WOL_FIN_PILOT_01",
    title: "Wolof mobile money pilot",
    status: "launched",
    language: { code: "wol", name: "Wolof", varieties: ["Baol-Baol", "Saloum-Saloum", "Dakar urban"] },
    topic: { domain: "Banking and Fintech", sub_domain: "Mobile money" },
    deadline: new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10),
    progress: { total: s.missions.length, todo: count("todo"), submitted: count("submitted"), accepted: count("accepted"), rejected: count("rejected") },
    next_step: step(s),
    blocked_reason: null,
    consents: {
      account: { required_version: "v2", signed: s.account, signed_version: s.account ? "v2" : null, text_url: "https://example.com/consent/account" },
      campaign: { required_version: "v1", signed: s.campaign, signed_version: s.campaign ? "v1" : null, text_url: "https://example.com/consent/campaign" },
    },
    instructions: {
      recording: { min_level_dbfs: -35, silence_margin_s: 1, background: "Quiet room, no music", mic_distance_cm: { min: 15, max: 30 } },
      speech_types: [
        { type: "read", duration_min_s: 3, duration_max_s: 15, missions_per_session: { min: 5, max: 20 } },
        { type: "spontaneous", duration_min_s: 8, duration_max_s: 30, missions_per_session: null },
        { type: "conversational", duration_min_s: 8, duration_max_s: 30, missions_per_session: null },
      ],
    },
    partner: { speaker_id: "SPK-4H8K2P9W", ready: true },
  };
}

function contributor(s: State) {
  return {
    contributor_id: "00000000-0000-4000-8000-0000000000b1",
    speaker_id: s.speakerId,
    locale: "en" as const,
    profile: { complete: s.profile, missing: s.profile ? [] : ["region"], values: s.profile ? { nativeLanguage: "wol", variety: s.variety, country: "SN", region: "Thiès", gender: "female", ageBand: "30-44", device: "Android Chrome" } : null },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bridge(body: Record<string, unknown>): Promise<Response> {
  await delay(250);
  const s = load();
  const list = () => ({ contributor: contributor(s), campaigns: [card(s)] });
  switch (body.action) {
    case "claim":
    case "campaigns":
      return json(list());
    case "profile":
      s.profile = true;
      s.variety = String(body.variety ?? "");
      s.speakerId ??= "SPK-7Q2M9X4D";
      save(s);
      return json({ contributor: contributor(s), blocked: [] });
    case "consent":
      if (body.type === "account") s.account = true;
      else s.campaign = true;
      save(s);
      return json({ signed_version: String(body.version), already: false });
    case "missions":
      if (step(s) !== "ready") return json({ error: "Sign it first.", code: "campaign_consent", next_step: step(s) }, 403);
      return json({ campaign: card(s), missions: s.missions, rewards: { accepted: s.missions.filter((m) => m.status === "accepted").length } });
    case "submit": {
      const m = s.missions.find((x) => x.mission_id === body.mission_id);
      if (!m) return json({ error: "Not yours.", code: "not_assigned" }, 404);
      if (m.status === "submitted" || m.status === "accepted") return json({ recording_id: "r-" + m.code, mission_status: m.status, duplicate: true });
      m.status = "submitted";
      m.rejection_reason = null;
      m.recording = { status: "uploaded", rejection_reason: null };
      save(s);
      return json({ recording_id: "r-" + m.code, mission_status: "submitted", duplicate: false });
    }
    case "withdraw":
      return json({ withdrawn: true });
  }
  return json({ error: "unknown_action" }, 400);
}

export function installCampaignMock() {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_CAMPAIGN_MOCK !== "1") return;
  const w = window as unknown as { __afkMock?: unknown; fetch: typeof fetch };
  if (w.__afkMock) return;

  // A signed-in session the Supabase client accepts without the network.
  const sessionKey = "afriklang.campaign.auth.v1";
  if (!localStorage.getItem(sessionKey) && localStorage.getItem("afriklang.mock.signedOut") !== "1") {
    const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
    localStorage.setItem(sessionKey, JSON.stringify({ access_token: "mock", refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 30, expires_at: exp, user: { ...USER, aud: "authenticated", role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {}, created_at: new Date().toISOString() } }));
  }

  const real = window.fetch.bind(window);
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/functions/v1/campaigns")) return bridge(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    if (url.endsWith("/api/audio-upload")) {
      await delay(900);
      if (navigator.onLine === false) throw new TypeError("Failed to fetch");
      return json({ audio_id: "say-" + Math.random().toString(36).slice(2, 10) });
    }
    if (url.includes("/auth/v1/logout")) {
      localStorage.setItem("afriklang.mock.signedOut", "1");
      return new Response(null, { status: 204 });
    }
    return real(input, init);
  };
  w.__afkMock = {
    reset: () => localStorage.removeItem(KEY),
    signIn: () => localStorage.removeItem("afriklang.mock.signedOut"),
    /** The team reviewed: the first submitted take is rejected, the others accepted. */
    review: () => {
      const s = load();
      let first = true;
      for (const m of s.missions) {
        if (m.status !== "submitted") continue;
        if (first) {
          m.status = "rejected";
          m.rejection_reason = "Background noise (a radio) under the voice.";
          first = false;
        } else m.status = "accepted";
      }
      save(s);
    },
  };
}
