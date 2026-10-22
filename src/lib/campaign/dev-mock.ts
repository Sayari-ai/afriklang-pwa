/**
 * A pretend backend for trying the speaker app without Supabase, the dashboard or Sayari.
 * Development only: active when NEXT_PUBLIC_CAMPAIGN_MOCK=1 and NODE_ENV is not production.
 *
 *   NEXT_PUBLIC_CAMPAIGN_MOCK=1 NEXT_PUBLIC_SUPABASE_URL=https://mock.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=mock npm run dev
 *
 * It signs in a fake speaker, answers the campaign bridge from state kept in localStorage
 * (reset with `window.__afkMock.reset()`), and accepts audio uploads. Two campaigns: a planned one
 * (every mission assigned up front) and a pool one (the speaker draws leased batches).
 *
 * In the browser console:
 *   __afkMock.review()                 the reviewer: rejects the first submitted take, accepts the others
 *   __afkMock.poolStatus("cell_full")  the next draws are refused with that status ("ok" lifts it);
 *                                      a second argument `true` lists the planned campaign in `elsewhere`
 *   __afkMock.leaseSoon()              the pool batch's leases end in 5 hours
 *   __afkMock.expire()                 the pool batch's leases have ended
 *   __afkMock.tickets("old_dashboard")  upload tickets: "ok" (default), "old_dashboard" (404 without a
 *                                      code, as a dashboard without the route), or a refusal code
 *                                      such as "campaign_closed" or "campaign_paused"
 *   __afkMock.qualify("eligible")      decides the qualification test once it is in review
 *                                      ("eligible", "retry": a new attempt, "not_eligible")
 *
 * The answers mirror afriklang-landing-page/docs/CAMPAIGN_BRIDGE_CONTRACT.md: keep them in step.
 */

import type { CampaignCard, Mission, NextStep, PoolStatus, QualificationView } from "./types";

const KEY = "afriklang.mock.v2";
const USER = { id: "00000000-0000-4000-8000-00000000a11c", email: "awa.diop@example.com" };
const PLANNED_ID = "00000000-0000-4000-8000-0000000000c1";
const POOL_ID = "00000000-0000-4000-8000-0000000000c2";
const QUAL_ID = "00000000-0000-4000-8000-0000000000c3";
/** Pool settings: a batch of 6, draw again under 3, 72 h leases. */
const BATCH = 6;
const REFILL_BELOW = 3;
const LEASE_MS = 72 * 3_600_000;
const READ_MAX_S = 15;
/** The card's recording rules, as the dashboard sends them (its defaults: mic distance [from, to] cm per kind, not {min, max}). */
const RECORDING = { min_level_dbfs: -35, silence_margin_s: 1, background: "Quiet room, no music", mic_distance_cm: { read: [20, 30], conversational: [30, 50] } } satisfies CampaignCard["instructions"]["recording"];

type PoolMission = Mission & { cancelled?: boolean };
type State = {
  profile: boolean;
  account: boolean;
  speakerId: string | null;
  variety: string | null;
  planned: { consent: boolean; missions: Mission[] };
  pool: { consent: boolean; missions: PoolMission[]; nextPrompt: number; forced: Exclude<PoolStatus, "ok"> | null; elsewhere: boolean };
  /** Seconds of each submitted take (for the paid time), by mission id. */
  seconds: Record<string, number>;
  /** How `upload_ticket` answers: "ok", "old_dashboard", or a refusal code. */
  tickets?: string;
  /** The qualification test (absent from states saved before it existed). */
  qual?: { consent: boolean; attempt: number; stage: QualificationView["stage"]; decision: QualificationView["decision"]; missions: Mission[] };
};

/** A qualification draw: one sentence per category and 5 topics, shown in the speaker's working language. */
const QUAL_SCRIPTS: [Mission["type"], string, string][] = [
  ["read", "everyday", "I am going to the market this morning."],
  ["read", "numbers", "I paid 2,500 francs for two loaves of bread."],
  ["read", "names", "Aminata took the bus from Thiès to Saint-Louis."],
  ["read", "mixed", "My phone needs a new SIM card from Orange."],
  ["read", "questions", "Where is the nearest pharmacy?"],
  ["spontaneous", "topic", "Describe what you usually eat for breakfast."],
  ["spontaneous", "topic", "Tell us about the town or village where you grew up."],
  ["spontaneous", "topic", "What do you do on a day off?"],
  ["spontaneous", "topic", "How do you get to work or school?"],
  ["spontaneous", "topic", "Talk about a celebration you enjoy."],
];

