-- 108: 4-digit PIN for visitors, with a lockout (Kevin, Nov 3, 2026).
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- How it works now:
--  - The PIN is checked here, in the database, not by Supabase's password login.
--    The pin-login function asks service_pin_login() and, only when the PIN is
--    right, hands the app a one-time sign-in token.
--  - 5 wrong PINs for one email locks that email for 15 minutes (both numbers
--    are in app_settings > pin_lockout). Supabase's own limits count per IP
--    address, not per account, so they could not do this.
--  - New accounts pick a 4-digit PIN. Their real Supabase password is a long
--    random value nobody knows, so the PIN can't be guessed through Supabase's
--    login either.
--  - Existing accounts keep their 6-digit PIN. The first time one signs in
--    after this update, its PIN is copied here (as a hash), and from then on
--    it gets the same lockout. Their Supabase password is left as it is.
--  - PINs are stored only as bcrypt hashes.

create extension if not exists pgcrypto with schema extensions;

insert into public.app_settings (key, value, is_public)
values ('pin_lockout', '{"max_fails": 5, "lock_minutes": 15}', false)
on conflict (key) do nothing;

create table if not exists public.pin_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  pin_len smallint not null check (pin_len in (4, 6)),
  updated_at timestamptz not null default now()
);
alter table public.pin_credentials enable row level security;
revoke all on public.pin_credentials from public, anon, authenticated;
-- Service role and the functions below only. No policies on purpose.

create table if not exists public.pin_attempts (
  email text primary key,
  fails integer not null default 0,
  last_fail_at timestamptz,
  locked_until timestamptz
);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from public, anon, authenticated;

create or replace function public.pin_lockout_values(out max_fails int, out lock_minutes int)
language sql stable security definer set search_path = public as $$
  select greatest(3, coalesce((v->>'max_fails')::int, 5)), greatest(1, coalesce((v->>'lock_minutes')::int, 15))
  from (select coalesce((select value from public.app_settings where key = 'pin_lockout'), '{}'::jsonb) as v) s;
$$;
revoke all on function public.pin_lockout_values() from public, anon, authenticated;

-- PINs that are too easy to guess: all the same digit, or straight runs.
create or replace function public.pin_too_simple(p_pin text)
returns boolean language sql immutable as $$
  select p_pin ~ '^(\d)\1+$'
      or position(p_pin in '0123456789') > 0
      or position(p_pin in '9876543210') > 0;
$$;

-- The PIN check, used only by the pin-login function (service role).
-- Returns {ok: true, user_id, migrated} or {ok: false, reason: wrong | locked, left | minutes}.
create or replace function public.service_pin_login(p_email text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  lim record;
  a public.pin_attempts;
  uid uuid;
  enc text;
  cred public.pin_credentials;
  ok boolean := false;
  legacy boolean := false;
begin
  if e = '' or char_length(e) > 320 then
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', 0);
  end if;
  select * into lim from public.pin_lockout_values();

  -- One check at a time per email, so parallel guesses can't skip the count.
  perform pg_advisory_xact_lock(hashtext('pin:' || e));

  select * into a from public.pin_attempts where email = e;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked',
      'minutes', greatest(1, ceil(extract(epoch from (a.locked_until - now())) / 60)::int));
  end if;

  if coalesce(p_pin, '') ~ '^([0-9]{4}|[0-9]{6})$' then
    select u.id, u.encrypted_password into uid, enc from auth.users u where lower(u.email) = e limit 1;
    if uid is not null then
      select * into cred from public.pin_credentials where user_id = uid;
      if cred.user_id is not null then
        ok := crypt(p_pin, cred.pin_hash) = cred.pin_hash;
      elsif enc is not null and enc like '$2%' then
        -- Account from before this update: its 6-digit PIN is its Supabase password.
        ok := crypt(p_pin, enc) = enc;
        legacy := ok;
      end if;
    end if;
  end if;

  if ok then
    delete from public.pin_attempts where email = e;
    if legacy then
      insert into public.pin_credentials (user_id, pin_hash, pin_len)
      values (uid, crypt(p_pin, gen_salt('bf', 10)), char_length(p_pin))
      on conflict (user_id) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'user_id', uid, 'migrated', legacy);
  end if;

  -- Wrong PIN (or no such account: counted the same, so the answer gives nothing away).
  insert into public.pin_attempts as pa (email, fails, last_fail_at, locked_until)
  values (e, 1, now(), null)
  on conflict (email) do update set
    fails = case when pa.last_fail_at < now() - make_interval(mins => lim.lock_minutes) then 1 else pa.fails + 1 end,
    last_fail_at = now(),
    locked_until = null
  returning * into a;

  if a.fails >= lim.max_fails then
    update public.pin_attempts set fails = 0, locked_until = now() + make_interval(mins => lim.lock_minutes) where email = e;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', lim.lock_minutes);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', lim.max_fails - a.fails);
