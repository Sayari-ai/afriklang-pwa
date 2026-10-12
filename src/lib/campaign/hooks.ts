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

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CampaignList, MissionList } from "./api";
import { getCampaignAuth, isCampaignAuthConfigured } from "./auth-client";
import { cacheId, campaignCache, type Entry } from "./cache";
import { needsSignIn } from "./errors";
import { CAMPAIGNS, loadCampaigns, loadMissions, missionsKey } from "./queries";
import type { CampaignFailure } from "./types";

export type SessionState = { status: "waiting" } | { status: "signedOut" } | { status: "signedIn"; email: string | null; userId: string };

let lastSession: SessionState | null = null;

export function useCampaignSession(): SessionState {
  const [state, setState] = useState<SessionState>(() => lastSession ?? (isCampaignAuthConfigured ? { status: "waiting" } : { status: "signedOut" }));
  useEffect(() => {
    if (!isCampaignAuthConfigured) return;
    const auth = getCampaignAuth().auth;
    const apply = (s: { user: { id: string; email?: string | null } } | null) => {
      const next: SessionState = s ? { status: "signedIn", email: s.user.email ?? null, userId: s.user.id } : { status: "signedOut" };
      lastSession = next;
      setState((prev) => (sameSession(prev, next) ? prev : next));
    };
    void auth.getSession().then(({ data }) => apply(data.session));
    const { data } = auth.onAuthStateChange((_event, session) => apply(session));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

const sameSession = (a: SessionState, b: SessionState) =>
  a.status === b.status && (a.status !== "signedIn" || (b.status === "signedIn" && a.userId === b.userId && a.email === b.email));

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
