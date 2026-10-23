-- 098: Kevin's Harbor Heights test, A42 data cleanup and the A41 Photo Wall fix (Oct 23, 2026).
--
--  Part 1  Harbor Heights
--    - Basic shows only name, address, pin, phone, hours and one cover photo:
--      the plan limit switch is turned on (Admin > Settings can turn it off).
--    - Phone typed on an application is copied to the listing when it has none.
--    - A Basic listing's uploaded logo with no photos becomes its cover photo.
--    - New subcategory Stay > Vacation Homes, free-text "vacation rental" style
--      categories become Stay, and admin can pick any subcategory.
--    - portal_set_cover_photo: the one cover photo, on every plan.
--  Part 2  A42
--    - Backup, then 9 duplicate pairs merged into the row with the Google place id.
--      The other row is hidden, never deleted (merged_into says where it went).
--    - Duplicate beach accesses ("Access 15 - "Campbell Street"" next to
--      "Campbell Street - 15") merged into the "Name - 15" row, and given a category.
--    - Blue Mountain Beach Creamery no longer borrows the Liquors' place id, hours or phone.
--    - "30A Thai Cusine" spelling.
--  Part 3  A41 Photo Wall
--    - New posts wait for admin approval. Admin > Photo Wall approves or removes them.
--
-- Run after 097. Safe to run more than once. Ends with three short reports.

-- =====================================================================
-- Part 1. Harbor Heights
-- =====================================================================

update public.app_settings set value = '{"on": true}', updated_at = now()
where key = 'enforce_plan_limits' and coalesce((value->>'on')::boolean, false) = false;

-- Phone from the application, where the listing has none.
update public.listings l
set phone = left(a.phone, 40)
from public.portal_audit pa
join public.business_applications a on a.id = (pa.detail->>'application')::uuid
where pa.action = 'application_approved'
  and pa.listing_id = l.id
  and l.phone is null
  and a.phone is not null and trim(a.phone) <> '';

-- A Basic listing's logo, with no photos, becomes its cover photo.
insert into public.listing_photos (listing_id, url, sort_order)
select l.id, l.logo_url, 0
from public.listings l
where l.plan = 'basic' and l.logo_url is not null
  and not exists (select 1 from public.listing_photos p where p.listing_id = l.id);

-- Stay > Vacation Homes, for single rental homes like Harbor Heights.
insert into public.subcategories (category, name, sort)
values ('Stay', 'Vacation Homes', 4)
on conflict (name) do nothing;

-- Free-text categories from the old apply form.
update public.listings
set category = 'Stay'
where category is not null
  and category not in (select distinct category from public.subcategories)
  and category ~* '(vacation|rental home|beach house|house rental|lodging|stay|hotel|inn\y|condo|resort|cottage)';