end $$;
revoke all on function public.service_pin_login(text, text) from public, anon, authenticated;
grant execute on function public.service_pin_login(text, text) to service_role;

-- How many digits the PIN pad shows for an email: 4 for new accounts, 6 for older ones.
create or replace function public.login_pin_length(p_email text)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select c.pin_len::int from auth.users u join public.pin_credentials c on c.user_id = u.id
                   where lower(u.email) = lower(trim(p_email)) limit 1), 6);
$$;
revoke all on function public.login_pin_length(text) from public;
grant execute on function public.login_pin_length(text) to anon, authenticated;

-- Sets the signed-in person's PIN.
--  - Right after sign up (account under 24 hours old, no PIN yet): no current PIN
--    needed. The account's Supabase password is also replaced by a long random
--    value, so only the PIN (with its lockout) can sign in.
--  - Later: the current PIN is required.
create or replace function public.set_my_pin(p_pin text, p_current text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  cred public.pin_credentials;
  u record;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'Your PIN must be exactly 4 digits.';
  end if;
  if public.pin_too_simple(p_pin) then
    raise exception 'That PIN is too easy to guess. Avoid repeated digits and runs like 1234.';
  end if;
  select id, created_at, encrypted_password into u from auth.users where id = uid;
  select * into cred from public.pin_credentials where user_id = uid;

  if cred.user_id is not null then
    if p_current is null or crypt(p_current, cred.pin_hash) <> cred.pin_hash then
      raise exception 'Your current PIN is not right.';
    end if;
  elsif u.created_at < now() - interval '24 hours' then
    if p_current is null or u.encrypted_password is null or crypt(p_current, u.encrypted_password) <> u.encrypted_password then
      raise exception 'Your current PIN is not right.';
    end if;
  else
    update auth.users
    set encrypted_password = crypt(encode(gen_random_bytes(32), 'base64'), gen_salt('bf', 10))
    where id = uid;
  end if;

  insert into public.pin_credentials (user_id, pin_hash, pin_len, updated_at)
  values (uid, crypt(p_pin, gen_salt('bf', 10)), 4, now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, pin_len = 4, updated_at = now();
end $$;
revoke all on function public.set_my_pin(text, text) from public, anon;
grant execute on function public.set_my_pin(text, text) to authenticated;

-- Tidy old wrong-PIN rows now and then (called by the function, cheap).
create or replace function public.service_pin_cleanup()
returns void language sql security definer set search_path = public as $$
  delete from public.pin_attempts
  where (locked_until is null or locked_until < now()) and last_fail_at < now() - interval '2 days';
$$;
revoke all on function public.service_pin_cleanup() from public, anon, authenticated;
grant execute on function public.service_pin_cleanup() to service_role;

-- Report
select 'pin lockout' as what, (select value::text from public.app_settings where key = 'pin_lockout') as detail
union all
select 'accounts with a PIN stored here', (select count(*)::text from public.pin_credentials)
union all
select 'pgcrypto', (select extversion from pg_extension where extname = 'pgcrypto');
