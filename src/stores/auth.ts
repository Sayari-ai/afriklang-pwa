"use client";

/**
 * Auth session store Google sign-in via Supabase Auth (PKCE).
 *
 * The app's identity model is layered:
 *   - `device_id` (see `device-identity.ts`) remains the key every
 *     Edge Function call is authorized with nothing changes there.
 *   - The Google account session gates *access* to the app: the splash
 *     gate and `<AppRouteGuard>` refuse to route past `/login` until a
 *     session exists. Server-side device→account linking is a separate
 *     backend project (see `supabase/migrations/00007_events.sql`).
 *
 * Session persistence is owned by supabase-js (`persistSession: true`
 * in `src/lib/supabase.ts`) this store only mirrors the session into
 * Zustand so screens get the usual dual API:
 *
 *   reactive:   const user = useAuth((s) => s.user);
 *   imperative: await useAuth.getState().signInWithGoogle();
 *
 * `hydrate()` is async (unlike the localStorage-backed stores) because
 * `getSession()` must await the client's initialization which is
 * also where the OAuth `?code=` exchange happens after the Google
 * redirect lands back on `/login`. Gates must therefore check
 * `useAuth.hydrated` in addition to the synchronous stores' flags.
 */

import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";

import { track } from "@/lib/api/events";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/** Minimal projection of the Supabase user all the UI ever needs. */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mapSession(session: Session | null): AuthUser | null {
  const user = session?.user;
  if (!user) return null;
  // Google populates `user_metadata` with `full_name` / `name` and
  // `avatar_url` / `picture` depending on the provider version take
  // whichever is present.
  const meta: Record<string, unknown> = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    name: asNonEmptyString(meta.full_name) ?? asNonEmptyString(meta.name),
    avatarUrl:
      asNonEmptyString(meta.avatar_url) ?? asNonEmptyString(meta.picture),
  };
}

interface AuthState {
  /** Signed-in Google user, or null. Null until `hydrated` is true. */
  user: AuthUser | null;
  /** True once the initial `getSession()` (incl. OAuth code exchange) resolved. */
  hydrated: boolean;
  /**
   * Restore the persisted session and subscribe to auth changes.
   * Idempotent; called once by `<AppHydration>`. Never rejects a
   * failed restore degrades to signed-out rather than hanging the
   * splash gate.
   */
  hydrate: () => Promise<void>;
  /**
   * Start the Google OAuth redirect flow. On success the browser
   * navigates away to Google callers should hold their busy state
   * until unload. Throws on failure (backend unconfigured, provider
   * misconfigured, offline) so the login screen can surface an error.
   */
  signInWithGoogle: () => Promise<void>;
  /** End the session. The auth listener resets `user` to null. */
  signOut: () => Promise<void>;
}

// `hydrate()` is async, so the `hydrated` flag alone can't dedupe
// concurrent calls module-level guard, same idea as the
// `appOpenTracked` latch in `app-hydration.tsx`.
let hydrateStarted = false;

export const useAuth = create<AuthState>()((set, get) => ({
  user: null,
  hydrated: false,

  hydrate: async () => {
    if (hydrateStarted) return;
    hydrateStarted = true;

    // No backend → behave like the rest of the app: don't hang, let
    // the login screen render and surface the config error on tap.
    if (!isSupabaseConfigured) {
      set({ user: null, hydrated: true });
      return;
    }

    const supabase = getSupabase();

    // Keep the store in lockstep with the SDK for the whole app
    // lifetime (sign-in on another tab, token refresh, sign-out).
    // Subscribed before `getSession()` so the SIGNED_IN emitted by the
    // OAuth code exchange is never missed.
    supabase.auth.onAuthStateChange((event, session) => {
      const prev = get().user;
      const next = mapSession(session);
      set({ user: next });
      // A real transition into a session not INITIAL_SESSION on
      // boot, not a token refresh is the "login completed" moment.
      if (event === "SIGNED_IN" && prev === null && next !== null) {
        track("login_success");
      }
    });

    try {
      const { data } = await supabase.auth.getSession();
      set({ user: mapSession(data.session), hydrated: true });
    } catch {
      set({ user: null, hydrated: true });
    }
  },

  signInWithGoogle: async () => {
    // Throws with a descriptive message when env vars are missing.
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Land back on the login screen: it holds render while the
        // code exchange runs, then bounces to the splash gate which
        // owns the funnel decision tree.
        redirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) throw error;
  },

  signOut: async () => {
    if (!isSupabaseConfigured) return;
    try {
      await getSupabase().auth.signOut();
    } finally {
      // Belt-and-braces: the listener also clears it, but never leave
      // a ghost session in the store if the network call failed.
      set({ user: null });
    }
  },
}));
