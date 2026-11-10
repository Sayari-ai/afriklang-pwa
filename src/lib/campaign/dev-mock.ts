/**
 * A pretend backend for trying the speaker app without Supabase, the dashboard or Sayari.
 * Development only: active when NEXT_PUBLIC_CAMPAIGN_MOCK=1 and NODE_ENV is not production.
 *
 *   NEXT_PUBLIC_CAMPAIGN_MOCK=1 NEXT_PUBLIC_SUPABASE_URL=https://mock.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=mock npm run dev
 *
 * It signs in a fake speaker, answers the campaign bridge from state kept in localStorage
 * (reset with `window.__afkMock.reset()`), and accepts audio uploads. Two campaigns: a planned one
 * (every mission assigned up front) and a pool one (the speaker draws leased batches); and three
 * qualification tests, Wolof (the speaker's first language), Pulaar and Bambara, each with its
 * own variety, as one application in several languages produces (A7).
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
 *   __afkMock.qualify("eligible")      decides the Wolof qualification test once it is in review
 *                                      ("eligible", "retry": a new attempt, "not_eligible"); a second
 *                                      argument names another test ("fuc", "bam")
 *   __afkMock.qcReject(missionId, "low_snr")  the automatic checks refused that mission's take: it comes
 *                                      back to record again with what was measured (any REJECT_CHECKS value)
 *   __afkMock.claim("email_mismatch")  the next invitation claims are refused with that code, as the dashboard
 *                                      would ("email_unverified", "account_conflict", "invalid_link",
 *                                      "link_expired", "campaign_closed", "misconfigured"; "ok" lifts it)
 *   __afkMock.uploadDuplicate(true)    Sayari answers the next uploads with duplicate: true (its real answer
 *                                      shape, {message, results:[{id, audio_sha256, duplicate, filename}]})
 *   __afkMock.sweep()                  the dashboard's 15-minute sweep now: a test whose 10 takes are all in
 *                                      moves to review (otherwise it does by itself 20 s after the last one)
 *   __afkMock.oldApplicant()           an applicant from before the form asked the first language: no
 *                                      first language, no profile, and only the Wolof and Pulaar tests, so
 *                                      the profile step asks which is the first language (`false` undoes it)
 *
 * The answers mirror afriklang-landing-page/docs/CAMPAIGN_BRIDGE_CONTRACT.md: keep them in step.
 */

import { REJECT_CHECKS, type CampaignCard, type ContributorView, type Mission, type NextStep, type PoolStatus, type QualificationView, type RejectCheck, type RejectDetail, type RejectionReason } from "./types";

/** Sayari's default QC limits, as the dashboard puts them on every card (decision B). */
const QC_LIMITS = { min_snr_db: 10, max_background_noise_db: -20, max_clipping_ratio: 0.01, max_silence_ratio: 0.5 };
const KEY = "afriklang.mock.v3";
const USER = { id: "00000000-0000-4000-8000-00000000a11c", email: "awa.diop@example.com" };
const PLANNED_ID = "00000000-0000-4000-8000-0000000000c1";
const POOL_ID = "00000000-0000-4000-8000-0000000000c2";
const QUAL_ID = "00000000-0000-4000-8000-0000000000c3";
export const QUAL_FUC_ID = "00000000-0000-4000-8000-0000000000c4";
export const QUAL_BAM_ID = "00000000-0000-4000-8000-0000000000c5";

