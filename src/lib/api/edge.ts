"use client";

/**
 * Edge Function invocation helper.
 *
 * The Supabase JS client returns `{ data, error }` from
 * `functions.invoke()`, which is awkward to use directly: a non-2xx
 * response surfaces as `error: FunctionsHttpError` and the body lives
 * on `error.context.json()`. This helper normalises both paths into a
 * single throw with a parsed message, matching the Flutter
 * `_ensureOk()` pattern across `paths_api.dart`, `progress_api.dart`,
 * and `leaderboard_api.dart`.
 *
 * We pass `device_id` as a body field for POSTs and a query parameter
 * for GETs — exactly like the Flutter calls.
 */

import { FunctionsHttpError } from "@supabase/supabase-js";

import { getSupabase } from "../supabase";

export class EdgeFunctionError extends Error {
  constructor(
    public readonly fn: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EdgeFunctionError";
  }
}

interface InvokeOptions {
  /** Defaults to `'POST'`. Use `'GET'` for read-only endpoints. */
  method?: "GET" | "POST";
  /** JSON body for POST. */
  body?: Record<string, unknown>;
  /** Query string for GET. */
  query?: Record<string, string>;
}

export async function invokeEdge<T = unknown>(
  fn: string,
  opts: InvokeOptions = {},
): Promise<T> {
  const supabase = getSupabase();
  const { method = "POST", body, query } = opts;

  // The JS client exposes query params via the `body` shape for GETs
  // through a special URL-rewriting branch; safest to append manually.
  const fnName = query
    ? `${fn}?${new URLSearchParams(query).toString()}`
    : fn;

  const { data, error } = await supabase.functions.invoke(fnName, {
    method,
    body: method === "POST" ? body : undefined,
  });

  if (error) {
    // FunctionsHttpError bundles the original Response so we can read
    // a `{message,error}` body the same way Flutter does.
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status ?? 0;
      let detail = error.message;
      try {
        const json = (await error.context.json()) as
          | { message?: unknown; error?: unknown }
          | undefined;
        const m = json?.message ?? json?.error;
        if (typeof m === "string" && m.length > 0) detail = m;
      } catch {
        // body wasn't JSON — keep the default message
      }
      throw new EdgeFunctionError(fn, status, `${fn} failed (${status}): ${detail}`);
    }
    // Non-HTTP errors (network/timeout/etc.) — no status available.
    throw new EdgeFunctionError(fn, 0, `${fn} failed: ${error.message}`);
  }

  return data as T;
}
