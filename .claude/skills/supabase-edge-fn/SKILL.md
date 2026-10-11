---
name: supabase-edge-fn
description: Workflow for the afriklang-mobile Supabase backend (Postgres + Deno Edge Functions) and the contracts the PWA consumes. USE FOR: writing or modifying Supabase migrations, adding/editing Edge Functions under supabase/functions/, changing RPC contracts (assign_path, advance_path, award_points, progress_set), per-device cycle semantics, the cycle_incomplete sentinel, deploying functions/migrations, debugging "column reference ambiguous" errors, the legacy-vs-multicycle response shape, and curl-testing edge endpoints. Trigger phrases: "edge function", "supabase migration", "assign_path", "advance_path", "progress_set", "cycle_incomplete", "rpc contract", "device_paths", "device_progress", "supabase db push", "supabase functions deploy". DO NOT USE FOR: PWA-only client work (use audio-flow for the recording pipeline; pwa-cache-bust for SW issues), Supabase auth/RLS for non-service-role users, or generic Postgres tutorials.
---

# Supabase Edge Function + Migration workflow

This project's backend lives in the sibling repo `afriklang-mobile/supabase/`. The PWA consumes the Edge Function HTTP contract; the Flutter app consumes the same contract. **Do not break it without coordinating both clients.**

## Repo layout

```
afriklang-mobile/supabase/
  migrations/                         # NNNNN_description.sql (5-digit pad)
    00001_init.sql
    00002_leaderboard.sql
    00003_multicycle.sql
    00004_fix_cycle_ambiguity.sql
  functions/
    _shared/util.ts                   # corsHeaders, errorResponse, jsonResponse, isUuid, serviceClient
    paths_assign/index.ts
    progress_set/index.ts
    leaderboard_top/index.ts
    nickname_set/index.ts
```

## Composite-key invariants (read this BEFORE touching SQL)

After migration `00003_multicycle.sql`:

- `device_paths` PK = **`(device_id, cycle)`**
- `device_progress` PK = **`(device_id, cycle, level_id)`**
- `device_progress` FK → `device_paths(device_id, cycle)` ON DELETE CASCADE
- `cycle` is **1-based PER DEVICE** (NOT the global rotation counter). The global rotation counter still exists as `paths_rotation.cycle` but never leaks into per-device rows.
- Every WHERE / UPDATE / INSERT on these tables MUST include `cycle` or you'll touch the wrong row once a device has advanced.

If you see code keyed on `(device_id, level_id)` only, it is from before 00003 and is broken fix it.

## Naming gotcha: never name a SQL local var `cycle`

`assign_path()` and `advance_path()` declare `RETURNS TABLE (... cycle int ...)`. PL/pgSQL treats every OUT column as a variable in scope for the entire body. So this:

```sql
update public.paths_rotation
   set cycle = case when ... then v_rotation.cycle + 1 else v_rotation.cycle end
```

raises `ERROR: column reference "cycle" is ambiguous` Postgres can't decide between (a) the OUT param, (b) `paths_rotation.cycle` (the SET target), (c) `v_rotation.cycle`. This is exactly what `00004_fix_cycle_ambiguity.sql` fixed.

**Rules:**

1. Always prefix locals with `v_` (e.g. `v_cycle`, `v_top_cycle`, `v_new_cycle`, `v_rotation_cycle`).
2. In SELECT/UPDATE bodies, qualify columns with table aliases: `select max(dp.cycle) from public.device_paths dp`.
3. If you must reference an OUT param column name in an UPDATE's RHS, **pre-compute into a `v_*` local** and reference the local in the SET exactly like 00004 does:

```sql
if v_rotation.next_index = 20 then
  v_next_index     := 1;
  v_rotation_cycle := v_rotation.cycle + 1;
else
  v_next_index     := v_rotation.next_index + 1;
  v_rotation_cycle := v_rotation.cycle;
end if;

update public.paths_rotation
   set next_index = v_next_index,
       cycle      = v_rotation_cycle,
       updated_at = now()
 where id = 1;
```

## OUT-param shape preservation

The OUT param **names** of `assign_path()` and `advance_path()` (`path_id smallint, cycle int, assigned_at timestamptz`) are baked into the JSON the Edge Function returns. The Flutter app and PWA both deserialise by key. **Never rename or reorder these.** Adding a new column at the end is the only safe extension, and even then both clients must tolerate the new field (the deployed Flutter build may not).

## The `cycle_incomplete` sentinel → HTTP 409

`advance_path()` raises:

```sql
raise exception 'cycle_incomplete: device % top cycle % has %/8 completed levels',
  p_device_id, v_top_cycle, v_completed
  using errcode = 'P0001';
```

The Edge Function does a **case-insensitive substring match** on the error message and returns 409:

```ts
const msg = (error.message ?? "").toLowerCase();
if (msg.includes("cycle_incomplete")) {
  return errorResponse("cycle_incomplete", "Current cycle has unfinished levels; cannot advance", 409);
}
if (msg.includes("not_assigned")) {
  return errorResponse("not_assigned", "Device has no path assignment; call paths_assign first", 404);
}
```

Don't change the sentinel string without changing both ends in the same PR.

## Legacy-by-default contract (Flutter compat)

`paths_assign` accepts `{ device_id, advance? }` where `advance` defaults to `false`. The deployed Flutter app calls without `advance` and expects a single-path response that's the legacy contract. The PWA opts into multi-cycle behaviour via the `?multicycle=1` query param on read endpoints. **Never flip the default.** When in doubt, default to legacy and let the PWA opt in.

## Edge Function template

