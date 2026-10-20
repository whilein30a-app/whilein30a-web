-- 091: plans and slots, subcategories, booked pushes, Nearby deals,
-- sponsor spots, admin analytics.
--
-- Run AFTER 090. Safe to run more than once. Run in the Supabase SQL editor.
--
-- DECISIONS WORTH KNOWING
--   * Plans do not change what people see until you switch enforcement on:
--     update app_settings set value = '{"on": true}' where key = 'enforce_plan_limits';
--     Until then every listing looks as it does today. Do this on launch day,
--     after the real plans are set in the admin.
--   * Featured allows 3 listings per subcategory, Spotlight allows 1. The
--     database refuses a 4th Featured or a 2nd Spotlight.
--   * Pushes are booked. App wide there is one push in the morning window
--     (10 AM to 3 PM Central) and one in the afternoon window (3 to 8 PM
--     Central) per day. The first business to book a day and window gets it.
--   * Nearby pushes use the location the app saved when the person last
--     opened it, rounded to about 100 meters, and only if they switched
--     Nearby deal alerts on. Switching it off deletes the saved location.
--   * A user can no longer make themselves an admin through the API.

-- ---------------------------------------------------------------------
-- Helpers and settings
-- ---------------------------------------------------------------------

create or replace function public.central_today()
returns date language sql stable as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
-- Signed-out visitors are the anon role, and they may not call
-- is_portal_admin(), so they get their own policy.
drop policy if exists app_settings_read on public.app_settings;
drop policy if exists app_settings_read_anon on public.app_settings;
drop policy if exists app_settings_read_auth on public.app_settings;
create policy app_settings_read_anon on public.app_settings
  for select to anon using (is_public);
create policy app_settings_read_auth on public.app_settings
  for select to authenticated using (is_public or public.is_portal_admin());

insert into public.app_settings (key, value, is_public) values
  ('enforce_plan_limits', '{"on": false}', true),
  ('push_windows', '{"morning": {"start": 10, "end": 15, "send_hour": 11}, "afternoon": {"start": 15, "end": 20, "send_hour": 16}}', true),
  ('push_rules', '{"spotlight_per_month": 1, "standard_price": 99, "nearby_price": 149}', true),
  ('nearby', '{"radius_miles": 2, "fresh_hours": 3}', true),
  ('stripe_links', '{}', true)
on conflict (key) do nothing;

create or replace function public.get_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function public.plan_limits_enforced()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.get_setting('enforce_plan_limits')->>'on')::boolean, false);
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb, p_public boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_]{2,60}$' then
    raise exception 'Bad setting name';
  end if;
  insert into public.app_settings (key, value, is_public, updated_at)
  values (p_key, coalesce(p_value, '{}'::jsonb), coalesce(p_public, true), now())
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_at = now();
  insert into public.portal_audit (user_id, action, detail)
  values (auth.uid(), 'setting_changed', jsonb_build_object('key', p_key));
end $$;
revoke all on function public.admin_set_setting(text, jsonb, boolean) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb, boolean) to authenticated;

revoke all on function public.get_setting(text) from public, anon;
revoke all on function public.plan_limits_enforced() from public, anon;
grant execute on function public.get_setting(text) to authenticated;
grant execute on function public.plan_limits_enforced() to authenticated;

-- Stop users from making themselves admin through the API. The SQL editor and
-- the service role are not affected.
create or replace function public.profiles_protect_admin()
returns trigger language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Not allowed';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin before update on public.profiles
  for each row execute function public.profiles_protect_admin();

-- ---------------------------------------------------------------------
-- Subcategories and plans on listings
-- ---------------------------------------------------------------------

create table if not exists public.subcategories (
  name text primary key check (char_length(name) between 2 and 60),
  category text not null,
  sort integer not null default 0
);
alter table public.subcategories enable row level security;
revoke all on public.subcategories from anon, authenticated;
grant select on public.subcategories to anon, authenticated;
drop policy if exists subcategories_read on public.subcategories;
create policy subcategories_read on public.subcategories for select to anon, authenticated using (true);

