"use client";

/**
 * Data hooks shared by every campaign screen.
 *
 *   useCampaignSession()      who is signed in (Google), and whether that is known yet
 *   useCampaignList()         the contributor + one card per campaign
 *   useCampaignMissions(id)   one campaign's card + its missions
 *
 * Reads go through the shared cache (cache.ts): one call per key however many screens ask, the
 * last answer painted at once (also offline), refreshed in the background when the app comes back
 * to the foreground or the network returns.
 *
 * Each data hook returns { state, data, error, reload }. `state` is "waiting" until the session is
 * known, "signedOut" without a session, "loading" until the first answer, then "ready" | "error".
 * "ready" also says whether a refresh is running and whether the last one failed (the data shown
 * is then the saved copy).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CampaignList, MissionList } from "./api";
import { getCampaignAuth, isCampaignAuthConfigured, storedCampaignUser } from "./auth-client";
import { cacheId, campaignCache, type Entry } from "./cache";
import { needsSignIn } from "./errors";
import { CAMPAIGNS, loadCampaigns, loadMissions, missionsKey } from "./queries";
import type { CampaignFailure } from "./types";

/**
 * `verified: false`: a known speaker whose session could not be renewed because the phone is
 * offline (APP-003). Screens show their saved data and the outbox keeps their takes; calls answer
 * "offline" until the session is renewed, which happens by itself once the network is back.
 */
export type SessionState = { status: "waiting" } | { status: "signedOut" } | { status: "signedIn"; email: string | null; userId: string; verified: boolean };

/** The session state for what getSession / onAuthStateChange gave. Pure apart from reading the saved session. */
export function sessionStateFor(s: { user: { id: string; email?: string | null } } | null, signedOutEvent = false): SessionState {
  if (s) return { status: "signedIn", email: s.user.email ?? null, userId: s.user.id, verified: true };
  if (signedOutEvent) return { status: "signedOut" };
  // No usable session, but one is still saved: the renewal failed on the network (supabase-js
  // deletes the saved session when Auth refuses it). The speaker is known, just offline.
  const known = storedCampaignUser();
  return known ? { status: "signedIn", email: known.email, userId: known.id, verified: false } : { status: "signedOut" };
}

// One session store for the whole app (APP-034): one getSession() and one auth subscription, however
// many components ask (each getSession() takes the auth lock).
const INITIAL: SessionState = isCampaignAuthConfigured ? { status: "waiting" } : { status: "signedOut" };
/** How long a saved speaker waits for the session check before their saved screens show. */
export const OPTIMISTIC_SESSION_MS = 2500;
let current: SessionState = INITIAL;
let started = false;
const sessionListeners = new Set<() => void>();

function applySession(next: SessionState) {
  if (sameSession(current, next)) return;
  current = next;
  for (const l of [...sessionListeners]) l();
}

function startSession() {
  if (started || !isCampaignAuthConfigured || typeof window === "undefined") return;
  started = true;
  const auth = getCampaignAuth().auth;
  const check = () => void auth.getSession().then(({ data }) => applySession(sessionStateFor(data.session)), () => applySession(sessionStateFor(null)));
  check();
  // Never keep a known speaker on a spinner while supabase-js retries an expired token on a bad
  // network (about 25 s, twice): their saved screens show after a short wait (at once when the
  // phone says it is offline), and the real answer replaces this as soon as it comes.
  const known = storedCampaignUser();
  if (known) {
    const optimistic = () => {
      if (current.status === "waiting") applySession({ status: "signedIn", email: known.email, userId: known.id, verified: false });
    };
    if (navigator.onLine === false) optimistic();
    else window.setTimeout(optimistic, OPTIMISTIC_SESSION_MS);
  }
  auth.onAuthStateChange((event, session) => applySession(sessionStateFor(session, event === "SIGNED_OUT")));
  // Back online: renew a session that could not be renewed offline.
  window.addEventListener("online", () => current.status === "signedIn" && !current.verified && check());
}

