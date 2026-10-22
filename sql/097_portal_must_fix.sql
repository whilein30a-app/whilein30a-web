-- 097: Business Portal must-fix group (Kevin's walkthrough, Oct 21-22, 2026).
--
--  1. A new business needs a map pin before it can be approved.
--     admin_review_application takes the pin (or "no street address") and a subcategory.
--     admin_set_pin lets admin fix any listing's pin in one step.
--  2. One Basic rule, enforced by the server whatever the admin toggle says:
--     Basic = name, address, pin, phone, hours. Description, links, logo, deals and
--     events are Premium and above. Admin is never blocked.
--  3. Hours: listings.hours_note (plain text, one line per day). The app shows it.
--  4. Plan requests: a business without a payment link taps "Request this plan";
--     admin gets an email and a row in plan_requests.
--  5. portal_slots_left: how many Featured / Spotlight places are open in a subcategory.
--  6. Email outbox: triggers queue emails; the send-outbox function sends them.
--
-- Safe to run more than once. Run after 096.

-- ---------------------------------------------------------------------
-- 3. Hours
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists hours_note text
  check (hours_note is null or char_length(hours_note) <= 600);

-- The portal also needs to read hours_note.
drop function if exists public.portal_my_listings();
create or replace function public.portal_my_listings()
returns table (
  id uuid, name text, category text, subcategory text, address text, phone text, website text,
  description text, is_sponsored boolean, plan text, billing text, is_founding boolean,
  plan_expires_on date, logo_url text, menu_url text, booking_url text, hours_note text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.category, l.subcategory, l.address, l.phone, l.website, l.description,
         l.is_sponsored, l.plan, l.billing, l.is_founding, l.plan_expires_on, l.logo_url, l.menu_url, l.booking_url, l.hours_note
  from public.listings l
  join public.listing_owners o on o.listing_id = l.id and o.user_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.portal_my_listings() from public, anon;
grant execute on function public.portal_my_listings() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Slots left
-- ---------------------------------------------------------------------
create or replace function public.portal_slots_left(p_listing_id uuid)
returns table (subcategory text, featured_left integer, spotlight_left integer)
language plpgsql stable security definer set search_path = public as $$
declare
  sub text;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  select l.subcategory into sub from public.listings l where l.id = p_listing_id;
  if sub is null then
    return query select null::text, null::integer, null::integer;
    return;
  end if;
  return query select sub,
    greatest(0, 3 - (select count(*)::int from public.listings x
                     where x.subcategory = sub and x.plan = 'featured' and x.id <> p_listing_id
                       and (x.plan_expires_on is null or x.plan_expires_on >= public.central_today()))),
    greatest(0, 1 - (select count(*)::int from public.listings x
                     where x.subcategory = sub and x.plan = 'spotlight' and x.id <> p_listing_id
                       and (x.plan_expires_on is null or x.plan_expires_on >= public.central_today())));
end $$;
revoke all on function public.portal_slots_left(uuid) from public, anon;
grant execute on function public.portal_slots_left(uuid) to authenticated;

-- Founding Partner places left (of 20). Signed-in businesses see founding prices while any are open.
create or replace function public.portal_founding_left()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, 20 - (select count(*)::int from public.listings where is_founding));
$$;
revoke all on function public.portal_founding_left() from public, anon;
grant execute on function public.portal_founding_left() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Plan requests
-- ---------------------------------------------------------------------
create table if not exists public.plan_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('premium', 'featured', 'spotlight')),
  billing text not null check (billing in ('month', 'year')),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists plan_requests_open_idx on public.plan_requests (status, created_at);
alter table public.plan_requests enable row level security;
drop policy if exists plan_requests_select on public.plan_requests;
create policy plan_requests_select on public.plan_requests for select to authenticated
  using (user_id = auth.uid() or public.is_portal_admin());
revoke all on public.plan_requests from anon, authenticated;
grant select on public.plan_requests to authenticated;