Every function in this repo follows the same shape:

```ts
// POST /functions/v1/<name>
// Body: { ... }
import { corsHeaders, errorResponse, isUuid, jsonResponse, serviceClient } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405);
  }

  let payload: { device_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return errorResponse("bad_json", "Body must be JSON", 400);
  }

  if (!isUuid(payload.device_id)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }

  const supabase = serviceClient();             // service-role client; bypasses RLS
  const { data, error } = await supabase.rpc("my_rpc", { p_device_id: payload.device_id });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("my_sentinel")) {
      return errorResponse("my_sentinel", "Friendly explanation", 409);
    }
    console.error("my_rpc failed", error);
    return errorResponse("rpc_failed", error.message, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return errorResponse("rpc_empty", "my_rpc returned no row", 500);

  return jsonResponse({ /* explicitly shape the response */ });
});
```

Imports: `_shared/util.ts` already pins `deno.land/std` and `@supabase/supabase-js` versions. Don't add new dependencies casually every new import is a cold-start cost on Deno Deploy.

## Playbook: ADD a new edge function

1. Pick a name. Use `verb_noun` snake_case (`paths_assign`, `progress_set`, `nickname_set`). Match the Flutter `*_api.dart` naming.
2. Create `supabase/functions/<name>/index.ts` from the template above.
3. If it touches new tables/columns or adds an RPC, write a migration: `supabase/migrations/NNNNN_short_description.sql` (next 5-digit number, lowercase, snake_case). Wrap in `begin; ... commit;`.
4. Apply locally: `supabase db reset` (rebuilds from all migrations) or `supabase db push` (applies new migrations to the linked project).
5. Add a PWA client function in `src/lib/api/<feature>.ts` that calls `invokeEdge<T>("<name>", { body: {...} })`. Mirror the response shape with a typed interface.
6. Test with curl (see below) before wiring the PWA call.
7. Deploy: `supabase functions deploy <name> --project-ref elosonbrvmsfgrxemtso`.

## Playbook: MODIFY a contract

This is the dangerous one. The Flutter app is in production and cannot be force-updated.

1. Decide: is this **additive** (safe) or **breaking** (requires a new function name)?
   - Additive: new optional request field, new response field appended at the end.
   - Breaking: renamed field, removed field, type change, semantic change.
2. For breaking changes, **don't modify the existing function** create `paths_assign_v2` and let the PWA migrate first. Retire the v1 only after Flutter has shipped a build that uses v2.
3. For additive changes:
   - Edit the SQL function. **Preserve OUT param names and order.** Add new columns at the end.
   - Edit the Edge Function to surface the new field.
   - Edit `src/lib/api/edge.ts` callers in the PWA.
   - Confirm the Flutter app's parser is permissive (most are they ignore unknown JSON keys).
4. Migration: `supabase/migrations/NNNNN_description.sql`. Use `create or replace function` never `drop function` unless you're also dropping every signature variant (see 00003 dropping the 2-arg `award_points` after creating the 3-arg version with a default).
5. `supabase db push` then `supabase functions deploy <name> --project-ref elosonbrvmsfgrxemtso`.
6. Smoke-test with curl AND with both clients pointed at the deployed function.

## Deploy commands

```bash
# Migrations: applies any new files in supabase/migrations/ to the linked project.
supabase db push

# Single function deploy (preferred faster, smaller blast radius).
supabase functions deploy paths_assign --project-ref elosonbrvmsfgrxemtso

# Deploy all functions (use sparingly; cold-starts every function).
supabase functions deploy --project-ref elosonbrvmsfgrxemtso

# Tail logs for a function (Deno Deploy):
supabase functions logs paths_assign --project-ref elosonbrvmsfgrxemtso
```

The `--project-ref` is `elosonbrvmsfgrxemtso` for prod. Local dev uses `supabase start` + `supabase functions serve <name>`.

## curl testing

Anon key is fine for invoking edge functions (the function uses the service-role key internally via `serviceClient()`):

```bash
SB_URL=https://elosonbrvmsfgrxemtso.supabase.co
ANON=<anon-key-from-dashboard>

# Legacy assign (Flutter contract):
curl -X POST "$SB_URL/functions/v1/paths_assign" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"00000000-0000-0000-0000-000000000001"}'

# Advance (PWA after cycle complete):
curl -X POST "$SB_URL/functions/v1/paths_assign" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"00000000-0000-0000-0000-000000000001","advance":true}'
# Expect 409 with {"error":"cycle_incomplete",...} if the top cycle isn't all 8 done.

# Progress set (legacy no cycle, server resolves to top cycle):
curl -X POST "$SB_URL/functions/v1/progress_set" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"00000000-0000-0000-0000-000000000001","level_id":1,"status":"completed"}'

# Progress set (PWA explicit cycle):
curl -X POST "$SB_URL/functions/v1/progress_set" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"...","cycle":2,"level_id":3,"status":"completed"}'
```

If you get `{"error":"rpc_failed","message":"column reference \"cycle\" is ambiguous"}` → see the naming gotcha above.

## Reading from the PWA side

The PWA wraps everything in `src/lib/api/edge.ts`'s `invokeEdge<T>(fn, opts)` helper, which:

- POSTs JSON body or builds a query string for GET.
- Unwraps `FunctionsHttpError` and tries to parse `{message, error}` from the body.
- Throws `EdgeFunctionError(fn, status, message)` callers `catch` and `instanceof`-check this to map status codes (404 → "no assignment", 409 → "cycle incomplete", etc.).

When you change a contract, search for the function name in `src/lib/api/` and update both the request shape AND the typed response.
