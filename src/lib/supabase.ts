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
 *   - `persistSession: false` — we don't use Supabase auth; every Edge
 *     Function authenticates with the anon key plus our own
 *     `device_id` payload field. Persisting an empty session would just
 *     pollute localStorage.
 *   - `autoRefreshToken: false` — same reason.
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
 * Returns the singleton client. Throws if env vars aren't set —
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
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return _client;
}
