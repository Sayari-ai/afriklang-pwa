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

export type ConsentView = { required_version: string | null; signed: boolean; signed_version: string | null; text_url: string | null };

export type CampaignCard = {
  assignment_id: string;
  campaign_id: string;
  code: string;
  title: string;
  status: string;
  language: { code: string; name: string; varieties: string[] };
  topic: { domain: string; sub_domain: string | null };
  deadline: string | null;
  progress: { total: number; todo: number; submitted: number; accepted: number; rejected: number };
  next_step: NextStep;
  blocked_reason: string | null;
  consents: { account: ConsentView; campaign: ConsentView };
  instructions: {
    recording: { min_level_dbfs: number; silence_margin_s: number; background?: string; mic_distance_cm?: { min?: number; max?: number } | null; [k: string]: unknown };
    speech_types: { type: SpeechType; duration_min_s: number; duration_max_s: number; missions_per_session?: { min: number; max: number } | null }[];
  };
  partner: { speaker_id: string | null; ready: boolean } | null;
};

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
  | "unknown";

export type CampaignFailure = {
  ok: false;
  status: number;
  code: CampaignErrorCode;
  message: string;
  nextStep?: NextStep;
  reason?: "duration" | "level" | "silence" | "other";
  retryAfterS?: number;
  /** Per-field problems of a 400 (Edge Function or dashboard), keyed by the body field name, e.g. "variety" or "recording.duration_s". */
  fieldErrors?: Record<string, string>;
};
export type CampaignResult<T> = { ok: true; data: T } | CampaignFailure;
