/**
 * Where to go back to after Google sign-in. The "to record again" email links straight into the
 * studio (`/campaign/<id>/studio?m=a,b`); a signed-out speaker lands on the sign-in page and
 * Google brings them back to `/campaign` (the only redirect URL Supabase allows). The studio path
 * is kept here meanwhile, for an hour, and `/campaign` follows it once the speaker is signed in.
 *
 * Only same-app paths of the exact studio shape are stored or followed: this can never become an
 * open redirect. Modelled on link-token.ts (the same `Store` injection for tests).
 */

import { parseFocus } from "./studio-flow";

const KEY = "afriklang.campaign.return.v1";
const PATH_RE = /^\/campaign\/[0-9a-f-]{36}\/studio(\?m=[0-9a-f,-]{36,400})?$/;
/** A saved path older than this is forgotten: the speaker has moved on. */
export const RETURN_PATH_MAX_AGE_MS = 60 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The studio path to come back to, rebuilt from its parts rather than copied from the address: a
 * mail client may encode the link's commas (`%2C`) or change the case of the ids, and the raw
 * search would then fail the shape check below and the focus be lost after sign-in. The ids go
 * through parseFocus (well-formed, lowercase, at most MAX_FOCUS); the campaign id is lowercased.
 * A campaign id that is not a UUID gives a path saveReturnPath refuses.
 */
export function studioReturnPath(campaignId: string, m: string | null): string {
  const ids = parseFocus(m);
  return `/campaign/${campaignId.toLowerCase()}/studio${ids.length ? `?m=${ids.join(",")}` : ""}`;
}

/** True for a studio path of this app (`/campaign/<uuid>/studio`, with or without `?m=`). */
export const isReturnPath = (path: string) => PATH_RE.test(path);

/** Remember `path` for after sign-in, when it is a studio path; anything else is ignored. */
export function saveReturnPath(path: string, s: Store | null = store(), now = Date.now()): void {
  if (!isReturnPath(path)) return;
  try {
    s?.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    // storage blocked: the speaker lands on the home after sign-in, as before
  }
}

/** The saved path, and forget it: null when there is none, when it is older than an hour, or when it is not a studio path. */
export function takeReturnPath(s: Store | null = store(), now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = s?.getItem(KEY) ?? null;
    if (raw !== null) s?.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof d.path !== "string" || !isReturnPath(d.path)) return null;
    if (typeof d.at !== "number" || !Number.isFinite(d.at) || now - d.at > RETURN_PATH_MAX_AGE_MS || d.at > now + RETURN_PATH_MAX_AGE_MS) return null;
    return d.path;
  } catch {
    return null;
  }
}