create or replace function public.auto_subcategory(p_name text, p_category text, p_description text)
returns text
language sql immutable as $$
  with t as (select lower(coalesce(p_name, '') || ' ' || coalesce(p_description, '')) as s)
  select case p_category
    when 'Food & Drink' then case
      when s ~ '\y(steakhouse|chophouse|fine dining|prime)\y' then 'Fine Dining'
      when s ~ '\y(oyster|oysters|seafood|crab|shrimp|fish house|raw bar|lobster)\y' then 'Seafood & Oysters'
      when s ~ '\y(pizza|pizzeria|italian|pasta|trattoria)\y' then 'Pizza & Italian'
      when s ~ '\y(taco|tacos|mexican|cantina|burrito|latin|cuban|tex-mex)\y' then 'Mexican & Latin'
      when s ~ '\y(sushi|thai|asian|ramen|hibachi|chinese|pho|poke|japanese|korean)\y' then 'Asian & Sushi'
      when s ~ '\y(ice cream|gelato|candy|fudge|yogurt|dessert|cupcake|sweets|creamery)\y' then 'Ice Cream & Sweets'
      when s ~ '\y(coffee|bakery|bagel|donut|espresso|roaster|pastry|cafe|café)\y' then 'Coffee & Bakeries'
      when s ~ '\y(breakfast|brunch|pancake|biscuit)\y' then 'Breakfast & Brunch'
      when s ~ '\y(food truck|truck|juice|smoothie|salad|vegan|acai|açaí|healthy)\y' then 'Food Trucks & Healthy'
      when s ~ '\y(bbq|barbecue|smokehouse|burger|burgers|southern|diner|wings|american)\y' then 'Southern BBQ & American'
      when s ~ '\y(bar|pub|brewery|brewing|tavern|wine bar|lounge|cocktail|saloon|live music)\y' then 'Bars & Live Music'
      end
    when 'Shops' then case
      when s ~ '\y(surf|swim|swimwear|beachwear|bikini)\y' then 'Swim Surf & Beachwear'
      when s ~ '\y(gallery|galleries)\y' then 'Art Galleries'
      when s ~ '\y(jewelry|jeweler|jewellery|accessories)\y' then 'Jewelry & Accessories'
      when s ~ '\y(grocery|market|wine|liquor|sundries|bottle|pharmacy)\y' then 'Groceries Wine & Sundries'
      when s ~ '\y(boutique|clothing|apparel|dress|fashion|outfitters)\y' then 'Clothing Boutiques'
      when s ~ '\y(gift|gifts|home|kids|toy|toys|decor|candles)\y' then 'Gifts Home & Kids'
      end
    when 'Activities' then case
      when s ~ '\y(golf cart|golf carts|lsv|cart rental|carts)\y' then 'Golf Carts & LSVs'
      when s ~ '\y(e-bike|ebike|bike|bikes|bicycle|cycle)\y' then 'Bikes & E-Bikes'
      when s ~ '\y(fishing|charter|charters)\y' then 'Fishing Charters'
      when s ~ '\y(dolphin|boat|cruise|boat tour|sailing|pontoon)\y' then 'Boat & Dolphin Tours'
      when s ~ '\y(kayak|paddleboard|paddle|sup|surf lesson|surfing)\y' then 'Kayak Paddleboard & Surf'
      when s ~ '\y(beach chair|beach chairs|umbrella|bonfire|bonfires|cabana)\y' then 'Beach Chairs & Bonfires'
      when s ~ '\y(photographer|photography|photos)\y' then 'Beach Photographers'
      when s ~ '\y(golf|tennis|pickleball)\y' then 'Golf Tennis & Pickleball'
      when s ~ '\y(yoga|fitness|pilates|gym|barre)\y' then 'Fitness & Yoga'
      when s ~ '\y(park|zoo|museum|attraction|mini golf|arcade|playground)\y' then 'Parks Attractions & Kids'
      end
    when 'Services' then case
      when s ~ '\y(spa|massage|wellness)\y' then 'Spas Massage & Wellness'
      when s ~ '\y(salon|hair|beauty|nails|barber)\y' then 'Salons & Beauty'
      when s ~ '\y(chef|catering|caterer)\y' then 'Private Chefs & Catering'
      when s ~ '\y(urgent care|clinic|medical|dental|doctor|health)\y' then 'Health & Urgent Care'
      when s ~ '\y(baby|babysitting|nanny|crib)\y' then 'Baby Gear & Babysitting'
      end
    when 'Stay' then case
      when s ~ '\y(hotel|inn|motel|lodge)\y' then 'Hotels & Inns'
      when s ~ '\y(resort|condo|condos|condominium)\y' then 'Resorts & Condos'
      when s ~ '\y(rental company|rentals|management|properties|realty)\y' then 'Vacation Rental Companies'
      when s ~ '\y(house|home|cottage|villa|bungalow|heights|retreat|vacation rental|rental)\y' then 'Vacation Homes'
      end
  end
  from t;
$$;

-- Picking a subcategory also sets its parent category, so a listing with a
-- free-text category is never stuck with "None" as the only choice.
create or replace function public.admin_set_subcategory(p_listing_id uuid, p_subcategory text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  parent text;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_subcategory is not null then
    select category into parent from public.subcategories where name = p_subcategory;
    if parent is null then
      raise exception 'Unknown subcategory';
    end if;
  end if;
  update public.listings
  set subcategory = p_subcategory,
      category = coalesce(parent, category)
  where id = p_listing_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'subcategory_set', p_listing_id, jsonb_build_object('subcategory', p_subcategory, 'category', parent));
end $$;
revoke all on function public.admin_set_subcategory(uuid, text) from public, anon;
grant execute on function public.admin_set_subcategory(uuid, text) to authenticated;

-- Harbor Heights and anything like it: a subcategory from the name now that
-- the category is right.
update public.listings
set subcategory = public.auto_subcategory(name, category, description)
where subcategory is null and category = 'Stay'
  and public.auto_subcategory(name, category, description) is not null;

