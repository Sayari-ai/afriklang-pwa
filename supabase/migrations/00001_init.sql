-- Afriklang content + rotation schema (PoC).
--
-- Run: `supabase db push` after `supabase start`.

-- =====================================================================
-- path_questions: 800 rows total. (path_id, level_id, q_index) is the PK.
-- =====================================================================
create table if not exists public.path_questions (
  path_id   smallint not null check (path_id between 1 and 20),
  level_id  smallint not null check (level_id between 1 and 8),
  q_index   smallint not null check (q_index between 1 and 7),
  theme     text not null,
  prompt_en text not null,
  image_url text not null,
  image_path text not null,
  primary key (path_id, level_id, q_index)
);

create index if not exists path_questions_path_idx
  on public.path_questions (path_id);

-- =====================================================================
-- paths_rotation: single-row counter that paths_assign locks atomically.
-- =====================================================================
create table if not exists public.paths_rotation (
  id          smallint primary key default 1 check (id = 1),
  cycle       int      not null default 1,
  next_index  smallint not null default 1
              check (next_index between 1 and 20),
  updated_at  timestamptz not null default now()
);

insert into public.paths_rotation (id) values (1)
  on conflict (id) do nothing;

-- =====================================================================
-- device_paths: which path was issued to which device, in which cycle.
-- =====================================================================
create table if not exists public.device_paths (
  device_id   uuid primary key,
  path_id     smallint not null check (path_id between 1 and 20),
  cycle       int      not null,
  assigned_at timestamptz not null default now()
);

-- =====================================================================
-- device_progress: per-device level state vector (8 rows per device).
-- =====================================================================
create table if not exists public.device_progress (
  device_id    uuid not null
               references public.device_paths(device_id) on delete cascade,
  level_id     smallint not null check (level_id between 1 and 8),
  status       text not null check (status in ('locked','current','completed')),
  completed_at timestamptz,
  primary key (device_id, level_id)
);

-- =====================================================================
-- RLS: deny-all to anon. Edge Functions use the service role.
-- =====================================================================
alter table public.path_questions  enable row level security;
alter table public.paths_rotation  enable row level security;
alter table public.device_paths    enable row level security;
alter table public.device_progress enable row level security;
-- (no policies are created → effective deny-all for anon/authenticated roles.)

-- =====================================================================
-- assign_path(): the atomic core of paths_assign. Returns the path_id +
-- cycle the device was issued. Idempotent for an existing device.
--
-- The 24h soft rate-limit lives in the Edge Function (it's a UX concern,
-- not a correctness one the idempotent fast path here always returns
-- the existing assignment if one exists).
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
  v_cycle    int;
begin
  -- Idempotent: if the device already has an assignment, return it.
  select dp.path_id, dp.cycle, dp.assigned_at
    into v_existing
    from public.device_paths dp
   where dp.device_id = p_device_id;

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
  v_cycle   := v_rotation.cycle;

  insert into public.device_paths (device_id, path_id, cycle)
       values (p_device_id, v_path_id, v_cycle);

  -- Seed the progress vector: L1 current, L2..L8 locked.
  insert into public.device_progress (device_id, level_id, status)
  select p_device_id, lvl, case when lvl = 1 then 'current' else 'locked' end
    from generate_series(1, 8) as lvl;

  update public.paths_rotation
     set next_index = case when v_rotation.next_index = 20 then 1
                          else v_rotation.next_index + 1 end,
         cycle      = case when v_rotation.next_index = 20 then v_rotation.cycle + 1
                          else v_rotation.cycle end,
         updated_at = now()
   where id = 1;

  path_id := v_path_id;
  cycle   := v_cycle;
  assigned_at := now();
  return next;
end;
$$;

revoke all on function public.assign_path(uuid) from public;
-- granted only to service_role (used by Edge Functions); intentionally NOT to anon.
grant execute on function public.assign_path(uuid) to service_role;
