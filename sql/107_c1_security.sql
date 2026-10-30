-- 107: C1 security (store compliance audit, Oct 28). Run once; safe to run again.
--
-- Based on the live policy report from Oct 30. Fixes:
--   1. get_admin_analytics: anon could run it. Now admins only.
--   2. The 7 "always true" insert policies (anyone could insert anything,
--      including someone else's user id). Now each checks its own fields.
--   3. profiles: "Anyone can view profiles" let anyone read every user's email,
--      phone, push token and admin flag (the old login screen looked users up by
--      email). Now people read only their own profile. Other people's first
--      names come from public_first_names(), and the login screen uses
--      login_first_name(). Needs app update 132.
--   4. itineraries / itinerary_stops: everyone could read everyone's trip plans.
--      Now: curated ones for everyone, your own for you.
--   5. Public bucket listing: listing-photos and photo-wall had read policies
--      that let anyone list every file. Public buckets serve their files by link
--      without them, so they are removed. Links keep working.
-- Not SQL: leaked password protection is a dashboard switch (see README).

-- ---------------------------------------------------------------------
-- 1. get_admin_analytics: admins only
-- ---------------------------------------------------------------------
do $$
declare
  res text;
begin
  if to_regprocedure('public.get_admin_analytics()') is null then
    raise notice 'get_admin_analytics() not found, skipped';
    return;
  end if;
  -- Keep the original as an internal function the first time this runs.
  if to_regprocedure('public.get_admin_analytics_core()') is null then
    alter function public.get_admin_analytics() rename to get_admin_analytics_core;
  end if;
  revoke all on function public.get_admin_analytics_core() from public, anon, authenticated;
  select pg_get_function_result('public.get_admin_analytics_core()'::regprocedure) into res;
  execute format($f$
    create or replace function public.get_admin_analytics()
    returns %s
    language plpgsql stable security definer set search_path = public as $b$
    begin
      if not public.is_portal_admin() then
        raise exception 'Not allowed';
      end if;
      return query select * from public.get_admin_analytics_core();
    end $b$;
  $f$, res);
  revoke all on function public.get_admin_analytics() from public, anon;
  grant execute on function public.get_admin_analytics() to authenticated;
end $$;

-- ---------------------------------------------------------------------
-- 2. Insert policies that were "with check (true)"
-- ---------------------------------------------------------------------
-- Each new check is built from the columns the table really has:
--   user_id / reported_by: empty, or your own id (no posting as someone else)
--   the field the app always sends: must be filled in
--   free text: a sensible length
do $$
declare
  t record;
  parts text[];
  c text;
  expr text;
  has_col boolean;
begin
  for t in
    select * from (values
      ('activity_bookings',          'Anyone can submit a booking request', array['listing_id','name','phone'], array['name:120','phone:40','requested_time:120','note:1000']),
      ('affiliate_clicks',           'Public insert clicks',                array['affiliate_link_id'],          array[]::text[]),
      ('beach_flag_reports',         'Public insert reports',               array['status'],                     array['status:30']),
      ('bug_reports',                'Anyone can file a bug report',        array['message'],                    array['message:4000','steps:4000','contact:200','screen:120']),
      ('parking_reports',            'Public insert parking reports',       array['listing_id'],                 array[]::text[]),
      ('restroom_condition_reports', 'Anyone can report restroom condition',array['listing_id'],                 array['condition:40']),
      ('shuttle_reports',            'Public insert reports',               array['route_name','status'],        array['route_name:120','status:40'])
    ) v(tbl, old_policy, required, caps)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice '% not found, skipped', t.tbl;
      continue;
    end if;
    parts := array[]::text[];
    foreach c in array array['user_id','reported_by'] loop
      select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tbl and column_name = c) into has_col;
      if has_col then
        parts := parts || format('(%1$I is null or %1$I = (select auth.uid()))', c);
      end if;
    end loop;
    foreach c in array t.required loop
      select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tbl and column_name = c) into has_col;
      if has_col then
        parts := parts || format('%I is not null', c);
      end if;
    end loop;
    foreach c in array t.caps loop
      select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tbl
                     and column_name = split_part(c, ':', 1) and data_type in ('text', 'character varying')) into has_col;
      if has_col then
        parts := parts || format('char_length(coalesce(%I, '''')) <= %s', split_part(c, ':', 1), split_part(c, ':', 2));
      end if;
    end loop;
    if coalesce(array_length(parts, 1), 0) = 0 then
      raise notice '% has none of the expected columns, policy left as is', t.tbl;
      continue;
    end if;
    expr := array_to_string(parts, ' and ');
    execute format('drop policy if exists %I on public.%I', t.old_policy, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_insert_checked', t.tbl);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (%s)', t.tbl || '_insert_checked', t.tbl, expr);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. profiles: your own row only
-- ---------------------------------------------------------------------
drop policy if exists "Anyone can view profiles" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_portal_admin());

-- First names only, for posts, comments and lost and found.
create or replace function public.public_first_names(p_ids uuid[])
returns table (id uuid, first_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name::text
  from public.profiles p
  where p.id = any (p_ids[1:200]);
$$;
revoke all on function public.public_first_names(uuid[]) from public;
grant execute on function public.public_first_names(uuid[]) to anon, authenticated;

-- The login screen's "Welcome back, Name": the first name for one email.
create or replace function public.login_first_name(p_email text)
returns text
language sql stable security definer set search_path = public as $$
  select p.first_name::text
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;
revoke all on function public.login_first_name(text) from public;
grant execute on function public.login_first_name(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. itineraries: curated for everyone, your own for you
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.itineraries') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itineraries' and column_name = 'user_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itineraries' and column_name = 'is_curated') then
    drop policy if exists "Anyone can view itineraries" on public.itineraries;
    drop policy if exists itineraries_select_visible on public.itineraries;
    create policy itineraries_select_visible on public.itineraries
      for select to anon, authenticated
      using (is_curated or user_id = (select auth.uid()));
    if to_regclass('public.itinerary_stops') is not null then
      drop policy if exists "Anyone can view itinerary stops" on public.itinerary_stops;
      drop policy if exists itinerary_stops_select_visible on public.itinerary_stops;
      create policy itinerary_stops_select_visible on public.itinerary_stops
        for select to anon, authenticated
        using (exists (select 1 from public.itineraries i
                       where i.id = itinerary_stops.itinerary_id
                         and (i.is_curated or i.user_id = (select auth.uid()))));
    end if;
  else
    raise notice 'itineraries: expected columns not found, left as is';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Public buckets: no listing
-- ---------------------------------------------------------------------
drop policy if exists "Public read listing photos" on storage.objects;
drop policy if exists "Public read photo wall images" on storage.objects;

-- ---------------------------------------------------------------------
-- Report: anything still "always true" that is not a plain public read
-- ---------------------------------------------------------------------
select 'still always true' as what, schemaname || '.' || tablename || ': ' || policyname || ' (' || cmd || ')' as detail
from pg_policies
where schemaname in ('public', 'storage')
  and cmd <> 'SELECT'
  and (qual = 'true' or with_check = 'true')
union all
select 'anon can run get_admin_analytics', has_function_privilege('anon', 'public.get_admin_analytics()', 'execute')::text
union all
select 'profiles readable by anyone', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT' and qual = 'true')::text
union all
select 'storage read policies left', count(*)::text from pg_policies where schemaname = 'storage' and cmd = 'SELECT';
