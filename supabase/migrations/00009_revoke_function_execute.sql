-- 00009: close the anon-key EXECUTE surface that 00008 didn't reach
-- (security audit 2026-11-11, APP-S04 / L-08 - confirmed live: the anon key
-- could call assign_path, award_points and advance_path through
-- /rest/v1/rpc/<name> and reach their bodies, not a permission error).
--
-- 00008 revoked all table/view/sequence privileges from anon and authenticated,
-- but a hosted Supabase project also auto-grants EXECUTE on every function in
-- `public` to anon and authenticated by default (independent of the `public`
-- pseudo-role `assign_path`/`advance_path`/`award_points`/`upsert_nickname`/
-- `swap_question` already `revoke ... from public` in their own migrations:
-- that revoke never touched anon/authenticated, which is why the hole held).
-- These functions take only a bare `device_id` (uuid) with no secret and no
-- ownership check, so anon could mint points, overwrite a nickname, or
-- rewrite another device's learning path.
--
-- Nothing in the app calls a function with the anon or authenticated key:
-- every call goes through an Edge Function with the service role.

do $$
declare r record;
begin
  for r in
    select p.oid, p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function public.%I(%s) from anon, authenticated', r.proname, r.args);
  end loop;
end $$;

alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Guard: fails on drift (mirrors 00008's table guard).
do $$
declare v text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if v is not null then raise exception 'functions reachable by the API roles: %', v; end if;
end $$;