/** The three qualification tests: one per language the applicant chose, each with the variety given for it (A5). */
type QualLang = "wol" | "fuc" | "bam";
const QUAL_LANGS: Record<QualLang, { id: string; assignment: string; name: string; code: string; variety: string; varieties: string[]; idPrefix: string }> = {
  wol: { id: QUAL_ID, assignment: "00000000-0000-4000-8000-0000000000a3", name: "Wolof", code: "WOL_GEN_QUALIF_01", variety: "Dakar urban", varieties: [], idPrefix: "e" },
  fuc: { id: QUAL_FUC_ID, assignment: "00000000-0000-4000-8000-0000000000a4", name: "Pulaar", code: "FUC_GEN_QUALIF_01", variety: "Fuuta Tooro", varieties: ["Fuuta Tooro", "Fuuta Jalon"], idPrefix: "f" },
  bam: { id: QUAL_BAM_ID, assignment: "00000000-0000-4000-8000-0000000000a5", name: "Bambara", code: "BAM_GEN_QUALIF_01", variety: "Bamako", varieties: ["Bamako", "Ségou"], idPrefix: "b" },
};
const QUAL_LANG_CODES = Object.keys(QUAL_LANGS) as QualLang[];
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
  /** The native language the profile was saved with (the app never overwrites it from a test card, A5). */
  nativeLanguage?: string | null;
  /** The gender the profile was saved with. */
  gender?: string | null;
  planned: { consent: boolean; missions: Mission[] };
  pool: { consent: boolean; missions: PoolMission[]; nextPrompt: number; forced: Exclude<PoolStatus, "ok"> | null; elsewhere: boolean };
  /** Seconds of each submitted take (for the paid time), by mission id. */
  seconds: Record<string, number>;
  /** How `upload_ticket` answers: "ok", "old_dashboard", or a refusal code. */
  tickets?: string;
  /** The qualification tests, one per language (absent from states saved before they existed). */
  quals?: Record<QualLang, QualState>;
  /**
   * An old applicant: the dashboard knows no first language and the list holds only the Wolof and
   * Pulaar tests (no campaigns yet), so the profile form asks which one is first.
   */
  oldApplicant?: boolean;
  /** How `claim` answers: "ok" (default) or a refusal code (X-08). */
  claim?: string;
  /** Sayari answers uploads with duplicate: true (X-08). */
  uploadDuplicate?: boolean;
};
/** `allInAt`: when the test's last take was submitted; the sweep moves it to review after SWEEP_MS (X-08). */
type QualState = { consent: boolean; attempt: number; stage: QualificationView["stage"]; decision: QualificationView["decision"]; missions: Mission[]; allInAt?: number | null };

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

function qualMissions(lang: QualLang, attempt: number): Mission[] {
  const { code, idPrefix } = QUAL_LANGS[lang];
  return QUAL_SCRIPTS.map(([type, category, text], i) => ({
    mission_id: uuid(attempt * 100 + i + 1, idPrefix),
    code: `${code}_M${String((attempt - 1) * 10 + i + 1).padStart(4, "0")}`,
    type,
    position: i + 1,
    status: "todo",
    rejection_reason: null,
    rejection_detail: null,
    prompt: { id: `${code}_PQ${attempt}${i}`, text_or_topic: attempt > 1 ? `${text} (2)` : text, category },
    duration_s: type === "read" ? { min: 3, max: 15 } : { min: 15, max: 30 },
    partner_speaker_id: null,
    partner_ready: false,
    recording: null,
    lease_until: null,
  }));
}
const initialQual = (lang: QualLang): QualState => ({ consent: false, attempt: 1, stage: "recording", decision: null, missions: qualMissions(lang, 1) });
const initialQuals = (): Record<QualLang, QualState> => ({ wol: initialQual("wol"), fuc: initialQual("fuc"), bam: initialQual("bam") });
/** The test a campaign id names, or null. */
const qualOf = (s: State, campaignId: unknown): { lang: QualLang; q: QualState } | null => {
  const lang = QUAL_LANG_CODES.find((l) => QUAL_LANGS[l].id === campaignId);
  return lang ? { lang, q: s.quals![lang] } : null;
};
/** The test holding a mission, or null. */
const qualWithMission = (s: State, missionId: unknown): { lang: QualLang; q: QualState; m: Mission } | null => {
  for (const lang of QUAL_LANG_CODES) {
    const m = s.quals![lang].missions.find((x) => x.mission_id === missionId);
    if (m) return { lang, q: s.quals![lang], m };
  }
  return null;
};

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
  s.quals ??= initialQuals();
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
    qc_limits: QC_LIMITS,
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
    qc_limits: QC_LIMITS,
    instructions: {
      recording: RECORDING,
      speech_types: [{ type: "read", duration_min_s: 3, duration_max_s: READ_MAX_S, missions_per_session: { min: 3, max: BATCH } }],
    },
    partner: null,
  };
}

