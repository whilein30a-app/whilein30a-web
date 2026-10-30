-- 106: Ask 30A usage limits, golf cart request emails, notification email settings.
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- 1. Ask 30A limits (Kevin, Oct 29): 30 questions per person per day, 5 per
--    minute, and a total per day across everyone (2,000 to start). Days reset
--    at midnight 30A time (America/Chicago). Changed in the portal:
--    Admin > App settings > Ask 30A limits.
-- 2. A golf cart request now emails the in30A team (the app already tells the
--    person "we'll follow up"). Address: Admin > App settings > Notification
--    emails. Empty golf cart address = the admin address.
-- 3. The admin address still defaults to the suspended in30a.info Gmail.
--    Change it in the portal after running this.

-- ---------------------------------------------------------------------
-- 1. Ask 30A limits
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, is_public)
values ('ask30a_limits', '{"per_user_day": 30, "per_user_minute": 5, "total_day": 2000}', false)
on conflict (key) do nothing;

create table if not exists public.ask30a_usage (
  who text not null,          -- 'u:<user id>', 'd:<device id>', 'ip:<address>' or '*' for everyone
  bucket text not null,       -- 'day:2026-10-30' or 'min:2026-10-30T14:05' (30A local time)
  n integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (who, bucket)
);
create index if not exists ask30a_usage_created_idx on public.ask30a_usage (created_at);
alter table public.ask30a_usage enable row level security;
revoke all on public.ask30a_usage from anon, authenticated;
-- Service role only. No policies on purpose.

create or replace function public.ask30a_limit_values()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'per_user_day',    greatest(1, coalesce((v->>'per_user_day')::int, 30)),
    'per_user_minute', greatest(1, coalesce((v->>'per_user_minute')::int, 5)),
    'total_day',       greatest(1, coalesce((v->>'total_day')::int, 2000)))
  from (select coalesce((select value from public.app_settings where key = 'ask30a_limits'), '{}'::jsonb) as v) s;
$$;
revoke all on function public.ask30a_limit_values() from public, anon, authenticated;

-- Checks the three limits and, if all pass, counts the question.
-- Returns {ok: true, left_today} or {ok: false, reason: user_minute | user_day | total_day}.
create or replace function public.service_ask30a_take(p_who text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lim jsonb := public.ask30a_limit_values();
  local_now timestamp := now() at time zone 'America/Chicago';
  dkey text := 'day:' || to_char(local_now, 'YYYY-MM-DD');
  mkey text := 'min:' || to_char(local_now, 'YYYY-MM-DD"T"HH24:MI');
  total_used int;
  day_used int;
  min_used int;
begin
  if p_who is null or char_length(p_who) not between 3 and 120 or p_who = '*' then
    raise exception 'bad caller id';
  end if;

  -- One question at a time is counted, so two at once can't both slip past a limit.
  perform pg_advisory_xact_lock(hashtext('ask30a_usage'));

  select n into total_used from public.ask30a_usage where who = '*' and bucket = dkey;
  select n into day_used from public.ask30a_usage where who = p_who and bucket = dkey;
  select n into min_used from public.ask30a_usage where who = p_who and bucket = mkey;

  if coalesce(total_used, 0) >= (lim->>'total_day')::int then
    return jsonb_build_object('ok', false, 'reason', 'total_day');
  end if;
  if coalesce(day_used, 0) >= (lim->>'per_user_day')::int then
    return jsonb_build_object('ok', false, 'reason', 'user_day');
  end if;
  if coalesce(min_used, 0) >= (lim->>'per_user_minute')::int then
    return jsonb_build_object('ok', false, 'reason', 'user_minute');
  end if;

  insert into public.ask30a_usage (who, bucket, n) values
    ('*', dkey, 1), (p_who, dkey, 1), (p_who, mkey, 1)
  on conflict (who, bucket) do update set n = public.ask30a_usage.n + 1;

  -- Old counters are only needed for today; tidy up now and then.
  if random() < 0.02 then
    delete from public.ask30a_usage where created_at < now() - interval '3 days';
  end if;

  return jsonb_build_object('ok', true, 'left_today', (lim->>'per_user_day')::int - coalesce(day_used, 0) - 1);
end $$;
revoke all on function public.service_ask30a_take(text) from public, anon, authenticated;
grant execute on function public.service_ask30a_take(text) to service_role;

-- Portal: read the limits and today's use.
create or replace function public.admin_ask30a_limits()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  dkey text := 'day:' || to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD');
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return public.ask30a_limit_values() || jsonb_build_object(
    'used_today', coalesce((select n from public.ask30a_usage where who = '*' and bucket = dkey), 0),
    'people_today', (select count(*) from public.ask30a_usage where who <> '*' and bucket = dkey));
end $$;
revoke all on function public.admin_ask30a_limits() from public, anon;
grant execute on function public.admin_ask30a_limits() to authenticated;

create or replace function public.admin_save_ask30a_limits(p_per_user_day int, p_per_user_minute int, p_total_day int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_per_user_day not between 1 and 1000 then raise exception 'Questions per person per day must be 1 to 1,000.'; end if;
  if p_per_user_minute not between 1 and 60 then raise exception 'Questions per person per minute must be 1 to 60.'; end if;
  if p_total_day not between 1 and 1000000 then raise exception 'Total per day must be 1 to 1,000,000.'; end if;
  insert into public.app_settings (key, value, is_public, updated_at)
  values ('ask30a_limits', jsonb_build_object('per_user_day', p_per_user_day, 'per_user_minute', p_per_user_minute, 'total_day', p_total_day), false, now())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_at = now();
  insert into public.portal_audit (user_id, action, detail)
  values (auth.uid(), 'setting_changed', jsonb_build_object('key', 'ask30a_limits'));
end $$;
revoke all on function public.admin_save_ask30a_limits(int, int, int) from public, anon;
grant execute on function public.admin_save_ask30a_limits(int, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 2 and 3. Notification emails, golf cart requests
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, is_public)
values ('golf_cart_notify_email', '""', false)
on conflict (key) do nothing;

create or replace function public.golf_cart_notify_address()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(both '"' from (select value::text from public.app_settings where key = 'golf_cart_notify_email')), ''),
                  public.admin_notify_address());
