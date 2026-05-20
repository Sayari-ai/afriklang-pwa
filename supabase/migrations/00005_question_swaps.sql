-- Per-device question swaps.
--
-- When a user clicks Skip in the PWA because they don't know how to say
-- the depicted concept in the target language, the client requests a
-- replacement question drawn from path_questions rows belonging to OTHER
-- path_ids at the SAME level_id, excluding any (path_id, level_id, q_index)
-- the device has ever been served — across all cycles AND prior swaps.
--
-- Persistence model: one row per (device_id, cycle, level_id, q_index)
-- swap. The PK enforces "one active swap per slot" — re-swapping the same
-- slot REPLACES the existing swap (caller upserts). The replacement is
-- another (path_id, q_index) pair pointing at the live path_questions
-- pool. paths_get LEFT JOINs this table to splice replacements into the
-- response, so swaps survive reload + reinstall + multi-device sync.
--
-- Audio filename invariant: the recording slug remains pNN-Lx-qy where
-- qy is the ORIGINAL q_index (not the replacement's). Each device has
-- its own upload folder so two devices that both swap their Q3 to
-- different replacements never collide.

create table if not exists public.device_question_swaps (
  device_id            uuid     not null,
  cycle                int      not null check (cycle >= 1),
  level_id             smallint not null check (level_id between 1 and 8),
  q_index              smallint not null check (q_index between 1 and 7),
  replacement_path_id  smallint not null check (replacement_path_id between 1 and 20),
  replacement_q_index  smallint not null check (replacement_q_index between 1 and 7),
  swapped_at           timestamptz not null default now(),
  primary key (device_id, cycle, level_id, q_index),
  foreign key (device_id, cycle) references public.device_paths(device_id, cycle) on delete cascade,
  foreign key (replacement_path_id, level_id, replacement_q_index)
    references public.path_questions(path_id, level_id, q_index)
);

-- Useful for paths_get's LEFT JOIN by (device_id, cycle, level_id).
create index if not exists device_question_swaps_lookup_idx
  on public.device_question_swaps (device_id, cycle, level_id);

-- swap_question(device_id, cycle, level_id, q_index)
--
-- Picks one (path_id, q_index) from path_questions at the same level_id
-- not in the device's "served set" (every q_index ever served at that
-- level_id, across all cycles and prior swaps), upserts a swap row, and
-- returns the replacement question. Raises 'swap_pool_exhausted' (P0001)
-- when no candidate exists.
--
-- The "served set" is computed as:
--   1. For every cycle the device has been issued, the 7 base q_index
--      values at the requested level_id from that cycle's path_id.
--   2. Plus every (replacement_path_id, replacement_q_index) the device
--      has already swapped in at the same level_id (any cycle).
--   3. Minus the original q_index of the slot being swapped right now —
--      if the user already had a previous swap on this slot, we want to
--      re-pick freely without the previous replacement excluding itself.
create or replace function public.swap_question(
  p_device_id uuid,
  p_cycle     int,
  p_level_id  smallint,
  p_q_index   smallint
)
returns table (
  path_id     smallint,
  q_index     smallint,
  theme       text,
  prompt_en   text,
  image_url   text
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

  -- Verify the device actually has this cycle assigned (FK gives us this
  -- on insert, but we want a clean error before doing any work).
  perform 1 from public.device_paths
   where device_id = p_device_id and cycle = p_cycle;
  if not found then
    raise exception 'cycle_not_assigned'
      using errcode = 'P0002';
  end if;

  -- Pick a random row in path_questions at the same level_id that's not
  -- in the served set. The served set is the UNION of:
  --   (a) every base q_index from any path_id this device has ever been
  --       issued, at the requested level_id;
  --   (b) every prior replacement at the same level_id (any cycle),
  --       except the slot we're re-swapping.
  with served as (
    select pq.path_id, pq.q_index
      from public.device_paths dp
      join public.path_questions pq
        on pq.path_id = dp.path_id
     where dp.device_id = p_device_id
       and pq.level_id = p_level_id
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
        where s.path_id = pq.path_id and s.q_index = pq.q_index
     )
   order by random()
   limit 1;

  if not found then
    raise exception 'swap_pool_exhausted'
      using errcode = 'P0001';
  end if;

  -- Upsert the swap. ON CONFLICT replaces a prior swap on the same slot
  -- so a user can swap-then-swap-again on the same q_index freely.
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

  path_id   := v_pick.path_id;
  q_index   := v_pick.q_index;
  theme     := v_pick.theme;
  prompt_en := v_pick.prompt_en;
  image_url := v_pick.image_url;
  return next;
end;
$$;

revoke all on function public.swap_question(uuid, int, smallint, smallint) from public;
grant execute on function public.swap_question(uuid, int, smallint, smallint) to service_role;
