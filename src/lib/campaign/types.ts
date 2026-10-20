/** Shapes the dashboard's campaign bridge returns (docs/CAMPAIGN_BRIDGE_CONTRACT.md in afriklang-landing-page). */

export type SpeechType = "read" | "spontaneous" | "conversational";
export type NextStep = "profile" | "blocked" | "account_consent" | "campaign_consent" | "paused" | "ready" | "closed";

export type ProfileValues = {
  nativeLanguage: string | null;
  variety: string | null;
  country: string | null;
  region: string | null;
  gender: string | null;
  ageBand: string | null;
  device: string | null;
};

export type ContributorView = {
  contributor_id: string;
  speaker_id: string | null;
  locale: "en" | "fr";
  profile: { complete: boolean; missing: string[]; values: ProfileValues | null };
};

/**
 * How work reaches the speaker. "planned": every mission is assigned up front. "pool": the speaker
 * draws small leased batches (missions/draw). A card from a dashboard older than pool dispatch has
 * no `dispatch`: it is planned.
 */
export type Dispatch = "planned" | "pool";

/**
 * Pay per hour of accepted audio. `accepted`: count of accepted takes (kept for compatibility);
 * `accepted_s`: their payable seconds; `pending_s`: seconds submitted but not reviewed yet.
 */
export type Rewards = { accepted: number; accepted_s?: number; pending_s?: number };

/**
 * `text_url`: the text in the contributor's language as the dashboard stores it. `text_urls`: the
 * text in every language it exists in (newer dashboards), so the app opens the one the speaker
 * reads the app in, the locale it records with the signature (M-16).
 */
export type ConsentView = { required_version: string | null; signed: boolean; signed_version: string | null; text_url: string | null; text_urls?: Record<string, string> | null };

export type CampaignCard = {
  assignment_id: string;
  campaign_id: string;
  code: string;
  title: string;
  status: string;
  /**
   * `varieties`: the varieties the campaign is for (a declared variety outside them pauses the
   * campaign until the team checks; none: any). A qualification test accepts any variety.
   * `known_varieties`: every variety of the language the dashboard knows, the form's suggestions.
   * Optional: an older dashboard does not send it (the form then suggests `varieties`).
   */
  language: { code: string; name: string; varieties: string[]; known_varieties?: string[] };
  topic: { domain: string; sub_domain: string | null };
  deadline: string | null;
  dispatch?: Dispatch;
  /** Pool campaigns: draw again when the speaker holds fewer open missions than this. */
  refill_below?: number | null;
  /** Pool campaigns: `total` is what the speaker has drawn so far, not a fixed plan. */
  progress: { total: number; todo: number; submitted: number; accepted: number; rejected: number };
  rewards?: Rewards;
  next_step: NextStep;
  blocked_reason: string | null;
  consents: { account: ConsentView; campaign: ConsentView };
  instructions: {
    recording: { min_level_dbfs: number; silence_margin_s: number; background?: string; mic_distance_cm?: { min?: number; max?: number } | null; [k: string]: unknown };
    speech_types: { type: SpeechType; duration_min_s: number; duration_max_s: number; missions_per_session?: { min: number; max: number } | null }[];
  };
  partner: { speaker_id: string | null; ready: boolean } | null;
  /** "qualification": the speaker's qualification test in this language (not paid; no redo once sent). Absent from older dashboards: a collection campaign. */
  kind?: "collection" | "qualification";
  /** Qualification campaigns only: the current attempt. */
  qualification?: QualificationView | null;
};

/**
 * A qualification test attempt. `stage`: recording (record the prompts; a take refused by the
 * automatic checks comes back to record again), in_review (everything sent, being listened to),
 * decided, cancelled. `retry_after` (YYYY-MM-DD) after "not_eligible".
 */
export type QualificationView = {
  attempt_no: number;
  stage: "recording" | "in_review" | "decided" | "cancelled";
  decision: "eligible" | "retry" | "not_eligible" | null;
  accepted: number | null;
  total: number;
  retry_after: string | null;
};

export const isQualification = (c: Pick<CampaignCard, "kind">) => c.kind === "qualification";

export type Mission = {
  mission_id: string;
  code: string;
  type: SpeechType;
  position: number;
  status: "todo" | "submitted" | "accepted" | "rejected";
  rejection_reason: string | null;
  prompt: { id: string; text_or_topic: string; category: string | null };
  duration_s: { min: number | null; max: number | null };
  partner_speaker_id: string | null;
  partner_ready: boolean;
  recording: { status: "uploaded" | "pre_annotated" | "accepted" | "rejected"; rejection_reason: string | null } | null;
  /** Pool missions: record and submit before then, or the mission goes back to the pool. Null (or absent) when planned. */
  lease_until?: string | null;
};

/** Why a draw added nothing: not an error, a state to show. */
export type PoolStatus = "ok" | "cell_full" | "campaign_full" | "speaker_cap" | "quality_hold";

export type PoolView = {
  status: PoolStatus;
  /** Open missions the speaker now holds. */
  open: number;
  refill_below: number;
  /** When the earliest open lease ends; null with nothing open. */
  lease_until: string | null;
  /** cell_full / campaign_full: the speaker's other campaigns where a draw would succeed now. */
  elsewhere?: { campaign_id: string; title: string; code: string | null }[];
};

export type ProfileInput = {
  native_language: string;
  variety: string;
  country: string;
  region: string;
  gender: string;
  age_band: string;
  device: string;
};

/** The metadata of a take, sent after its audio was uploaded. */
export type RecordingMetadata = {
  format: "wav";
  sample_rate: number;
  channels: number;
  duration_s: number;
  level_dbfs: number;
  source_sha256: string;
  peak_dbfs?: number;
  silence_before_s?: number;
  silence_after_s?: number;
  device?: string;
  sayari_recording_id?: string;
};

export type CampaignErrorCode =
  | "invalid_input"
  | "not_linked"
  | "not_assigned"
  | "invalid_link"
  | "link_expired"
  | "campaign_closed"
  | "email_unverified"
  | "email_mismatch"
  | "account_conflict"
  | "consent_version_changed"
  | "already_submitted"
  | "recording_rejected"
  | "profile_incomplete"
  | "blocked"
  | "account_consent"
  | "campaign_consent"
  | "partner_consent"
  | "campaign_paused"
  | "campaign_not_open"
  /** The same file was already sent for another prompt: record this one again. */
  | "duplicate_audio"
  /** A qualification test no longer takes recordings (being reviewed, decided or cancelled). */
  | "test_closed"
  | "server_error"
  // from the Edge Function / network
  | "unauthorized"
  | "bridge_unreachable"
  | "bridge_error"
  | "network"
  | "offline"
  | "timeout"
  | "misconfigured"
  | "conflict"
  | "rate_limited"
  /** The backend has no such call yet (an Edge Function or a dashboard older than the app). */
  | "unsupported"
  | "unknown";

/** The dashboard's rejection reasons (REJECTION_REASONS there). */
export const REJECTION_REASONS = ["level", "duration", "silence", "variety", "banned_topic", "reading_gap", "speaker_balance", "other"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export type CampaignFailure = {
  ok: false;
  status: number;
  code: CampaignErrorCode;
  message: string;
  nextStep?: NextStep;
  reason?: RejectionReason;
  retryAfterS?: number;
  /** Per-field problems of a 400 (Edge Function or dashboard), keyed by the body field name, e.g. "variety" or "recording.duration_s". */
  fieldErrors?: Record<string, string>;
};
export type CampaignResult<T> = { ok: true; data: T } | CampaignFailure;
