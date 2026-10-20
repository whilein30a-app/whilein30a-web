-- 090: engagement tracking v2 (card W11) and the Business Portal tables
-- (cards W08 to W10).
--
-- Safe to run more than once. Read the notes at the top of each part first.
-- Run in the Supabase SQL editor. No app rebuild is needed for this file.
--
-- WHAT IT DOES
--   Part A  Locks down listing_engagement (it was "RLS always true"), moves
--           writes behind a function that validates and rate limits them,
--           and adds nightly daily totals (listing_stats_daily).
--   Part B  Business accounts: owners, applications, admin approval.
--   Part C  Deals and events submitted from the portal, with admin approval
--           and a monthly push limit.
--   Part D  The portal's stats function, and the schedules.
--
-- DECISIONS WORTH KNOWING
--   * Raw event rows are readable by admins only. Businesses read the daily
--     totals, which hold no device ids. That is stricter than "own rows".
--   * Duplicate taps are removed when the daily totals are built, not when
--     events are written, so the raw table always keeps every event.
--     Rule: the same device, listing and event type inside the same
--     30-minute block counts once.
--   * A "day" is a Central Time day, because that is where 30A is.
--   * The last 3 days are rebuilt every night to catch events that arrived
--     late from phones that were offline. Older days are never touched again,
--     so numbers do not move after the fact.
--   * "Visitor taps" (agreement 2.5) = call + directions + website +
--     deal_view. Change VISITOR_TAP_KINDS in portal_listing_stats and
--     engagement_month_summary together if that definition changes.

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_portal_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------
-- Part B first, because Part A policies refer to listing_owners.
-- ---------------------------------------------------------------------

