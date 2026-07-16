-- Leaderboard support: per-device points + nicknames + aggregation view.
--
-- Run: `supabase db push` after the previous migration.

-- =====================================================================
-- Add a points column to device_progress. Each row's points reflect the
-- award for completing THAT level (80 + 20*level_id). Aggregating per
-- device gives total points.
-- =====================================================================
alter table public.device_progress
  add column if not exists points int not null default 0;

-- =====================================================================
-- award_points(): atomic helper invoked by progress_set when a level
-- transitions to 'completed' for the first time. Idempotent: replays
-- never re-award. Returns the row's current points after the operation.
-- =====================================================================
create or replace function public.award_points(
  p_device_id uuid,
  p_level_id  smallint
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_award    int;
begin
  v_award := 80 + 20 * p_level_id;

  select status, points
    into v_existing
    from public.device_progress
   where device_id = p_device_id
     and level_id  = p_level_id
   for update;

  if not found then
    raise exception 'no progress row for device % level %', p_device_id, p_level_id;
  end if;

  -- Idempotent: if this level was already completed, leave points alone.
  if v_existing.status = 'completed' and v_existing.points > 0 then
    return v_existing.points;
  end if;

  update public.device_progress
     set points = v_award
   where device_id = p_device_id
     and level_id  = p_level_id;

  return v_award;
end;
$$;

revoke all on function public.award_points(uuid, smallint) from public;
grant execute on function public.award_points(uuid, smallint) to service_role;

-- =====================================================================
-- leaderboard_top: aggregate per-device totals and dense_rank by points.
-- A view (not a materialized one) the dataset is small (one row per
-- device) and we want results to reflect the latest completion instantly.
-- =====================================================================
create or replace view public.leaderboard_top as
  select
    dp.device_id,
    sum(dp.points)::int as points,
    dense_rank() over (order by sum(dp.points) desc, dp.device_id asc)::int
      as rank
  from public.device_progress dp
  group by dp.device_id;

-- The view inherits RLS from the base table it's accessed via service role
-- only (Edge Functions). Anon clients still can't read it directly.
