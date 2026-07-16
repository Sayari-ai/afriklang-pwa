-- Fix ambiguous "cycle" reference in assign_path() and advance_path().
--
-- Both functions declare a `RETURNS TABLE (... cycle int ...)` clause,
-- which creates an implicit OUT parameter named `cycle` in scope for
-- the entire function body. The body also runs:
--
--   update public.paths_rotation
--      set next_index = ...,
--          cycle      = case when ... then v_rotation.cycle + 1
--                            else v_rotation.cycle end,
--
-- where the bare `cycle` on the right of `case when ... else ...` is
-- ambiguous: it could refer to (a) the OUT parameter, (b) the
-- `paths_rotation.cycle` column referenced by the SET target, or
-- (c) the `v_rotation.cycle` field. Postgres 14+ refuses to guess and
-- raises:
--
--   ERROR: column reference "cycle" is ambiguous
--
-- which surfaces from the Edge Function as
-- `{ "error": "rpc_failed", "message": "column reference \"cycle\" is
-- ambiguous" }` and breaks both first-time `paths_assign` AND every
-- `advance_path()` call.
--
-- Fix: pre-compute the next rotation values into local variables, so
-- the UPDATE only references column names + locals no bare
-- expression that PG could resolve to the OUT parameter. The OUT
-- parameter name `cycle` itself is preserved so the JSON return shape
-- stays binary-compatible with the deployed Flutter app and the PWA.

create or replace function public.assign_path(p_device_id uuid)
returns table (path_id smallint, cycle int, assigned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing       record;
  v_rotation       record;
  v_path_id        smallint;
  v_next_index     smallint;
  v_rotation_cycle int;
begin
  -- Idempotent: return the device's TOP cycle assignment if any exists.
  select dp.path_id, dp.cycle, dp.assigned_at
    into v_existing
    from public.device_paths dp
   where dp.device_id = p_device_id
   order by dp.cycle desc
   limit 1;

  if found then
    path_id := v_existing.path_id;
    cycle   := v_existing.cycle;
    assigned_at := v_existing.assigned_at;
    return next;
    return;
  end if;

  -- Atomic: lock the rotation row before reading next_index.
  select * into v_rotation
    from public.paths_rotation
   where id = 1
   for update;

  v_path_id := v_rotation.next_index;

  insert into public.device_paths (device_id, path_id, cycle)
       values (p_device_id, v_path_id, 1);

  -- Seed the cycle-1 progress vector: L1 current, L2..L8 locked.
  insert into public.device_progress (device_id, cycle, level_id, status)
  select p_device_id, 1, lvl,
         case when lvl = 1 then 'current' else 'locked' end
    from generate_series(1, 8) as lvl;

  -- Pre-compute next rotation values into locals so the UPDATE has no
  -- bare `cycle` expression that could be ambiguous against the OUT
  -- parameter of the same name.
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

  path_id := v_path_id;
  cycle   := 1;
  assigned_at := now();
  return next;
end;
$$;

revoke all on function public.assign_path(uuid) from public;
grant execute on function public.assign_path(uuid) to service_role;


create or replace function public.advance_path(p_device_id uuid)
returns table (path_id smallint, cycle int, assigned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top_cycle      int;
  v_completed      int;
  v_rotation       record;
  v_path_id        smallint;
  v_new_cycle      int;
  v_next_index     smallint;
  v_rotation_cycle int;
begin
  -- 1. Lock the device's top-cycle row to serialise concurrent advances.
  select max(dp.cycle) into v_top_cycle
    from public.device_paths dp
   where dp.device_id = p_device_id;

  if v_top_cycle is null then
    raise exception 'not_assigned'
      using errcode = 'P0002';
  end if;

  -- 2. Verify the top cycle is fully completed.
  select count(*) into v_completed
    from public.device_progress dp
   where dp.device_id = p_device_id
     and dp.cycle     = v_top_cycle
     and dp.status    = 'completed';

  if v_completed < 8 then
    raise exception 'cycle_incomplete: device % top cycle % has %/8 completed levels',
      p_device_id, v_top_cycle, v_completed
      using errcode = 'P0001';
  end if;

  -- 3. Take the next path from the global rotation.
  select * into v_rotation
    from public.paths_rotation
   where id = 1
   for update;

  v_path_id   := v_rotation.next_index;
  v_new_cycle := v_top_cycle + 1;

  insert into public.device_paths (device_id, path_id, cycle)
       values (p_device_id, v_path_id, v_new_cycle);

  -- Seed the new cycle's progress vector.
  insert into public.device_progress (device_id, cycle, level_id, status)
  select p_device_id, v_new_cycle, lvl,
         case when lvl = 1 then 'current' else 'locked' end
    from generate_series(1, 8) as lvl;

  -- Pre-compute next rotation values; same reasoning as assign_path().
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

  path_id := v_path_id;
  cycle   := v_new_cycle;
  assigned_at := now();
  return next;
end;
$$;

revoke all on function public.advance_path(uuid) from public;
grant execute on function public.advance_path(uuid) to service_role;
