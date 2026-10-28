-- 104: A17, Google Places compliance.
--
-- Google's terms let us keep the place ID only. Coordinates may be kept 30 days,
-- everything else (phone, website, description, hours, attributes, status,
-- photos) may not be stored, and none of it may be shown on a non-Google map.
--
-- This file only RECORDS where each value came from and adds the tools. It does
-- not delete anything. Clearing the Google values is a separate step that Kevin
-- decides the timing of (service_a17_clear_google, run by a17-google-cleanup.js).
--
--   listings.coords_source   where the pin came from: google, mapbox, admin, owner, other
--   listings.google_fields   which of the listing's current values came from Google:
--                            phone, website, description, address, hours, attributes, status
--
-- When an owner or admin changes one of those values in the portal, it stops
-- counting as Google (trigger below). Scripts that use the service key set the
-- source themselves.
--
-- Safe to run twice.

alter table public.listings add column if not exists coords_source text;
alter table public.listings add column if not exists google_fields text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_coords_source_check') then
    alter table public.listings add constraint listings_coords_source_check
      check (coords_source is null or coords_source in ('google', 'mapbox', 'admin', 'owner', 'other'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Where today's values came from (runs once)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.app_settings where key = 'a17_sources_marked') then
    return;
  end if;

  -- Fields filled from Google: every listing the Google import touched, minus the
  -- fields an owner or admin has since changed in the portal.
  update public.listings l set google_fields = array(
    select f from unnest(array[
      case when l.phone is not null then 'phone' end,
      case when l.website is not null then 'website' end,
      case when l.description is not null then 'description' end,
      case when l.address is not null then 'address' end,
      case when l.hours_periods is not null or l.hours_text is not null then 'hours' end,
      case when l.attributes_source = 'google_places' then 'attributes' end,
      case when l.business_status is not null then 'status' end
    ]) f
    where f is not null
      and not exists (
        select 1 from public.portal_audit pa
        where pa.listing_id = l.id and pa.action = 'listing_updated' and pa.detail ? f
      )
  )
  where l.google_place_id is not null
     or l.attributes_source = 'google_places'
     or coalesce(l.area_reason, '') ilike '%no trusted google pin%';

  -- Pins: set by an admin in the portal, from Google, or from somewhere else
  -- (beach accesses from Visit South Walton, parking, seeds).
  update public.listings l set coords_source = case
      when exists (select 1 from public.portal_audit pa where pa.listing_id = l.id and pa.action = 'pin_set') then 'admin'
      when l.google_place_id is not null or coalesce(l.area_reason, '') ilike '%no trusted google pin%' then 'google'
      else 'other' end
  where l.latitude is not null and l.coords_source is null;

  insert into public.app_settings (key, value, is_public)
  values ('a17_sources_marked', jsonb_build_object('at', now()), false);
end $$;

-- ---------------------------------------------------------------------
-- 2. A person's edit replaces the Google value
-- ---------------------------------------------------------------------
create or replace function public.track_listing_sources()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only signed-in people (owners and admins). Scripts on the service key set
  -- the source themselves.
  if auth.uid() is null then
    return new;
  end if;
  if new.phone is distinct from old.phone then new.google_fields := array_remove(new.google_fields, 'phone'); end if;
  if new.website is distinct from old.website then new.google_fields := array_remove(new.google_fields, 'website'); end if;
  if new.description is distinct from old.description then new.google_fields := array_remove(new.google_fields, 'description'); end if;
  if new.address is distinct from old.address then new.google_fields := array_remove(new.google_fields, 'address'); end if;
  if new.hours_periods is distinct from old.hours_periods or new.hours_text is distinct from old.hours_text then
    new.google_fields := array_remove(new.google_fields, 'hours');
  end if;
  if new.attributes_source is distinct from old.attributes_source and new.attributes_source is distinct from 'google_places' then
    new.google_fields := array_remove(new.google_fields, 'attributes');
  end if;
  if new.business_status is distinct from old.business_status then new.google_fields := array_remove(new.google_fields, 'status'); end if;
  if (new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude) then
    new.coords_source := case when new.latitude is null then null
                              when public.is_portal_admin() then 'admin' else 'owner' end;
  end if;
  return new;
end $$;
revoke all on function public.track_listing_sources() from public, anon, authenticated;

drop trigger if exists trg_track_listing_sources on public.listings;
create trigger trg_track_listing_sources
  before update on public.listings
  for each row execute function public.track_listing_sources();

-- ---------------------------------------------------------------------
-- 3. Mapbox pins from the geocoding script (service key only)
-- ---------------------------------------------------------------------
create or replace function public.service_apply_mapbox_pin(p_listing_id uuid, p_lat double precision, p_lng double precision, p_address text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_lat is null or p_lng is null or p_lat not between 30.2 and 30.45 or p_lng not between -86.4 and -85.9 then
    raise exception 'Pin is outside the 30A area';
  end if;
  update public.listings set
    latitude = p_lat,
    longitude = p_lng,
    coords_source = 'mapbox',
    address = coalesce(nullif(trim(p_address), ''), address),
    google_fields = case when nullif(trim(p_address), '') is not null then array_remove(google_fields, 'address') else google_fields end
  where id = p_listing_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (null, 'pin_mapbox', p_listing_id, jsonb_build_object('lat', p_lat, 'lng', p_lng, 'address', p_address));
end $$;
revoke all on function public.service_apply_mapbox_pin(uuid, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.service_apply_mapbox_pin(uuid, double precision, double precision, text) to service_role;

-- Address only, for listings whose pin is already set by a person but whose
-- address text came from Google. The pin is left alone.
create or replace function public.service_apply_mapbox_address(p_listing_id uuid, p_address text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(trim(p_address), '')) < 6 then
    raise exception 'No address';
  end if;
  update public.listings set address = left(trim(p_address), 200), google_fields = array_remove(google_fields, 'address')
  where id = p_listing_id;
end $$;
revoke all on function public.service_apply_mapbox_address(uuid, text) from public, anon, authenticated;
grant execute on function public.service_apply_mapbox_address(uuid, text) to service_role;

-- Admin fixes an address by hand (Missing details page).
create or replace function public.admin_set_address(p_listing_id uuid, p_address text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if char_length(coalesce(trim(p_address), '')) < 6 then
    raise exception 'Enter a full street address';
  end if;
  update public.listings set address = left(trim(p_address), 200) where id = p_listing_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'address_set', p_listing_id, jsonb_build_object('address', left(trim(p_address), 200)));
end $$;
revoke all on function public.admin_set_address(uuid, text) from public, anon;
grant execute on function public.admin_set_address(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Admin: listings with missing or Google-sourced details
-- ---------------------------------------------------------------------
create or replace function public.admin_missing_details(p_problem text default 'all', p_search text default null, p_limit integer default 200)
returns table (
  id uuid, name text, category text, subcategory text, town text, address text,
  phone text, website text, hours_note text, has_hours boolean, photos integer,
  has_pin boolean, coords_source text, google_fields text[], google_photos integer,
  owned boolean, plan text, in_area boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  term text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
  with base as (
    select l.*,
      (l.hours_note is not null or l.hours_periods is not null or l.hours_text is not null) as hh,
      (select count(*)::int from public.listing_photos p where p.listing_id = l.id) as pc,
      (select count(*)::int from public.listing_photos p where p.listing_id = l.id and p.url like '%/listing-photos/%') as gpc,
      exists (select 1 from public.listing_owners o where o.listing_id = l.id) as own
    from public.listings l
    where l.merged_into is null
      and coalesce(l.is_public_access, false) = false
      and (l.in_area or l.area_reason = 'no_coordinates')
      and (term is null or l.name ilike '%' || term || '%' or coalesce(l.aka, '') ilike '%' || term || '%')
  )
  select b.id, b.name, b.category, b.subcategory, b.town, b.address,
         b.phone, b.website, b.hours_note, b.hh, b.pc,
         (b.latitude is not null and b.longitude is not null), b.coords_source, b.google_fields, b.gpc,
         b.own, b.plan, b.in_area
  from base b
  where case coalesce(p_problem, 'all')
    when 'google_pin' then b.coords_source = 'google'
    when 'no_pin' then b.latitude is null
    when 'google_details' then cardinality(b.google_fields) > 0
    when 'google_photo' then b.gpc > 0
    when 'no_phone' then b.phone is null
    when 'no_hours' then not b.hh
    when 'no_photo' then b.pc = 0
    else b.coords_source = 'google' or b.latitude is null or cardinality(b.google_fields) > 0
         or b.gpc > 0 or b.phone is null or not b.hh or b.pc = 0
  end
  order by b.own desc, b.name
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;
revoke all on function public.admin_missing_details(text, text, integer) from public, anon;
grant execute on function public.admin_missing_details(text, text, integer) to authenticated;

create or replace function public.admin_missing_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  with base as (
    select l.*,
      (l.hours_note is not null or l.hours_periods is not null or l.hours_text is not null) as hh,
      (select count(*) from public.listing_photos p where p.listing_id = l.id) as pc,
      (select count(*) from public.listing_photos p where p.listing_id = l.id and p.url like '%/listing-photos/%') as gpc
    from public.listings l
    where l.merged_into is null and coalesce(l.is_public_access, false) = false
      and (l.in_area or l.area_reason = 'no_coordinates')
  )
  select jsonb_build_object(
    'listings', count(*),
    'google_pin', count(*) filter (where coords_source = 'google'),
    'no_pin', count(*) filter (where latitude is null),
    'google_details', count(*) filter (where cardinality(google_fields) > 0),
    'google_photo', count(*) filter (where gpc > 0),
    'no_phone', count(*) filter (where phone is null),
    'no_hours', count(*) filter (where not hh),
    'no_photo', count(*) filter (where pc = 0),
    'cleared_at', (select value->>'at' from public.app_settings where key = 'a17_cleared')
  ) into out from base;
  return out;
end $$;
revoke all on function public.admin_missing_summary() from public, anon;
grant execute on function public.admin_missing_summary() to authenticated;

-- ---------------------------------------------------------------------
-- 5. The clearing step. NOT run by this file. Kevin decides when.
--    a17-google-cleanup.js calls it with the service key, first as a dry run.
--    p_parts: any of details, hours, attributes, status, coords, photos
-- ---------------------------------------------------------------------
create or replace function public.service_a17_clear_google(p_apply boolean default false, p_parts text[] default array['details','hours','attributes','status','coords','photos'])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  res jsonb;
  urls text[];
begin
  select jsonb_build_object(
    'phone', count(*) filter (where 'phone' = any(google_fields)),
    'website', count(*) filter (where 'website' = any(google_fields)),
    'description', count(*) filter (where 'description' = any(google_fields)),
    'hours', count(*) filter (where 'hours' = any(google_fields)),
    'attributes', count(*) filter (where 'attributes' = any(google_fields)),
    'status', count(*) filter (where 'status' = any(google_fields)),
    'pins', count(*) filter (where coords_source = 'google'),
    'claimed_listings_affected', count(*) filter (where (google_fields && array['phone','website','description','hours','attributes','status'] or coords_source = 'google')
                                  and exists (select 1 from public.listing_owners o where o.listing_id = l.id))
  ) into res from public.listings l;

  select coalesce(array_agg(url), '{}') into urls
  from public.listing_photos where url like '%/listing-photos/%';
  res := res || jsonb_build_object('photos', cardinality(urls), 'applied', p_apply, 'parts', to_jsonb(p_parts));

  if not p_apply then
    return res;
  end if;

  if 'details' = any(p_parts) then
    update public.listings set
      phone = case when 'phone' = any(google_fields) then null else phone end,
      website = case when 'website' = any(google_fields) then null else website end,
      description = case when 'description' = any(google_fields) then null else description end,
      google_fields = array(select f from unnest(google_fields) f where f not in ('phone', 'website', 'description'))
    where google_fields && array['phone', 'website', 'description'];
  end if;
  if 'hours' = any(p_parts) then
    update public.listings set hours_periods = null, hours_text = null, google_fields = array_remove(google_fields, 'hours')
    where 'hours' = any(google_fields);
  end if;
  if 'attributes' = any(p_parts) then
    update public.listings set
      good_for_children = null, menu_for_children = null, allows_dogs = null, good_for_groups = null,
      wheelchair_entrance = null, wheelchair_restroom = null, wheelchair_parking = null, wheelchair_seating = null,
      price_level = null, outdoor_seating = null, live_music = null, reservable = null, serves_vegetarian = null,
      indoor_outdoor = null, attributes_source = null, attributes_updated_at = now(),
      google_fields = array_remove(google_fields, 'attributes')
    where 'attributes' = any(google_fields);
    -- Our own indoor/outdoor guess from the category (same rule as sql/092).
    update public.listings set indoor_outdoor = case
        when subcategory in ('Golf Carts & LSVs', 'Bikes & E-Bikes', 'Kayak Paddleboard & Surf', 'Fishing Charters',
                             'Boat & Dolphin Tours', 'Beach Chairs & Bonfires', 'Beach Photographers',
                             'Golf Tennis & Pickleball', 'Food Trucks & Healthy') then 'outdoor'
        when category = 'Food & Drink' then 'indoor'
        when category in ('Shops', 'Services', 'Stay') then 'indoor'
        when category = 'Activities' and (name || ' ' || coalesce(description, '')) ~*
             '(beach|kayak|paddle|surf|boat|charter|dolphin|fishing|bike|trail|hike|state park|bonfire|golf|cruise|sail|snorkel|dive|parasail)' then 'outdoor'
        else null end::public.indoor_outdoor_t
    where indoor_outdoor is null and coalesce(is_public_access, false) = false;
  end if;
  if 'status' = any(p_parts) then
    update public.listings set business_status = null, google_fields = array_remove(google_fields, 'status')
    where 'status' = any(google_fields);
  end if;
  if 'coords' = any(p_parts) then
    -- Pins still from Google (Mapbox could not place them). The listing stays in
    -- lists and search, and drops off the map until someone sets a pin.
    update public.listings set latitude = null, longitude = null, coords_source = null
    where coords_source = 'google';
  end if;
  if 'photos' = any(p_parts) then
    delete from public.listing_photos where url like '%/listing-photos/%';
    res := res || jsonb_build_object('photo_urls', to_jsonb(urls));
  end if;

  insert into public.app_settings (key, value, is_public)
  values ('a17_cleared', jsonb_build_object('at', now(), 'parts', to_jsonb(p_parts)), false)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (null, 'a17_clear_google', null, res - 'photo_urls');
  return res;
end $$;
revoke all on function public.service_a17_clear_google(boolean, text[]) from public, anon, authenticated;
grant execute on function public.service_a17_clear_google(boolean, text[]) to service_role;

-- ---------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------
select 'pins by source' as what, coalesce(coords_source, 'no pin') as detail, count(*)::text as n
from public.listings where merged_into is null group by coords_source
union all
select 'listings with Google values', 'any', count(*)::text from public.listings where cardinality(google_fields) > 0
union all
select 'Google photos', 'listing-photos bucket', count(*)::text from public.listing_photos where url like '%/listing-photos/%'
order by 1, 2;
