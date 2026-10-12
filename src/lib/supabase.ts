"use client";

/**
 * Supabase browser client (singleton).
 *
 * Mirrors `lib/core/supabase/supabase_init.dart`:
 *   - URL + anon key are baked in at build time via `NEXT_PUBLIC_*` env vars
 *     (the equivalent of `--dart-define`).
 *   - We do NOT throw when keys are missing. Instead `isSupabaseConfigured`
 *     stays false and the path-setup screen surfaces a friendly error
 *     (the `pathSetupBackendNotConfigured` ICU message we already ported).
 *
 * Storage / auth options:
 *   - `persistSession: true` Google sign-in (Supabase Auth) is now
 *     required before path-setup, so the session must survive reloads.
 *     supabase-js stores it under its own `sb-<ref>-auth-token`
 *     localStorage key (managed by the SDK, not `StorageKeys`).
 *   - `autoRefreshToken: true` keep the session alive in the
 *     background while the PWA is open.
 *   - `detectSessionInUrl: false` Google sign-in is finished by the
 *     campaign client (lib/campaign/auth-client.ts), see below.
 *
 * Edge Functions keep authenticating with the anon key plus our own
 * `device_id` payload field `user_id` attribution is a server-side
 * concern (see `supabase/migrations/00007_events.sql`).
 *
 * We expose the bare client (`supabase`) plus a `functions` helper that
 * matches the Flutter call-site shape (`functions.invoke(name, ...)`)
 * so the API wrappers can be 1:1 ports.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

let _client: SupabaseClient | null = null;

/**
 * Returns the singleton client. Throws if env vars aren't set 
 * callers should gate behind `isSupabaseConfigured` first.
 */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and rebuild.",
    );
  }
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The speaker app signs in through the campaign client (lib/campaign/auth-client.ts), which
      // finishes Google's sign-in on /campaign. This client must never try to exchange a sign-in
      // code: it does not hold the code verifier, and "/" and "/login" forward the code to
      // /campaign.
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return _client;
}
