-- Fix ambiguous "q_index" / "path_id" references in swap_question().
--
-- Same root cause as 00004's fix to assign_path()/advance_path():
-- `RETURNS TABLE (path_id smallint, q_index smallint, ...)` creates
-- implicit OUT parameters in scope for the entire function body. Inside
-- the served-set CTE we reference `pq.q_index`, `dqs.replacement_path_id`,
-- etc., and inside the final picker SELECT we read `pq.path_id` /
-- `pq.q_index`. Postgres cannot disambiguate the bare names that appear
-- in the `served` CTE column list against the OUT params, raising:
--
--   ERROR: column reference "q_index" is ambiguous
--
-- which surfaces as
-- `{ "error": "rpc_failed", "message": "column reference \"q_index\" is
-- ambiguous" }` from the question_swap edge function and breaks every
-- swap attempt.
--
-- Fix: rename the OUT parameters to `out_path_id`, `out_q_index`, etc.
-- so they can never collide with table-column references in the body.
-- The SELECT from rpc() in the edge function reads named keys off each
-- returned row, so we update question_swap/index.ts to read the new
-- names. The wire-shape returned to the client is unchanged.

-- DROP FIRST: Postgres refuses `CREATE OR REPLACE FUNCTION` when the
-- OUT-parameter names change ("Row type defined by OUT parameters is
-- different", SQLSTATE 42P13) because the function's row type alias
-- changes shape. Migration 00006 first attempt failed for this reason.
drop function if exists public.swap_question(uuid, int, smallint, smallint);

create function public.swap_question(
  p_device_id uuid,
  p_cycle     int,
  p_level_id  smallint,
  p_q_index   smallint
)
returns table (
  out_path_id   smallint,
  out_q_index   smallint,
  out_theme     text,
  out_prompt_en text,
  out_image_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick record;
begin
  if p_q_index < 1 or p_q_index > 7 then
    raise exception 'bad_q_index'
      using errcode = 'P0001';
  end if;
  if p_level_id < 1 or p_level_id > 8 then
    raise exception 'bad_level_id'
      using errcode = 'P0001';
  end if;

  perform 1 from public.device_paths
   where device_id = p_device_id and cycle = p_cycle;
  if not found then
    raise exception 'cycle_not_assigned'
      using errcode = 'P0002';
  end if;

  with served as (
    select pq.path_id as s_path_id, pq.q_index as s_q_index
      from public.device_paths dp
      join public.path_questions pq
        on pq.path_id = dp.path_id
     where dp.device_id = p_device_id
       and pq.level_id  = p_level_id
    union
    select dqs.replacement_path_id, dqs.replacement_q_index
      from public.device_question_swaps dqs
     where dqs.device_id = p_device_id
       and dqs.level_id  = p_level_id
       and not (dqs.cycle = p_cycle and dqs.q_index = p_q_index)
  )
  select pq.path_id, pq.q_index, pq.theme, pq.prompt_en, pq.image_url
    into v_pick
    from public.path_questions pq
   where pq.level_id = p_level_id
     and not exists (
       select 1 from served s
        where s.s_path_id = pq.path_id and s.s_q_index = pq.q_index
     )
   order by random()
   limit 1;

  if not found then
    raise exception 'swap_pool_exhausted'
      using errcode = 'P0001';
  end if;

  insert into public.device_question_swaps (
    device_id, cycle, level_id, q_index,
    replacement_path_id, replacement_q_index
  ) values (
    p_device_id, p_cycle, p_level_id, p_q_index,
    v_pick.path_id, v_pick.q_index
  )
  on conflict (device_id, cycle, level_id, q_index) do update
    set replacement_path_id = excluded.replacement_path_id,
        replacement_q_index = excluded.replacement_q_index,
        swapped_at          = now();

  out_path_id   := v_pick.path_id;
  out_q_index   := v_pick.q_index;
  out_theme     := v_pick.theme;
  out_prompt_en := v_pick.prompt_en;
  out_image_url := v_pick.image_url;
  return next;
end;
$$;

revoke all on function public.swap_question(uuid, int, smallint, smallint) from public;
grant execute on function public.swap_question(uuid, int, smallint, smallint) to service_role;