-- The one cover photo. Every plan has it. It replaces the first photo.
create or replace function public.portal_set_cover_photo(p_listing_id uuid, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  u text := nullif(trim(p_url), '');
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  if u is not null and position('/listing-assets/' || p_listing_id::text || '/' in u) = 0 then
    raise exception 'Upload the photo here in the portal';
  end if;
  delete from public.listing_photos
  where listing_id = p_listing_id
    and sort_order = (select min(sort_order) from public.listing_photos where listing_id = p_listing_id);
  if u is not null then
    insert into public.listing_photos (listing_id, url, sort_order) values (p_listing_id, u, 0);
  end if;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'cover_photo_set', p_listing_id, jsonb_build_object('url', u));
end $$;
revoke all on function public.portal_set_cover_photo(uuid, text) from public, anon;
grant execute on function public.portal_set_cover_photo(uuid, text) to authenticated;

-- =====================================================================
-- Part 2. A42
-- =====================================================================

do $$
begin
  if to_regclass('public.listings_backup_098') is null then
    execute 'create table public.listings_backup_098 as select * from public.listings';
    execute 'alter table public.listings_backup_098 enable row level security';
    execute 'revoke all on public.listings_backup_098 from anon, authenticated';
  end if;
end $$;

alter table public.listings add column if not exists merged_into uuid references public.listings(id) on delete set null;

