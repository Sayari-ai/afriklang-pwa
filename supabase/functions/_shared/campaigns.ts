// Pure logic of the `campaigns` Edge Function (no Deno imports, so vitest can test it).
//
// The function is the ONLY holder of the dashboard's bridge secret. It turns a signed-in
// user's request into a call to the dashboard's /api/pwa/campaigns/* routes:
//
//   * who the user is (user_id, email, email_verified) comes from the VERIFIED session,
//     never from the request body: whatever the browser sends under those names is dropped;
//   * only the actions and fields listed in ACTIONS are forwarded, each checked first: a
//     missing or malformed field is a 400 naming every bad field (`fieldErrors`);
//   * the dashboard's answer is relayed as is (status + JSON).
//
// Contract: afriklang-landing-page/docs/CAMPAIGN_BRIDGE_CONTRACT.md

export type Identity = { userId: string; email: string | null; emailVerified: boolean };

/**
 * One body field: its type and the rule it must meet. Limits mirror what the dashboard
 * accepts (src/lib/campaigns/{speaker-service,bridge-service,recording-metadata}.ts there),
 * so a value the dashboard would refuse is refused here with a precise 400 instead.
 */
type Field =
  | { kind: "text"; label: string; max: number; required?: boolean; pattern?: RegExp; patternHint?: string; oneOf?: readonly string[]; upper?: boolean }
  | { kind: "uuid"; label: string; required?: boolean }
  | { kind: "uuids"; label: string; max: number; required?: boolean }
  | { kind: "sha256"; label: string; required?: boolean }
  | { kind: "number"; label: string; min: number; max: number; minExclusive?: boolean; required?: boolean }
  | { kind: "recording"; label: string; required?: boolean };
