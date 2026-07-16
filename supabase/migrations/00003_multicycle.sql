-- Multi-cycle support + per-device nicknames.
--
-- Run: `supabase db push` after migration 00002.
--
-- =====================================================================
-- SEMANTIC CHANGE: `cycle` is now a PER-DEVICE counter.
--
-- Until now, `device_paths.cycle` recorded whatever the GLOBAL rotation
-- counter happened to be at the moment a device was first assigned a
-- path. That number was effectively meaningless to the device itself
-- (different devices saw different "cycle 7"s depending on assignment
-- order).
--
-- From this migration on, `cycle` is a 1-based PER-DEVICE counter:
--   cycle = 1  → the device's first path.
--   cycle = 2  → the device's second path (issued via advance_path()
--                after they completed all 8 levels of cycle 1).
--   cycle = N  → the device's N-th path.
--
-- The global rotation counter (`paths_rotation.cycle`) still exists and
-- is unchanged in meaning it just no longer leaks into the per-device
-- column. We retain it so `paths_rotation.next_index` stays well-defined.
--
-- For currently-assigned devices we rewrite their `device_paths.cycle`
-- to 1 (everyone is on their first per-device cycle). Their progress
-- rows in `device_progress` get the same.
--
-- =====================================================================

begin;

-- =====================================================================
-- 1. Backfill: clamp existing rows to per-device cycle = 1 BEFORE we
--    change keys. Currently every device has at most one row in
--    device_paths and 8 rows in device_progress, all sharing the same
--    (now-misnamed) `cycle` value. Coalesce them to 1.
-- =====================================================================
update public.device_paths set cycle = 1;

-- device_progress doesn't yet have a `cycle` column. We'll add it next
-- with default 1, which suits the existing rows.
alter table public.device_progress
  add column if not exists cycle int not null default 1
  check (cycle >= 1);

-- =====================================================================
-- 2. Replace device_paths primary key: (device_id) → (device_id, cycle).
--    `cycle` already exists on the table. Drop the old FK in
--    device_progress first, since it points at device_paths(device_id).
-- =====================================================================

-- 2a. Drop child FK so we can change the parent's PK shape.
alter table public.device_progress
  drop constraint if exists device_progress_device_id_fkey;

-- 2b. Swap PK on device_paths.
alter table public.device_paths
  drop constraint if exists device_paths_pkey;

alter table public.device_paths
  add constraint device_paths_pkey
  primary key (device_id, cycle);

-- =====================================================================
-- 3. Replace device_progress primary key:
--    (device_id, level_id) → (device_id, cycle, level_id).
-- =====================================================================
alter table public.device_progress
  drop constraint if exists device_progress_pkey;

alter table public.device_progress
  add constraint device_progress_pkey
  primary key (device_id, cycle, level_id);

-- 3b. Recreate child FK against the new composite parent PK.
alter table public.device_progress
  add constraint device_progress_device_paths_fkey
  foreign key (device_id, cycle)
  references public.device_paths (device_id, cycle)
  on delete cascade;

