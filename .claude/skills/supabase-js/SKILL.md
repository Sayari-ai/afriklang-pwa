---
name: supabase-js
description: Supabase JavaScript client v2 createClient, edge function invocation, PostgREST queries, storage, auth, realtime. USE FOR: calling supabase.functions.invoke(), creating the browser client, wiring Database type generics, parsing FunctionsHttpError, querying tables via .from(), uploading to storage buckets, handling the {data, error} return shape. DO NOT USE FOR: server-side admin operations (this project uses anon key only no service-role usage), realtime channels (not used in this project), Supabase Auth flows (this project disables persistSession).
---

# @supabase/supabase-js@^2.105.1

## When to use

This project uses `@supabase/supabase-js` for exactly one thing: **invoking Supabase Edge Functions** from the browser. All backend reads and writes (paths, progress, leaderboard, nickname) go through Edge Functions named `paths_assign`, `paths_get`, `progress_get`, `progress_set`, `leaderboard_get`, `nickname_set` via `supabase.functions.invoke()` wrapped by `invokeEdge()` in `src/lib/api/edge.ts`.

The project does **NOT** use:
- `.from(...)` PostgREST queries (no direct table access every read/write is an Edge Function)
- `supabase.storage` (audio files go to Sayari, not Supabase Storage; uploaded via a same-origin Next.js Route Handler proxy at `/api/audio-upload` see `src/lib/api/audio.ts` and `src/app/api/audio-upload/route.ts`)
- `supabase.auth` (auth is disabled `persistSession: false`, `autoRefreshToken: false`; identity is a self-issued `device_id` UUID passed in every Edge Function payload)
- `supabase.realtime` / channels (not used the home map polls via `boot({ forceRefresh })` instead)
- `.rpc(...)` (the SQL `advance_path()` RPC is invoked server-side by the `paths_assign` Edge Function, not from the browser)

Reach for this skill when:
- Adding a new Edge Function call → extend `invokeEdge()` consumers in `src/lib/api/`
- Debugging a `FunctionsHttpError` understand the `error.context: Response` shape
- Wiring `Database` typegen for future direct PostgREST access (not yet adopted)
- Touching `src/lib/supabase.ts` (the singleton client)

## API reference

### `createClient(url, anonKey, options?)`

Factory for a `SupabaseClient`. The project's call site is `src/lib/supabase.ts:47`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,     // we don't use Supabase auth
    autoRefreshToken: false,   // ditto
    detectSessionInUrl: false, // no OAuth callback
  },
});
```

Useful options:
- `auth.persistSession` store session in `localStorage` (default `true`). Off here.
- `auth.storage` custom storage adapter (e.g. `cookies` for SSR). Not used.
- `global.headers` extra headers on every request.
- `global.fetch` custom `fetch` (e.g. `node-fetch`, instrumented `fetch`).
- `db.schema` default to a non-`public` schema.
- `realtime.params` websocket config. Unused.

**Anon key vs service role:** the browser client must use the **anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Service-role keys bypass Row Level Security and must never ship to the client. This project does not use the service role anywhere Edge Functions run with the user's JWT (here, the anon JWT) and consult `device_id` from the payload for authorization.

### `supabase.functions.invoke(name, options?)`

Call an Edge Function. Returns `{ data, error }`.

```ts
const { data, error } = await supabase.functions.invoke("paths_assign", {
  method: "POST",
  body: { device_id: deviceId },
});
```

Options:
- `method` `"POST"` (default), `"GET"`, `"PUT"`, `"PATCH"`, `"DELETE"`. The project uses POST and GET.
- `body` auto-JSON-stringified for `POST`. Pass `FormData` to send multipart.
- `headers` extra headers (Authorization is added automatically).

**Query params on GET:** the JS client has historically had quirks around how query strings are passed. The project sidesteps this by appending `?key=value` directly to the function name:

```ts
// src/lib/api/edge.ts:51-53
const fnName = query
  ? `${fn}?${new URLSearchParams(query).toString()}`
  : fn;
```

**Error shape:** non-2xx responses surface as `error: FunctionsHttpError`, **not** thrown. Read body via `error.context`:

```ts
import { FunctionsHttpError } from "@supabase/supabase-js";

if (error instanceof FunctionsHttpError) {
  const status = error.context?.status ?? 0;        // e.g. 409
  const body = await error.context.json();          // { message, error, ... }
}
```

`error.context` is the raw `Response` read it once (`json()` or `text()`), not both. Other error subclasses: `FunctionsRelayError`, `FunctionsFetchError`.

### `supabase.from(table)` (NOT used in this project)

PostgREST query builder. Documented for completeness:

```ts
// SELECT
const { data, error } = await supabase
  .from("levels")
  .select("id, title, status")
  .eq("path_id", 3)
  .in("status", ["current", "completed"])
  .order("id", { ascending: true })
  .limit(50);

// .single() expect exactly one row, error otherwise
// .maybeSingle() expect 0 or 1 rows, null if 0

// INSERT
const { data, error } = await supabase
  .from("levels")
  .insert({ path_id: 3, title: "Hello" })
  .select()      // return the inserted row
  .single();

// UPDATE
await supabase.from("levels").update({ status: "completed" }).eq("id", 7);

// UPSERT (insert-or-update by primary key / unique index)
await supabase
  .from("progress")
  .upsert({ device_id, level_id, status }, { onConflict: "device_id,level_id" });