$$;
revoke all on function public.golf_cart_notify_address() from public, anon, authenticated;

create or replace function public.email_on_golf_cart_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.queue_email(public.golf_cart_notify_address(), 'golf_cart_request',
    'Golf cart request: ' || coalesce(new.name, 'someone') || ', ' || coalesce(new.requested_time, ''),
    'Someone asked for a golf cart in the app. The app told them we will follow up to confirm, so please call or text them.' || E'\n\n' ||
    'Name: ' || coalesce(new.name, '') || E'\n' ||
    'Phone: ' || coalesce(new.phone, '') || E'\n' ||
    'Pickup: ' || coalesce(new.pickup_location, '') || E'\n' ||
    'When: ' || coalesce(new.requested_time, '') ||
    case when coalesce(new.note, '') <> '' then E'\n' || 'Note: ' || new.note else '' end,
    null);
  return new;
exception when others then
  -- An email problem must never stop the request from being saved.
  return new;
end $$;
revoke all on function public.email_on_golf_cart_request() from public, anon, authenticated;
drop trigger if exists email_golf_cart_request_ins on public.golf_cart_bookings;
create trigger email_golf_cart_request_ins after insert on public.golf_cart_bookings
  for each row execute function public.email_on_golf_cart_request();

-- Portal: read and save the two notification addresses.
create or replace function public.admin_notify_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return jsonb_build_object(
    'admin_email', public.admin_notify_address(),
    'golf_cart_email', coalesce(trim(both '"' from (select value::text from public.app_settings where key = 'golf_cart_notify_email')), ''));
end $$;
revoke all on function public.admin_notify_settings() from public, anon;
grant execute on function public.admin_notify_settings() to authenticated;

create or replace function public.admin_save_notify_settings(p_admin_email text, p_golf_cart_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  a text := lower(trim(coalesce(p_admin_email, '')));
  g text := lower(trim(coalesce(p_golf_cart_email, '')));
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if a !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid admin email.'; end if;
  if g <> '' and g !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid golf cart email, or leave it empty.'; end if;
  insert into public.app_settings (key, value, is_public, updated_at) values
    ('admin_notify_email', to_jsonb(a), false, now()),
    ('golf_cart_notify_email', to_jsonb(g), false, now())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_at = now();
  insert into public.portal_audit (user_id, action, detail)
  values (auth.uid(), 'setting_changed', jsonb_build_object('key', 'notify_emails'));
end $$;
revoke all on function public.admin_save_notify_settings(text, text) from public, anon;
grant execute on function public.admin_save_notify_settings(text, text) to authenticated;

-- Report
select 'ask30a limits' as what, public.ask30a_limit_values()::text as detail
union all
select 'admin email', public.admin_notify_address()
union all
select 'golf cart email', public.golf_cart_notify_address()
union all
select 'golf cart trigger', (select count(*)::text from pg_trigger where tgname = 'email_golf_cart_request_ins');
