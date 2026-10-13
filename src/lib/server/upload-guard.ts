/**
 * Guards for the Sayari upload proxy (src/app/api/audio-upload/route.ts).
 *
 * The proxy adds Sayari's upload key to what it forwards, so it must only forward for a
 * signed-in contributor, within a size cap and a per-person rate. Server-only: no "use client".
 *
 *   readBearer      the access token from an Authorization header
 *   precheckJwt     cheap shape/expiry/role test, so junk never costs a network call
 *   verifySession   asks Supabase Auth who the token belongs to (cached briefly)
 *   checkLength     the declared body size against the cap
 *   RateLimiter     fixed-window counter per key, in this server instance's memory
 *
 * The rate limits are per instance: Amplify may run several, so the effective ceiling is a
 * multiple of these numbers. Good enough to stop a flood; a shared store comes with the
 * upload-ticket work (docs/CAMPAIGN_PIPELINE_COMPLETION_PLAN.md, Phase 1).
 */

import { createHash } from "node:crypto";

/** Largest body the proxy forwards. A 30 s take is about 1 MB; conversations are longer. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header.trim());
  return m ? m[1] : null;
}

function decodeSegment(seg: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Rejects what cannot be a live access token of this project, without the network.
 * NOT a verification: the signature is checked by Supabase in verifySession.
 */
export function precheckJwt(token: string, nowS: number): { ok: true; sub: string; exp: number } | { ok: false } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };
  const payload = decodeSegment(parts[1]);
  if (!payload) return { ok: false };
  const { sub, exp, role } = payload;
  if (typeof sub !== "string" || !sub || typeof exp !== "number" || exp <= nowS) return { ok: false };
  if (role !== "authenticated") return { ok: false };
  // The issuer is NOT compared with the app's Supabase URL: it differs behind a custom domain or a
  // proxy, which refused every real upload. Auth checks the signature, and the user id it returns
  // must equal `sub` (verifySession).
  return { ok: true, sub, exp };
}

type Verified = { userId: string };
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const CACHE_MS = 60_000;
const CACHE_MAX = 5_000;
const sessionCache = new Map<string, { userId: string; until: number }>();

const tokenKey = (token: string) => createHash("sha256").update(token).digest("base64url");

/**
 * Who the token belongs to, per Supabase Auth (`GET /auth/v1/user`), or null when it is not a
 * valid session. Answers are cached 60 s (never past the token's expiry) under the token's
 * hash, so a burst of uploads costs one Auth call. Throws when Auth cannot be reached, so the
 * caller answers 503 (retry later) instead of 401 (sign in again).
 */
export async function verifySession(
  token: string,
  cfg: { supabaseUrl: string; anonKey: string },
  opts: {
    now?: () => number;
    fetch?: FetchLike;
    /** Called before each Auth call (cache misses only); returning false throws `auth_busy`. */
    beforeLookup?: () => boolean;
  } = {},
): Promise<Verified | null> {
  const now = opts.now ?? Date.now;
  const pre = precheckJwt(token, Math.floor(now() / 1000));
  if (!pre.ok) return null;

  const key = tokenKey(token);
  const hit = sessionCache.get(key);
  if (hit && hit.until > now()) return { userId: hit.userId };
  if (hit) sessionCache.delete(key);
  if (opts.beforeLookup && !opts.beforeLookup()) throw new Error("auth_busy");

  const res = await (opts.fetch ?? fetch)(`${cfg.supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  // Any refusal of the token (401, 403 "bad_jwt", 400 …) means "not signed in". Only 429 and 5xx
  // mean Auth itself is unavailable.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
  if (!res.ok) throw new Error(`auth_unavailable_${res.status}`);
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || body.id !== pre.sub) return null;

  if (sessionCache.size >= CACHE_MAX) sessionCache.delete(sessionCache.keys().next().value as string);
  sessionCache.set(key, { userId: body.id, until: Math.min(now() + CACHE_MS, pre.exp * 1000) });
  return { userId: body.id };
}

/** For tests. */
export function clearSessionCache() {
  sessionCache.clear();
}

/** The declared body size: a number within the cap, or why it is refused. */
export function checkLength(header: string | null, max = MAX_UPLOAD_BYTES): { ok: true; bytes: number } | { ok: false; status: 411 | 413 } {
  if (header === null || !/^\d{1,12}$/.test(header.trim())) return { ok: false, status: 411 };
  const bytes = Number(header.trim());
  if (bytes > max) return { ok: false, status: 413 };
  return { ok: true, bytes };
}

/** Fixed-window counter per key, in memory, bounded in size. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 20_000,
  ) {}

  /** Counts one request for `key`. `retryAfterS` is set when it is over the limit. */
  take(key: string, nowMs = Date.now()): { ok: true } | { ok: false; retryAfterS: number } {
    let e = this.hits.get(key);
    if (!e || e.resetAt <= nowMs) {
      if (!e && this.hits.size >= this.maxKeys) this.sweep(nowMs);
      e = { count: 0, resetAt: nowMs + this.windowMs };
      this.hits.set(key, e);
    }
    e.count += 1;
    if (e.count > this.limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((e.resetAt - nowMs) / 1000)) };
    return { ok: true };
  }

  /** True when `key` is already over the limit in its current window (counts nothing). */
  blocked(key: string, nowMs = Date.now()): boolean {
    const e = this.hits.get(key);
    return Boolean(e && e.resetAt > nowMs && e.count >= this.limit);
  }

  private sweep(nowMs: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= nowMs) this.hits.delete(k);
    // Still full (a flood of distinct keys): drop the oldest entries rather than grow.
    while (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
  }
}

/** The client address as the platform's proxy reports it (best effort; used only to slow down bad tokens). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64) || "unknown";
  return headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown";
}