function qualCard(s: State, lang: QualLang): CampaignCard {
  const q = s.quals![lang];
  const L = QUAL_LANGS[lang];
  const accepted = q.missions.filter((m) => m.status === "accepted").length;
  // The Wolof lists grow with what the speaker types (the profile's language); the others are fixed.
  const varieties = lang === "wol" ? knownVarieties(s) : L.varieties;
  return {
    assignment_id: L.assignment,
    campaign_id: L.id,
    code: L.code,
    title: `${L.name} qualification test`,
    status: "launched",
    language: { code: lang, name: L.name, varieties, known_varieties: varieties },
    topic: { domain: "General conversation", sub_domain: null },
    deadline: null,
    dispatch: "planned",
    refill_below: null,
    progress: progress(q.missions),
    rewards: { accepted: 0, accepted_s: 0, pending_s: 0 },
    next_step: step(s, q.consent),
    blocked_reason: null,
    consents: CONSENTS(s, q.consent),
    qc_limits: QC_LIMITS,
    instructions: {
      recording: RECORDING,
      speech_types: [
        { type: "read", duration_min_s: 3, duration_max_s: 15, missions_per_session: { min: 20, max: 50 } },
        { type: "spontaneous", duration_min_s: 15, duration_max_s: 30, missions_per_session: { min: 10, max: 20 } },
      ],
    },
    partner: null,
    kind: "qualification",
    qualification: { attempt_no: q.attempt, stage: q.stage, decision: q.decision, accepted: q.stage === "decided" ? accepted : null, total: 10, retry_after: q.decision === "not_eligible" ? new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) : null, variety: L.variety },
  };
}

function contributor(s: State): ContributorView {
  return {
    contributor_id: "00000000-0000-4000-8000-0000000000b1",
    speaker_id: s.speakerId,
    locale: "en" as const,
    profile: { complete: s.profile, missing: s.profile ? [] : ["region"], values: s.profile ? { nativeLanguage: s.nativeLanguage ?? "wol", variety: s.variety, country: "SN", region: "Thiès", gender: s.gender ?? "female", ageBand: "30-44", device: "Android Chrome" } : null },
    // The language the applicant marked as first on the form: the profile's native language (A5).
    // None for an applicant from before the form asked.
    first_language: s.oldApplicant ? null : { code: "wol", name: "Wolof" },
    // The sex given on the application form: prefills the profile's (the speaker can change it).
    gender: "female",
  };
}

