-- 105: W13 and W14, plans, add-on slots and pushes paid in the portal with Stripe.
--
-- Money only moves through Stripe. This database never sees card details.
-- The flow:
--   1. A business picks a plan (or pays for a push). The stripe-checkout function
--      calls portal_checkout_prepare() as that signed-in owner. It checks the
--      rules (owner, slot free, Founding place free) and puts a 35 minute HOLD on
--      the slot, so two businesses can never buy the last Featured place at once.
--   2. Stripe's embedded checkout takes the payment.
--   3. Stripe tells the stripe-webhook function, which calls the service_*
--      functions below to turn the plan on, renew it, mark it past due, or drop
--      it to Basic. Nothing here trusts the browser.
--
-- Prices live in Stripe. Admin pastes the Stripe price IDs and the publishable
-- key in Admin > App settings. Secret keys stay in Supabase secrets only.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, is_public) values
  ('stripe_publishable', '{"key": ""}', true),
  ('stripe_prices', '{}', false),
  ('portal_url', '"https://portal.in30a.app"', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Tables (service role only; people read through the functions)
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists billing_subscription_id text;
alter table public.listings add column if not exists founding_since date;

create table if not exists public.billing_customers (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id text primary key,                         -- Stripe subscription id
  listing_id uuid not null references public.listings(id) on delete cascade,
  stripe_customer_id text,
  plan text not null check (plan in ('premium', 'featured', 'spotlight')),
  billing text not null check (billing in ('month', 'year')),
  founding boolean not null default false,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_subscriptions_listing_idx on public.billing_subscriptions (listing_id);

create table if not exists public.checkout_holds (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('plan', 'push')),
  plan text check (plan is null or plan in ('premium', 'featured', 'spotlight')),
  billing text check (billing is null or billing in ('month', 'year')),
  founding boolean not null default false,
  deal_id uuid references public.deals(id) on delete cascade,
  price_key text not null,
  stripe_session_id text unique,
  status text not null default 'open' check (status in ('open', 'complete', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists checkout_holds_open_idx on public.checkout_holds (status, expires_at);

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['billing_customers', 'billing_subscriptions', 'checkout_holds', 'stripe_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Slots and Founding places now count open checkout holds
-- ---------------------------------------------------------------------
create or replace function public.slots_taken(p_subcategory text, p_plan text, p_except uuid)
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.listings x
          where x.subcategory = p_subcategory and x.plan = p_plan and x.id <> p_except
            and (x.plan_expires_on is null or x.plan_expires_on >= public.central_today()))
       + (select count(*)::int from public.checkout_holds h join public.listings x on x.id = h.listing_id
          where h.kind = 'plan' and h.plan = p_plan and h.status = 'open' and h.expires_at > now()
            and x.subcategory = p_subcategory and h.listing_id <> p_except);
$$;
revoke all on function public.slots_taken(text, text, uuid) from public, anon, authenticated;

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
    greatest(0, 3 - public.slots_taken(sub, 'featured', p_listing_id)),
    greatest(0, 1 - public.slots_taken(sub, 'spotlight', p_listing_id));
end $$;
revoke all on function public.portal_slots_left(uuid) from public, anon;
grant execute on function public.portal_slots_left(uuid) to authenticated;

create or replace function public.founding_taken(p_except uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.listings where is_founding and id is distinct from p_except)
       + (select count(*)::int from public.checkout_holds h
          where h.founding and h.kind = 'plan' and h.status = 'open' and h.expires_at > now()
            and h.listing_id is distinct from p_except
            and not exists (select 1 from public.listings l where l.id = h.listing_id and l.is_founding));
$$;
revoke all on function public.founding_taken(uuid) from public, anon, authenticated;

create or replace function public.portal_founding_left()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, 20 - public.founding_taken(null));
$$;
revoke all on function public.portal_founding_left() from public, anon;
grant execute on function public.portal_founding_left() to authenticated;

-- Admin's manual plan setting also respects holds.
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
    used := public.slots_taken(l.subcategory, p_plan, p_listing_id);
    if used >= cap then
      raise exception 'No % slot left in %. % of % are taken or being paid for.', p_plan, l.subcategory, used, cap;
    end if;
  end if;
  if p_founding and not l.is_founding and public.founding_taken(p_listing_id) >= 20 then
    raise exception 'All 20 Founding Partner places are taken';
  end if;
  update public.listings set
    plan = p_plan,
    billing = case when p_plan = 'basic' then null else p_billing end,
    is_founding = coalesce(p_founding, false),
    founding_since = case when coalesce(p_founding, false) then coalesce(founding_since, public.central_today()) else null end,
    plan_expires_on = case when p_plan = 'basic' then null else p_expires_on end,
    is_sponsored = (p_plan <> 'basic')
  where id = p_listing_id;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'plan_set', p_listing_id,
          jsonb_build_object('plan', p_plan, 'billing', p_billing, 'founding', p_founding, 'expires', p_expires_on));
end $$;
revoke all on function public.admin_set_plan(uuid, text, text, boolean, date) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, text, boolean, date) to authenticated;

-- ---------------------------------------------------------------------
-- 1. Checkout: rules checked as the signed-in owner, slot held
-- ---------------------------------------------------------------------
create or replace function public.portal_checkout_prepare(
  p_kind text, p_listing_id uuid, p_plan text default null, p_billing text default null, p_deal_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  d public.deals;
  founding boolean := false;
  key text;
  hold uuid;
  cust text;
  left_f integer;
  left_s integer;
begin
  if auth.uid() is null or not public.owns_listing(p_listing_id) then
    raise exception 'Only the approved owner of this business can pay for it';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.merged_into is not null then
    raise exception 'Listing not found';
  end if;

  if p_kind = 'plan' then
    if p_plan not in ('premium', 'featured', 'spotlight') or p_billing not in ('month', 'year') then
      raise exception 'Unknown plan';
    end if;
    if l.plan = p_plan and coalesce(l.billing, '') = p_billing and l.billing_subscription_id is not null then
      raise exception 'You are already on this plan';
    end if;
    if p_plan in ('featured', 'spotlight') then
      if l.subcategory is null then
        raise exception 'We need to set your subcategory first. Email hello@in30a.app and we will do it today.';
      end if;
      select s.featured_left, s.spotlight_left into left_f, left_s from public.portal_slots_left(p_listing_id) s;
      if (p_plan = 'featured' and left_f < 1) or (p_plan = 'spotlight' and left_s < 1) then
        raise exception 'No % place is open in % right now', p_plan, l.subcategory;
      end if;
    end if;
    founding := l.is_founding or public.founding_taken(p_listing_id) < 20;
    key := p_plan || '_' || case when founding then 'founding' else 'standard' end || '_' || p_billing;
  elsif p_kind = 'push' then
    select * into d from public.deals where id = p_deal_id for update;
    if not found or d.listing_id <> p_listing_id then
      raise exception 'Deal not found';
    end if;
    if d.push_type not in ('single', 'nearby') then
      raise exception 'This deal has no paid push';
    end if;
    if d.push_paid then
      raise exception 'This push is already paid';
    end if;
    if d.push_status not in ('requested', 'scheduled') then
      raise exception 'This push can no longer be paid for';
    end if;
    if not public.push_window_in_future(d.push_date, d.push_window) then
      raise exception 'That push time has passed. Pick a new time on the deal first.';
    end if;
    key := 'push_' || d.push_type;
  else
    raise exception 'Unknown payment';
  end if;

  -- Ten checkouts an hour per business is plenty, and stops anyone holding a
  -- slot hostage by starting checkouts over and over.
  if (select count(*) from public.checkout_holds where listing_id = p_listing_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many checkout attempts. Please wait an hour or email hello@in30a.app.';
  end if;

  -- One open checkout per business at a time.
  update public.checkout_holds set status = 'expired'
  where listing_id = p_listing_id and status = 'open';

  insert into public.checkout_holds (listing_id, user_id, kind, plan, billing, founding, deal_id, price_key, expires_at)
  values (p_listing_id, auth.uid(), p_kind,
          case when p_kind = 'plan' then p_plan end, case when p_kind = 'plan' then p_billing end,
          founding, case when p_kind = 'push' then p_deal_id end, key, now() + interval '35 minutes')
  returning id into hold;

  select stripe_customer_id into cust from public.billing_customers where listing_id = p_listing_id;
  return jsonb_build_object(
    'hold_id', hold, 'price_key', key, 'mode', case when p_kind = 'plan' then 'subscription' else 'payment' end,
    'founding', founding, 'customer', cust, 'email', public.user_email(auth.uid()),
    'listing_id', p_listing_id, 'listing_name', l.name, 'plan', p_plan, 'billing', p_billing, 'deal_id', p_deal_id
  );
end $$;
revoke all on function public.portal_checkout_prepare(text, uuid, text, text, uuid) from public, anon;
grant execute on function public.portal_checkout_prepare(text, uuid, text, text, uuid) to authenticated;

-- The function stores which Stripe session belongs to the hold.
create or replace function public.service_checkout_attach(p_hold uuid, p_session text)
returns void language sql security definer set search_path = public as $$
  update public.checkout_holds set stripe_session_id = p_session where id = p_hold;
$$;
revoke all on function public.service_checkout_attach(uuid, text) from public, anon, authenticated;
grant execute on function public.service_checkout_attach(uuid, text) to service_role;

-- Owner or admin may ask about a session (the return page). Only the hold's own
-- listing is answered.
create or replace function public.portal_checkout_hold(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h public.checkout_holds;
begin
  select * into h from public.checkout_holds where stripe_session_id = p_session;
  if not found or not (public.owns_listing(h.listing_id) or public.is_portal_admin()) then
    raise exception 'Not found';
  end if;
  return jsonb_build_object('kind', h.kind, 'status', h.status, 'listing_id', h.listing_id, 'plan', h.plan, 'deal_id', h.deal_id);
end $$;
revoke all on function public.portal_checkout_hold(text) from public, anon;
grant execute on function public.portal_checkout_hold(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Webhook side (service key only)
-- ---------------------------------------------------------------------
create or replace function public.service_stripe_event_new(p_id text, p_type text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.stripe_events (id, type) values (p_id, p_type);
  return true;
exception when unique_violation then
  return false;
end $$;
revoke all on function public.service_stripe_event_new(text, text) from public, anon, authenticated;
grant execute on function public.service_stripe_event_new(text, text) to service_role;

create or replace function public.service_stripe_event_forget(p_id text)
returns void language sql security definer set search_path = public as $$
  delete from public.stripe_events where id = p_id;
$$;
revoke all on function public.service_stripe_event_forget(text) from public, anon, authenticated;
grant execute on function public.service_stripe_event_forget(text) to service_role;

-- Emails every owner of a listing.
create or replace function public.email_listing_owners(p_listing uuid, p_kind text, p_subject text, p_body text, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select u.email::text as email from public.listing_owners o join auth.users u on u.id = o.user_id
           where o.listing_id = p_listing loop
    perform public.queue_email(r.email, p_kind, p_subject, p_body, p_link);
  end loop;
end $$;
revoke all on function public.email_listing_owners(uuid, text, text, text, text) from public, anon, authenticated;

-- A subscription was created or changed in Stripe. Returns the id of an older
-- subscription to cancel when a business switched plans, else null.
create or replace function public.service_apply_subscription(
  p_sub text, p_listing uuid, p_customer text, p_plan text, p_billing text, p_founding boolean,
  p_status text, p_period_end timestamptz, p_cancel_at_end boolean, p_hold uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.listings;
  old_sub text;
  live boolean := p_status in ('active', 'trialing', 'past_due');
  dead boolean := p_status in ('canceled', 'unpaid', 'incomplete_expired', 'paused');
  was_new boolean;
  portal text := coalesce(nullif(trim(both '"' from (select value::text from public.app_settings where key = 'portal_url')), ''), 'https://portal.in30a.app');
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then
    raise exception 'Listing % not found', p_listing;
  end if;
  if p_customer is not null then
    insert into public.billing_customers (listing_id, stripe_customer_id) values (p_listing, p_customer)
    on conflict (listing_id) do update set stripe_customer_id = excluded.stripe_customer_id;
  end if;

  was_new := not exists (select 1 from public.billing_subscriptions where id = p_sub);
  insert into public.billing_subscriptions (id, listing_id, stripe_customer_id, plan, billing, founding, status, current_period_end, cancel_at_period_end, updated_at)
  values (p_sub, p_listing, p_customer, p_plan, p_billing, coalesce(p_founding, false), p_status, p_period_end, coalesce(p_cancel_at_end, false), now())
  on conflict (id) do update set status = excluded.status, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end, stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_subscriptions.stripe_customer_id),
    updated_at = now();

  if p_hold is not null then
    update public.checkout_holds set status = 'complete' where id = p_hold;
  end if;

  if live then
    old_sub := case when l.billing_subscription_id is not null and l.billing_subscription_id <> p_sub then l.billing_subscription_id end;
    update public.listings set
      plan = p_plan,
      billing = p_billing,
      plan_expires_on = coalesce((p_period_end + interval '8 days')::date, plan_expires_on),
      is_sponsored = true,
      is_founding = is_founding or coalesce(p_founding, false),
      founding_since = case when coalesce(p_founding, false) then coalesce(founding_since, public.central_today()) else founding_since end,
      billing_subscription_id = p_sub
    where id = p_listing;
    if was_new or l.plan is distinct from p_plan then
      insert into public.portal_audit (user_id, action, listing_id, detail)
      values (null, 'plan_paid', p_listing, jsonb_build_object('plan', p_plan, 'billing', p_billing, 'subscription', p_sub));
      perform public.email_listing_owners(p_listing, 'plan_active', 'Your in30A ' || initcap(p_plan) || ' plan is on',
        'Thank you. ' || l.name || ' is now on the ' || initcap(p_plan) || ' plan. Stripe emails your receipt.' || E'\n\n' ||
        'Manage billing, invoices and your card from the Plan page in the portal.', portal || '/plan');
      perform public.queue_email(public.admin_notify_address(), 'admin_plan_paid', 'Paid plan: ' || l.name,
        l.name || ' paid for ' || initcap(p_plan) || ' (' || p_billing || ')' || case when p_founding then ', Founding Partner' else '' end || '.', portal || '/admin/business/' || p_listing);
    end if;
  elsif dead and l.billing_subscription_id = p_sub then
    update public.listings set plan = 'basic', billing = null, plan_expires_on = null, is_sponsored = false, billing_subscription_id = null
    where id = p_listing;
    insert into public.portal_audit (user_id, action, listing_id, detail)
    values (null, 'plan_ended', p_listing, jsonb_build_object('plan', p_plan, 'status', p_status, 'subscription', p_sub));
    perform public.email_listing_owners(p_listing, 'plan_ended', 'Your in30A plan has ended',
      l.name || ' is back on the free Basic listing' ||
      case when p_status = 'canceled' then '.' else ', because the payment did not go through after several tries.' end || E'\n\n' ||
      'Your listing still shows name, address, map pin, phone, hours and one photo. Choose a plan again any time from the Plan page.',
      portal || '/plan');
    perform public.queue_email(public.admin_notify_address(), 'admin_plan_ended', 'Plan ended: ' || l.name,
      l.name || ' dropped to Basic (' || p_status || ').', portal || '/admin/business/' || p_listing);
  end if;
  return old_sub;
end $$;
revoke all on function public.service_apply_subscription(text, uuid, text, text, text, boolean, text, timestamptz, boolean, uuid) from public, anon, authenticated;
grant execute on function public.service_apply_subscription(text, uuid, text, text, text, boolean, text, timestamptz, boolean, uuid) to service_role;

create or replace function public.service_payment_failed(p_sub text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.billing_subscriptions; nm text;
  portal text := coalesce(nullif(trim(both '"' from (select value::text from public.app_settings where key = 'portal_url')), ''), 'https://portal.in30a.app');
begin
  select * into s from public.billing_subscriptions where id = p_sub;
  if not found then
    return;
  end if;
  select name into nm from public.listings where id = s.listing_id;
  perform public.email_listing_owners(s.listing_id, 'payment_failed', 'Your in30A payment did not go through',
    'We could not take the payment for ' || nm || '''s ' || initcap(s.plan) || ' plan. Stripe tries again over the next 7 days.' || E'\n\n' ||
    'To keep your plan, update your card: Plan page > Manage billing.', portal || '/plan');
end $$;
revoke all on function public.service_payment_failed(text) from public, anon, authenticated;
grant execute on function public.service_payment_failed(text) to service_role;

-- A push was paid for.
create or replace function public.service_push_paid(p_deal uuid, p_hold uuid, p_customer text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_deal for update;
  if not found then
    raise exception 'Deal % not found', p_deal;
  end if;
  if p_customer is not null then
    insert into public.billing_customers (listing_id, stripe_customer_id) values (d.listing_id, p_customer)
    on conflict (listing_id) do nothing;
  end if;
  update public.deals set
    push_paid = true,
    push_status = case when push_status = 'requested' and review_status = 'approved' then 'scheduled' else push_status end
  where id = p_deal;
  update public.checkout_holds set status = 'complete' where id = p_hold;
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (null, 'push_paid', d.listing_id, jsonb_build_object('deal', p_deal, 'paid', true, 'via', 'stripe'));
  perform public.queue_email(public.admin_notify_address(), 'admin_push_paid', 'Push paid: ' || d.title,
    'A ' || d.push_type || ' push was paid for: ' || d.title || ', ' || d.push_date || ' ' || d.push_window || '.', null);
end $$;
revoke all on function public.service_push_paid(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.service_push_paid(uuid, uuid, text) to service_role;

create or replace function public.service_release_hold(p_hold uuid)
returns void language sql security definer set search_path = public as $$
  update public.checkout_holds set status = 'expired' where id = p_hold and status = 'open';
$$;
revoke all on function public.service_release_hold(uuid) from public, anon, authenticated;
grant execute on function public.service_release_hold(uuid) to service_role;

-- For the stripe-portal and stripe-checkout functions.
create or replace function public.service_listing_customer(p_listing uuid)
returns text language sql stable security definer set search_path = public as $$
  select stripe_customer_id from public.billing_customers where listing_id = p_listing;
$$;
revoke all on function public.service_listing_customer(uuid) from public, anon, authenticated;
grant execute on function public.service_listing_customer(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. What the owner sees on the Plan page
-- ---------------------------------------------------------------------
create or replace function public.portal_billing_status(p_listing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.listings;
  s public.billing_subscriptions;
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  select * into l from public.listings where id = p_listing_id;
  select * into s from public.billing_subscriptions where id = l.billing_subscription_id;
  return jsonb_build_object(
    'online', coalesce((select value->>'key' from public.app_settings where key = 'stripe_publishable'), '') <> '',
    'has_customer', exists (select 1 from public.billing_customers where listing_id = p_listing_id),
    'subscription', case when s.id is null then null else jsonb_build_object(
      'plan', s.plan, 'billing', s.billing, 'status', s.status, 'founding', s.founding,
      'renews_on', (s.current_period_end at time zone 'America/Chicago')::date,
      'cancel_at_period_end', s.cancel_at_period_end) end,
    'checkout_open', exists (select 1 from public.checkout_holds where listing_id = p_listing_id and status = 'open' and expires_at > now())
  );
end $$;
revoke all on function public.portal_billing_status(uuid) from public, anon;
grant execute on function public.portal_billing_status(uuid) to authenticated;

-- Admin saves the Stripe price IDs.
create or replace function public.admin_save_stripe_prices(p_prices jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v text;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_prices, '{}'::jsonb)) loop
    if k !~ '^(premium|featured|spotlight)_(founding|standard)_(month|year)$' and k !~ '^push_(single|nearby)$' then
      raise exception 'Unknown price name %', k;
    end if;
    if coalesce(v, '') <> '' and v !~ '^price_[A-Za-z0-9]+$' then
      raise exception 'Price IDs start with price_ (check %)', k;
    end if;
  end loop;
  insert into public.app_settings (key, value, is_public) values ('stripe_prices', coalesce(p_prices, '{}'::jsonb), false)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.portal_audit (user_id, action, listing_id, detail) values (auth.uid(), 'stripe_prices_saved', null, p_prices);
end $$;
revoke all on function public.admin_save_stripe_prices(jsonb) from public, anon;
grant execute on function public.admin_save_stripe_prices(jsonb) to authenticated;

create or replace function public.admin_save_stripe_publishable(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if coalesce(p_key, '') <> '' and p_key !~ '^pk_(test|live)_[A-Za-z0-9]+$' then
    raise exception 'The publishable key starts with pk_test_ or pk_live_. Never paste the secret key (sk_) here.';
  end if;
  insert into public.app_settings (key, value, is_public) values ('stripe_publishable', jsonb_build_object('key', coalesce(p_key, '')), true)
  on conflict (key) do update set value = excluded.value, is_public = true, updated_at = now();
  insert into public.portal_audit (user_id, action, listing_id, detail)
  values (auth.uid(), 'stripe_key_saved', null, jsonb_build_object('mode', case when p_key like 'pk_live_%' then 'live' when p_key like 'pk_test_%' then 'test' else 'off' end));
end $$;
revoke all on function public.admin_save_stripe_publishable(text) from public, anon;
grant execute on function public.admin_save_stripe_publishable(text) to authenticated;

create or replace function public.admin_stripe_prices()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return coalesce((select value from public.app_settings where key = 'stripe_prices'), '{}'::jsonb);
end $$;
revoke all on function public.admin_stripe_prices() from public, anon;
grant execute on function public.admin_stripe_prices() to authenticated;

-- Report
select 'stripe publishable key set' as what, ((select value->>'key' from public.app_settings where key = 'stripe_publishable') <> '')::text as detail
union all
select 'stripe prices saved', (select count(*)::text from jsonb_object_keys(coalesce((select value from public.app_settings where key = 'stripe_prices'), '{}'::jsonb)))
union all
select 'founding places left', public.portal_founding_left()::text;