-- =====================================================================
-- 4. award_points(): now keyed on (device_id, cycle, level_id). Cycle
--    parameter defaults to the device's TOP per-device cycle so that
--    legacy callers (Flutter mobile app) continue to work without
--    knowing about cycles.
-- =====================================================================
create or replace function public.award_points(
  p_device_id uuid,
  p_level_id  smallint,
  p_cycle     int default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_award    int;
  v_cycle    int;
begin
  v_award := 80 + 20 * p_level_id;

  -- If caller didn't specify a cycle, fall back to the device's top cycle.
  if p_cycle is null then
    select max(cycle) into v_cycle
      from public.device_paths
     where device_id = p_device_id;
    if v_cycle is null then
      raise exception 'no device_paths row for device %', p_device_id;
    end if;
  else
    v_cycle := p_cycle;
  end if;

  select status, points
    into v_existing
    from public.device_progress
   where device_id = p_device_id
     and cycle     = v_cycle
     and level_id  = p_level_id
   for update;

  if not found then
    raise exception 'no progress row for device % cycle % level %',
      p_device_id, v_cycle, p_level_id;
  end if;

  -- Idempotent: if this level was already completed, leave points alone.
  if v_existing.status = 'completed' and v_existing.points > 0 then
    return v_existing.points;
  end if;

  update public.device_progress
     set points = v_award
   where device_id = p_device_id
     and cycle     = v_cycle
     and level_id  = p_level_id;

  return v_award;
end;
$$;

revoke all on function public.award_points(uuid, smallint, int) from public;
grant execute on function public.award_points(uuid, smallint, int) to service_role;

-- The old 2-arg signature is kept (still resolves to the new 3-arg via
-- default), so Postgres considers them different functions. We drop
-- the old explicit 2-arg version to avoid the ambiguity.
drop function if exists public.award_points(uuid, smallint);

-- =====================================================================
-- 5. assign_path(): unchanged in spirit still idempotent. Now returns
--    the device's TOP cycle if any, otherwise issues cycle = 1.
-- =====================================================================
create or replace function public.assign_path(p_device_id uuid)
returns table (path_id smallint, cycle int, assigned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_rotation record;
  v_path_id  smallint;
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

  update public.paths_rotation
     set next_index = case when v_rotation.next_index = 20 then 1
                           else v_rotation.next_index + 1 end,
         cycle      = case when v_rotation.next_index = 20 then v_rotation.cycle + 1
                           else v_rotation.cycle end,
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

-- =====================================================================
-- 6. advance_path(): re-issues the next per-device cycle. Caller is
--    expected to be the paths_assign Edge Function with `{ advance: true }`.
--
--    Asserts the device's CURRENT top cycle has all 8 levels completed.
--    Raises a recognisable error otherwise so the Edge Function can
--    translate it to 409 Conflict.
-- =====================================================================
create or replace function public.advance_path(p_device_id uuid)
returns table (path_id smallint, cycle int, assigned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top_cycle int;
  v_completed int;
  v_rotation  record;
  v_path_id   smallint;
  v_new_cycle int;
begin
  -- 1. Lock the device's top-cycle row to serialise concurrent advances.
  select max(cycle) into v_top_cycle
    from public.device_paths
   where device_id = p_device_id;

  if v_top_cycle is null then
    -- Device has never been assigned. Kick out they should call
    -- paths_assign without `advance` first.
    raise exception 'not_assigned'
      using errcode = 'P0002'; -- no_data_found, used as a sentinel.
  end if;

  -- 2. Verify the top cycle is fully completed.
  select count(*) into v_completed
    from public.device_progress
   where device_id = p_device_id
     and cycle     = v_top_cycle
     and status    = 'completed';

  if v_completed < 8 then
    raise exception 'cycle_incomplete: device % top cycle % has %/8 completed levels',
      p_device_id, v_top_cycle, v_completed
      using errcode = 'P0001'; -- raise_exception, generic.
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

  update public.paths_rotation
     set next_index = case when v_rotation.next_index = 20 then 1
                           else v_rotation.next_index + 1 end,
         cycle      = case when v_rotation.next_index = 20 then v_rotation.cycle + 1
                           else v_rotation.cycle end,
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

-- =====================================================================
-- 7. device_nicknames: per-device user-chosen leaderboard display name.
--    Optional when absent the leaderboard falls back to the
--    deterministic nicknameFor() helper in functions/_shared/util.ts.
-- =====================================================================
create table if not exists public.device_nicknames (
  device_id  uuid primary key,
  nickname   text not null
             check (
               char_length(nickname) between 2 and 20
               and nickname = btrim(nickname)
             ),
  updated_at timestamptz not null default now()
);

alter table public.device_nicknames enable row level security;
-- (no policies → service-role only, like every other table.)

create or replace function public.upsert_nickname(
  p_device_id uuid,
  p_nickname  text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text;
begin
  -- Server-side validation mirror of the client's: trim, collapse
  -- internal whitespace runs to single spaces, enforce 2..20 chars.
  v_clean := btrim(regexp_replace(p_nickname, '\s+', ' ', 'g'));
  if char_length(v_clean) < 2 or char_length(v_clean) > 20 then
    raise exception 'bad_nickname_length'
      using errcode = 'P0001';
  end if;

  insert into public.device_nicknames (device_id, nickname, updated_at)
       values (p_device_id, v_clean, now())
  on conflict (device_id) do update
       set nickname   = excluded.nickname,
           updated_at = excluded.updated_at;

  return v_clean;
end;
$$;

revoke all on function public.upsert_nickname(uuid, text) from public;
grant execute on function public.upsert_nickname(uuid, text) to service_role;

commit;