type Spec = { path: string; fields: Record<string, Field>; sendEmail?: boolean; check?: (body: Record<string, unknown>, errors: FieldErrors) => void };
export type FieldErrors = Record<string, string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The invitation token: 32 random bytes, base64url (the dashboard's invitation-token.ts). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Letters or digits somewhere in a free-text answer (not only punctuation or spaces). */
const HAS_WORD = /[\p{L}\p{N}]/u;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The dashboard refuses a `return` of more missions than this in one call. */
export const MAX_RETURN_IDS = 200;

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export const AGE_BANDS = ["18-29", "30-44", "45-59", "60+"] as const;

/** Browser action -> dashboard route and the body fields allowed through. */
export const ACTIONS: Record<string, Spec> = {
  // The invitation link. email/email_verified go along: the dashboard binds the account only
  // when the verified email is the invited contributor's.
  claim: {
    path: "claim",
    sendEmail: true,
    fields: {
      token: { kind: "text", label: "token", max: 43, required: true, pattern: TOKEN_RE, patternHint: "the 43-character code from the invitation link" },
      device_id: { kind: "uuid", label: "device_id" },
    },
  },
  campaigns: { path: "", fields: {} },
  profile: {
    path: "profile",
    fields: {
      native_language: { kind: "text", label: "native_language", max: 3, required: true, pattern: /^[a-z]{3}$/, patternHint: "an ISO 639-3 code such as wol" },
      variety: { kind: "text", label: "variety", max: 80, required: true },
      country: { kind: "text", label: "country", max: 2, required: true, upper: true, pattern: /^[A-Z]{2}$/, patternHint: "an ISO 3166-1 alpha-2 code such as SN" },
      region: { kind: "text", label: "region", max: 80, required: true },
      gender: { kind: "text", label: "gender", max: 20, required: true, oneOf: GENDERS },
      age_band: { kind: "text", label: "age_band", max: 10, required: true, oneOf: AGE_BANDS },
      device: { kind: "text", label: "device", max: 80, required: true },
    },
  },
  consent: {
    path: "consent",
    fields: {
      type: { kind: "text", label: "type", max: 20, required: true, oneOf: ["account", "campaign"] },
      campaign_id: { kind: "uuid", label: "campaign_id" },
      version: { kind: "text", label: "version", max: 20, required: true },
      locale: { kind: "text", label: "locale", max: 2, required: true, oneOf: ["en", "fr"] },
    },
    check: (body, errors) => {
      if (body.type === "campaign" && !body.campaign_id && !errors.campaign_id) errors.campaign_id = "campaign_id is required for a campaign consent";
      if (body.type === "account") delete body.campaign_id;
    },
  },
  withdraw: { path: "consent/withdraw", fields: { campaign_id: { kind: "uuid", label: "campaign_id", required: true } } },
  missions: { path: "missions", fields: { campaign_id: { kind: "uuid", label: "campaign_id", required: true } } },
  // A signed upload ticket for ONE file of one mission (docs/contracts/README.md §1). The app never
  // reads the ticket: it hands it to the upload proxy, which hands it to Sayari.
  upload_ticket: {
    path: "missions/upload-ticket",
    fields: {
      mission_id: { kind: "uuid", label: "mission_id", required: true },
      source_sha256: { kind: "sha256", label: "source_sha256", required: true },
      duration_s: { kind: "number", label: "duration_s", min: 0, minExclusive: true, max: 3_600, required: true },
    },
  },
  submit: { path: "missions/submit", fields: { mission_id: { kind: "uuid", label: "mission_id", required: true }, recording: { kind: "recording", label: "recording", required: true } } },
  // Pool campaigns only: draw a leased batch, or give open missions back (at most 200 per call).
  draw: { path: "missions/draw", fields: { campaign_id: { kind: "uuid", label: "campaign_id", required: true } } },
  return: {
    path: "missions/return",
    fields: { campaign_id: { kind: "uuid", label: "campaign_id", required: true }, mission_ids: { kind: "uuids", label: "mission_ids", max: MAX_RETURN_IDS, required: true } },
  },
};

export type Built =
  | { ok: true; path: string; body: Record<string, unknown> }
  | { ok: false; code: "unknown_action" | "invalid_input"; error: string; fieldErrors?: FieldErrors };

/** The dashboard body for one action, built from the verified identity and the allowed fields. */
export function buildForward(action: unknown, clientBody: unknown, who: Identity): Built {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return { ok: false, code: "unknown_action", error: `Unknown action${typeof action === "string" && action ? ` "${action.slice(0, 40)}"` : ""}. Expected one of: ${Object.keys(ACTIONS).join(", ")}.` };
  }
  const spec = ACTIONS[action];
  const input = clientBody && typeof clientBody === "object" && !Array.isArray(clientBody) ? (clientBody as Record<string, unknown>) : {};
  const body: Record<string, unknown> = { user_id: who.userId };
  if (spec.sendEmail) {
    body.email = who.email ?? "";
    body.email_verified = who.emailVerified;
  }
  const errors: FieldErrors = {};
  for (const [name, f] of Object.entries(spec.fields)) {
    const v = input[name];
    const blank = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (blank) {
      if (f.required) errors[name] = `${f.label} is required`;
      continue;
    }
    if (f.kind === "text") {
      if (typeof v !== "string") {
        errors[name] = `${f.label} must be text`;
        continue;
      }
      let s = v.trim();
      if (f.upper) s = s.toUpperCase();
      if (CONTROL.test(s)) errors[name] = `${f.label} contains control characters`;
      else if (s.length > f.max) errors[name] = `${f.label} is too long (${s.length} characters, at most ${f.max})`;
      else if (f.oneOf && !f.oneOf.includes(s)) errors[name] = `${f.label} must be one of: ${f.oneOf.join(", ")}`;
      else if (f.pattern && !f.pattern.test(s)) errors[name] = `${f.label} must be ${f.patternHint ?? "well formed"}`;
      else if (!f.oneOf && !f.pattern && !HAS_WORD.test(s)) errors[name] = `${f.label} must contain letters or digits`;
      else body[name] = s;
    } else if (f.kind === "uuid") {
      if (typeof v !== "string" || !UUID_RE.test(v.trim())) errors[name] = `${f.label} must be a uuid`;
      else body[name] = v.trim().toLowerCase();
    } else if (f.kind === "sha256") {
      const h = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{64}$/.test(h)) errors[name] = `${f.label} must be the sha-256 of the file (64 hex characters)`;
      else body[name] = h;
    } else if (f.kind === "number") {
      const low = f.minExclusive ? (n: number) => n > f.min : (n: number) => n >= f.min;
      if (!isNum(v) || !low(v) || v > f.max) errors[name] = `${f.label} must be a number ${f.minExclusive ? "above" : "of at least"} ${f.min} and at most ${f.max}`;
      else body[name] = v;
    } else if (f.kind === "uuids") {
      if (!Array.isArray(v)) errors[name] = `${f.label} must be a list of uuids`;
      else if (v.length === 0) {
        if (f.required) errors[name] = `${f.label} must list at least one id`;
      } else if (v.length > f.max) errors[name] = `${f.label} lists ${v.length} ids, at most ${f.max}`;
      else if (v.some((x) => typeof x !== "string" || !UUID_RE.test(x.trim()))) errors[name] = `${f.label} must contain uuids only`;
      else body[name] = [...new Set(v.map((x: string) => x.trim().toLowerCase()))];
    } else {
      const r = checkRecording(v, errors);
      if (r) body[name] = r;
    }
  }
  spec.check?.(body, errors);
  const names = Object.keys(errors);
  if (names.length) return { ok: false, code: "invalid_input", error: `Invalid request: ${names.map((n) => errors[n]).join("; ")}.`, fieldErrors: errors };
  return { ok: true, path: spec.path, body };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A recording's metadata, checked field by field and stripped of anything else. Errors go
 * under "recording.<field>". The dashboard checks the take against the campaign's rules again.
 */