// DELETE
await supabase.from("levels").delete().eq("id", 7);
```

Modifiers: `.eq`, `.neq`, `.gt`, `.gte`, `.lt`, `.lte`, `.like`, `.ilike`, `.is`, `.in`, `.contains`, `.containedBy`, `.range`, `.match`, `.not`, `.or`, `.filter`, `.order`, `.limit`, `.range(from,to)`.

### `supabase.rpc(name, args)` (NOT used in this project)

Invokes a Postgres function. Returns `{ data, error }` like `.from()`.

```ts
const { data, error } = await supabase.rpc("advance_path", { p_device_id: deviceId });
```

### `supabase.storage` (NOT used in this project)

```ts
// Upload
const { data, error } = await supabase.storage
  .from("avatars")
  .upload(`${userId}/avatar.png`, file, {
    contentType: "image/png",
    upsert: true,
  });

// Public URL (public bucket only)
const { data } = supabase.storage.from("avatars").getPublicUrl(`${userId}/avatar.png`);
// data.publicUrl

// Signed URL (private bucket)
const { data } = await supabase.storage
  .from("private")
  .createSignedUrl("path/file.png", 60 /* seconds */);

// Download
const { data: blob } = await supabase.storage.from("avatars").download(`${userId}/avatar.png`);
```

### `supabase.auth` (disabled here)

Common methods (for reference): `signInWithPassword`, `signInWithOtp`, `signUp`, `signOut`, `getSession`, `getUser`, `onAuthStateChange`, `setSession`, `refreshSession`. The project disables session persistence and never calls these.

### `supabase.channel(name)` realtime (NOT used in this project)

Realtime is not used in this project note that briefly: the home map and leaderboard re-fetch via `boot({ forceRefresh })` rather than subscribing to row changes. If you need realtime later: `supabase.channel("x").on("postgres_changes", { event: "*", schema: "public", table: "..." }, cb).subscribe()`.

## Common patterns (project-specific)

### Singleton browser client (lazy)

```ts
// src/lib/supabase.ts
let _client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured...");
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }});
  return _client;
}
```

### Normalised Edge Function wrapper

The project converts the `{ data, error }` pattern into throw-on-error so call sites read top-to-bottom (see `src/lib/api/edge.ts`):

```ts
const { data, error } = await supabase.functions.invoke(fnName, { method, body });
if (error) {
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status ?? 0;
    let detail = error.message;
    try {
      const json = await error.context.json() as { message?: string; error?: string };
      detail = json?.message ?? json?.error ?? detail;
    } catch { /* not JSON */ }
    throw new EdgeFunctionError(fn, status, `${fn} failed (${status}): ${detail}`);
  }
  throw new EdgeFunctionError(fn, 0, `${fn} failed: ${error.message}`);
}
return data as T;
```

A status of `0` is the project's convention for "no HTTP response" used by the offline progress queue runner (`src/lib/storage/progress-queue-runner.ts:167`) to distinguish transient network failures from permanent backend rejections.

### Audio-upload exception

Sayari (the audio backend) is **not** Supabase Storage. Uploads go to a same-origin Next.js Route Handler at `/api/audio-upload` (`src/lib/api/audio.ts`). The handler proxies to Sayari server-side because Sayari's CORS allowlist only includes `localhost:3000`. Don't try to wedge audio uploads through `supabase.storage`.

### Type safety with `Database` generic

Generate types from your Supabase project once direct PostgREST access is needed:

```sh
npx supabase gen types typescript --project-id <ref> --schema public > src/lib/database.types.ts
```

```ts
import { type Database } from "@/lib/database.types";
const supabase = createClient<Database>(url, key);
// .from("levels") is now strongly typed
```

This project doesn't generate types yet because it never calls `.from()`. If a future feature needs direct PostgREST, wire the generic in `src/lib/supabase.ts` and re-typegen on schema changes.

## Gotchas

- **`{ data, error }` is never thrown.** Forgetting to check `error` will silently treat a `FunctionsHttpError` as success. The `invokeEdge` wrapper exists precisely to convert this to throw-on-error.
- **`error.context` is a `Response`, single-shot.** Calling `.json()` twice throws "body stream already read". Read once and stash.
- **Don't set `Content-Type` on multipart bodies.** When passing `FormData`, let the runtime add the boundary header. (Relevant for any future direct multipart Edge Function call.)
- **Anon key is public** it's safe to ship to the browser. RLS policies + Edge Function logic enforce authorization.
- **Service-role key must never be in `NEXT_PUBLIC_*`.** Service-role usage belongs in Edge Functions or Route Handlers only.
- **GET query string quirks** pass via `?k=v` appended to the function name (this project's pattern), or be aware that some builder versions URL-encode `body` on GET.
- **`persistSession: false` means no auto Authorization refresh.** Fine here; Edge Functions trust the anon JWT and the payload `device_id`.
- **`createClient` is cheap but not free.** Make it a module-level singleton multiple clients fragment the realtime websocket and auth listener.
- **PostgREST `.single()` errors when 0 rows are returned** use `.maybeSingle()` if zero is valid.
- **Realtime reconnection is automatic** but websocket failures show up as silent `subscribe()` callback states, not thrown errors. The project sidesteps the whole surface by polling.

## References

- API wrapper: `src/lib/api/edge.ts`
- Browser client singleton: `src/lib/supabase.ts`
- Edge Function consumers: `src/lib/api/{paths,progress,leaderboard,nickname}.ts`
- Audio upload (NOT supabase-js): `src/lib/api/audio.ts`, `src/app/api/audio-upload/route.ts`
- Offline progress queue runner: `src/lib/storage/progress-queue-runner.ts`
- Upstream docs: https://supabase.com/docs/reference/javascript/introduction
- Type generation: https://supabase.com/docs/guides/api/rest/generating-types