insert into public.subcategories (category, name, sort) values
  ('Food & Drink', 'Seafood & Oysters', 1),
  ('Food & Drink', 'Fine Dining', 2),
  ('Food & Drink', 'Pizza & Italian', 3),
  ('Food & Drink', 'Mexican & Latin', 4),
  ('Food & Drink', 'Asian & Sushi', 5),
  ('Food & Drink', 'Breakfast & Brunch', 6),
  ('Food & Drink', 'Coffee & Bakeries', 7),
  ('Food & Drink', 'Ice Cream & Sweets', 8),
  ('Food & Drink', 'Bars & Live Music', 9),
  ('Food & Drink', 'Southern BBQ & American', 10),
  ('Food & Drink', 'Food Trucks & Healthy', 11),
  ('Shops', 'Clothing Boutiques', 1),
  ('Shops', 'Swim Surf & Beachwear', 2),
  ('Shops', 'Art Galleries', 3),
  ('Shops', 'Jewelry & Accessories', 4),
  ('Shops', 'Gifts Home & Kids', 5),
  ('Shops', 'Groceries Wine & Sundries', 6),
  ('Activities', 'Golf Carts & LSVs', 1),
  ('Activities', 'Bikes & E-Bikes', 2),
  ('Activities', 'Kayak Paddleboard & Surf', 3),
  ('Activities', 'Fishing Charters', 4),
  ('Activities', 'Boat & Dolphin Tours', 5),
  ('Activities', 'Beach Chairs & Bonfires', 6),
  ('Activities', 'Beach Photographers', 7),
  ('Activities', 'Golf Tennis & Pickleball', 8),
  ('Activities', 'Fitness & Yoga', 9),
  ('Activities', 'Parks Attractions & Kids', 10),
  ('Services', 'Spas Massage & Wellness', 1),
  ('Services', 'Salons & Beauty', 2),
  ('Services', 'Private Chefs & Catering', 3),
  ('Services', 'Health & Urgent Care', 4),
  ('Services', 'Baby Gear & Babysitting', 5),
  ('Stay', 'Vacation Rental Companies', 1),
  ('Stay', 'Hotels & Inns', 2),
  ('Stay', 'Resorts & Condos', 3)
on conflict (name) do nothing;