export function checkRecording(v: unknown, errors: FieldErrors): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    errors.recording = "recording must be an object with the take's metadata";
    return null;
  }
  const r = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const bad = (k: string, msg: string) => void (errors[`recording.${k}`] = `recording.${k} ${msg}`);
  const number = (k: string, rule: (n: number) => boolean, msg: string, required: boolean, integer = false) => {
    const x = r[k];
    if (x === undefined || x === null) {
      if (required) bad(k, "is required");
      return;
    }
    if (!isNum(x) || (integer && !Number.isInteger(x)) || !rule(x)) bad(k, msg);
    else out[k] = x;
  };
  const text = (k: string, max: number) => {
    const x = r[k];
    if (x === undefined || x === null || x === "") return;
    if (typeof x !== "string" || !x.trim()) bad(k, "must be text");
    else if (x.trim().length > max || CONTROL.test(x)) bad(k, `must be at most ${max} plain characters`);
    else out[k] = x.trim();
  };

  if (r.format !== "wav") bad("format", 'must be "wav"');
  else out.format = "wav";
  number("sample_rate", (n) => n >= 8_000 && n <= 192_000, "must be a whole number between 8000 and 192000", true, true);
  number("channels", (n) => n === 1 || n === 2, "must be 1 or 2", true, true);
  number("duration_s", (n) => n > 0 && n <= 3_600, "must be a number of seconds above 0 and at most 3600", true);
  number("level_dbfs", (n) => n <= 0 && n >= -120, "must be a number of dBFS between -120 and 0", true);
  // 0 dBFS or above is a clipped take: well formed, refused by the dashboard as recording_rejected.
  number("peak_dbfs", (n) => n <= 20 && n >= -120, "must be a number of dBFS between -120 and 20", false);
  number("silence_before_s", (n) => n >= 0 && n <= 3_600, "must be a number of seconds, 0 or more", false);
  number("silence_after_s", (n) => n >= 0 && n <= 3_600, "must be a number of seconds, 0 or more", false);
  const sha = typeof r.source_sha256 === "string" ? r.source_sha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha)) bad("source_sha256", "must be the sha-256 of the file (64 hex characters)");
  else out.source_sha256 = sha;
  text("device", 80);
  text("sayari_recording_id", 200);
  return Object.keys(errors).some((k) => k === "recording" || k.startsWith("recording.")) ? null : out;
}

type AuthUserLike = {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  app_metadata?: { provider?: unknown } | null;
  user_metadata?: { email_verified?: unknown } | null;
  identities?: { provider?: unknown; identity_data?: { email?: unknown; email_verified?: unknown } | null }[] | null;
};

/**
 * Who the verified session belongs to. The email counts as verified only when the Google
 * identity itself says so (identity_data.email_verified) AND that identity's email is the
 * account's email. `user_metadata` is not trusted: users can write it themselves
 * (auth.updateUser({ data })), and an account email changed after the Google sign-in is not
 * the one Google verified (APP-020).
 */
export function identityFrom(user: AuthUserLike | null | undefined): Identity | null {
  if (!user || typeof user.id !== "string" || !UUID_RE.test(user.id)) return null;
  const email = typeof user.email === "string" && user.email.includes("@") ? user.email.trim().toLowerCase() : null;
  const google = user.identities?.find((i) => i?.provider === "google");
  const googleEmail = typeof google?.identity_data?.email === "string" ? google.identity_data.email.trim().toLowerCase() : null;
  const googleSays = google?.identity_data?.email_verified === true && googleEmail !== null && googleEmail === email;
  return { userId: user.id, email, emailVerified: Boolean(email) && googleSays };
}

export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec(header ?? "");
  return m ? m[1] : null;
}

/** Largest request body the function accepts (a recording's metadata is a few hundred bytes). */
export const MAX_BODY_BYTES = 40 * 1024;

/** dashboard base like https://admin.example.com (no trailing slash), or null when unusable. */
export function dashboardBase(raw: string | undefined | null): string | null {
  try {
    const u = new URL((raw ?? "").trim());
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}
