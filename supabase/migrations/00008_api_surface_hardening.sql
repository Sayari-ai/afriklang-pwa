-- 00008: close the anon-key surface (security audit 2026-10-21, APP-01).
--
-- The anon key ships in the app bundle, so whatever anon or authenticated can
-- reach through /rest/v1 is internet-facing. Before this migration:
--   * public.device_question_swaps (00005) had no RLS: anyone could read,
--     insert, update or delete swaps with the anon key;
--   * public.leaderboard_top (00002) is a view, and a view runs with its
--     owner's rights, so it did NOT inherit device_progress's RLS (the 00002
--     comment says otherwise): anon read every device_id with its points,
--     and a device_id is all the legacy Edge Functions (nickname_set,
--     progress_set, paths_assign, question_swap, events_log) ask for;
--   * anon and authenticated held table privileges everywhere, so RLS was the
--     only wall.
--
-- Nothing in the app reads a table with the anon key: every read and write goes
-- through an Edge Function with the service role, which this does not touch.

alter table public.device_question_swaps enable row level security;

-- Run the view with the caller's rights, so device_progress's RLS applies even
-- if a grant comes back by mistake.
alter view public.leaderboard_top set (security_invoker = true);

do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Guard: fails on drift.
do $$
declare v text;
begin
  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v is not null then raise exception 'tables without RLS: %', v; end if;

  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
          or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger'));
  if v is not null then raise exception 'tables reachable by the API roles: %', v; end if;
end $$;