/** What the automatic checks say when they refuse a take for `check`: plausible numbers, the shape of 03 §7. */
function qcDetail(check: RejectCheck, m: Mission): { reason: RejectionReason; detail: RejectDetail } {
  const d = (reason: RejectionReason, detail: Omit<RejectDetail, "check">) => ({ reason, detail: { check, ...detail } });
  switch (check) {
    case "too_short":
      return d("duration", { measured: 2.1, limit: m.duration_s.min ?? 3, unit: "s", bound: "min" });
    case "too_long":
      return d("duration", { measured: (m.duration_s.max ?? 15) + 3.9, limit: m.duration_s.max ?? 15, unit: "s", bound: "max" });
    case "low_snr":
      return d("level", { measured: 7.3, limit: 10, unit: "dB", bound: "min" });
    case "background_noise":
      return d("level", { measured: -38.2, limit: -45, unit: "dBFS", bound: "max" });
    case "clipping":
      return d("level", { measured: 0.014, limit: 0.005, unit: "ratio", bound: "max" });
    case "long_silence":
      return d("silence", { measured: 0.42, limit: 0.3, unit: "ratio", bound: "max" });
    default:
      return d("other", { measured: null, limit: null, unit: null, bound: null });
  }
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

/** The dashboard's 422 for a length outside the prompt's limits (±0.5 s), with what it measured; null when it fits. */
function lengthRefused(m: Pick<Mission, "duration_s">, duration: number | null): Response | null {
  if (duration == null) return null;
  const { min, max } = m.duration_s;
  if (min != null && duration < min - 0.5) {
    const detail: RejectDetail = { check: "too_short", measured: duration, limit: min, unit: "s", bound: "min" };
    return json({ error: `Too short: ${duration} s, this prompt needs at least ${min} s.`, code: "recording_rejected", reason: "duration", detail }, 422);
  }
  if (max != null && duration > max + 0.5) {
    const detail: RejectDetail = { check: "too_long", measured: duration, limit: max, unit: "s", bound: "max" };
    return json({ error: `Too long: ${duration} s, this prompt takes at most ${max} s.`, code: "recording_rejected", reason: "duration", detail }, 422);
  }
  return null;
}

/** The dashboard's claim refusals (status, and the hint it gives for a wrong account). */
const CLAIM_REFUSALS: Record<string, { status: number; error: string }> = {
  email_mismatch: { status: 403, error: "Sign in with the Google account for a***@yahoo.fr, the address this invitation was sent to." },
  email_unverified: { status: 403, error: "Your Google email address is not verified." },
  account_conflict: { status: 409, error: "This invitation belongs to another account." },
  invalid_link: { status: 404, error: "This invitation link is not valid." },
  link_expired: { status: 410, error: "This invitation link has expired." },
  campaign_closed: { status: 410, error: "This campaign has ended." },
};

/** After this long with every take in, the dashboard's sweep moves a test to review (it runs every 15 minutes; shorter here). */
const SWEEP_MS = 20_000;
/** The sweep: a test whose takes are all in (and passed the checks) goes to review. `now` true: whatever the time. */
function sweep(s: State, now = false) {
  for (const q of Object.values(s.quals ?? {})) {
    if (q.stage === "recording" && q.allInAt && (now || Date.now() - q.allInAt >= SWEEP_MS) && q.missions.every((x) => x.status === "submitted")) {
      q.stage = "in_review";
      q.allInAt = null;
    }
  }
}

/** Sayari's upload answer (app/api/audio.py), with `duplicate` as the mock is set. */
function sayariUploadAnswer(s: State, fields: Record<string, string>) {
  return {
    message: "Uploaded 1 file(s)",
    results: [{ id: "say-" + Math.random().toString(36).slice(2, 10), audio_sha256: fields.source_sha256 ?? "", duplicate: Boolean(s.uploadDuplicate), filename: fields.__filename ?? "take.wav" }],
  };
}

/** The `upload_ticket` answer: { ticket, expires_at }, the ticket's payload as upload-ticket.schema.json. */
async function uploadTicket(s: State, body: Record<string, unknown>): Promise<Response> {
  const mode = s.tickets ?? "ok";
  if (mode === "old_dashboard") return json({ error: "route_not_found", message: "The campaign service does not offer this call yet." }, 404);
  if (mode !== "ok") return json({ error: "Refused (mock).", code: mode }, TICKET_REFUSALS[mode] ?? 403);
  const planned = s.planned.missions.find((x) => x.mission_id === body.mission_id);
  const pooled = s.pool.missions.find((x) => x.mission_id === body.mission_id);
  const qual = qualWithMission(s, body.mission_id);
  const m = planned ?? pooled ?? qual?.m;
  if (!m) return notAssigned();
  const refused = gate(s, planned ? s.planned.consent : pooled ? s.pool.consent : qual!.q.consent);
  if (refused) return refused;
  if (qual && qual.q.stage !== "recording") return json({ error: "This test is closed: your recordings are being reviewed.", code: "test_closed" }, 403);
  // As the dashboard: a length outside the prompt's limits (±0.5 s) is refused here, before any
  // byte is uploaded (bridge-service, X-08).
  const lengthRefusal = lengthRefused(m, typeof body.duration_s === "number" ? body.duration_s : null);
  if (lengthRefusal) return lengthRefusal;
  const card = planned ? plannedCard(s) : pooled ? poolCard(s) : qualCard(s, qual!.lang);
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
    // A test's audio carries the test's variety (the attempt's), a campaign's the profile's.
    variety: qual ? QUAL_LANGS[qual.lang].variety : s.variety || null,
    domain: planned ? "FIN" : "GEN",
    speaker_ids: m.type === "conversational" && m.partner_speaker_id ? [s.speakerId ?? "SPK-7Q2M9X4D", m.partner_speaker_id] : [s.speakerId ?? "SPK-7Q2M9X4D"],
    source_sha256: String(body.source_sha256),
    duration_max_s: m.duration_s.max ?? 3600,
    // The dashboard always sends it (bridge-service).
    duration_min_s: m.duration_s.min ?? 0,
    ...(qual ? { purpose: "qualification" } : {}),
  };
  return json({ ticket: await signMockTicket(JSON.stringify(payload)), expires_at: new Date(exp * 1000).toISOString() });
}