function qualMissions(attempt: number): Mission[] {
  return QUAL_SCRIPTS.map(([type, category, text], i) => ({
    mission_id: uuid(attempt * 100 + i + 1, "e"),
    code: `WOL_GEN_QUALIF_01_M${String((attempt - 1) * 10 + i + 1).padStart(4, "0")}`,
    type,
    position: i + 1,
    status: "todo",
    rejection_reason: null,
    prompt: { id: `WOL_GEN_QUALIF_01_PQ${attempt}${i}`, text_or_topic: attempt > 1 ? `${text} (2)` : text, category },
    duration_s: type === "read" ? { min: 3, max: 15 } : { min: 15, max: 30 },
    partner_speaker_id: null,
    partner_ready: false,
    recording: null,
    lease_until: null,
  }));
}
const initialQual = (): NonNullable<State["qual"]> => ({ consent: false, attempt: 1, stage: "recording", decision: null, missions: qualMissions(1) });

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

/** The pool campaign's prompts (read only: conversations stay planned). */
const POOL_PROMPTS = [
  "Suba si laa dem marse bi.",
  "Sama yaay dafa togg ceebu jën.",
  "Ndax yaa ngi ci jàmm?",
  "Dama bëgg jënd benn mbuus muuru.",
  "Taksi bi dafa ñëw ci kanam kër gi.",
  "Ñu ngi koy wax ci làkk wu bees.",
  "Sama xarit dafa dëkk Kaolack.",
  "Bës bi dafa tàng lool.",
  "Xale yi ñu ngi fo ci buntu kër gi.",
  "Dinaa la yónnee benn bataaxal.",
  "Ëllëg dinaa liggéey ba ngoon.",
  "Sama mbokk dafa am benn bitig.",
  "Ndox mi dafa sedd.",
  "Lekkool bi dafa sori.",
  "Damay jàng Wolof ak Faraanse.",
  "Kër gi dafa rafet lool.",
  "Ñaari xale yi ñoo ngi nelaw.",
  "Damay dem Tuubaa ci Màggal gi.",
  "Sama telefon bi dafa sedd.",
  "Mbir mi dafa am solo.",
  "Jigéen ji dafa jaay mburu.",
  "Góor gi dafa wax ak sama baay.",
  "Dama xiif, dama mar.",
  "Benn waxtu ak genn-wàll la.",
];

