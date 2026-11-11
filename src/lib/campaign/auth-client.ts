"use client";

/**
 * Supabase client for the campaign area: a REAL, persistent session (Google sign-in with PKCE).
 *
 * The app's other client (lib/supabase.ts) deliberately keeps no session (it identifies a
 * device, not a person). Campaign contributors are people with an account, so they get their
 * own client; both talk to the same Supabase project.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { captureSignInReturn } from "./sign-in-return";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isCampaignAuthConfigured = URL_.length > 0 && ANON.length > 0;

/** Where supabase-js keeps this client's session on the phone. */
export const CAMPAIGN_AUTH_STORAGE_KEY = "afriklang.campaign.auth.v1";

let client: SupabaseClient | null = null;

export function getCampaignAuth(): SupabaseClient {
  if (!isCampaignAuthConfigured) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  if (client) return client;
  // Before the client reads (and strips) the address: why a sign-in came back without a session (APP2-11).
  captureSignInReturn();
  // The dev mock only in a development build with the mock on. Both values are inlined at build
  // time, so a production build drops this branch and the 800-line module with it (APP2-31).
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_CAMPAIGN_MOCK === "1") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("./dev-mock") as typeof import("./dev-mock")).installCampaignMock();
  }
  client = createClient(URL_, ANON, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      // Must stay `true`, not a function: supabase-js treats a function as the *implicit*-grant
      // test, so a PKCE "?code=" would be rejected and never exchanged (endless sign-in screen).
      // Only codes whose verifier this client stored (under its own storageKey) are exchanged.
      detectSessionInUrl: true,
      storageKey: CAMPAIGN_AUTH_STORAGE_KEY,
    },
  });
  return client;
}

/**
 * The current access token, or undefined when signed out. `renew` asks Auth for a fresh one
 * (after a server answered 401 to a token the client still thought valid).
 */
export async function campaignAccessToken(renew = false): Promise<string | undefined> {
  try {
    const auth = getCampaignAuth().auth;
    if (renew) {
      const { data, error } = await auth.refreshSession();
      return error ? undefined : data.session?.access_token;
    }
    return (await auth.getSession()).data.session?.access_token;
  } catch {
    return undefined;
  }
}

/**
 * The person whose session is saved on this phone, read without the network and without checking
 * it (APP-003). supabase-js keeps the saved session when a renewal fails for a network reason and
 * deletes it when Auth refuses it, so "a saved session with a refresh token" after getSession()
 * answered null means: a known speaker who is offline, not a signed-out one.
 */
export function storedCampaignUser(): { id: string; email: string | null } | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(CAMPAIGN_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { refresh_token?: unknown; user?: { id?: unknown; email?: unknown } } | null;
    if (!s || typeof s.refresh_token !== "string" || !s.refresh_token) return null;
    const id = s.user?.id;
    if (typeof id !== "string" || !id) return null;
    return { id, email: typeof s.user?.email === "string" ? s.user.email : null };
  } catch {
    return null;
  }
}

/** Start Google sign-in and come back to `returnPath` (same origin). */
export async function signInWithGoogle(returnPath = "/campaign"): Promise<void> {
  const target = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/campaign";
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_CAMPAIGN_MOCK === "1") {
    localStorage.removeItem("afriklang.mock.signedOut");
    return window.location.assign(target);
  }
  const { error } = await getCampaignAuth().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${target}`, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

/**
 * Set when the speaker signs out themselves, removed at the next sign-in: a link opened after
 * that asks to sign in without saying the session expired (session-memory.ts). Kept on the phone
 * so a sign-out in another tab, and the reload after it, see it too.
 */
const SIGNED_OUT_ON_PURPOSE_KEY = "afriklang.campaign.signedOutOnPurpose.v1";

export function signedOutOnPurpose(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_ON_PURPOSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function forgetSignOut(): void {
  try {
    localStorage.removeItem(SIGNED_OUT_ON_PURPOSE_KEY);
  } catch {
    // storage blocked: nothing was saved
  }
}

/**
 * Sign out on this phone (APP-008). Scope "local": the default "global" would also sign the speaker
 * out of every other device. Online, this session is revoked on the server too. supabase-js keeps
 * the saved session when that call fails (offline, bad network), so the saved session is then
 * removed here by hand: signing out on a shared phone must work without a network.
 * The caller reloads the page afterwards (the client still holds the session in memory).
 */
export async function signOut(): Promise<void> {
  try {
    // Before the session goes: the "signed out" event it fires must already read it.
    localStorage.setItem(SIGNED_OUT_ON_PURPOSE_KEY, "1");
  } catch {
    // storage blocked: the screens then say the session expired, which is only less precise
  }
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_CAMPAIGN_MOCK === "1") {
    try {
      localStorage.setItem("afriklang.mock.signedOut", "1");
    } catch {
      // ignore
    }
  }
  try {
    await getCampaignAuth().auth.signOut({ scope: "local" });
  } catch {
    // removed below
  }
  try {
    localStorage.removeItem(CAMPAIGN_AUTH_STORAGE_KEY);
    localStorage.removeItem(`${CAMPAIGN_AUTH_STORAGE_KEY}-code-verifier`);
    localStorage.removeItem(`${CAMPAIGN_AUTH_STORAGE_KEY}-user`);
  } catch {
    // storage blocked: nothing was saved there either
  }
}