alter table public.listings add column if not exists subcategory text;
alter table public.listings add column if not exists plan text not null default 'basic';
alter table public.listings add column if not exists billing text;
alter table public.listings add column if not exists is_founding boolean not null default false;
alter table public.listings add column if not exists plan_expires_on date;
alter table public.listings add column if not exists logo_url text;
alter table public.listings add column if not exists menu_url text;
alter table public.listings add column if not exists booking_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_plan_check') then
    alter table public.listings add constraint listings_plan_check
      check (plan in ('basic', 'premium', 'featured', 'spotlight'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_billing_check') then
    alter table public.listings add constraint listings_billing_check
      check (billing is null or billing in ('month', 'year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_urls_check') then
    alter table public.listings add constraint listings_urls_check check (
      (logo_url is null or logo_url ~* '^https://[^\s]+$')
      and (menu_url is null or menu_url ~* '^https?://[^\s]+$')
      and (booking_url is null or booking_url ~* '^https?://[^\s]+$'));
  end if;
end $$;

create index if not exists listings_subcategory_plan_idx on public.listings (subcategory, plan);

-- Anyone already marked as a sponsor starts on Premium.
update public.listings set plan = 'premium' where is_sponsored is true and plan = 'basic';

-- Best guess at a subcategory from the name and description. Only a first
-- pass: the admin reviews and fixes the result.
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
      when s ~ '\y(rental|rentals|vacation|management)\y' then 'Vacation Rental Companies'
      end
  end
  from t;
$$;

create or replace function public.admin_autoassign_subcategories()
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  with u as (
    update public.listings l
    set subcategory = public.auto_subcategory(l.name, l.category, l.description)
    where l.subcategory is null
      and coalesce(l.is_public_access, false) = false
      and public.auto_subcategory(l.name, l.category, l.description) is not null
    returning 1
  )
  select count(*) into n from u;
  insert into public.portal_audit (user_id, action, detail)
  values (auth.uid(), 'subcategories_autoassigned', jsonb_build_object('count', n));
  return n;
end $$;
revoke all on function public.admin_autoassign_subcategories() from public, anon;
grant execute on function public.admin_autoassign_subcategories() to authenticated;

create or replace function public.admin_set_subcategory(p_listing_id uuid, p_subcategory text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_subcategory is not null and not exists (select 1 from public.subcategories where name = p_subcategory) then
    raise exception 'Unknown subcategory';
  end if;
  update public.listings set subcategory = p_subcategory where id = p_listing_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'subcategory_set', p_listing_id, jsonb_build_object('subcategory', p_subcategory));
end $$;
revoke all on function public.admin_set_subcategory(uuid, text) from public, anon;
grant execute on function public.admin_set_subcategory(uuid, text) to authenticated;

-- Sets a business's plan. Refuses when the slot is full.
create or replace function public.admin_set_plan(
  p_listing_id uuid,
  p_plan text,
  p_billing text default null,
  p_founding boolean default false,
  p_expires_on date default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  cap integer;
  used integer;
  founders integer;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_plan not in ('basic', 'premium', 'featured', 'spotlight') then
    raise exception 'Unknown plan';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'Listing not found';
  end if;

  if p_plan in ('featured', 'spotlight') then
    if l.subcategory is null then
      raise exception 'Set a subcategory first. Slots are per subcategory.';
    end if;
    cap := case p_plan when 'featured' then 3 else 1 end;
    select count(*) into used from public.listings
      where subcategory = l.subcategory and plan = p_plan and id <> p_listing_id
        and (plan_expires_on is null or plan_expires_on >= public.central_today());
    if used >= cap then
      raise exception 'No % slot left in %. % of % are taken.', p_plan, l.subcategory, used, cap;
    end if;
  end if;

  if p_founding and not l.is_founding then
    select count(*) into founders from public.listings where is_founding and id <> p_listing_id;
    if founders >= 20 then
      raise exception 'All 20 Founding Partner places are taken';
    end if;
  end if;

  update public.listings set
    plan = p_plan,
    billing = case when p_plan = 'basic' then null else p_billing end,
    is_founding = coalesce(p_founding, false),
    plan_expires_on = case when p_plan = 'basic' then null else p_expires_on end,
    is_sponsored = (p_plan <> 'basic')
  where id = p_listing_id;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'plan_set', p_listing_id,
          jsonb_build_object('plan', p_plan, 'billing', p_billing, 'founding', p_founding, 'expires', p_expires_on));
end $$;
revoke all on function public.admin_set_plan(uuid, text, text, boolean, date) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, text, boolean, date) to authenticated;

-- Open and taken Featured and Spotlight slots per subcategory.
create or replace function public.admin_slots_overview()
returns table (category text, subcategory text, featured_names text[], spotlight_names text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select s.category, s.name,
      coalesce((select array_agg(l.name order by l.name) from public.listings l
                where l.subcategory = s.name and l.plan = 'featured'
                  and (l.plan_expires_on is null or l.plan_expires_on >= public.central_today())), '{}'::text[]),
      coalesce((select array_agg(l.name order by l.name) from public.listings l
                where l.subcategory = s.name and l.plan = 'spotlight'
                  and (l.plan_expires_on is null or l.plan_expires_on >= public.central_today())), '{}'::text[])
    from public.subcategories s
    order by s.category, s.sort;
end $$;
revoke all on function public.admin_slots_overview() from public, anon;
grant execute on function public.admin_slots_overview() to authenticated;

-- Plans that have run out go back to Basic every night.
create or replace function public.expire_plans()
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with u as (
    update public.listings
    set plan = 'basic', billing = null, is_sponsored = false
    where plan <> 'basic' and plan_expires_on is not null and plan_expires_on < public.central_today()
    returning 1
  )
  select count(*) into n from u;
  return n;
end $$;
revoke all on function public.expire_plans() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- What owners see and can edit
-- ---------------------------------------------------------------------

drop function if exists public.portal_my_listings();
create or replace function public.portal_my_listings()
returns table (
  id uuid, name text, category text, subcategory text, address text, phone text, website text,
  description text, is_sponsored boolean, plan text, billing text, is_founding boolean,
  plan_expires_on date, logo_url text, menu_url text, booking_url text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.category, l.subcategory, l.address, l.phone, l.website, l.description,
         l.is_sponsored, l.plan, l.billing, l.is_founding, l.plan_expires_on, l.logo_url, l.menu_url, l.booking_url
  from public.listings l
  join public.listing_owners o on o.listing_id = l.id and o.user_id = auth.uid()
  order by l.name;
$$;
revoke all on function public.portal_my_listings() from public, anon;
grant execute on function public.portal_my_listings() to authenticated;

create or replace function public.portal_update_listing(p_listing_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  site text;
  logo text;
  menu text;
  book text;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  select * into l from public.listings where id = p_listing_id;

  if public.plan_limits_enforced() and l.plan = 'basic' and not public.is_portal_admin()
     and (p_fields ? 'description' or p_fields ? 'website' or p_fields ? 'logo_url'
          or p_fields ? 'menu_url' or p_fields ? 'booking_url') then
    raise exception 'Description, links and logo are part of Premium and above';
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

  update public.listings set
    description = case when p_fields ? 'description' then nullif(left(p_fields->>'description', 1500), '') else description end,
    phone = case when p_fields ? 'phone' then nullif(left(p_fields->>'phone', 40), '') else phone end,
    website = case when p_fields ? 'website' then site else website end,
    menu_url = case when p_fields ? 'menu_url' then menu else menu_url end,
    booking_url = case when p_fields ? 'booking_url' then book else booking_url end,
    logo_url = case when p_fields ? 'logo_url' then logo else logo_url end
  where id = p_listing_id;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'listing_updated', p_listing_id, p_fields);
end $$;
revoke all on function public.portal_update_listing(uuid, jsonb) from public, anon;
grant execute on function public.portal_update_listing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Booked pushes
-- ---------------------------------------------------------------------

alter table public.deals add column if not exists push_type text not null default 'none';
alter table public.deals add column if not exists push_date date;
alter table public.deals add column if not exists push_window text;
alter table public.deals add column if not exists push_status text not null default 'none';
alter table public.deals add column if not exists push_paid boolean not null default false;
alter table public.deals add column if not exists push_sent_at timestamptz;
alter table public.deals add column if not exists push_recipients integer;

-- Pushes now come only from bookings.
alter table public.deals alter column send_push set default false;
update public.deals set send_push = false where send_push is true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_push_type_check') then
    alter table public.deals add constraint deals_push_type_check check (push_type in ('none', 'included', 'single', 'nearby'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_push_window_check') then
    alter table public.deals add constraint deals_push_window_check check (push_window is null or push_window in ('morning', 'afternoon'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_push_status_check') then
    alter table public.deals add constraint deals_push_status_check check (push_status in ('none', 'requested', 'scheduled', 'sent', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_push_booking_check') then
    alter table public.deals add constraint deals_push_booking_check check (
      push_status = 'none' or push_status = 'cancelled' or (push_date is not null and push_window is not null));
  end if;
end $$;

-- One push per day and window, app wide. First booking wins.
create unique index if not exists deals_push_slot_uq on public.deals (push_date, push_window)
  where push_status in ('requested', 'scheduled', 'sent');

create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  kind text not null,
  deal_id uuid,
  listing_id uuid,
  title text,
  body text,
  audience text,
  recipients integer not null default 0,
  sent_by uuid,
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;
grant select on public.push_log to authenticated;
drop policy if exists push_log_admin_read on public.push_log;
create policy push_log_admin_read on public.push_log for select to authenticated using (public.is_portal_admin());

create or replace function public.push_send_hour(p_window text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((public.get_setting('push_windows')->p_window->>'send_hour')::int,
                  case p_window when 'morning' then 11 else 16 end);
$$;

create or replace function public.push_window_in_future(p_date date, p_window text)
returns boolean language sql stable security definer set search_path = public as $$
  select ((p_date + make_interval(hours => public.push_send_hour(p_window))) at time zone 'America/Chicago') > now();
$$;

-- Which windows are already booked. Business owners need this to choose.
create or replace function public.push_windows_taken(p_from date, p_to date)
returns table (push_date date, push_window text)
language sql stable security definer set search_path = public as $$
  select d.push_date, d.push_window from public.deals d
  where d.push_status in ('requested', 'scheduled', 'sent')
    and d.push_date between p_from and least(p_to, p_from + 120);
$$;
revoke all on function public.push_windows_taken(date, date) from public, anon;
grant execute on function public.push_windows_taken(date, date) to authenticated;

create or replace function public.included_pushes_used(p_listing_id uuid, p_month date)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.deals d
  where d.listing_id = p_listing_id and d.push_type = 'included'
    and d.push_status in ('requested', 'scheduled', 'sent')
    and date_trunc('month', d.push_date) = date_trunc('month', p_month);
$$;
revoke all on function public.included_pushes_used(uuid, date) from public, anon;
grant execute on function public.included_pushes_used(uuid, date) to authenticated;

drop function if exists public.portal_save_deal(uuid, uuid, text, text, date, boolean);
create or replace function public.portal_save_deal(
  p_listing_id uuid,
  p_deal_id uuid,
  p_title text,
  p_discount_text text,
  p_valid_until date,
  p_push_type text default 'none',
  p_push_date date default null,
  p_push_window text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  existing public.deals;
  result uuid;
  want_push boolean := coalesce(p_push_type, 'none') <> 'none';
  allowance integer := coalesce((public.get_setting('push_rules')->>'spotlight_per_month')::int, 1);
  is_admin boolean := public.is_portal_admin();
begin
  if not (public.owns_listing(p_listing_id) or is_admin) then
    raise exception 'Not allowed';
  end if;
  select * into l from public.listings where id = p_listing_id;
  if public.plan_limits_enforced() and l.plan = 'basic' and not is_admin then
    raise exception 'Deals are part of Premium and above';
  end if;
  if p_title is null or char_length(trim(p_title)) < 3 or char_length(p_title) > 80 then
    raise exception 'Title must be 3 to 80 characters';
  end if;
  if p_discount_text is null or char_length(trim(p_discount_text)) < 2 or char_length(p_discount_text) > 160 then
    raise exception 'Deal text must be 2 to 160 characters';
  end if;
  if p_valid_until is not null and p_valid_until < public.central_today() then
    raise exception 'The end date is in the past';
  end if;

  if p_deal_id is not null then
    select * into existing from public.deals where id = p_deal_id and listing_id = p_listing_id;
    if not found then
      raise exception 'Deal not found';
    end if;
  end if;

  -- A push that already went out cannot be rebooked.
  if existing.id is not null and existing.push_status = 'sent' then
    want_push := false;
    p_push_type := existing.push_type;
  end if;

  if want_push then
    if l.plan = 'basic' and not is_admin then
      raise exception 'Pushes are not part of the Basic plan';
    end if;
    if p_push_type not in ('included', 'single', 'nearby') then
      raise exception 'Unknown push type';
    end if;
    if p_push_type = 'included' and l.plan <> 'spotlight' and not is_admin then
      raise exception 'Only Spotlight includes a monthly push';
    end if;
    if p_push_date is null or p_push_window not in ('morning', 'afternoon') then
      raise exception 'Choose a day and a time window for the push';
    end if;
    if p_push_date > public.central_today() + 120 then
      raise exception 'Pushes can be booked up to 120 days ahead';
    end if;
    if not public.push_window_in_future(p_push_date, p_push_window) then
      raise exception 'That time has already passed. Pick a later day or window.';
    end if;
    if p_push_type = 'included' and
       public.included_pushes_used(p_listing_id, p_push_date) -
         (case when existing.id is not null and existing.push_type = 'included'
                    and existing.push_status in ('requested', 'scheduled')
                    and date_trunc('month', existing.push_date) = date_trunc('month', p_push_date) then 1 else 0 end)
       >= allowance then
      raise exception 'The included push for that month is already booked';
    end if;
  end if;

  begin
    if p_deal_id is null then
      insert into public.deals (listing_id, title, discount_text, valid_until, is_active, review_status, created_by,
                                send_push, push_type, push_date, push_window, push_status, push_paid)
      values (p_listing_id, trim(p_title), trim(p_discount_text), p_valid_until, false, 'pending', auth.uid(),
              false,
              case when want_push then p_push_type else 'none' end,
              case when want_push then p_push_date end,
              case when want_push then p_push_window end,
              case when want_push then 'requested' else 'none' end,
              false)
      returning id into result;
    else
      update public.deals set
        title = trim(p_title), discount_text = trim(p_discount_text), valid_until = p_valid_until,
        is_active = false, review_status = 'pending', review_note = null,
        push_type = case when push_status = 'sent' then push_type when want_push then p_push_type else 'none' end,
        push_date = case when push_status = 'sent' then push_date when want_push then p_push_date end,
        push_window = case when push_status = 'sent' then push_window when want_push then p_push_window end,
        push_status = case when push_status = 'sent' then 'sent' when want_push then 'requested' else 'none' end,
        push_paid = case when push_status = 'sent' then push_paid
                          when want_push and p_push_type = push_type then push_paid else false end
      where id = p_deal_id and listing_id = p_listing_id
      returning id into result;
    end if;
  exception when unique_violation then
    raise exception 'That day and time window is already booked. Pick another.';
  end;

  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'deal_saved', p_listing_id,
          jsonb_build_object('deal', result, 'push', case when want_push then p_push_type else 'none' end));
  return result;
end $$;
revoke all on function public.portal_save_deal(uuid, uuid, text, text, date, text, date, text) from public, anon;
grant execute on function public.portal_save_deal(uuid, uuid, text, text, date, text, date, text) to authenticated;

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
    update public.deals
    set review_status = 'approved', review_note = null, is_active = true, live_at = now(),
        push_status = case
          when push_status = 'requested' and (push_type = 'included' or push_paid) then 'scheduled'
          else push_status end
    where id = p_deal_id;
  else
    update public.deals
    set review_status = 'rejected', review_note = left(p_note, 500), is_active = false,
        push_status = case when push_status in ('requested', 'scheduled') then 'cancelled' else push_status end
    where id = p_deal_id;
  end if;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), case when p_approve then 'deal_approved' else 'deal_rejected' end, d.listing_id, jsonb_build_object('deal', p_deal_id));
end $$;
revoke all on function public.admin_review_deal(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_deal(uuid, boolean, text) to authenticated;

drop function if exists public.admin_pending_deals();
create or replace function public.admin_pending_deals()
returns table (id uuid, listing_id uuid, listing_name text, title text, discount_text text, valid_until date,
               push_type text, push_date date, push_window text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select d.id, d.listing_id, l.name, d.title, d.discount_text, d.valid_until::date,
           d.push_type, d.push_date, d.push_window, d.created_at
    from public.deals d join public.listings l on l.id = d.listing_id
    where d.review_status = 'pending' order by d.created_at;
end $$;
revoke all on function public.admin_pending_deals() from public, anon;
grant execute on function public.admin_pending_deals() to authenticated;

create or replace function public.admin_mark_push_paid(p_deal_id uuid, p_paid boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select * into d from public.deals where id = p_deal_id for update;
  if not found or d.push_type not in ('single', 'nearby') then
    raise exception 'This deal has no paid push';
  end if;
  update public.deals set
    push_paid = p_paid,
    push_status = case
      when p_paid and push_status = 'requested' and review_status = 'approved' then 'scheduled'
      when not p_paid and push_status = 'scheduled' then 'requested'
      else push_status end
  where id = p_deal_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'push_paid', d.listing_id, jsonb_build_object('deal', p_deal_id, 'paid', p_paid));
end $$;
revoke all on function public.admin_mark_push_paid(uuid, boolean) from public, anon;
grant execute on function public.admin_mark_push_paid(uuid, boolean) to authenticated;

create or replace function public.portal_cancel_push(p_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_deal_id for update;
  if not found or not (public.owns_listing(d.listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  if d.push_status not in ('requested', 'scheduled') then
    raise exception 'This push cannot be cancelled';
  end if;
  update public.deals set push_status = 'cancelled' where id = p_deal_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'push_cancelled', d.listing_id, jsonb_build_object('deal', p_deal_id));
end $$;
revoke all on function public.portal_cancel_push(uuid) from public, anon;
grant execute on function public.portal_cancel_push(uuid) to authenticated;

-- Every booked push from today on, plus the recent past, for the admin.
create or replace function public.admin_push_queue()
returns table (deal_id uuid, listing_id uuid, listing_name text, title text, push_type text, push_date date,
               push_window text, push_status text, push_paid boolean, review_status text,
               push_recipients integer, push_sent_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select d.id, d.listing_id, l.name, d.title, d.push_type, d.push_date, d.push_window, d.push_status,
           d.push_paid, d.review_status, d.push_recipients, d.push_sent_at
    from public.deals d join public.listings l on l.id = d.listing_id
    where d.push_status in ('requested', 'scheduled', 'sent')
      and d.push_date >= public.central_today() - 30
    order by d.push_date, d.push_window;
end $$;
revoke all on function public.admin_push_queue() from public, anon;
grant execute on function public.admin_push_queue() to authenticated;

-- Used by the sender (service role only).
create or replace function public.due_scheduled_pushes()
returns table (deal_id uuid, listing_id uuid, listing_name text, title text, discount_text text, push_type text,
               latitude double precision, longitude double precision)
language plpgsql security definer set search_path = public as $$
begin
  -- Missed by more than a day: cancel instead of sending late.
  update public.deals set push_status = 'cancelled'
  where push_status = 'scheduled' and push_date < public.central_today() - 1;

  return query
    select d.id, d.listing_id, l.name, d.title, d.discount_text, d.push_type, l.latitude::double precision, l.longitude::double precision
    from public.deals d join public.listings l on l.id = d.listing_id
    where d.push_status = 'scheduled' and d.review_status = 'approved' and d.is_active
      and (d.valid_until is null or d.valid_until >= public.central_today())
      and ((d.push_date + make_interval(hours => public.push_send_hour(d.push_window))) at time zone 'America/Chicago') <= now();
end $$;
revoke all on function public.due_scheduled_pushes() from public, anon, authenticated;
grant execute on function public.due_scheduled_pushes() to service_role;

create or replace function public.mark_push_sent(p_deal_id uuid, p_recipients integer, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  update public.deals set push_status = 'sent', push_sent_at = now(), push_recipients = p_recipients
  where id = p_deal_id and push_status = 'scheduled' returning * into d;
  if found then
    insert into public.push_log (kind, deal_id, listing_id, title, body, audience, recipients)
    values ('deal', p_deal_id, d.listing_id, p_title, p_body, d.push_type, p_recipients);
  end if;
end $$;
revoke all on function public.mark_push_sent(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.mark_push_sent(uuid, integer, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Nearby deals
-- ---------------------------------------------------------------------

alter table public.profiles add column if not exists nearby_deals_enabled boolean not null default false;
alter table public.profiles add column if not exists last_lat double precision;
alter table public.profiles add column if not exists last_lng double precision;
alter table public.profiles add column if not exists last_location_at timestamptz;

create or replace function public.set_nearby_deals(p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not allowed';
  end if;
  update public.profiles set
    nearby_deals_enabled = coalesce(p_on, false),
    last_lat = case when coalesce(p_on, false) then last_lat end,
    last_lng = case when coalesce(p_on, false) then last_lng end,
    last_location_at = case when coalesce(p_on, false) then last_location_at end
  where id = auth.uid();
end $$;
revoke all on function public.set_nearby_deals(boolean) from public, anon;
grant execute on function public.set_nearby_deals(boolean) to authenticated;

-- Saves roughly where the person is (about 100 meters). Only while switched
-- on, and at most every 10 minutes.
create or replace function public.update_my_location(p_lat double precision, p_lng double precision)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then
    raise exception 'Not allowed';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad location';
  end if;
  update public.profiles set
    last_lat = round(p_lat::numeric, 3)::double precision,
    last_lng = round(p_lng::numeric, 3)::double precision,
    last_location_at = now()
  where id = auth.uid() and nearby_deals_enabled
    and (last_location_at is null or last_location_at < now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.update_my_location(double precision, double precision) from public, anon;
grant execute on function public.update_my_location(double precision, double precision) to authenticated;

-- Push tokens for a deal push (service role only). Nearby pushes go only to
-- people who switched Nearby on and opened the app near the business lately.
create or replace function public.deal_push_recipients(p_listing_id uuid, p_nearby boolean)
returns table (push_token text)
language plpgsql stable security definer set search_path = public as $$
declare
  miles numeric := coalesce((public.get_setting('nearby')->>'radius_miles')::numeric, 2);
  hours integer := coalesce((public.get_setting('nearby')->>'fresh_hours')::int, 3);
  lat double precision;
  lng double precision;
begin
  if not p_nearby then
    return query
      select p.push_token from public.profiles p
      where p.notifications_enabled and p.deal_alerts_enabled and p.push_token is not null;
    return;
  end if;
  select l.latitude::double precision, l.longitude::double precision into lat, lng
  from public.listings l where l.id = p_listing_id;
  if lat is null or lng is null then
    return;
  end if;
  return query
    select p.push_token from public.profiles p
    where p.notifications_enabled and p.deal_alerts_enabled and p.nearby_deals_enabled
      and p.push_token is not null and p.last_lat is not null and p.last_lng is not null
      and p.last_location_at > now() - make_interval(hours => hours)
      and 3958.8 * acos(least(1, greatest(-1,
            sin(radians(lat)) * sin(radians(p.last_lat)) +
            cos(radians(lat)) * cos(radians(p.last_lat)) * cos(radians(p.last_lng - lng))))) <= miles;
end $$;
revoke all on function public.deal_push_recipients(uuid, boolean) from public, anon, authenticated;
grant execute on function public.deal_push_recipients(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------
-- Sponsor spots
-- ---------------------------------------------------------------------

create table if not exists public.sponsor_spots (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('home_carousel', 'section_parking', 'section_beaches', 'section_weather',
                                     'section_events', 'section_tram', 'presenting')),
  sponsor_name text not null check (char_length(sponsor_name) between 2 and 80),
  headline text check (headline is null or char_length(headline) <= 120),
  image_url text check (image_url is null or image_url ~* '^https://[^\s]+$'),
  logo_url text check (logo_url is null or logo_url ~* '^https://[^\s]+$'),
  link_url text check (link_url is null or link_url ~* '^https://[^\s]+$'),
  listing_id uuid references public.listings(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);
create index if not exists sponsor_spots_slot_idx on public.sponsor_spots (slot, is_active, sort_order);

alter table public.sponsor_spots enable row level security;
revoke all on public.sponsor_spots from anon, authenticated;
grant select on public.sponsor_spots to anon, authenticated;
grant insert, update, delete on public.sponsor_spots to authenticated;
drop policy if exists sponsor_spots_read on public.sponsor_spots;
drop policy if exists sponsor_spots_read_anon on public.sponsor_spots;
create policy sponsor_spots_read_anon on public.sponsor_spots for select to anon
  using (is_active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date));
drop policy if exists sponsor_spots_read_auth on public.sponsor_spots;
create policy sponsor_spots_read_auth on public.sponsor_spots for select to authenticated
  using ((is_active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date))
         or public.is_portal_admin());
drop policy if exists sponsor_spots_admin_write on public.sponsor_spots;
create policy sponsor_spots_admin_write on public.sponsor_spots for all to authenticated
  using (public.is_portal_admin()) with check (public.is_portal_admin());

-- 5 rotating slides on Home, one sponsor everywhere else.
create or replace function public.sponsor_spots_limit()
returns trigger language plpgsql as $$
declare n integer; cap integer;
begin
  if new.is_active then
    cap := case when new.slot = 'home_carousel' then 5 else 1 end;
    select count(*) into n from public.sponsor_spots
      where slot = new.slot and is_active and id <> new.id;
    if n >= cap then
      raise exception 'That spot is full (% allowed). Turn another sponsor off first.', cap;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sponsor_spots_limit on public.sponsor_spots;
create trigger sponsor_spots_limit before insert or update on public.sponsor_spots
  for each row execute function public.sponsor_spots_limit();

-- Uploads. The storage schema only exists on Supabase.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sponsor-assets', 'sponsor-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('listing-assets', 'listing-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;

-- A listing upload must live in a folder named after a listing the person owns.
create or replace function public.listing_upload_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.owns_listing(split_part(p_name, '/', 1)::uuid) or public.is_portal_admin()
    else false end;
$$;
revoke all on function public.listing_upload_ok(text) from public, anon;
grant execute on function public.listing_upload_ok(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists sponsor_assets_write on storage.objects';
    execute $p$create policy sponsor_assets_write on storage.objects for all to authenticated
      using (bucket_id = 'sponsor-assets' and public.is_portal_admin())
      with check (bucket_id = 'sponsor-assets' and public.is_portal_admin())$p$;
    execute 'drop policy if exists listing_assets_write on storage.objects';
    execute $p$create policy listing_assets_write on storage.objects for all to authenticated
      using (bucket_id = 'listing-assets' and public.listing_upload_ok(name))
      with check (bucket_id = 'listing-assets' and public.listing_upload_ok(name))$p$;
  end if;
exception when others then
  raise notice 'Storage policies were not created: %. Create them in Storage > Policies.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Admin analytics, whole app
-- ---------------------------------------------------------------------

create or replace function public.admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  span integer := least(greatest(coalesce(p_days, 30), 7), 90);
  today date := public.central_today();
  result jsonb;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  with d as (
    select s.listing_id, s.day, s.kind, s.source, s.events,
           case when s.day > today - span and s.day <= today then 'cur'
                when s.day > today - 2 * span and s.day <= today - span then 'prev' end as period
    from public.listing_stats_daily s where s.day > today - 2 * span
  ),
  tap_kinds as (select unnest(array['call', 'directions', 'website', 'deal_view']) as kind),
  kinds as (
    select kind,
           coalesce(sum(events) filter (where period = 'cur'), 0) as cur,
           coalesce(sum(events) filter (where period = 'prev'), 0) as prev
    from d where period is not null group by kind
  ),
  top as (
    select l.name, l.plan,
           coalesce(sum(d.events) filter (where d.kind in (select kind from tap_kinds)), 0) as taps,
           coalesce(sum(d.events) filter (where d.kind = 'detail_view'), 0) as views
    from d join public.listings l on l.id = d.listing_id
    where d.period = 'cur' group by l.id, l.name, l.plan
    order by taps desc, views desc limit 10
  ),
  src as (
    select source, sum(events) as taps from d
    where period = 'cur' and kind in (select kind from tap_kinds) group by source order by taps desc
  ),
  series as (
    select day,
           coalesce(sum(events) filter (where kind in (select kind from tap_kinds)), 0) as taps,
           coalesce(sum(events) filter (where kind = 'detail_view'), 0) as views
    from d where period = 'cur' group by day
  ),
  plans as (select plan, count(*) as n from public.listings group by plan),
  signups as (
    select count(*) filter (where (u.created_at at time zone 'America/Chicago')::date > today - span) as cur,
           count(*) filter (where (u.created_at at time zone 'America/Chicago')::date > today - 2 * span
                              and (u.created_at at time zone 'America/Chicago')::date <= today - span) as prev,
           count(*) as total
    from auth.users u
  ),
  pushes as (
    select count(*) as sent, coalesce(sum(recipients), 0) as recipients
    from public.push_log where created_at > now() - make_interval(days => span)
  )
  select jsonb_build_object(
    'days', span,
    'through', today - 1,
    'kinds', coalesce((select jsonb_object_agg(kind, jsonb_build_object('cur', cur, 'prev', prev)) from kinds), '{}'::jsonb),
    'visitor_taps', jsonb_build_object(
      'cur', coalesce((select sum(cur) from kinds where kind in (select kind from tap_kinds)), 0),
      'prev', coalesce((select sum(prev) from kinds where kind in (select kind from tap_kinds)), 0)),
    'top_listings', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'plan', plan, 'taps', taps, 'views', views)) from top), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'taps', taps)) from src), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'taps', taps, 'views', views) order by day) from series), '[]'::jsonb),
    'plans', coalesce((select jsonb_object_agg(plan, n) from plans), '{}'::jsonb),
    'signups', (select jsonb_build_object('cur', cur, 'prev', prev, 'total', total) from signups),
    'pushes', (select jsonb_build_object('sent', sent, 'recipients', recipients) from pushes),
    'pending', jsonb_build_object(
      'applications', (select count(*) from public.business_applications where status = 'pending'),
      'deals', (select count(*) from public.deals where review_status = 'pending'),
      'events', (select count(*) from public.event_submissions where status = 'pending'))
  ) into result;
  return result;
end $$;
revoke all on function public.admin_analytics(integer) from public, anon;
grant execute on function public.admin_analytics(integer) to authenticated;

-- ---------------------------------------------------------------------
-- Nightly: expire plans
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'plans-expire';
  perform cron.schedule('plans-expire', '20 9 * * *', $job$ select public.expire_plans() $job$);
exception when others then
  raise notice 'Schedule was not created: %. Turn on pg_cron and run this block again.', sqlerrm;
end $$;
