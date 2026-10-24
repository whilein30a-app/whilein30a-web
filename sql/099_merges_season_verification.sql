-- 099: merges (Grayton, Yoga), search aliases, editable transit season,
-- ownership verification (email domain, phone code, admin review).
-- Safe to run twice.

-- ---------------------------------------------------------------------
-- 1. Search aliases and the two merges Kevin confirmed
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists aka text;

create or replace function public.merge_named(p_keep text, p_drop text, p_aka text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ka uuid[]; da uuid[];
  res text;
  terms text[];
  kid uuid;
  dname text;
begin
  if auth.uid() is not null and not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select array_agg(id) into ka from public.listings where norm_name(name) = norm_name(p_keep) and merged_into is null;
  select array_agg(id) into da from public.listings where norm_name(name) = norm_name(p_drop) and merged_into is null;
  if da is null then
    if exists (select 1 from public.listings where norm_name(name) = norm_name(p_drop) and merged_into is not null) then
      return 'already merged: ' || p_drop || ' -> ' || p_keep;
    end if;
    return 'not found: ' || p_drop;
  end if;
  if ka is null then
    return 'not found: ' || p_keep;
  end if;
  if array_length(ka, 1) > 1 or array_length(da, 1) > 1 then
    return format('check by hand: %s rows named "%s", %s rows named "%s"', array_length(ka, 1), p_keep, array_length(da, 1), p_drop);
  end if;
  kid := ka[1];
  select name into dname from public.listings where id = da[1];
  res := public.merge_listing(kid, da[1], p_keep);
  select array_agg(distinct t) into terms from unnest(
    string_to_array(coalesce((select aka from public.listings where id = kid), ''), ' | ')
    || array[dname, nullif(trim(coalesce(p_aka, '')), '')]
  ) as t where t is not null and trim(t) <> '';
  update public.listings set aka = array_to_string(terms, ' | ') where id = kid;
  return res;
end $$;
revoke all on function public.merge_named(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Transit season, editable in Admin > App settings
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, is_public)
values ('transit_season', '{"mode":"auto","summer_start":"03-01","summer_end":"09-30"}', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. Ownership verification
-- ---------------------------------------------------------------------
alter table public.business_applications add column if not exists verified_at timestamptz;
alter table public.business_applications add column if not exists verify_method text;
alter table public.business_applications drop constraint if exists business_applications_verify_method_check;
alter table public.business_applications add constraint business_applications_verify_method_check
  check (verify_method is null or verify_method in ('email_domain', 'phone_code'));

create table if not exists public.verify_attempts (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.business_applications(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('start', 'check')),
  created_at timestamptz not null default now()
);
create index if not exists verify_attempts_app_idx on public.verify_attempts (application_id, kind, created_at);
alter table public.verify_attempts enable row level security;
revoke all on public.verify_attempts from public, anon, authenticated;
grant select, insert, delete on public.verify_attempts to service_role;

-- +1XXXXXXXXXX or null.
create or replace function public.phone_e164(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^1[2-9][0-9]{9}$' then '+' || d
    when d ~ '^[2-9][0-9]{9}$' then '+1' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

create or replace function public.email_domain_matches(p_email text, p_website text)
returns boolean language plpgsql immutable as $$
declare
  ed text := lower(split_part(coalesce(p_email, ''), '@', 2));
  host text := lower(regexp_replace(regexp_replace(coalesce(p_website, ''), '^[a-z]+://', ''), '[/?#:].*$', ''));
begin
  host := regexp_replace(host, '^www\.', '');
  if ed = '' or host = '' or position('.' in ed) = 0 or position('.' in host) = 0 then
    return false;
  end if;
  if ed = any (array['gmail.com','googlemail.com','yahoo.com','ymail.com','outlook.com','hotmail.com','live.com','msn.com',
                     'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','gmx.com','mail.com','zoho.com',
                     'comcast.net','att.net','verizon.net','bellsouth.net','sbcglobal.net','cox.net','charter.net']) then
    return false;
  end if;
  return ed = host or right(host, length(ed) + 1) = '.' || ed or right(ed, length(host) + 1) = '.' || host;
end $$;

drop function if exists public.admin_review_application(uuid, boolean, text);
drop function if exists public.admin_review_application(uuid, boolean, text, double precision, double precision, boolean, text);
create or replace function public.admin_review_application(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_no_pin boolean default false,
  p_subcategory text default null,
  p_replace_owner boolean default false
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
  auto boolean := coalesce(current_setting('app.verified_approve', true), '') = '1';
begin
  if not public.is_portal_admin() and not auto then
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
      if exists (select 1 from public.listing_owners where listing_id = target and user_id <> a.user_id) then
        if not coalesce(p_replace_owner, false) then
          raise exception 'This place already has an owner. Tick "Replace the current owner" to move it to this applicant.';
        end if;
        delete from public.listing_owners where listing_id = target and user_id <> a.user_id;
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
      reviewed_by = case when auto then null else auth.uid() end,
      reviewed_at = now()
  where id = p_id;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (coalesce(auth.uid(), a.user_id), case when p_approve then 'application_approved' else 'application_rejected' end,
          target, jsonb_build_object('application', p_id, 'note', left(p_note, 500), 'method', case when auto then a.verify_method else 'admin' end, 'replaced_owner', coalesce(p_replace_owner, false)));
end $$;
revoke all on function public.admin_review_application(uuid, boolean, text, double precision, double precision, boolean, text, boolean) from public, anon;
grant execute on function public.admin_review_application(uuid, boolean, text, double precision, double precision, boolean, text, boolean) to authenticated;


-- Admin queue: now shows how the applicant was verified and who owns the
-- place today.
drop function if exists public.admin_pending_applications();
create or replace function public.admin_pending_applications()
returns table (
  id uuid, business_name text, contact_name text, phone text, email text, notes text,
  claim_listing_id uuid, claim_address text, claim_has_pin boolean, claim_subcategory text,
  new_listing jsonb, created_at timestamptz,
  verify_method text, verified_at timestamptz, owner_email text, claim_phone text, claim_website text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select a.id, a.business_name, a.contact_name, a.phone, u.email::text, a.notes,
           a.claim_listing_id, l.address, (l.latitude is not null and l.longitude is not null), l.subcategory,
           a.new_listing, a.created_at,
           a.verify_method, a.verified_at,
           (select string_agg(ou.email::text, ', ') from public.listing_owners lo join auth.users ou on ou.id = lo.user_id
             where lo.listing_id = a.claim_listing_id and lo.user_id <> a.user_id),
           l.phone, l.website
    from public.business_applications a
    left join auth.users u on u.id = a.user_id
    left join public.listings l on l.id = a.claim_listing_id
    where a.status = 'pending'
    order by (a.verified_at is null), a.created_at;
end $$;
revoke all on function public.admin_pending_applications() from public, anon;
grant execute on function public.admin_pending_applications() to authenticated;

-- Marks the application verified. Approves it on the spot when nothing
-- needs a person (the place has a pin or is a mobile service, and nobody
-- else owns it). Otherwise it stays in the queue with a "verified" badge.
create or replace function public.service_verified_approve(p_id uuid, p_method text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  a public.business_applications;
  l public.listings;
  nopin boolean;
begin
  if p_method not in ('email_domain', 'phone_code') then
    raise exception 'Bad method';
  end if;
  select * into a from public.business_applications where id = p_id for update;
  if not found or a.status <> 'pending' or a.claim_listing_id is null then
    return 'not_pending';
  end if;
  update public.business_applications set verified_at = now(), verify_method = p_method where id = p_id;
  select * into l from public.listings where id = a.claim_listing_id;
  if l.id is null then
    return 'needs_review';
  end if;
  if exists (select 1 from public.listing_owners where listing_id = l.id and user_id <> a.user_id) then
    return 'needs_review';
  end if;
  nopin := (l.latitude is null or l.longitude is null);
  if nopin and l.area_status_override is distinct from 'core' then
    return 'needs_review';
  end if;
  perform set_config('app.verified_approve', '1', true);
  perform public.admin_review_application(
    p_id, true,
    case p_method when 'email_domain' then 'Verified automatically: email matches the business website.'
                  else 'Verified automatically: code sent to the number listed publicly for this business.' end,
    null, null, nopin, null, false);
  perform set_config('app.verified_approve', '', true);
  return 'approved';
end $$;
revoke all on function public.service_verified_approve(uuid, text) from public, anon, authenticated;
grant execute on function public.service_verified_approve(uuid, text) to service_role;

-- Instant approval when the applicant's confirmed email is on the
-- business's own website domain. Free mail providers never count.
create or replace function public.portal_verify_email(p_app_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  a public.business_applications;
  em text;
  conf timestamptz;
  site text;
begin
  select * into a from public.business_applications where id = p_app_id and user_id = auth.uid();
  if not found then
    raise exception 'Application not found';
  end if;
  if a.status <> 'pending' then
    return a.status;
  end if;
  if a.claim_listing_id is null then
    return 'needs_review';
  end if;
  select email::text, email_confirmed_at into em, conf from auth.users where id = a.user_id;
  if conf is null then
    return 'unconfirmed';
  end if;
  select website into site from public.listings where id = a.claim_listing_id;
  if not public.email_domain_matches(em, site) then
    return 'no_match';
  end if;
  return public.service_verified_approve(a.id, 'email_domain');
end $$;
revoke all on function public.portal_verify_email(uuid) from public, anon;
grant execute on function public.portal_verify_email(uuid) to authenticated;

-- What the Apply page can offer for one application. The full phone
-- number never leaves the database, only its last four digits.
create or replace function public.portal_verify_options(p_app_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.business_applications;
  l public.listings;
  em text;
  conf timestamptz;
  e164 text;
begin
  select * into a from public.business_applications where id = p_app_id and user_id = auth.uid();
  if not found then
    raise exception 'Application not found';
  end if;
  select email::text, email_confirmed_at into em, conf from auth.users where id = a.user_id;
  if a.claim_listing_id is not null then
    select * into l from public.listings where id = a.claim_listing_id;
  end if;
  e164 := public.phone_e164(l.phone);
  return jsonb_build_object(
    'status', a.status,
    'is_claim', a.claim_listing_id is not null,
    'verified', a.verified_at is not null,
    'email_match', conf is not null and l.id is not null and public.email_domain_matches(em, l.website),
    'phone_last4', case when e164 is null then null else right(e164, 4) end,
    'owner_conflict', l.id is not null and exists (select 1 from public.listing_owners where listing_id = l.id and user_id <> a.user_id)
  );
end $$;
revoke all on function public.portal_verify_options(uuid) from public, anon;
grant execute on function public.portal_verify_options(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Run the two merges and report
-- ---------------------------------------------------------------------
create temporary table if not exists _r099 (n serial, step text, result text);
truncate _r099;
insert into _r099 (step, result) select 'merge', public.merge_named('Grayton Beach Charters', 'Grayton Girl Fishing Charters', 'Grayton Girl');
insert into _r099 (step, result) select 'merge', public.merge_named('Yoga Bar 30A', 'The Yoga Haus');
insert into _r099 (step, result) select 'search names', name || '  =>  ' || aka from public.listings where aka is not null and merged_into is null order by name;
insert into _r099 (step, result) select 'transit_season', value::text from public.app_settings where key = 'transit_season';
select step, result from _r099 order by n;