async function bridge(body: Record<string, unknown>): Promise<Response> {
  await delay(250);
  const s = load();
  const cards = () => (s.oldApplicant ? [qualCard(s, "wol"), qualCard(s, "fuc")] : [plannedCard(s), poolCard(s), ...QUAL_LANG_CODES.map((lang) => qualCard(s, lang))]);
  const campaignId = body.campaign_id;
  const qual = qualOf(s, campaignId);
  switch (body.action) {
    case "claim": {
      const mode = s.claim ?? "ok";
      if (mode === "misconfigured") return json({ error: "server_misconfigured" }, 500);
      const refusal = CLAIM_REFUSALS[mode];
      if (refusal) return json({ error: refusal.error, code: mode }, refusal.status);
      return json({ contributor: contributor(s), campaign: plannedCard(s) });
    }
    case "campaigns":
      expire(s);
      sweep(s);
      save(s);
      return json({ contributor: contributor(s), campaigns: cards() });
    case "profile":
      s.profile = true;
      s.variety = String(body.variety ?? "");
      s.nativeLanguage = typeof body.native_language === "string" && body.native_language ? body.native_language : "wol";
      s.gender = typeof body.gender === "string" && body.gender ? body.gender : "female";
      s.speakerId ??= "SPK-7Q2M9X4D";
      save(s);
      return json({ contributor: contributor(s), blocked: [] });
    case "consent":
      if (body.type === "account") s.account = true;
      else if (campaignId === POOL_ID) s.pool.consent = true;
      else if (qual) qual.q.consent = true;
      else s.planned.consent = true;
      save(s);
      return json({ signed_version: String(body.version), already: false });
    case "missions": {
      sweep(s);
      save(s);
      if (qual) {
        const refused = gate(s, qual.q.consent);
        if (refused) return refused;
        return json({ campaign: qualCard(s, qual.lang), missions: qual.q.missions, rewards: { accepted: 0, accepted_s: 0, pending_s: 0 } });
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
      const found = qualWithMission(s, body.mission_id);
      if (found && found.q.stage !== "recording") return json({ error: "This test is closed: your recordings are being reviewed.", code: "test_closed" }, 403);
      const m: PoolMission | undefined = s.planned.missions.find((x) => x.mission_id === body.mission_id) ?? s.pool.missions.find((x) => x.mission_id === body.mission_id) ?? found?.m;
      if (!m) return notAssigned();
      if (m.status === "submitted" || m.status === "accepted") return json({ recording_id: "r-" + m.code, mission_status: m.status, duplicate: true });
      const rec = body.recording as { duration_s?: unknown } | undefined;
      const duration = typeof rec?.duration_s === "number" ? rec.duration_s : 0;
      // The dashboard's submit check refuses a take outside the prompt's limits, and says what it
      // measured (A15, the dashboard's C2). The mission stays as it was.
      const lengthRefusal = lengthRefused(m, duration);
      if (lengthRefusal) return lengthRefusal;
      // A late take (lease ended, mission cancelled) is always kept: the mission comes back as submitted.
      m.cancelled = false;
      m.status = "submitted";
      m.rejection_reason = null;
      m.rejection_detail = null;
      m.recording = { status: "uploaded", rejection_reason: null, rejection_detail: null };
      s.seconds[m.mission_id] = duration;
      // The dashboard moves a test to review once all its takes passed the automatic checks, at its
      // next sweep (every 15 minutes), not at the last submit (X-08): the test stays "recording" until then.
      if (found && found.q.missions.every((x) => x.status === "submitted")) found.q.allInAt = Date.now();
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
      const fields: Record<string, string> = {};
      if (init?.body instanceof FormData) init.body.forEach((v, k) => (typeof v === "string" ? (fields[k] = v) : (fields.__filename = (v as File).name)));
      return json(sayariUploadAnswer(load(), fields));
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
      const sent: Record<string, string> = {};
      if (body instanceof FormData) {
        const fields: Record<string, string> = {};
        body.forEach((v, k) => (fields[k] = typeof v === "string" ? v : `<file ${(v as File).name}, ${(v as File).size} bytes>`));
        body.forEach((v, k) => (typeof v === "string" ? (sent[k] = v) : (sent.__filename = (v as File).name)));
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
        this.responseText = JSON.stringify(sayariUploadAnswer(load(), sent));
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
          // The dashboard only ever sends a reason code (REJECTION_REASONS), never a reviewer's words (X-08).
          m.status = "rejected";
          m.rejection_reason = "level";
          m.rejection_detail = null;
          m.recording = { status: "rejected", rejection_reason: "level", rejection_detail: null };
          // A rejected pool mission comes back to the same speaker with a new lease.
          if (m.lease_until) m.lease_until = new Date(Date.now() + LEASE_MS).toISOString();
          first = false;
        } else {
          m.status = "accepted";
          m.recording = { status: "accepted", rejection_reason: null, rejection_detail: null };
        }
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
    /** A qualification test's review: 8 accepted (eligible), 6 (retry: a new attempt), or 3 (not eligible). `lang`: which test ("wol" by default). */
    qualify: (decision: "eligible" | "retry" | "not_eligible" = "eligible", lang: QualLang = "wol") => {
      const s = load();
      const q = s.quals![lang];
      const accept = decision === "eligible" ? 8 : decision === "retry" ? 6 : 3;
      q.missions.forEach((m, i) => {
        m.status = i < accept ? "accepted" : "rejected";
        m.rejection_reason = i < accept ? null : "variety";
        m.rejection_detail = null;
        m.recording = { status: m.status, rejection_reason: m.rejection_reason, rejection_detail: null };
      });
      if (decision === "retry") s.quals![lang] = { ...q, attempt: q.attempt + 1, stage: "recording", decision: null, missions: qualMissions(lang, q.attempt + 1) };
      else Object.assign(q, { stage: "decided", decision });
      save(s);
    },
    /**
     * The automatic checks refused a mission's take for `check` (a REJECT_CHECKS value): the
     * mission comes back to record again, with the reason the check maps to and what was measured
     * (on the mission and on its recording, as the dashboard sends them). A test that had moved to
     * review comes back to recording.
     */
    qcReject: (missionId: string, check: RejectCheck = "low_snr") => {
      if (!(REJECT_CHECKS as readonly string[]).includes(check)) throw new Error(`unknown check: ${check}; one of ${REJECT_CHECKS.join(", ")}`);
      const s = load();
      const found = qualWithMission(s, missionId);
      const m = s.planned.missions.find((x) => x.mission_id === missionId) ?? s.pool.missions.find((x) => x.mission_id === missionId) ?? found?.m;
      if (!m) throw new Error(`no mission ${missionId}`);
      const { reason, detail } = qcDetail(check, m);
      m.status = "rejected";
      m.rejection_reason = reason;
      m.rejection_detail = detail;
      m.recording = { status: "rejected", rejection_reason: reason, rejection_detail: detail };
      if (found && found.q.stage === "in_review") found.q.stage = "recording";
      save(s);
    },
    /**
     * An applicant from before the form asked the first language (`on` false: the usual speaker):
     * no first language, the profile not filled yet, and only the Wolof and Pulaar tests.
     */
    oldApplicant: (on = true) => {
      const s = load();
      s.oldApplicant = on;
      if (on) Object.assign(s, { profile: false, nativeLanguage: null, variety: null, gender: null });
      save(s);
    },
    /** How the next invitation claims are answered: "ok", or a refusal code (CLAIM_REFUSALS, or "misconfigured"). */
    claim: (mode = "ok") => {
      if (mode !== "ok" && mode !== "misconfigured" && !CLAIM_REFUSALS[mode]) throw new Error(`unknown claim mode: ${mode}; one of ok, misconfigured, ${Object.keys(CLAIM_REFUSALS).join(", ")}`);
      const s = load();
      s.claim = mode;
      save(s);
    },
    /** Sayari answers the next uploads with duplicate: true (`false` lifts it). */
    uploadDuplicate: (on = true) => {
      const s = load();
      s.uploadDuplicate = on;
      save(s);
    },
    /** The dashboard's sweep, now: a test with every take in moves to review. */
    sweep: () => {
      const s = load();
      sweep(s, true);
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