const subscribeSession = (fn: () => void) => {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
};

export function useCampaignSession(): SessionState {
  useEffect(startSession, []);
  return useSyncExternalStore(subscribeSession, () => current, () => INITIAL);
}

const sameSession = (a: SessionState, b: SessionState) =>
  a.status === b.status && (a.status !== "signedIn" || (b.status === "signedIn" && a.userId === b.userId && a.email === b.email && a.verified === b.verified));

export type Loaded<T> =
  | { state: "waiting" | "signedOut" | "loading"; error: null; data: null; reload: () => void }
  | {
      state: "ready";
      error: null;
      data: T;
      reload: () => void;
      refreshing: boolean;
      failure: CampaignFailure | null;
      /** The data is a copy saved on an earlier visit, not yet confirmed by the server. */
      saved: boolean;
    }
  | { state: "error"; error: CampaignFailure; data: null; reload: () => void };

// ── Revalidation of what is on screen ────────────────────────────────────

const active = new Map<string, { count: number; load: (force: boolean) => Promise<void> }>();
let listening = false;

function revalidateActive() {
  for (const { load } of active.values()) void load(false);
}

function listenOnce() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("online", () => {
    // Back online: what is shown may be old, fetch it whatever its age.
    for (const { load } of active.values()) void load(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateActive();
  });
}

/** `valid` rejects a saved copy of the wrong shape (an older app version wrote it): it is then refetched, never painted. */
function useCached<T>(key: string | null, load: ((userId: string, force: boolean) => Promise<void>) | null, valid: (data: T) => boolean = () => true): Loaded<T> {
  const session = useCampaignSession();
  const userId = session.status === "signedIn" ? session.userId : null;
  const id = userId && key ? cacheId(userId, key) : null;

  const entry = useSyncExternalStore(
    campaignCache.subscribe,
    () => (id ? campaignCache.read<T>(id) : null),
    () => null,
  ) as Entry<T> | null;

  useEffect(() => {
    if (!id || !userId || !load) return;
    listenOnce();
    const run = (force: boolean) => load(userId, force);
    const slot = active.get(id) ?? { count: 0, load: run };
    slot.count++;
    active.set(id, slot);
    void run(false);
    return () => {
      slot.count--;
      if (slot.count <= 0) active.delete(id);
    };
  }, [id, userId, load]);

  const reload = useCallback(() => {
    if (userId && load) void load(userId, true);
  }, [userId, load]);

  if (session.status === "waiting") return { state: "waiting", error: null, data: null, reload };
  if (session.status === "signedOut") return { state: "signedOut", error: null, data: null, reload };
  if (!entry) return { state: "loading", error: null, data: null, reload };
  // A rejected session is "signed out" as far as the screens are concerned.
  if (entry.failure && needsSignIn(entry.failure.code)) return { state: "signedOut", error: null, data: null, reload };
  if (entry.data != null && valid(entry.data)) return { state: "ready", error: null, data: entry.data, reload, refreshing: entry.refreshing, failure: entry.failure, saved: entry.at === 0 };
  if (entry.failure && !entry.refreshing) return { state: "error", error: entry.failure, data: null, reload };
  return { state: "loading", error: null, data: null, reload };
}

const listLoader = (userId: string, force: boolean) => loadCampaigns(userId, force);

const isCampaignList = (d: CampaignList) => Array.isArray(d?.campaigns);

export const useCampaignList = (): Loaded<CampaignList> => useCached<CampaignList>(CAMPAIGNS, listLoader, isCampaignList);

/** `enabled: false` reads the saved copy only (the bridge refuses missions before the consents). */
export function useCampaignMissions(campaignId: string, enabled = true): Loaded<MissionList> {
  const loader = useCallback((userId: string, force: boolean) => loadMissions(userId, campaignId, force), [campaignId]);
  return useCached<MissionList>(missionsKey(campaignId), enabled ? loader : null);
}
