-- 111: Lost & Found report and block, and a PIN limit per IP and device
-- (Kevin's Update 134 review, Nov 4, 2026). Needs sql/102, 108, 109 and 110.
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Lost & Found
--  - Every post can be reported (6 reasons). Reports go to Portal > Admin >
--    Lost & Found and email the admin address.
--  - Reports from different accounts count. The poster's own reports don't.
--    At 3 (app_settings > lost_found > auto_hide_reports) the post is hidden
--    until an admin looks at it.
--  - Hidden posts are filtered by the database, not only the app. The poster
--    still sees their own hidden post, marked as hidden.
--  - People banned from posting can't post here either.
--  - Blocking uses the same block list as Photo Wall and reviews (sql/102).
--
-- PIN sign in
--  - On top of the 5 tries per email lockout (sql/108): 20 wrong tries an hour
--    from one IP address, or from one device, pauses sign in from there. Both
--    numbers are in app_settings > pin_lockout.
--  - IP addresses and device ids are stored only as SHA-256 hashes.
--  - When an older 6-digit account signs in for the first time after 134, its
--    Supabase password (which was the PIN) is now replaced by a long random
--    value, so the PIN can only be tried through the limited sign in.

create extension if not exists pgcrypto with schema extensions;

-------------------------------------------------------------------------------
-- Lost & Found
-------------------------------------------------------------------------------

insert into public.app_settings (key, value, is_public)
values ('lost_found', '{"auto_hide_reports": 3}', false)
on conflict (key) do nothing;

alter table public.lost_found_posts add column if not exists is_hidden boolean not null default false;
alter table public.lost_found_posts add column if not exists hidden_reason text;

-- Hidden posts: only the poster sees them. A restrictive policy is added on
-- top of the existing ones, so nothing else about who can read changes.
drop policy if exists lost_found_hide_hidden on public.lost_found_posts;
create policy lost_found_hide_hidden on public.lost_found_posts
  as restrictive for select to public
  using (not is_hidden or user_id = auth.uid());

-- Only the moderation functions below can change is_hidden. A poster can still
-- mark their post resolved or delete it, but cannot unhide it.
create or replace function public.lost_found_guard_hidden()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.lost_found_moderation', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.is_hidden := false;
      new.hidden_reason := null;
    else
      new.is_hidden := old.is_hidden;
      new.hidden_reason := old.hidden_reason;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.lost_found_guard_hidden() from public, anon, authenticated;
drop trigger if exists lost_found_guard_hidden on public.lost_found_posts;
create trigger lost_found_guard_hidden before insert or update on public.lost_found_posts
  for each row execute function public.lost_found_guard_hidden();

-- Posting bans (sql/102) now cover Lost & Found too. The message no longer
-- names the old in30A address.
create or replace function public.reject_banned_poster()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who uuid := nullif(to_jsonb(new)->>'user_id', '')::uuid;
begin
  if who is not null and exists (select 1 from public.profiles where id = who and posting_banned_at is not null) then
    raise exception 'Your account cannot post right now. If you think this is a mistake, contact us from Profile > Support.';
  end if;
  return new;
end $$;
revoke all on function public.reject_banned_poster() from public, anon, authenticated;
drop trigger if exists reject_banned_poster on public.lost_found_posts;
create trigger reject_banned_poster before insert on public.lost_found_posts
  for each row execute function public.reject_banned_poster();

-- Reports. post_id takes the same type as lost_found_posts.id.
do $$
declare
  id_type text;
begin
  if to_regclass('public.lost_found_reports') is null then
    select format_type(a.atttypid, a.atttypmod) into id_type
    from pg_attribute a
    where a.attrelid = 'public.lost_found_posts'::regclass and a.attname = 'id';
    execute format($t$
      create table public.lost_found_reports (
        id uuid primary key default gen_random_uuid(),
        post_id %s not null references public.lost_found_posts(id) on delete cascade,
        reporter uuid not null references auth.users(id) on delete cascade,
        reason text not null check (reason in ('scam', 'spam', 'inappropriate', 'harassment', 'personal_info', 'other')),
        note text check (note is null or char_length(note) <= 500),
        counts boolean not null default true,
        created_at timestamptz not null default now(),
        resolved_at timestamptz,
        resolved_by uuid,
        resolution text,
        unique (post_id, reporter)
      )$t$, id_type);
  end if;
end $$;
alter table public.lost_found_reports enable row level security;
revoke all on public.lost_found_reports from public, anon, authenticated;
-- No policies: reports are written and read only through the functions below.

create or replace function public.lost_found_reason_label(p_reason text)
returns text language sql immutable as $$
  select case p_reason
    when 'scam' then 'Scam or fraud'
    when 'spam' then 'Spam'
    when 'inappropriate' then 'Inappropriate'
    when 'harassment' then 'Harassment'
    when 'personal_info' then 'Personal information'
    else 'Other' end;
$$;

-- Report a post. Returns {hidden: true|false}.
drop function if exists public.report_lost_found(text, text, text);
create or replace function public.report_lost_found(p_post_id text, p_reason text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p record;
  threshold int := greatest(1, coalesce(
    (select (value->>'auto_hide_reports')::int from public.app_settings where key = 'lost_found'),
    (select (value->>'auto_hide_reports')::int from public.app_settings where key = 'reviews'),
    3));
  n_counted int;
  n_open int;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_reason is null or p_reason not in ('scam', 'spam', 'inappropriate', 'harassment', 'personal_info', 'other') then
    raise exception 'Pick a reason.';
  end if;
  select id, user_id, is_hidden, item_description into p from public.lost_found_posts where id::text = p_post_id;
  if p.id is null then raise exception 'That post is gone.'; end if;
  if p.user_id = me then raise exception 'You can delete your own post instead.'; end if;

  perform pg_advisory_xact_lock(hashtext('lf_report:' || p.id::text));

  insert into public.lost_found_reports (post_id, reporter, reason, note, counts)
  values (p.id, me, p_reason, left(nullif(trim(coalesce(p_note, '')), ''), 500), true)
  on conflict (post_id, reporter) do update
    set reason = excluded.reason, note = excluded.note, created_at = now(),
        resolved_at = null, resolved_by = null, resolution = null;

  select count(distinct reporter) filter (where counts and reporter is distinct from p.user_id),
         count(*)
  into n_counted, n_open
  from public.lost_found_reports where post_id = p.id and resolved_at is null;

  if n_counted >= threshold and not p.is_hidden then
    perform set_config('app.lost_found_moderation', '1', true);
    update public.lost_found_posts set is_hidden = true, hidden_reason = 'auto_hide' where id = p.id;
    perform set_config('app.lost_found_moderation', '', true);
    begin
      perform public.queue_email(public.admin_notify_address(), 'lost_found_auto_hidden',
        'Lost & Found post hidden after reports',
        'A Lost & Found post got ' || n_counted || ' reports from different accounts and is hidden until you look at it.' || E'\n\n' ||
        'Post: ' || left(p.item_description, 200) || E'\n\n' ||
        'Portal > Admin > Lost & Found. Restore it if it breaks no rule.', null);
    exception when others then null;
    end;
    return jsonb_build_object('hidden', true);
  end if;

  if n_open = 1 then
    begin
      perform public.queue_email(public.admin_notify_address(), 'lost_found_reported',
        'Lost & Found post reported: ' || public.lost_found_reason_label(p_reason),
        'A Lost & Found post was reported: ' || public.lost_found_reason_label(p_reason) || '.' || E'\n\n' ||
        'Post: ' || left(p.item_description, 200) || E'\n\n' ||
        'Please check it within 24 hours: Portal > Admin > Lost & Found.', null);
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('hidden', false);
end $$;
revoke all on function public.report_lost_found(text, text, text) from public, anon;
grant execute on function public.report_lost_found(text, text, text) to authenticated;

-- Admin list. scope 'reported' (open reports or hidden) or 'all' (latest 100).
drop function if exists public.admin_lost_found_queue(text);
create or replace function public.admin_lost_found_queue(p_scope text default 'reported')
returns table (
  id text, post_type text, item_description text, location_name text, contact_info text,
  created_at timestamptz, is_resolved boolean, is_hidden boolean, hidden_reason text,
  user_id uuid, email text, posting_banned boolean, open_reports integer, reports jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then raise exception 'Not allowed'; end if;
  return query
    select p.id::text, p.post_type::text, p.item_description::text, p.location_name::text, p.contact_info::text,
           p.created_at, p.is_resolved, p.is_hidden, p.hidden_reason,
           p.user_id, u.email::text, coalesce(pr.posting_banned_at is not null, false),
           coalesce(r.n, 0)::int, coalesce(r.list, '[]'::jsonb)
    from public.lost_found_posts p
    left join auth.users u on u.id = p.user_id
    left join public.profiles pr on pr.id = p.user_id
    left join lateral (
      select count(*) as n,
             jsonb_agg(jsonb_build_object('reason', public.lost_found_reason_label(x.reason), 'note', x.note,
                                          'email', ru.email, 'at', x.created_at) order by x.created_at) as list
      from public.lost_found_reports x
      left join auth.users ru on ru.id = x.reporter
      where x.post_id = p.id and x.resolved_at is null
    ) r on true
    where p_scope = 'all' or p.is_hidden or coalesce(r.n, 0) > 0
    order by coalesce(r.n, 0) > 0 desc, p.created_at desc
    limit 100;
end $$;
revoke all on function public.admin_lost_found_queue(text) from public, anon;
grant execute on function public.admin_lost_found_queue(text) to authenticated;

-- hide | restore | remove | dismiss. Restore and dismiss close the open reports.
create or replace function public.admin_moderate_lost_found(p_id text, p_action text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  pid_text text;
  n int;
begin
  if not public.is_portal_admin() then raise exception 'Not allowed'; end if;
  if p_action not in ('hide', 'restore', 'remove', 'dismiss') then raise exception 'Unknown action'; end if;
  select id::text into pid_text from public.lost_found_posts where id::text = p_id;
  if pid_text is null then raise exception 'Post not found'; end if;

  if p_action = 'remove' then
    delete from public.lost_found_posts where id::text = p_id;
  else
    perform set_config('app.lost_found_moderation', '1', true);
    if p_action = 'hide' then
      update public.lost_found_posts set is_hidden = true, hidden_reason = 'admin' where id::text = p_id;
    elsif p_action = 'restore' then
      update public.lost_found_posts set is_hidden = false, hidden_reason = null where id::text = p_id;
    end if;
    perform set_config('app.lost_found_moderation', '', true);
    if p_action in ('restore', 'dismiss') then
      update public.lost_found_reports
      set resolved_at = now(), resolved_by = auth.uid(), resolution = p_action
      where post_id::text = p_id and resolved_at is null;
    end if;
  end if;
  get diagnostics n = row_count;

  insert into public.portal_audit (user_id, action, detail)
  values (auth.uid(), 'lost_found_' || p_action, jsonb_build_object('post', p_id, 'note', left(p_note, 300)));
end $$;
revoke all on function public.admin_moderate_lost_found(text, text, text) from public, anon;
grant execute on function public.admin_moderate_lost_found(text, text, text) to authenticated;

-------------------------------------------------------------------------------
-- PIN limit per IP and device
-------------------------------------------------------------------------------

update public.app_settings
set value = value || '{"source_max_fails": 20, "source_window_minutes": 60}'
where key = 'pin_lockout' and not (value ? 'source_max_fails');

create table if not exists public.pin_source_attempts (
  source text primary key,        -- 'ip:<sha256>' or 'dev:<sha256>'
  fails integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.pin_source_attempts enable row level security;
revoke all on public.pin_source_attempts from public, anon, authenticated;

-- What the pin-login function calls from update 135 on. Checks the IP and
-- device limits, then the per-email check in service_pin_login (sql/108).
create or replace function public.service_pin_login_limited(p_email text, p_pin text, p_ip text, p_device text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v jsonb := coalesce((select value from public.app_settings where key = 'pin_lockout'), '{}'::jsonb);
  max_fails int := greatest(5, coalesce((v->>'source_max_fails')::int, 20));
  window_min int := greatest(5, coalesce((v->>'source_window_minutes')::int, 60));
  keys text[] := array[]::text[];
  k text;
  a public.pin_source_attempts;
  wait_min int := 0;
  res jsonb;
begin
  if coalesce(trim(p_ip), '') <> '' then
    keys := keys || ('ip:' || encode(digest(trim(p_ip), 'sha256'), 'hex'));
  end if;
  if coalesce(trim(p_device), '') <> '' then
    keys := keys || ('dev:' || encode(digest(left(trim(p_device), 200), 'sha256'), 'hex'));
  end if;

  -- Same order every time, so two requests never wait on each other in a loop.
  select coalesce(array_agg(x order by x), array[]::text[]) into keys from unnest(keys) x;
  foreach k in array keys loop
    perform pg_advisory_xact_lock(hashtext('pinsrc:' || k));
  end loop;

  foreach k in array keys loop
    select * into a from public.pin_source_attempts where source = k;
    if a.source is not null and a.window_start > now() - make_interval(mins => window_min) and a.fails >= max_fails then
      wait_min := greatest(wait_min, ceil(extract(epoch from (a.window_start + make_interval(mins => window_min) - now())) / 60)::int);
    end if;
  end loop;
  if wait_min > 0 then
    -- Same answer shape as the email lockout, so every app version shows it.
    return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', greatest(1, wait_min), 'scope', 'source');
  end if;

  res := public.service_pin_login(p_email, p_pin);

  if coalesce((res->>'ok')::boolean, false) then
    -- First sign in of an older account: its Supabase password was the PIN.
    if coalesce((res->>'migrated')::boolean, false) then
      update auth.users
      set encrypted_password = crypt(encode(gen_random_bytes(32), 'base64'), gen_salt('bf', 10))
      where id = (res->>'user_id')::uuid;
    end if;
    return res;
  end if;

  foreach k in array keys loop
    insert into public.pin_source_attempts as s (source, fails, window_start)
    values (k, 1, now())
    on conflict (source) do update set
      fails = case when s.window_start <= now() - make_interval(mins => window_min) then 1 else s.fails + 1 end,
      window_start = case when s.window_start <= now() - make_interval(mins => window_min) then now() else s.window_start end;
  end loop;
  return res;
end $$;
revoke all on function public.service_pin_login_limited(text, text, text, text) from public, anon, authenticated;
grant execute on function public.service_pin_login_limited(text, text, text, text) to service_role;

-- Cleanup now also clears old IP and device rows.
create or replace function public.service_pin_cleanup()
returns void language sql security definer set search_path = public as $$
  delete from public.pin_attempts
  where (locked_until is null or locked_until < now()) and last_fail_at < now() - interval '2 days';
  delete from public.pin_source_attempts where window_start < now() - interval '1 day';
$$;
revoke all on function public.service_pin_cleanup() from public, anon, authenticated;
grant execute on function public.service_pin_cleanup() to service_role;

-------------------------------------------------------------------------------
-- Report
-------------------------------------------------------------------------------
select 'lost & found row security' as what,
       case when c.relrowsecurity then 'on' else 'OFF (tell Raffy)' end as detail
from pg_class c where c.oid = 'public.lost_found_posts'::regclass
union all
select 'lost & found auto-hide after reports', (select value->>'auto_hide_reports' from public.app_settings where key = 'lost_found')
union all
select 'lost & found open reports', (select count(*)::text from public.lost_found_reports where resolved_at is null)
union all
select 'pin limit per ip/device', (select (value->>'source_max_fails') || ' wrong tries per ' || (value->>'source_window_minutes') || ' minutes'
                                   from public.app_settings where key = 'pin_lockout');