create or replace function public.norm_name(p text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Moves everything that points at p_drop over to p_keep, fills gaps in
-- p_keep from p_drop, and hides p_drop. Nothing is deleted. A row that
-- cannot move (the same person favorited both, say) stays on the hidden one.
create or replace function public.merge_listing(p_keep uuid, p_drop uuid, p_new_name text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  k public.listings;
  d public.listings;
  fk record;
  rid tid;
  offset_n integer;
begin
  if auth.uid() is not null and not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select * into k from public.listings where id = p_keep;
  select * into d from public.listings where id = p_drop;
  if k.id is null or d.id is null or k.id = d.id then
    return 'skipped: listing not found';
  end if;
  if d.merged_into is not null then
    return 'already merged: ' || d.name;
  end if;

  -- Photos go after the kept row's own, or first when it has none.
  select coalesce(max(sort_order) + 1, 0) into offset_n from public.listing_photos where listing_id = p_keep;
  update public.listing_photos set listing_id = p_keep, sort_order = sort_order + offset_n where listing_id = p_drop;

  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.listings'::regclass
      and array_length(c.conkey, 1) = 1
      and c.conrelid not in ('public.listing_photos'::regclass, 'public.listings'::regclass)
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using p_keep, p_drop;
    exception when unique_violation or check_violation then
      -- Row by row, so only the clashing rows stay behind.
      for rid in execute format('select ctid from %s where %I = $1', fk.tbl, fk.col) using p_drop loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col) using p_keep, rid;
        exception when unique_violation or check_violation then
          null;
        end;
      end loop;
    end;
  end loop;

  update public.listings set
    name = coalesce(nullif(trim(p_new_name), ''), name),
    phone = coalesce(phone, d.phone),
    website = coalesce(website, d.website),
    description = coalesce(description, d.description),
    address = coalesce(address, d.address),
    latitude = coalesce(latitude, d.latitude),
    longitude = coalesce(longitude, d.longitude),
    category = coalesce(category, d.category),
    subcategory = coalesce(subcategory, d.subcategory),
    hours_periods = coalesce(hours_periods, d.hours_periods),
    hours_text = coalesce(hours_text, d.hours_text)
  where id = p_keep;

  update public.listings set
    merged_into = p_keep,
    area_status_override = 'outside',
    area_reason = 'override: duplicate of ' || coalesce(nullif(trim(p_new_name), ''), k.name) || ' (A42, merged)'
  where id = p_drop;

  return 'merged: ' || d.name || ' -> ' || coalesce(nullif(trim(p_new_name), ''), k.name);
end $$;
revoke all on function public.merge_listing(uuid, uuid, text) from public, anon, authenticated;

-- Merge two listings named a and b. The one with a Google place id is kept.
create or replace function public.merge_pair_by_name(a text, b text, new_name text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ra uuid; rb uuid; na int; nb int;
  pa text; pb text;
begin
  if exists (select 1 from public.listings
             where merged_into is not null
               and norm_name(name) in (norm_name(a), norm_name(b), norm_name(coalesce(new_name, a)))) then
    return 'already merged: ' || a || ' + ' || b;
  end if;
  select count(*) into na from public.listings where norm_name(name) = norm_name(a) and merged_into is null;
  select count(*) into nb from public.listings where norm_name(name) = norm_name(b) and merged_into is null;
  if na = 0 and nb = 0 then
    return 'not found: ' || a || ' + ' || b;
  end if;
  if na <> 1 or nb <> 1 then
    return format('check by hand: %s rows named "%s", %s rows named "%s"', na, a, nb, b);
  end if;
  select id, google_place_id into ra, pa from public.listings where norm_name(name) = norm_name(a) and merged_into is null;
  select id, google_place_id into rb, pb from public.listings where norm_name(name) = norm_name(b) and merged_into is null;
  if pa is not null and pb is null then
    return public.merge_listing(ra, rb, new_name);
  elsif pb is not null and pa is null then
    return public.merge_listing(rb, ra, new_name);
  else
    return format('check by hand: "%s" and "%s" %s have a place id', a, b, case when pa is null then 'neither' else 'both' end);
  end if;
end $$;
revoke all on function public.merge_pair_by_name(text, text, text) from public, anon, authenticated;

create temporary table if not exists _a42 (step text, result text);
truncate _a42;

insert into _a42 select 'pair', public.merge_pair_by_name('B.f.f – Great Southern', 'Great Southern Cafe', 'Great Southern Cafe');
insert into _a42 select 'pair', public.merge_pair_by_name('Lagree 30A', 'Lagree30A');
insert into _a42 select 'pair', public.merge_pair_by_name('The Big Chill', 'The Big Chill 30a');
insert into _a42 select 'pair', public.merge_pair_by_name('Pure Barre 30A', 'Pure Barre');
insert into _a42 select 'pair', public.merge_pair_by_name('Coastside Beer and Wine', 'Coastside 30A');
insert into _a42 select 'pair', public.merge_pair_by_name('Yellowfin Ocean Sports (WaterColor Crossings)', 'Yellowfin Ocean Sports WaterColor');
insert into _a42 select 'pair', public.merge_pair_by_name('30a Rental Company Shuttle (30a Pontoon)', '30A Pontoon Rental', '30A Pontoon Rental');
insert into _a42 select 'pair', public.merge_pair_by_name('30A Glow', 'GLOW Medspa & Wellness');
insert into _a42 select 'pair', public.merge_pair_by_name('Grayton Beach State Park (campground & cabins)', 'Grayton Beach State Park');
-- Not merged until Kevin confirms: Grayton Beach Charters + Grayton Girl Fishing Charters,
-- and The Yoga Haus + Yoga Bar 30A.

-- Beach accesses in two naming styles. "Access 15 - "Campbell Street"" is
-- merged into "Campbell Street - 15" when the number and the first word match.
do $$
declare
  r record;
begin
  for r in
    select o.id as drop_id, k.id as keep_id, o.name as old_name, k.name as keep_name
    from public.listings o
    join public.listings k
      on k.id <> o.id
     and k.merged_into is null
     and k.name ~ '\s-\s*\d+\s*$'
     and substring(k.name from '(\d+)\s*$') = substring(o.name from '^Access\s+(\d+)')
     and split_part(norm_name(substring(k.name from '^(.*?)\s*-\s*\d+\s*$')), ' ', 1)
         = split_part(norm_name(substring(o.name from '"([^"]+)"')), ' ', 1)
    where o.name ~* '^Access\s+\d+\s*-\s*"'
      and o.merged_into is null
  loop
    insert into _a42 values ('beach access', public.merge_listing(r.keep_id, r.drop_id));
  end loop;
end $$;

-- A category for every beach access that has none: the one most beach accesses already use.
update public.listings
set category = coalesce(
  (select mode() within group (order by category) from public.listings where is_public_access and category is not null),
  'Beach Access')
where is_public_access and category is null and merged_into is null;

-- Blue Mountain Beach Creamery is a different shop from Blue Mountain Liquors & Market
-- at the same address, but the Creamery row carries the Liquors' Google place id,
-- hours, phone and rating (Kevin, A42). They move to the Liquors row where it has
-- none, and the Creamery keeps only its own name and address.
do $$
declare
  c public.listings;
  l public.listings;
begin
  select * into c from public.listings where norm_name(name) = norm_name('Blue Mountain Beach Creamery') and merged_into is null limit 1;
  select * into l from public.listings where norm_name(name) = norm_name('Blue Mountain Liquors & Market') and merged_into is null limit 1;
  if c.id is null or l.id is null or c.google_place_id is null then
    return;
  end if;
  update public.listings set google_place_id = null, hours_periods = null, hours_text = null,
         phone = null, rating = null, rating_count = null
  where id = c.id;
  update public.listings set
    google_place_id = coalesce(google_place_id, c.google_place_id),
    hours_periods = coalesce(hours_periods, c.hours_periods),
    hours_text = coalesce(hours_text, c.hours_text),
    phone = coalesce(phone, c.phone),
    rating = coalesce(rating, c.rating),
    rating_count = coalesce(rating_count, c.rating_count)
  where id = l.id;
end $$;

update public.listings set name = '30A Thai Cuisine' where name = '30A Thai Cusine';

-- =====================================================================
-- Part 3. A41 Photo Wall: posts wait for review
-- =====================================================================

create or replace function public.photo_wall_hold_new()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    new.is_hidden := true;
  end if;
  return new;
end $$;
revoke all on function public.photo_wall_hold_new() from public, anon, authenticated;
drop trigger if exists photo_wall_hold_new_trg on public.photo_wall_posts;
create trigger photo_wall_hold_new_trg before insert on public.photo_wall_posts
  for each row execute function public.photo_wall_hold_new();

create or replace function public.email_on_photo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_hidden then
    perform public.queue_email(public.admin_notify_address(), 'admin_photo',
      'New Photo Wall photo to review',
      'Someone posted a photo to the Photo Wall. It stays hidden until you approve it.' || E'\n\n' ||
      coalesce('Caption: ' || new.caption, 'No caption') || E'\n' || coalesce('Place: ' || new.location_name, ''),
      'https://portal.in30a.app/admin/photos');
  end if;
  return new;
end $$;
revoke all on function public.email_on_photo() from public, anon, authenticated;
drop trigger if exists email_photo_ins on public.photo_wall_posts;
create trigger email_photo_ins after insert on public.photo_wall_posts
  for each row execute function public.email_on_photo();

create or replace function public.admin_photo_queue(p_scope text default 'pending')
returns table (id uuid, photo_url text, caption text, location_name text, created_at timestamptz, is_hidden boolean, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select p.id, p.photo_url, p.caption, p.location_name, p.created_at, p.is_hidden, u.email::text
    from public.photo_wall_posts p
    left join auth.users u on u.id = p.user_id
    where p_scope = 'all' or p.is_hidden
    order by p.created_at desc
    limit 100;
end $$;
revoke all on function public.admin_photo_queue(text) from public, anon;
grant execute on function public.admin_photo_queue(text) to authenticated;

create or replace function public.admin_review_photo(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_approve then
    update public.photo_wall_posts set is_hidden = false where id = p_id;
  else
    delete from public.photo_wall_posts where id = p_id;
  end if;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), case when p_approve then 'photo_approved' else 'photo_removed' end, null, jsonb_build_object('post', p_id));
end $$;
revoke all on function public.admin_review_photo(uuid, boolean) from public, anon;
grant execute on function public.admin_review_photo(uuid, boolean) to authenticated;

-- =====================================================================
-- Reports
-- =====================================================================

-- 1. What A42 did. "check by hand" lines need a look.
select step, result from _a42 order by step, result;

-- 2. Places Google lists as temporarily closed (the app now labels them).
select name, business_status from public.listings
where business_status = 'CLOSED_TEMPORARILY' and merged_into is null order by name;

-- 3. Blue Mountain pair after the fix (the Creamery should show no place id).
select name, google_place_id, phone from public.listings
where norm_name(name) in (norm_name('Blue Mountain Beach Creamery'), norm_name('Blue Mountain Liquors & Market'));

-- 4. Harbor Heights now.
select name, category, subcategory, plan, phone, latitude is not null as has_pin, area_status,
       (select count(*) from public.listing_photos p where p.listing_id = l.id) as photos
from public.listings l where name ilike 'Harbor Heights%';
