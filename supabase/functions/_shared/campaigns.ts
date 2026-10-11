// Pure logic of the `campaigns` Edge Function (no Deno imports, so vitest can test it).
//
// The function is the ONLY holder of the dashboard's bridge secret. It turns a signed-in
// user's request into a call to the dashboard's /api/pwa/campaigns/* routes:
//
//   * who the user is (user_id, email, email_verified) comes from the VERIFIED session,
//     never from the request body: whatever the browser sends under those names is dropped;
//   * only the actions and fields listed in ACTIONS are forwarded;
//   * the dashboard's answer is relayed as is (status + JSON).
//
// Contract: afriklang-landing-page/docs/CAMPAIGN_BRIDGE_CONTRACT.md

export type Identity = { userId: string; email: string | null; emailVerified: boolean };

type FieldKind = "string" | "uuid" | "object";
type Spec = { path: string; fields: Record<string, { kind: FieldKind; max?: number; required?: boolean }>; sendEmail?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browser action -> dashboard route and the body fields allowed through. */
export const ACTIONS: Record<string, Spec> = {
  // The invitation link. email/email_verified go along: the dashboard binds the account only
  // when the verified email is the invited contributor's.
  claim: { path: "claim", sendEmail: true, fields: { token: { kind: "string", max: 128, required: true }, device_id: { kind: "string", max: 64 } } },
  campaigns: { path: "", fields: {} },
  profile: {
    path: "profile",
    fields: {
      native_language: { kind: "string", max: 10 },
      variety: { kind: "string", max: 100 },
      country: { kind: "string", max: 10 },
      region: { kind: "string", max: 100 },
      gender: { kind: "string", max: 20 },
      age_band: { kind: "string", max: 10 },
      device: { kind: "string", max: 100 },
    },
  },
  consent: {
    path: "consent",
    fields: { type: { kind: "string", max: 20, required: true }, campaign_id: { kind: "uuid" }, version: { kind: "string", max: 50, required: true }, locale: { kind: "string", max: 5 } },
  },
  withdraw: { path: "consent/withdraw", fields: { campaign_id: { kind: "uuid", required: true } } },
  missions: { path: "missions", fields: { campaign_id: { kind: "uuid", required: true } } },
  submit: { path: "missions/submit", fields: { mission_id: { kind: "uuid", required: true }, recording: { kind: "object", required: true } } },
};

export type Built = { ok: true; path: string; body: Record<string, unknown> } | { ok: false; error: string };

/** The dashboard body for one action, built from the verified identity and the allowed fields. */
export function buildForward(action: unknown, clientBody: unknown, who: Identity): Built {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) return { ok: false, error: "unknown_action" };
  const spec = ACTIONS[action];
  const input = clientBody && typeof clientBody === "object" && !Array.isArray(clientBody) ? (clientBody as Record<string, unknown>) : {};
  const body: Record<string, unknown> = { user_id: who.userId };
  if (spec.sendEmail) {
    body.email = who.email ?? "";
    body.email_verified = who.emailVerified;
  }
  for (const [name, f] of Object.entries(spec.fields)) {
    const v = input[name];
    if (v === undefined || v === null) {
      if (f.required) return { ok: false, error: `${name}_required` };
      continue;
    }
    if (f.kind === "string") {
      if (typeof v !== "string") return { ok: false, error: `${name}_invalid` };
      body[name] = v.trim().slice(0, f.max ?? 200);
    } else if (f.kind === "uuid") {
      if (typeof v !== "string" || !UUID_RE.test(v)) return { ok: false, error: `${name}_invalid` };
      body[name] = v;
    } else {
      if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: `${name}_invalid` };
      body[name] = v; // the dashboard validates and normalises recording metadata itself
    }
  }
  return { ok: true, path: spec.path, body };
}

type AuthUserLike = {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  app_metadata?: { provider?: unknown } | null;
  user_metadata?: { email_verified?: unknown } | null;
  identities?: { provider?: unknown; identity_data?: { email_verified?: unknown } | null }[] | null;
};

/**
 * Who the verified session belongs to. The email counts as verified only for a Google
 * sign-in whose provider confirms it (Google reports email_verified), never for an
 * address someone typed.
 */
export function identityFrom(user: AuthUserLike | null | undefined): Identity | null {
  if (!user || typeof user.id !== "string" || !UUID_RE.test(user.id)) return null;
  const email = typeof user.email === "string" && user.email.includes("@") ? user.email.trim().toLowerCase() : null;
  const google = user.identities?.find((i) => i?.provider === "google");
  const viaGoogle = Boolean(google) || user.app_metadata?.provider === "google";
  const providerSays = google?.identity_data?.email_verified === true || user.user_metadata?.email_verified === true;
  return { userId: user.id, email, emailVerified: Boolean(email) && viaGoogle && providerSays };
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