const uuid = (n: number, prefix: string) => `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;

function initial(): State {
  return {
    profile: false,
    account: false,
    speakerId: null,
    variety: null,
    planned: {
      consent: false,
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
        lease_until: null,
      })),
    },
    pool: { consent: false, missions: [], nextPrompt: 0, forced: null, elsewhere: false },
    seconds: {},
  };
}

const load = (): State => {
  let s: State;
  try {
    s = (JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null) ?? initial();
  } catch {
    s = initial();
  }
  s.qual ??= initialQual();
  return s;
};
const save = (s: State) => localStorage.setItem(KEY, JSON.stringify(s));

function step(s: State, consent: boolean): NextStep {
  if (!s.profile) return "profile";
  if (!s.account) return "account_consent";
  if (!consent) return "campaign_consent";
  return "ready";
}

const isOpen = (m: Mission) => m.status === "todo" || m.status === "rejected";
const lapsed = (m: PoolMission, now: number) => isOpen(m) && m.lease_until != null && Date.parse(m.lease_until) <= now;

/** The dashboard expires stale leases inside every pool call: open missions past their lease are cancelled. */
function expire(s: State, now = Date.now()) {
  for (const m of s.pool.missions) if (!m.cancelled && lapsed(m, now)) m.cancelled = true;
}
/** What `missions` lists for the pool campaign: no cancelled missions. */
const poolListed = (s: State) => s.pool.missions.filter((m) => !m.cancelled).map(({ cancelled, ...m }) => (void cancelled, m));

function rewards(s: State, missions: Mission[]) {
  const payable = (m: Mission) => Math.min(s.seconds[m.mission_id] ?? 0, m.duration_s.max ?? Infinity);
  const sum = (st: Mission["status"]) => Math.round(missions.filter((m) => m.status === st).reduce((a, m) => a + payable(m), 0));
  return { accepted: missions.filter((m) => m.status === "accepted").length, accepted_s: sum("accepted"), pending_s: sum("submitted") };
}

function progress(missions: Mission[]) {
  const count = (st: Mission["status"]) => missions.filter((m) => m.status === st).length;
  return { total: missions.length, todo: count("todo"), submitted: count("submitted"), accepted: count("accepted"), rejected: count("rejected") };
}

const CONSENTS = (s: State, campaign: boolean) => ({
  account: { required_version: "v2", signed: s.account, signed_version: s.account ? "v2" : null, text_url: "https://example.com/consent/account", text_urls: { en: "https://example.com/consent/account", fr: "https://example.com/consent/account-fr" } },
  campaign: { required_version: "v1", signed: campaign, signed_version: campaign ? "v1" : null, text_url: "https://example.com/consent/campaign", text_urls: { en: "https://example.com/consent/campaign", fr: "https://example.com/consent/campaign-fr" } },
});

/** The dashboard's list of Wolof varieties; a variety the speaker typed is added on save, like the dashboard does. */
const BASE_VARIETIES = ["Baol-Baol", "Dakar urban", "Lebou", "Saloum-Saloum"];
function knownVarieties(s: State): string[] {
  const known = s.variety && !BASE_VARIETIES.some((v) => v.toLowerCase() === s.variety!.toLowerCase()) ? [...BASE_VARIETIES, s.variety] : BASE_VARIETIES;
  return [...known].sort((a, b) => a.localeCompare(b));
}

function plannedCard(s: State): CampaignCard {
  return {
    assignment_id: "00000000-0000-4000-8000-0000000000a1",
    campaign_id: PLANNED_ID,
    code: "WOL_FIN_PILOT_01",
    title: "Wolof mobile money pilot",
    status: "launched",
    language: { code: "wol", name: "Wolof", varieties: ["Baol-Baol", "Saloum-Saloum", "Dakar urban"], known_varieties: knownVarieties(s) },
    topic: { domain: "Banking and Fintech", sub_domain: "Mobile money" },
    deadline: new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10),
    dispatch: "planned",
    refill_below: null,
    progress: progress(s.planned.missions),
    rewards: rewards(s, s.planned.missions),
    next_step: step(s, s.planned.consent),
    blocked_reason: null,
    consents: CONSENTS(s, s.planned.consent),
    instructions: {
      recording: RECORDING,
      speech_types: [
        { type: "read", duration_min_s: 3, duration_max_s: 15, missions_per_session: { min: 5, max: 20 } },
        { type: "spontaneous", duration_min_s: 8, duration_max_s: 30, missions_per_session: null },
        { type: "conversational", duration_min_s: 8, duration_max_s: 30, missions_per_session: null },
      ],
    },
    partner: { speaker_id: "SPK-4H8K2P9W", ready: true },
  };
}

function poolCard(s: State): CampaignCard {
  const listed = poolListed(s);
  return {
    assignment_id: "00000000-0000-4000-8000-0000000000a2",
    campaign_id: POOL_ID,
    code: "WOL_GEN_1000H",
    title: "Wolof everyday speech (1,000 hours)",
    status: "launched",
    language: { code: "wol", name: "Wolof", varieties: ["Baol-Baol", "Saloum-Saloum", "Dakar urban"], known_varieties: knownVarieties(s) },
    topic: { domain: "General", sub_domain: "Everyday life" },
    deadline: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    dispatch: "pool",
    refill_below: REFILL_BELOW,
    progress: progress(listed),
    rewards: rewards(s, listed),
    next_step: step(s, s.pool.consent),
    blocked_reason: null,
    consents: CONSENTS(s, s.pool.consent),
    instructions: {
      recording: RECORDING,
      speech_types: [{ type: "read", duration_min_s: 3, duration_max_s: READ_MAX_S, missions_per_session: { min: 3, max: BATCH } }],
    },
    partner: null,
  };
}

function qualCard(s: State): CampaignCard {
  const q = s.qual!;
  const accepted = q.missions.filter((m) => m.status === "accepted").length;
  return {
    assignment_id: "00000000-0000-4000-8000-0000000000a3",
    campaign_id: QUAL_ID,
    code: "WOL_GEN_QUALIF_01",
    title: "Wolof qualification test",
    status: "launched",
    language: { code: "wol", name: "Wolof", varieties: knownVarieties(s), known_varieties: knownVarieties(s) },
    topic: { domain: "General conversation", sub_domain: null },
    deadline: null,
    dispatch: "planned",
    refill_below: null,
    progress: progress(q.missions),
    rewards: { accepted: 0, accepted_s: 0, pending_s: 0 },
    next_step: step(s, q.consent),
    blocked_reason: null,
    consents: CONSENTS(s, q.consent),
    instructions: {
      recording: RECORDING,
      speech_types: [
        { type: "read", duration_min_s: 3, duration_max_s: 15, missions_per_session: { min: 20, max: 50 } },
        { type: "spontaneous", duration_min_s: 15, duration_max_s: 30, missions_per_session: { min: 10, max: 20 } },
      ],
    },
    partner: null,
    kind: "qualification",
    qualification: { attempt_no: q.attempt, stage: q.stage, decision: q.decision, accepted: q.stage === "decided" ? accepted : null, total: 10, retry_after: q.decision === "not_eligible" ? new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) : null },
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
const notAssigned = () => json({ error: "You are not assigned to this campaign.", code: "not_assigned" }, 404);

/** The onboarding gate of `missions`, `draw` and `return`: 403 with the step to show. */
function gate(s: State, consent: boolean): Response | null {
  const next = step(s, consent);
  if (next === "ready") return null;
  const code = next === "profile" ? "profile_incomplete" : next;
  return json({ error: "Not available yet.", code, next_step: next }, 403);
}

function draw(s: State) {
  expire(s);
  const now = Date.now();
  const open = () => s.pool.missions.filter((m) => !m.cancelled && isOpen(m));
  const leaseUntil = () => {
    const ends = open().map((m) => Date.parse(m.lease_until ?? "")).filter(Number.isFinite);
    return ends.length ? new Date(Math.min(...ends)).toISOString() : null;
  };
  const view = (status: PoolStatus) => ({
    status,
    open: open().length,
    refill_below: REFILL_BELOW,
    lease_until: leaseUntil(),
    elsewhere: (status === "cell_full" || status === "campaign_full") && s.pool.elsewhere ? [{ campaign_id: PLANNED_ID, title: "Wolof mobile money pilot", code: "WOL_FIN_PILOT_01" }] : [],
  });
  if (s.pool.forced) return { missions: [], pool: view(s.pool.forced) };
  const fresh: Mission[] = [];
  const want = BATCH - open().length;
  for (let i = 0; i < want && s.pool.nextPrompt < POOL_PROMPTS.length; i++) {
    const n = s.pool.nextPrompt++;
    const position = s.pool.missions.length + 1;
    const m: Mission = {
      mission_id: uuid(position, "d"),
      code: `WOL_GEN_1000H_M${String(position).padStart(4, "0")}`,
      type: "read",
      position,
      status: "todo",
      rejection_reason: null,
      prompt: { id: `WOL_GEN_1000H_P${String(n + 1).padStart(3, "0")}`, text_or_topic: POOL_PROMPTS[n], category: n % 2 ? "home" : "town" },
      duration_s: { min: 3, max: READ_MAX_S },
      partner_speaker_id: null,
      partner_ready: false,
      recording: null,
      lease_until: new Date(now + LEASE_MS).toISOString(),
    };
    s.pool.missions.push(m);
    fresh.push(m);
  }
  // Every prompt drawn: the campaign has reached its target.
  return { missions: fresh, pool: view(!fresh.length && !open().length && s.pool.nextPrompt >= POOL_PROMPTS.length ? "campaign_full" : "ok") };
}

const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * A ticket in the contract's exact format: base64url(payload_json) "." base64url(HMAC-SHA256(key,
 * base64url(payload_json))), no padding (docs/contracts/README.md §1). The mock signs with a
 * made-up key; the real app never signs or checks a ticket. Exported for the contract test.
 */
export async function signMockTicket(payloadJson: string, key = "mock-ticket-secret"): Promise<string> {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(payloadJson));
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(head)));
  return `${head}.${b64url(mac)}`;
}

/** Refusal statuses the dashboard uses for upload_ticket (the same codes as submit). */
const TICKET_REFUSALS: Record<string, number> = {
  campaign_closed: 410,
  campaign_not_open: 403,
  not_assigned: 404,
  not_linked: 403,
  blocked: 403,
  campaign_paused: 403,
  campaign_consent: 403,
  account_consent: 403,
  partner_consent: 403,
  profile_incomplete: 403,
};

/** The `upload_ticket` answer: { ticket, expires_at }, the ticket's payload as upload-ticket.schema.json. */
async function uploadTicket(s: State, body: Record<string, unknown>): Promise<Response> {
  const mode = s.tickets ?? "ok";
  if (mode === "old_dashboard") return json({ error: "route_not_found", message: "The campaign service does not offer this call yet." }, 404);
  if (mode !== "ok") return json({ error: "Refused (mock).", code: mode }, TICKET_REFUSALS[mode] ?? 403);
  const planned = s.planned.missions.find((x) => x.mission_id === body.mission_id);
  const pooled = s.pool.missions.find((x) => x.mission_id === body.mission_id);
  const qual = s.qual!.missions.find((x) => x.mission_id === body.mission_id);
  const m = planned ?? pooled ?? qual;
  if (!m) return notAssigned();
  const refused = gate(s, planned ? s.planned.consent : pooled ? s.pool.consent : s.qual!.consent);
  if (refused) return refused;
  if (qual && s.qual!.stage !== "recording") return json({ error: "This test is closed: your recordings are being reviewed.", code: "test_closed" }, 403);
  const card = planned ? plannedCard(s) : pooled ? poolCard(s) : qualCard(s);
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = {
    v: 1,
    jti: crypto.randomUUID(),
    exp,
    campaign_id: card.campaign_id,
    campaign_code: card.code,
    mission_id: m.mission_id,
    mission_code: m.code,
    mission_type: m.type,
    prompt_id: m.prompt.id,
    language: card.language.code,
    variety: s.variety || null,
    domain: planned ? "FIN" : "GEN",
    speaker_ids: m.type === "conversational" && m.partner_speaker_id ? [s.speakerId ?? "SPK-7Q2M9X4D", m.partner_speaker_id] : [s.speakerId ?? "SPK-7Q2M9X4D"],
    source_sha256: String(body.source_sha256),
    duration_max_s: m.duration_s.max ?? 3600,
    ...(qual ? { purpose: "qualification" } : {}),
  };
  return json({ ticket: await signMockTicket(JSON.stringify(payload)), expires_at: new Date(exp * 1000).toISOString() });
}

async function bridge(body: Record<string, unknown>): Promise<Response> {
  await delay(250);
  const s = load();
  const cards = () => [plannedCard(s), poolCard(s), qualCard(s)];
  const campaignId = body.campaign_id;
  switch (body.action) {
    case "claim":
      return json({ contributor: contributor(s), campaign: plannedCard(s) });
    case "campaigns":
      expire(s);
      save(s);
      return json({ contributor: contributor(s), campaigns: cards() });
    case "profile":
      s.profile = true;
      s.variety = String(body.variety ?? "");
      s.speakerId ??= "SPK-7Q2M9X4D";
      save(s);
      return json({ contributor: contributor(s), blocked: [] });
    case "consent":
      if (body.type === "account") s.account = true;
      else if (campaignId === POOL_ID) s.pool.consent = true;
      else if (campaignId === QUAL_ID) s.qual!.consent = true;
      else s.planned.consent = true;
      save(s);
      return json({ signed_version: String(body.version), already: false });
    case "missions": {
      if (campaignId === QUAL_ID) {
        const refused = gate(s, s.qual!.consent);
        if (refused) return refused;
        return json({ campaign: qualCard(s), missions: s.qual!.missions, rewards: { accepted: 0, accepted_s: 0, pending_s: 0 } });
      }
      if (campaignId === POOL_ID) {
        const refused = gate(s, s.pool.consent);
        if (refused) return refused;
        expire(s);
        save(s);
        const listed = poolListed(s);
        return json({ campaign: poolCard(s), missions: listed, rewards: rewards(s, listed) });
      }
      const refused = gate(s, s.planned.consent);
      if (refused) return refused;
      return json({ campaign: plannedCard(s), missions: s.planned.missions, rewards: rewards(s, s.planned.missions) });
    }
    case "draw": {
      if (campaignId !== POOL_ID) return notAssigned();
      const refused = gate(s, s.pool.consent);
      if (refused) return refused;
      const out = draw(s);
      save(s);
      return json(out);
    }
    case "return": {
      if (campaignId !== POOL_ID) return notAssigned();
      const refused = gate(s, s.pool.consent);
      if (refused) return refused;
      const ids = new Set(Array.isArray(body.mission_ids) ? (body.mission_ids as string[]) : []);
      let returned = 0;
      for (const m of s.pool.missions) {
        if (ids.has(m.mission_id) && !m.cancelled && isOpen(m)) {
          m.cancelled = true;
          returned++;
        }
      }
      save(s);
      return json({ returned, pool: { open: s.pool.missions.filter((m) => !m.cancelled && isOpen(m)).length, refill_below: REFILL_BELOW } });
    }
    case "submit": {
      const q = s.qual!;
      const qm = q.missions.find((x) => x.mission_id === body.mission_id);
      if (qm && q.stage !== "recording") return json({ error: "This test is closed: your recordings are being reviewed.", code: "test_closed" }, 403);
      const m: PoolMission | undefined = s.planned.missions.find((x) => x.mission_id === body.mission_id) ?? s.pool.missions.find((x) => x.mission_id === body.mission_id) ?? qm;
      if (!m) return notAssigned();
      if (m.status === "submitted" || m.status === "accepted") return json({ recording_id: "r-" + m.code, mission_status: m.status, duplicate: true });
      // A late take (lease ended, mission cancelled) is always kept: the mission comes back as submitted.
      m.cancelled = false;
      m.status = "submitted";
      m.rejection_reason = null;
      m.recording = { status: "uploaded", rejection_reason: null };
      const rec = body.recording as { duration_s?: unknown } | undefined;
      s.seconds[m.mission_id] = typeof rec?.duration_s === "number" ? rec.duration_s : 0;
      // The dashboard moves a test to review once all its takes passed the automatic checks.
      if (qm && q.missions.every((x) => x.status === "submitted")) q.stage = "in_review";
      save(s);
      return json({ recording_id: "r-" + m.code, mission_status: "submitted", duplicate: false });
    }
    case "upload_ticket":
      return uploadTicket(s, body);
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
      // Keep the last upload's text fields so they can be inspected (window.__afkLastUpload).
      if (init?.body instanceof FormData) {
        const fields: Record<string, string> = {};
        init.body.forEach((v, k) => (fields[k] = typeof v === "string" ? v : `<file ${(v as File).name}, ${(v as File).size} bytes>`));
        (window as unknown as { __afkLastUpload?: unknown }).__afkLastUpload = { ...fields, "X-Campaign-Ticket": new Headers(init.headers).get("x-campaign-ticket") ?? "(none)" };
      }
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
  // Uploads go through XMLHttpRequest (upload progress): answer them here too, with fake progress.
  const RealXhr = window.XMLHttpRequest;
  class MockUploadXhr {
    private real: XMLHttpRequest | null = null;
    private url = "";
    private aborted = false;
    private ticket: string | null = null;
    upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    status = 0;
    statusText = "";
    responseText = "";
    open(method: string, url: string) {
      this.url = url;
      if (!url.endsWith("/api/audio-upload")) {
        this.real = new RealXhr();
        this.real.open(method, url);
      }
    }
    setRequestHeader(k: string, v: string) {
      if (k.toLowerCase() === "x-campaign-ticket") this.ticket = v;
      this.real?.setRequestHeader(k, v);
    }
    getResponseHeader(h: string) {
      return this.real ? this.real.getResponseHeader(h) : null;
    }
    abort() {
      this.aborted = true;
      this.real?.abort();
      this.onabort?.();
    }
    send(body?: Document | XMLHttpRequestBodyInit | null) {
      if (this.real) {
        const r = this.real;
        r.onload = () => {
          this.status = r.status;
          this.statusText = r.statusText;
          this.responseText = r.responseText;
          this.onload?.();
        };
        r.onerror = () => this.onerror?.();
        return r.send(body);
      }
      if (body instanceof FormData) {
        const fields: Record<string, string> = {};
        body.forEach((v, k) => (fields[k] = typeof v === "string" ? v : `<file ${(v as File).name}, ${(v as File).size} bytes>`));
        // The ticket header as the proxy would forward it (none: the old path without tickets).
        (window as unknown as { __afkLastUpload?: unknown }).__afkLastUpload = { ...fields, "X-Campaign-Ticket": this.ticket ?? "(none)" };
      }
      const total = 100_000;
      void (async () => {
        for (let i = 1; i <= 9; i++) {
          await delay(100);
          if (this.aborted) return;
          if (navigator.onLine === false) return this.onerror?.();
          this.upload.onprogress?.({ loaded: (total * i) / 10, total, lengthComputable: true });
        }
        this.upload.onprogress?.({ loaded: total, total, lengthComputable: true });
        this.upload.onload?.();
        this.status = 200;
        this.statusText = "OK";
        this.responseText = JSON.stringify({ audio_id: "say-" + Math.random().toString(36).slice(2, 10) });
        this.onload?.();
      })();
    }
  }
  (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = MockUploadXhr;

  w.__afkMock = {
    reset: () => localStorage.removeItem(KEY),
    signIn: () => localStorage.removeItem("afriklang.mock.signedOut"),
    /** The team reviewed: the first submitted take is rejected, the others accepted. */
    review: () => {
      const s = load();
      let first = true;
      for (const m of [...s.planned.missions, ...s.pool.missions]) {
        if (m.status !== "submitted") continue;
        if (first) {
          m.status = "rejected";
          m.rejection_reason = "Background noise (a radio) under the voice.";
          // A rejected pool mission comes back to the same speaker with a new lease.
          if (m.lease_until) m.lease_until = new Date(Date.now() + LEASE_MS).toISOString();
          first = false;
        } else m.status = "accepted";
      }
      save(s);
    },
    /** The next pool draws are refused with this status ("ok" lifts it). */
    poolStatus: (status: PoolStatus, elsewhere = false) => {
      const s = load();
      s.pool.forced = status === "ok" ? null : status;
      s.pool.elsewhere = elsewhere;
      save(s);
    },
    /** The pool batch's leases end in 5 hours. */
    leaseSoon: () => {
      const s = load();
      for (const m of s.pool.missions) if (!m.cancelled && isOpen(m)) m.lease_until = new Date(Date.now() + 5 * 3_600_000).toISOString();
      save(s);
    },
    /** How upload tickets are answered: "ok", "old_dashboard", or a refusal code ("campaign_closed", "campaign_paused"...). */
    tickets: (mode = "ok") => {
      const s = load();
      s.tickets = mode;
      save(s);
    },
    /** The qualification test's review: 8 accepted (eligible), 6 (retry: a new attempt), or 3 (not eligible). */
    qualify: (decision: "eligible" | "retry" | "not_eligible" = "eligible") => {
      const s = load();
      const q = s.qual!;
      const accept = decision === "eligible" ? 8 : decision === "retry" ? 6 : 3;
      q.missions.forEach((m, i) => {
        m.status = i < accept ? "accepted" : "rejected";
        m.rejection_reason = i < accept ? null : "variety";
        m.recording = { status: m.status, rejection_reason: m.rejection_reason };
      });
      if (decision === "retry") s.qual = { ...q, attempt: q.attempt + 1, stage: "recording", decision: null, missions: qualMissions(q.attempt + 1) };
      else Object.assign(q, { stage: "decided", decision });
      save(s);
    },
    /** The pool batch's leases have ended. */
    expire: () => {
      const s = load();
      for (const m of s.pool.missions) if (!m.cancelled && isOpen(m)) m.lease_until = new Date(Date.now() - 60_000).toISOString();
      save(s);
    },
  };
}