create table if not exists public.listing_owners (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  email_reports boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

alter table public.listing_owners enable row level security;

create or replace function public.owns_listing(p_listing_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.listing_owners o
    where o.listing_id = p_listing_id and o.user_id = auth.uid()
  );
$$;

drop policy if exists listing_owners_select on public.listing_owners;
create policy listing_owners_select on public.listing_owners
  for select to authenticated
  using (user_id = auth.uid() or public.is_portal_admin());

-- Owners may switch their own report emails on or off, nothing else.
drop policy if exists listing_owners_update_own on public.listing_owners;
create policy listing_owners_update_own on public.listing_owners
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.listing_owners from anon, authenticated;
grant select on public.listing_owners to authenticated;
grant update (email_reports) on public.listing_owners to authenticated;

-- ---------------------------------------------------------------------
-- Part A: engagement v2
-- ---------------------------------------------------------------------

create table if not exists public.listing_engagement (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  kind text not null,
  visitor_hash text,
  created_at timestamptz not null default now()
);

alter table public.listing_engagement add column if not exists device_id text;
alter table public.listing_engagement add column if not exists session_id text;
alter table public.listing_engagement add column if not exists source text not null default 'direct';
alter table public.listing_engagement add column if not exists is_test boolean not null default false;

-- Remove old check constraints and the old "one per day" unique index. The
-- de-duplication now happens in the rollup instead.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.listing_engagement'::regclass and contype = 'c'
  loop
    execute format('alter table public.listing_engagement drop constraint %I', r.conname);
  end loop;
  for r in
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'listing_engagement'
      and indexdef ilike 'create unique index%' and indexname not like '%pkey'
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;

-- Old daily hashes become the device id for old rows, so history still counts.
update public.listing_engagement set device_id = visitor_hash where device_id is null and visitor_hash is not null;

-- Old event names to the agreed ones.
update public.listing_engagement set kind = 'detail_view' where kind = 'view';
update public.listing_engagement set kind = 'booking_request' where kind = 'booking';

alter table public.listing_engagement
  add constraint listing_engagement_kind_check check (kind in (
    'impression', 'detail_view', 'call', 'directions', 'website',
    'deal_view', 'deal_redeem', 'push_open', 'booking_request'
  ));

create index if not exists listing_engagement_device_time_idx on public.listing_engagement (device_id, created_at);
create index if not exists listing_engagement_listing_time_idx on public.listing_engagement (listing_id, created_at);
create index if not exists listing_engagement_time_idx on public.listing_engagement (created_at);

-- Devices to leave out of every count: the team's phones, test phones.
-- Add one with: insert into engagement_exclusions (device_id, note) values ('<id>', 'Raffy phone');
create table if not exists public.engagement_exclusions (
  device_id text primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table public.engagement_exclusions enable row level security;
revoke all on public.engagement_exclusions from anon, authenticated;

-- Replace every existing policy ("always true") on the raw table.
alter table public.listing_engagement enable row level security;
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'listing_engagement'
  loop
    execute format('drop policy %I on public.listing_engagement', r.policyname);
  end loop;
end $$;

create policy listing_engagement_admin_read on public.listing_engagement
  for select to authenticated
  using (public.is_portal_admin());

revoke all on public.listing_engagement from anon, authenticated;
grant select on public.listing_engagement to authenticated;

-- The only way in. Validates the event, the listing and a per-device rate.
create or replace function public.record_engagement(
  p_listing_id uuid,
  p_kind text,
  p_device text,
  p_session text,
  p_source text default 'direct',
  p_is_test boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  recent integer;
begin
  if p_listing_id is null or p_device is null or length(p_device) > 64 then
    return;
  end if;
  if p_kind is null or p_kind not in (
    'impression', 'detail_view', 'call', 'directions', 'website',
    'deal_view', 'deal_redeem', 'push_open', 'booking_request'
  ) then
    return;
  end if;
  if not exists (select 1 from public.listings where id = p_listing_id) then
    return;
  end if;

  -- 300 events per device per hour is far above real use.
  select count(*) into recent
  from public.listing_engagement
  where device_id = p_device and created_at > now() - interval '1 hour';
  if recent >= 300 then
    return;
  end if;

  insert into public.listing_engagement (listing_id, kind, device_id, session_id, source, is_test)
  values (
    p_listing_id,
    p_kind,
    p_device,
    left(coalesce(p_session, ''), 64),
    left(regexp_replace(lower(coalesce(p_source, 'direct')), '[^a-z_]', '', 'g'), 20),
    coalesce(p_is_test, false)
  );
end;
$$;

revoke all on function public.record_engagement(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.record_engagement(uuid, text, text, text, text, boolean) to anon, authenticated;

-- Daily totals. Portal and reports read only this.
create table if not exists public.listing_stats_daily (
  listing_id uuid not null references public.listings(id) on delete cascade,
  day date not null,
  kind text not null,
  source text not null default 'direct',
  events integer not null,
  devices integer not null,
  primary key (listing_id, day, kind, source)
);
create index if not exists listing_stats_daily_day_idx on public.listing_stats_daily (day);

alter table public.listing_stats_daily enable row level security;
drop policy if exists listing_stats_daily_read on public.listing_stats_daily;
create policy listing_stats_daily_read on public.listing_stats_daily
  for select to authenticated
  using (public.is_portal_admin() or public.owns_listing(listing_id));
revoke all on public.listing_stats_daily from anon, authenticated;
grant select on public.listing_stats_daily to authenticated;

-- Rebuilds the totals for a range of Central Time days.
create or replace function public.rollup_engagement(p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
  t_from timestamptz := (p_from::timestamp) at time zone 'America/Chicago';
  t_to timestamptz := ((p_to + 1)::timestamp) at time zone 'America/Chicago';
begin
  delete from public.listing_stats_daily where day between p_from and p_to;

  with counted as (
    select distinct on (e.listing_id, e.kind, e.device_id, floor(extract(epoch from e.created_at) / 1800))
      e.listing_id,
      e.kind,
      e.device_id,
      e.source,
      (e.created_at at time zone 'America/Chicago')::date as day
    from public.listing_engagement e
    where e.created_at >= t_from and e.created_at < t_to
      and e.is_test = false
      and e.device_id is not null
      and not exists (select 1 from public.engagement_exclusions x where x.device_id = e.device_id)
    order by e.listing_id, e.kind, e.device_id, floor(extract(epoch from e.created_at) / 1800), e.created_at
  )
  insert into public.listing_stats_daily (listing_id, day, kind, source, events, devices)
  select listing_id, day, kind, coalesce(source, 'direct'), count(*), count(distinct device_id)
  from counted
  group by listing_id, day, kind, coalesce(source, 'direct');

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.rollup_engagement(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Part B: business accounts and approval
-- ---------------------------------------------------------------------

create table if not exists public.portal_audit (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  listing_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.portal_audit enable row level security;
revoke all on public.portal_audit from anon, authenticated;
grant select on public.portal_audit to authenticated;
drop policy if exists portal_audit_admin_read on public.portal_audit;
create policy portal_audit_admin_read on public.portal_audit
  for select to authenticated using (public.is_portal_admin());

create table if not exists public.business_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null check (char_length(business_name) between 2 and 120),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  claim_listing_id uuid references public.listings(id) on delete set null,
  new_listing jsonb,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists business_applications_status_idx on public.business_applications (status, created_at);

alter table public.business_applications enable row level security;
drop policy if exists business_applications_select on public.business_applications;
create policy business_applications_select on public.business_applications
  for select to authenticated
  using (user_id = auth.uid() or public.is_portal_admin());
drop policy if exists business_applications_insert on public.business_applications;
create policy business_applications_insert on public.business_applications
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);
revoke all on public.business_applications from anon, authenticated;
grant select, insert on public.business_applications to authenticated;

-- A person can have at most 3 pending applications at once.
create or replace function public.business_applications_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.business_applications
      where user_id = new.user_id and status = 'pending') >= 3 then
    raise exception 'Too many pending applications';
  end if;
  return new;
end $$;
drop trigger if exists business_applications_limit_trg on public.business_applications;
create trigger business_applications_limit_trg
  before insert on public.business_applications
  for each row execute function public.business_applications_limit();

create or replace function public.admin_review_application(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.business_applications;
  new_id uuid;
  nl jsonb;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select * into a from public.business_applications where id = p_id for update;
  if not found or a.status <> 'pending' then
    raise exception 'Application not found or already reviewed';
  end if;

  if p_approve then
    if a.claim_listing_id is not null then
      insert into public.listing_owners (user_id, listing_id)
      values (a.user_id, a.claim_listing_id)
      on conflict do nothing;
    elsif a.new_listing is not null then
      nl := a.new_listing;
      insert into public.listings (name, category, address, phone, website, description)
      values (
        left(coalesce(nl->>'name', a.business_name), 120),
        left(nl->>'category', 60),
        left(nl->>'address', 200),
        left(nl->>'phone', 40),
        left(nl->>'website', 300),
        left(nl->>'description', 1500)
      ) returning id into new_id;
      insert into public.listing_owners (user_id, listing_id) values (a.user_id, new_id);
    else
      raise exception 'Application has no listing to claim or create';
    end if;
  end if;

  update public.business_applications
  set status = case when p_approve then 'approved' else 'rejected' end,
      review_note = left(p_note, 500),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_id;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), case when p_approve then 'application_approved' else 'application_rejected' end,
          coalesce(a.claim_listing_id, new_id), jsonb_build_object('application', p_id));
end $$;
revoke all on function public.admin_review_application(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_application(uuid, boolean, text) to authenticated;

-- Owners edit only these fields, only on listings they own.
create or replace function public.portal_update_listing(p_listing_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  site text;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  if p_fields ? 'website' then
    site := nullif(trim(p_fields->>'website'), '');
    if site is not null and site !~* '^https?://[^\s]+$' then
      raise exception 'Website must start with http:// or https://';
    end if;
  end if;

  update public.listings set
    description = case when p_fields ? 'description' then nullif(left(p_fields->>'description', 1500), '') else description end,
    phone = case when p_fields ? 'phone' then nullif(left(p_fields->>'phone', 40), '') else phone end,
    website = case when p_fields ? 'website' then site else website end
  where id = p_listing_id;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'listing_updated', p_listing_id, p_fields);
end $$;
revoke all on function public.portal_update_listing(uuid, jsonb) from public, anon;
grant execute on function public.portal_update_listing(uuid, jsonb) to authenticated;

-- What a signed-in owner sees as "my listings".
create or replace function public.portal_my_listings()
returns table (id uuid, name text, category text, address text, phone text, website text, description text, is_sponsored boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.category, l.address, l.phone, l.website, l.description, l.is_sponsored
  from public.listings l
  join public.listing_owners o on o.listing_id = l.id and o.user_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.portal_my_listings() from public, anon;
grant execute on function public.portal_my_listings() to authenticated;

-- ---------------------------------------------------------------------
-- Part C: deals and events from the portal, with approval and push limits
-- ---------------------------------------------------------------------

alter table public.deals add column if not exists review_status text not null default 'approved';
alter table public.deals add column if not exists review_note text;
alter table public.deals add column if not exists created_by uuid;
alter table public.deals add column if not exists live_at timestamptz;
alter table public.deals add column if not exists send_push boolean not null default true;
update public.deals set live_at = created_at where live_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_review_status_check') then
    alter table public.deals add constraint deals_review_status_check check (review_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- How many promotional pushes a listing may trigger per month.
create table if not exists public.listing_push_limits (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  monthly_limit integer not null default 2 check (monthly_limit between 0 and 100)
);
alter table public.listing_push_limits enable row level security;
revoke all on public.listing_push_limits from anon, authenticated;
grant select on public.listing_push_limits to authenticated;
drop policy if exists listing_push_limits_read on public.listing_push_limits;
create policy listing_push_limits_read on public.listing_push_limits
  for select to authenticated using (public.is_portal_admin() or public.owns_listing(listing_id));

create or replace function public.pushes_used_this_month(p_listing_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.deals d
  where d.listing_id = p_listing_id and d.send_push and d.review_status = 'approved'
    and d.live_at >= date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago';
$$;

create or replace function public.portal_my_deals(p_listing_id uuid)
returns setof public.deals
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  return query select * from public.deals where listing_id = p_listing_id order by created_at desc;
end $$;
revoke all on function public.portal_my_deals(uuid) from public, anon;
grant execute on function public.portal_my_deals(uuid) to authenticated;

-- Creates or edits a deal. Anything an owner saves goes back to "pending"
-- and stays hidden until an admin approves it.
create or replace function public.portal_save_deal(
  p_listing_id uuid,
  p_deal_id uuid,
  p_title text,
  p_discount_text text,
  p_valid_until date,
  p_send_push boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  result uuid;
  limit_n integer;
  want_push boolean := coalesce(p_send_push, false);
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  if p_title is null or char_length(trim(p_title)) < 3 or char_length(p_title) > 80 then
    raise exception 'Title must be 3 to 80 characters';
  end if;
  if p_discount_text is null or char_length(trim(p_discount_text)) < 2 or char_length(p_discount_text) > 160 then
    raise exception 'Deal text must be 2 to 160 characters';
  end if;
  if p_valid_until is not null and p_valid_until < current_date then
    raise exception 'The end date is in the past';
  end if;

  if want_push then
    select coalesce((select monthly_limit from public.listing_push_limits where listing_id = p_listing_id), 2) into limit_n;
    if public.pushes_used_this_month(p_listing_id) >= limit_n then
      raise exception 'Monthly push limit reached (%). Save the deal without a push notification.', limit_n;
    end if;
  end if;

  if p_deal_id is null then
    insert into public.deals (listing_id, title, discount_text, valid_until, is_active, review_status, created_by, send_push)
    values (p_listing_id, trim(p_title), trim(p_discount_text), p_valid_until, false, 'pending', auth.uid(), want_push)
    returning id into result;
  else
    update public.deals
    set title = trim(p_title), discount_text = trim(p_discount_text), valid_until = p_valid_until,
        is_active = false, review_status = 'pending', review_note = null, send_push = want_push
    where id = p_deal_id and listing_id = p_listing_id
    returning id into result;
    if result is null then
      raise exception 'Deal not found';
    end if;
  end if;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'deal_saved', p_listing_id, jsonb_build_object('deal', result));
  return result;
end $$;
revoke all on function public.portal_save_deal(uuid, uuid, text, text, date, boolean) from public, anon;
grant execute on function public.portal_save_deal(uuid, uuid, text, text, date, boolean) to authenticated;

-- Owners can always switch an approved deal off, and back on. They cannot
-- switch on a deal that has not been approved.
create or replace function public.portal_set_deal_active(p_deal_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.deals;
begin
  select * into d from public.deals where id = p_deal_id;
  if not found or not (public.owns_listing(d.listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  if p_active and d.review_status <> 'approved' then
    raise exception 'This deal has not been approved yet';
  end if;
  update public.deals set is_active = p_active where id = p_deal_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'deal_active', d.listing_id, jsonb_build_object('deal', p_deal_id, 'active', p_active));
end $$;
revoke all on function public.portal_set_deal_active(uuid, boolean) from public, anon;
grant execute on function public.portal_set_deal_active(uuid, boolean) to authenticated;

create or replace function public.admin_review_deal(p_deal_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.deals;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select * into d from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Deal not found';
  end if;
  if p_approve then
    -- A deal over the monthly push limit still goes live, just without a push.
    if d.send_push and (
         select count(*) from public.deals x
         where x.listing_id = d.listing_id and x.id <> d.id and x.send_push and x.review_status = 'approved'
           and x.live_at >= date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago'
       ) >= coalesce((select monthly_limit from public.listing_push_limits where listing_id = d.listing_id), 2) then
      update public.deals set send_push = false where id = p_deal_id;
    end if;
    update public.deals
    set review_status = 'approved', review_note = null, is_active = true, live_at = now()
    where id = p_deal_id;
  else
    update public.deals
    set review_status = 'rejected', review_note = left(p_note, 500), is_active = false
    where id = p_deal_id;
  end if;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), case when p_approve then 'deal_approved' else 'deal_rejected' end, d.listing_id, jsonb_build_object('deal', p_deal_id));
end $$;
revoke all on function public.admin_review_deal(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_deal(uuid, boolean, text) to authenticated;

create or replace function public.admin_pending_deals()
returns table (id uuid, listing_id uuid, listing_name text, title text, discount_text text, valid_until date, send_push boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select d.id, d.listing_id, l.name, d.title, d.discount_text, d.valid_until::date, d.send_push, d.created_at
    from public.deals d join public.listings l on l.id = d.listing_id
    where d.review_status = 'pending' order by d.created_at;
end $$;
revoke all on function public.admin_pending_deals() from public, anon;
grant execute on function public.admin_pending_deals() to authenticated;

-- Events submitted from the portal wait here until approved, then are copied
-- into the public events table.
create table if not exists public.event_submissions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  venue_name text check (venue_name is null or char_length(venue_name) <= 100),
  town text check (town is null or char_length(town) <= 60),
  address text check (address is null or char_length(address) <= 200),
  start_date date not null,
  start_time text check (start_time is null or char_length(start_time) <= 20),
  end_time text check (end_time is null or char_length(end_time) <= 20),
  ticket_url text check (ticket_url is null or ticket_url ~* '^https?://[^\s]+$'),
  category text check (category is null or char_length(category) <= 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  published_event_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists event_submissions_status_idx on public.event_submissions (status, created_at);
alter table public.event_submissions enable row level security;
drop policy if exists event_submissions_select on public.event_submissions;
create policy event_submissions_select on public.event_submissions
  for select to authenticated
  using (public.is_portal_admin() or public.owns_listing(listing_id));
revoke all on public.event_submissions from anon, authenticated;
grant select on public.event_submissions to authenticated;

create or replace function public.portal_submit_event(
  p_listing_id uuid,
  p_title text,
  p_venue_name text,
  p_town text,
  p_address text,
  p_start_date date,
  p_start_time text,
  p_end_time text,
  p_ticket_url text,
  p_category text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  result uuid;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  if p_start_date is null or p_start_date < current_date then
    raise exception 'Choose a start date that is today or later';
  end if;
  if (select count(*) from public.event_submissions
      where listing_id = p_listing_id and status = 'pending') >= 10 then
    raise exception 'Too many events waiting for review';
  end if;
  insert into public.event_submissions
    (listing_id, submitted_by, title, venue_name, town, address, start_date, start_time, end_time, ticket_url, category)
  values
    (p_listing_id, auth.uid(), trim(p_title), nullif(trim(p_venue_name), ''), nullif(trim(p_town), ''),
     nullif(trim(p_address), ''), p_start_date, nullif(trim(p_start_time), ''), nullif(trim(p_end_time), ''),
     nullif(trim(p_ticket_url), ''), nullif(trim(p_category), ''))
  returning id into result;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'event_submitted', p_listing_id, jsonb_build_object('submission', result));
  return result;
end $$;
revoke all on function public.portal_submit_event(uuid, text, text, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.portal_submit_event(uuid, text, text, text, text, date, text, text, text, text) to authenticated;

create or replace function public.admin_review_event(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.event_submissions;
  new_id uuid;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select * into s from public.event_submissions where id = p_id for update;
  if not found or s.status <> 'pending' then
    raise exception 'Submission not found or already reviewed';
  end if;
  if p_approve then
    insert into public.events (title, venue_name, town, address, start_date, start_time, end_time, ticket_url, category)
    values (s.title, s.venue_name, s.town, s.address, s.start_date, s.start_time, s.end_time, s.ticket_url, s.category)
    returning id into new_id;
  end if;
  update public.event_submissions
  set status = case when p_approve then 'approved' else 'rejected' end,
      review_note = left(p_note, 500),
      published_event_id = new_id
  where id = p_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), case when p_approve then 'event_approved' else 'event_rejected' end, s.listing_id, jsonb_build_object('submission', p_id));
end $$;
revoke all on function public.admin_review_event(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_event(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Part D: stats for the portal and the monthly email
-- ---------------------------------------------------------------------

-- Last 30 days against the 30 before, by event type, in Central Time.
create or replace function public.portal_listing_stats(p_listing_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  result jsonb;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;

  with d as (
    select day, kind, source, events,
           case when day > today - 30 and day <= today then 'cur'
                when day > today - 60 and day <= today - 30 then 'prev' end as period
    from public.listing_stats_daily
    where listing_id = p_listing_id and day > today - 60
  ),
  kinds as (
    select kind,
           coalesce(sum(events) filter (where period = 'cur'), 0) as cur,
           coalesce(sum(events) filter (where period = 'prev'), 0) as prev
    from d where period is not null group by kind
  ),
  taps as (
    -- VISITOR_TAP_KINDS
    select coalesce(sum(events) filter (where period = 'cur'), 0) as cur,
           coalesce(sum(events) filter (where period = 'prev'), 0) as prev
    from d where kind in ('call', 'directions', 'website', 'deal_view')
  ),
  best as (
    select day, sum(events) as n from d
    where period = 'cur' and kind in ('call', 'directions', 'website', 'deal_view')
    group by day order by n desc, day desc limit 1
  ),
  top_source as (
    select source, sum(events) as n from d
    where period = 'cur' and kind in ('call', 'directions', 'website', 'deal_view')
    group by source order by n desc limit 1
  ),
  series as (
    select day,
           coalesce(sum(events) filter (where kind in ('call', 'directions', 'website', 'deal_view')), 0) as taps,
           coalesce(sum(events) filter (where kind = 'detail_view'), 0) as views
    from d where period = 'cur' group by day
  )
  select jsonb_build_object(
    'kinds', coalesce((select jsonb_object_agg(kind, jsonb_build_object('cur', cur, 'prev', prev)) from kinds), '{}'::jsonb),
    'visitor_taps', (select jsonb_build_object('cur', cur, 'prev', prev) from taps),
    'best_day', (select jsonb_build_object('day', day, 'taps', n) from best),
    'top_source', (select source from top_source),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'taps', taps, 'views', views) order by day) from series), '[]'::jsonb),
    'through', today - 1
  ) into result;
  return result;
end $$;
revoke all on function public.portal_listing_stats(uuid) from public, anon;
grant execute on function public.portal_listing_stats(uuid) to authenticated;

-- Used by the monthly email (service role only).
drop function if exists public.listing_engagement_summary(uuid, timestamptz, timestamptz);
create or replace function public.engagement_month_summary(p_listing_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public as $$
  with cur as (
    select kind, source, day, events from public.listing_stats_daily
    where listing_id = p_listing_id and day >= p_from and day < p_to
  ),
  prev as (
    select kind, events from public.listing_stats_daily
    where listing_id = p_listing_id
      and day >= (p_from - (p_to - p_from)) and day < p_from
  )
  select jsonb_build_object(
    'taps', coalesce((select sum(events) from cur where kind in ('call', 'directions', 'website', 'deal_view')), 0),
    'views', coalesce((select sum(events) from cur where kind = 'detail_view'), 0),
    'impressions', coalesce((select sum(events) from cur where kind = 'impression'), 0),
    'prev_taps', coalesce((select sum(events) from prev where kind in ('call', 'directions', 'website', 'deal_view')), 0),
    'prev_views', coalesce((select sum(events) from prev where kind = 'detail_view'), 0),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, sum(events) n from cur group by kind) k), '{}'::jsonb),
    'best_day', (select day from cur where kind in ('call', 'directions', 'website', 'deal_view')
                 group by day order by sum(events) desc, day limit 1),
    'top_source', (select source from cur where kind in ('call', 'directions', 'website', 'deal_view')
                   group by source order by sum(events) desc limit 1)
  );
$$;
revoke all on function public.engagement_month_summary(uuid, date, date) from public, anon, authenticated;
grant execute on function public.engagement_month_summary(uuid, date, date) to service_role;

-- notify-new-deal now goes by live_at (set when a deal is approved or was
-- created directly) and skips deals with send_push = false.

-- ---------------------------------------------------------------------
-- Schedules (pg_cron). If this block says the extension is missing, turn on
-- "pg_cron" under Database > Extensions, then run it again.
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('engagement-rollup', 'engagement-retention');
  -- 09:15 UTC is the middle of the night in Central Time. Rebuilds the last
  -- 3 complete days.
  perform cron.schedule(
    'engagement-rollup', '15 9 * * *',
    $job$ select public.rollup_engagement(
            (now() at time zone 'America/Chicago')::date - 3,
            (now() at time zone 'America/Chicago')::date - 1) $job$
  );
  -- Raw events are kept 14 months (13 needed for year over year).
  perform cron.schedule(
    'engagement-retention', '30 9 2 * *',
    $job$ delete from public.listing_engagement where created_at < now() - interval '14 months' $job$
  );
exception when others then
  raise notice 'Schedules were not created: %. Turn on pg_cron and run this block again.', sqlerrm;
end $$;

-- First fill: totals for everything already recorded.
select public.rollup_engagement(date '2026-01-01', (now() at time zone 'America/Chicago')::date - 1);

-- Helpers are for signed-in users only.
revoke all on function public.is_portal_admin() from public, anon;
revoke all on function public.owns_listing(uuid) from public, anon;
revoke all on function public.pushes_used_this_month(uuid) from public, anon;
grant execute on function public.is_portal_admin() to authenticated;
grant execute on function public.owns_listing(uuid) to authenticated;
grant execute on function public.pushes_used_this_month(uuid) to authenticated;
revoke all on function public.business_applications_limit() from public, anon, authenticated;