create or replace function public.portal_request_plan(p_listing_id uuid, p_plan text, p_billing text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  left_f integer;
  left_s integer;
begin
  if not public.owns_listing(p_listing_id) then
    raise exception 'Not allowed';
  end if;
  if p_plan not in ('premium', 'featured', 'spotlight') or p_billing not in ('month', 'year') then
    raise exception 'Unknown plan';
  end if;
  select * into l from public.listings where id = p_listing_id;
  if l.plan = p_plan then
    raise exception 'You are already on this plan';
  end if;
  if p_plan in ('featured', 'spotlight') then
    if l.subcategory is null then
      raise exception 'We need to set your subcategory first. We will do that when we review your request.';
    end if;
    select s.featured_left, s.spotlight_left into left_f, left_s from public.portal_slots_left(p_listing_id) s;
    if (p_plan = 'featured' and left_f < 1) or (p_plan = 'spotlight' and left_s < 1) then
      raise exception 'No % place is open in % right now', p_plan, l.subcategory;
    end if;
  end if;
  if exists (select 1 from public.plan_requests
             where listing_id = p_listing_id and plan = p_plan and status = 'open'
               and created_at > now() - interval '1 day') then
    raise exception 'You already asked for this plan. We will email you soon.';
  end if;
  insert into public.plan_requests (listing_id, user_id, plan, billing)
  values (p_listing_id, auth.uid(), p_plan, p_billing);
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'plan_requested', p_listing_id, jsonb_build_object('plan', p_plan, 'billing', p_billing));
end $$;
revoke all on function public.portal_request_plan(uuid, text, text) from public, anon;
grant execute on function public.portal_request_plan(uuid, text, text) to authenticated;

