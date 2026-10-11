"use client";

/**
 * Data hooks shared by every campaign screen.
 *
 *   useCampaignSession()      who is signed in (Google), and whether that is known yet
 *   useCampaignList()         the contributor + one card per campaign
 *   useCampaignMissions(id)   one campaign's card + its missions
 *
 * Each data hook returns { state, ..., error, reload }. `state` is "waiting" until the
 * session is known, "signedOut" without a session, then "loading" -> "ready" | "error".
 * A failure is a CampaignFailure (with the dashboard's code), never a thrown error.
 */

import { useCallback, useEffect, useState } from "react";
import { getCampaignAuth, isCampaignAuthConfigured } from "./auth-client";
import { getMissions, listCampaigns, type CampaignList, type MissionList } from "./api";
import { needsSignIn } from "./errors";
import type { CampaignFailure } from "./types";

export type SessionState = { status: "waiting" } | { status: "signedOut" } | { status: "signedIn"; email: string | null; userId: string };

export function useCampaignSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "waiting" });
  useEffect(() => {
    if (!isCampaignAuthConfigured) {
      setState({ status: "signedOut" });
      return;
    }
    const auth = getCampaignAuth().auth;
    const apply = (s: { user: { id: string; email?: string | null } } | null) =>
      setState(s ? { status: "signedIn", email: s.user.email ?? null, userId: s.user.id } : { status: "signedOut" });
    void auth.getSession().then(({ data }) => apply(data.session));
    const { data } = auth.onAuthStateChange((_event, session) => apply(session));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

export type Loaded<T> =
  | { state: "waiting" | "signedOut" | "loading"; error: null; data: null; reload: () => void }
  | { state: "ready"; error: null; data: T; reload: () => void }
  | { state: "error"; error: CampaignFailure; data: null; reload: () => void };

function useRemote<T>(load: (() => Promise<{ ok: true; data: T } | CampaignFailure>) | null, key: string): Loaded<T> {
  const session = useCampaignSession();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; value: { ok: true; data: T } | CampaignFailure } | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const signedIn = session.status === "signedIn";

  useEffect(() => {
    if (!signedIn || !load) return;
    let cancelled = false;
    void load().then((value) => {
      if (!cancelled) setResult({ key: `${key}:${version}`, value });
    });
    return () => {
      cancelled = true;
    };
    // `load` is rebuilt every render; `key` + `version` say when to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, key, version]);

  if (session.status === "waiting") return { state: "waiting", error: null, data: null, reload };
  if (session.status === "signedOut") return { state: "signedOut", error: null, data: null, reload };
  // Keep showing the previous data while a reload is in flight; only a different key resets to loading.
  if (!result || !result.key.startsWith(`${key}:`)) return { state: "loading", error: null, data: null, reload };
  const value = result.value;
  if (!value.ok) {
    // A rejected session is "signed out" as far as the screens are concerned.
    if (needsSignIn(value.code)) return { state: "signedOut", error: null, data: null, reload };
    return { state: "error", error: value, data: null, reload };
  }
  return { state: "ready", error: null, data: value.data, reload };
}

export const useCampaignList = (): Loaded<CampaignList> => useRemote(listCampaigns, "list");

export const useCampaignMissions = (campaignId: string): Loaded<MissionList> => useRemote(() => getMissions(campaignId), `missions:${campaignId}`);