create or replace function public.admin_open_plan_requests()
returns table (id uuid, listing_id uuid, listing_name text, plan text, billing text, created_at timestamptz, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select r.id, r.listing_id, l.name, r.plan, r.billing, r.created_at, u.email::text
    from public.plan_requests r
    join public.listings l on l.id = r.listing_id
    left join auth.users u on u.id = r.user_id
    where r.status = 'open' order by r.created_at;
end $$;
revoke all on function public.admin_open_plan_requests() from public, anon;
grant execute on function public.admin_open_plan_requests() to authenticated;

create or replace function public.admin_close_plan_request(p_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  update public.plan_requests set status = case when p_done then 'done' else 'dismissed' end where id = p_id;
end $$;
revoke all on function public.admin_close_plan_request(uuid, boolean) from public, anon;
grant execute on function public.admin_close_plan_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. One Basic rule, enforced here
-- ---------------------------------------------------------------------
create or replace function public.portal_update_listing(p_listing_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  site text;
  logo text;
  menu text;
  book text;
  hrs text;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  select * into l from public.listings where id = p_listing_id;

  -- Basic shows name, address, pin, phone and hours. Nothing else would be visible,
  -- so nothing else is accepted.
  if l.plan = 'basic' and not public.is_portal_admin()
     and (p_fields ? 'description' or p_fields ? 'website' or p_fields ? 'logo_url'
          or p_fields ? 'menu_url' or p_fields ? 'booking_url') then
    raise exception 'Description, links and logo are part of Premium and above. Upgrade to add them.';
  end if;

  if p_fields ? 'website' then
    site := nullif(trim(p_fields->>'website'), '');
    if site is not null and site !~* '^https?://[^\s]+$' then
      raise exception 'Website must start with http:// or https://';
    end if;
  end if;
  if p_fields ? 'menu_url' then
    menu := nullif(trim(p_fields->>'menu_url'), '');
    if menu is not null and menu !~* '^https?://[^\s]+$' then
      raise exception 'Menu link must start with http:// or https://';
    end if;
  end if;
  if p_fields ? 'booking_url' then
    book := nullif(trim(p_fields->>'booking_url'), '');
    if book is not null and book !~* '^https?://[^\s]+$' then
      raise exception 'Booking link must start with http:// or https://';
    end if;
  end if;
  if p_fields ? 'logo_url' then
    logo := nullif(trim(p_fields->>'logo_url'), '');
    if logo is not null and logo !~* '^https://[^\s]+$' then
      raise exception 'Logo must be an https link or an upload';
    end if;
  end if;
  if p_fields ? 'hours_note' then
    hrs := nullif(trim(p_fields->>'hours_note'), '');
    if hrs is not null and char_length(hrs) > 600 then
      raise exception 'Hours are too long. Keep it to one short line per day.';
    end if;
  end if;

  update public.listings set
    description = case when p_fields ? 'description' then nullif(left(p_fields->>'description', 1500), '') else description end,
    phone = case when p_fields ? 'phone' then nullif(left(p_fields->>'phone', 40), '') else phone end,
    website = case when p_fields ? 'website' then site else website end,
    menu_url = case when p_fields ? 'menu_url' then menu else menu_url end,
    booking_url = case when p_fields ? 'booking_url' then book else booking_url end,
    logo_url = case when p_fields ? 'logo_url' then logo else logo_url end,
    hours_note = case when p_fields ? 'hours_note' then hrs else hours_note end
  where id = p_listing_id;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'listing_updated', p_listing_id, p_fields);
end $$;
revoke all on function public.portal_update_listing(uuid, jsonb) from public, anon;
grant execute on function public.portal_update_listing(uuid, jsonb) to authenticated;

-- Deals and events are Premium and above, whatever the admin toggle says.
-- The check only applies to people signed in through the portal. Admin and
-- server jobs (no signed-in user) pass.
create or replace function public.require_paid_plan_for_posts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pl text;
begin
  if auth.uid() is null or public.is_portal_admin() then
    return new;
  end if;
  select plan into pl from public.listings where id = new.listing_id;
  if coalesce(pl, 'basic') = 'basic' then
    raise exception 'Deals and events are part of Premium and above. Upgrade to add them.';
  end if;
  return new;
end $$;
revoke all on function public.require_paid_plan_for_posts() from public, anon, authenticated;

drop trigger if exists deals_paid_plan_trg on public.deals;
create trigger deals_paid_plan_trg before insert on public.deals
  for each row execute function public.require_paid_plan_for_posts();
drop trigger if exists event_submissions_paid_plan_trg on public.event_submissions;
create trigger event_submissions_paid_plan_trg before insert on public.event_submissions
  for each row execute function public.require_paid_plan_for_posts();

-- ---------------------------------------------------------------------
-- 1. Pin on approval, subcategory on approval
-- ---------------------------------------------------------------------
create or replace function public.admin_set_pin(p_listing_id uuid, p_lat double precision, p_lng double precision)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That is not a valid pin';
  end if;
  update public.listings set latitude = p_lat, longitude = p_lng where id = p_listing_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'pin_set', p_listing_id, jsonb_build_object('lat', p_lat, 'lng', p_lng));
end $$;
revoke all on function public.admin_set_pin(uuid, double precision, double precision) from public, anon;
grant execute on function public.admin_set_pin(uuid, double precision, double precision) to authenticated;

-- Review queue: applications with the applicant's email and the claimed listing's pin state.
create or replace function public.admin_pending_applications()
returns table (
  id uuid, business_name text, contact_name text, phone text, email text, notes text,
  claim_listing_id uuid, claim_address text, claim_has_pin boolean, claim_subcategory text,
  new_listing jsonb, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select a.id, a.business_name, a.contact_name, a.phone, u.email::text, a.notes,
           a.claim_listing_id, l.address, (l.latitude is not null and l.longitude is not null), l.subcategory,
           a.new_listing, a.created_at
    from public.business_applications a
    left join auth.users u on u.id = a.user_id
    left join public.listings l on l.id = a.claim_listing_id
    where a.status = 'pending'
    order by a.created_at;
end $$;
revoke all on function public.admin_pending_applications() from public, anon;
grant execute on function public.admin_pending_applications() to authenticated;

drop function if exists public.admin_review_application(uuid, boolean, text);
create or replace function public.admin_review_application(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_no_pin boolean default false,
  p_subcategory text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.business_applications;
  new_id uuid;
  target uuid;
  nl jsonb;
  cat text;
  sub text;
  has_pin boolean;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select * into a from public.business_applications where id = p_id for update;
  if not found or a.status <> 'pending' then
    raise exception 'Application not found or already reviewed';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Give a reason when you reject';
  end if;

  if p_approve then
    nl := a.new_listing;
    sub := coalesce(nullif(trim(p_subcategory), ''), nl->>'subcategory');
    if sub is not null and not exists (select 1 from public.subcategories where name = sub) then
      raise exception 'Unknown subcategory';
    end if;
    if p_lat is not null and p_lng is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
      raise exception 'That is not a valid pin';
    end if;

    if a.claim_listing_id is not null then
      target := a.claim_listing_id;
      select (latitude is not null and longitude is not null) into has_pin from public.listings where id = target;
      if not coalesce(has_pin, false) and not (p_lat is not null and p_lng is not null) and not coalesce(p_no_pin, false) then
        raise exception 'This place has no map pin. Set the pin, or tick "No street address" for a mobile service.';
      end if;
      insert into public.listing_owners (user_id, listing_id) values (a.user_id, target) on conflict do nothing;
      if p_lat is not null and p_lng is not null then
        update public.listings set latitude = p_lat, longitude = p_lng where id = target;
      end if;
      if sub is not null then
        update public.listings set subcategory = sub where id = target and subcategory is null;
      end if;
    elsif nl is not null then
      if not (p_lat is not null and p_lng is not null) and not coalesce(p_no_pin, false) then
        raise exception 'Set the map pin before you approve. Without one the place is hidden in the app. Tick "No street address" for a mobile service.';
      end if;
      cat := left(nl->>'category', 60);
      if sub is null and cat is not null then
        select name into sub from public.subcategories where category = cat and name = public.auto_subcategory(nl->>'name', cat, nl->>'description');
      end if;
      insert into public.listings (name, category, subcategory, address, phone, website, description, latitude, longitude)
      values (
        left(coalesce(nl->>'name', a.business_name), 120),
        cat,
        sub,
        left(nl->>'address', 200),
        left(coalesce(nl->>'phone', a.phone), 40),
        nullif(left(nl->>'website', 300), ''),
        nullif(left(nl->>'description', 1500), ''),
        p_lat, p_lng
      ) returning id into new_id;
      -- No street address: show it in lists and Ask 30A but not on the map.
      if p_lat is null and coalesce(p_no_pin, false) then
        update public.listings set area_status_override = 'core',
               area_reason = 'override: mobile service, no street address (approved in portal)'
        where id = new_id;
      end if;
      target := new_id;
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
          target, jsonb_build_object('application', p_id, 'note', left(p_note, 500)));
end $$;
revoke all on function public.admin_review_application(uuid, boolean, text, double precision, double precision, boolean, text) from public, anon;
grant execute on function public.admin_review_application(uuid, boolean, text, double precision, double precision, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Email outbox
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, is_public)
values ('admin_notify_email', '"in30a.info@gmail.com"', false)
on conflict (key) do nothing;

create table if not exists public.email_outbox (
  id bigint generated always as identity primary key,
  to_email text not null,
  kind text not null,
  subject text not null,
  body text not null,
  link text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index if not exists email_outbox_pending_idx on public.email_outbox (created_at) where sent_at is null;
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
-- Service role only (the send-outbox function). No policies on purpose.

create or replace function public.queue_email(p_to text, p_kind text, p_subject text, p_body text, p_link text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_to is null or p_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return;
  end if;
  insert into public.email_outbox (to_email, kind, subject, body, link)
  values (lower(trim(p_to)), p_kind, left(p_subject, 200), left(p_body, 4000), p_link);
end $$;
revoke all on function public.queue_email(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.admin_notify_address()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(trim(both '"' from (select value::text from public.app_settings where key = 'admin_notify_email')), 'in30a.info@gmail.com');
$$;
revoke all on function public.admin_notify_address() from public, anon, authenticated;

create or replace function public.user_email(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select email::text from auth.users where id = p_user;
$$;
revoke all on function public.user_email(uuid) from public, anon, authenticated;

-- New application: admin + receipt to the applicant. Decision: applicant.
create or replace function public.email_on_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := public.user_email(new.user_id);
begin
  if tg_op = 'INSERT' then
    perform public.queue_email(public.admin_notify_address(), 'admin_application',
      'New business application: ' || new.business_name,
      'A business applied in the portal.' || E'\n\n' || 'Business: ' || new.business_name || E'\n' ||
      'Contact: ' || coalesce(new.contact_name, '') || ' ' || coalesce(new.phone, '') || E'\n' ||
      'Email: ' || coalesce(who, '') || E'\n' ||
      case when new.claim_listing_id is not null then 'Claims an existing listing.' else 'New listing.' end,
      'https://portal.in30a.app/admin');
    perform public.queue_email(who, 'application_received',
      'We got your application for ' || new.business_name,
      'Thanks for applying. We have your application for ' || new.business_name || ' and review it within one business day. We will email you when it is approved. You can also check the status any time on the Add a business page of the portal.',
      'https://portal.in30a.app/apply');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'approved' then
    perform public.queue_email(who, 'application_approved',
      new.business_name || ' is approved',
      'Good news. ' || new.business_name || ' is approved and you can now manage it. Sign in to add your hours, check your listing and choose a plan.',
      'https://portal.in30a.app/');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected' then
    perform public.queue_email(who, 'application_rejected',
      'About your application for ' || new.business_name,
      'We could not approve this application yet.' || E'\n\n' || 'Reason: ' || coalesce(new.review_note, 'not given') ||
      E'\n\n' || 'You can fix this and apply again on the Add a business page.',
      'https://portal.in30a.app/apply');
  end if;
  return new;
end $$;
revoke all on function public.email_on_application() from public, anon, authenticated;
drop trigger if exists email_application_ins on public.business_applications;
create trigger email_application_ins after insert on public.business_applications
  for each row execute function public.email_on_application();
drop trigger if exists email_application_upd on public.business_applications;
create trigger email_application_upd after update of status on public.business_applications
  for each row execute function public.email_on_application();

-- New deal waiting for review, and the decision.
create or replace function public.email_on_deal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lname text;
  owner_mail text;
begin
  select name into lname from public.listings where id = new.listing_id;
  if tg_op = 'INSERT' and new.review_status = 'pending' then
    perform public.queue_email(public.admin_notify_address(), 'admin_deal',
      'New deal to review: ' || coalesce(new.title, ''),
      lname || ' submitted a deal.' || E'\n\n' || coalesce(new.title, '') || E'\n' || coalesce(new.discount_text, ''),
      'https://portal.in30a.app/admin');
  elsif tg_op = 'UPDATE' and old.review_status = 'pending' and new.review_status in ('approved', 'rejected') then
    for owner_mail in select public.user_email(o.user_id) from public.listing_owners o where o.listing_id = new.listing_id loop
      perform public.queue_email(owner_mail, 'deal_' || new.review_status,
        case when new.review_status = 'approved' then 'Your deal is live: ' else 'Your deal was not approved: ' end || coalesce(new.title, ''),
        case when new.review_status = 'approved' then 'Your deal "' || coalesce(new.title, '') || '" for ' || lname || ' is live in the app.'
             else 'Your deal "' || coalesce(new.title, '') || '" for ' || lname || ' was not approved.' || E'\n\n' || 'Reason: ' || coalesce(new.review_note, 'not given') end,
        'https://portal.in30a.app/deals');
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.email_on_deal() from public, anon, authenticated;
drop trigger if exists email_deal_ins on public.deals;
create trigger email_deal_ins after insert on public.deals
  for each row execute function public.email_on_deal();
drop trigger if exists email_deal_upd on public.deals;
create trigger email_deal_upd after update of review_status on public.deals
  for each row execute function public.email_on_deal();

-- New event waiting for review, and the decision.
create or replace function public.email_on_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lname text;
  owner_mail text;
begin
  select name into lname from public.listings where id = new.listing_id;
  if tg_op = 'INSERT' then
    perform public.queue_email(public.admin_notify_address(), 'admin_event',
      'New event to review: ' || new.title,
      lname || ' submitted an event.' || E'\n\n' || new.title || E'\n' || new.start_date::text || ' ' || coalesce(new.start_time, '') ||
      E'\n' || coalesce(new.venue_name, ''),
      'https://portal.in30a.app/admin');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    for owner_mail in select public.user_email(o.user_id) from public.listing_owners o where o.listing_id = new.listing_id loop
      perform public.queue_email(owner_mail, 'event_' || new.status,
        case when new.status = 'approved' then 'Your event is live: ' else 'Your event was not approved: ' end || new.title,
        case when new.status = 'approved' then 'Your event "' || new.title || '" is live in Events in the app.'
             else 'Your event "' || new.title || '" was not approved.' || E'\n\n' || 'Reason: ' || coalesce(new.review_note, 'not given') end,
        'https://portal.in30a.app/events');
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.email_on_event() from public, anon, authenticated;
drop trigger if exists email_event_ins on public.event_submissions;
create trigger email_event_ins after insert on public.event_submissions
  for each row execute function public.email_on_event();
drop trigger if exists email_event_upd on public.event_submissions;
create trigger email_event_upd after update of status on public.event_submissions
  for each row execute function public.email_on_event();

-- New plan request: admin + receipt to the requester.
create or replace function public.email_on_plan_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lname text;
  who text := public.user_email(new.user_id);
begin
  select name into lname from public.listings where id = new.listing_id;
  perform public.queue_email(public.admin_notify_address(), 'admin_plan_request',
    'Plan request: ' || lname || ' wants ' || initcap(new.plan),
    lname || ' asked for the ' || initcap(new.plan) || ' plan, billed by the ' || new.billing || '.' || E'\n' || 'Reply to: ' || coalesce(who, ''),
    'https://portal.in30a.app/admin/plans');
  perform public.queue_email(who, 'plan_request_received',
    'We got your request for ' || initcap(new.plan),
    'Thanks. We have your request for the ' || initcap(new.plan) || ' plan for ' || lname || ' and will email you the payment details within one business day.',
    'https://portal.in30a.app/plan');
  return new;
end $$;
revoke all on function public.email_on_plan_request() from public, anon, authenticated;
drop trigger if exists email_plan_request_ins on public.plan_requests;
create trigger email_plan_request_ins after insert on public.plan_requests
  for each row execute function public.email_on_plan_request();

-- Used by the send-outbox function.
create or replace function public.outbox_claim(p_limit integer default 25)
returns setof public.email_outbox
language sql security definer set search_path = public as $$
  update public.email_outbox o set attempts = attempts + 1
  where o.id in (select id from public.email_outbox
                 where sent_at is null and attempts < 5
                 order by created_at limit p_limit for update skip locked)
  returning o.*;
$$;
revoke all on function public.outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.outbox_claim(integer) to service_role;

grant select, insert, update on public.email_outbox to service_role;
grant select, insert, update on public.plan_requests to service_role;
