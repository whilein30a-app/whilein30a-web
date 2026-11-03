-- 109: Two-step sign in (authenticator app) for admin and business accounts
-- (Kevin, Nov 3, 2026). Run once in the Supabase SQL editor. Safe to run again.
--
-- The portal asks every account for an authenticator app code (Google
-- Authenticator, Microsoft Authenticator, 1Password and similar). This file
-- makes the database insist on it too, so a stolen password alone cannot
-- reach admin tools, listings or billing, even outside the portal:
--   - is_portal_admin() is true only for an admin who passed the code step.
--   - owns_listing() is true only for an owner who passed the code step.
-- Everything that checks admins or owners (policies, portal functions,
-- payments, admin pushes) goes through these two.
--
-- Visitors in the app are not affected. The admin screens inside the app ask
-- for the same code (update 134).
--
-- Turn the database check off in an emergency (for example nobody can get a
-- code), then back on:
--   update public.app_settings set value = '{"required": false}' where key = 'portal_mfa';
--   update public.app_settings set value = '{"required": true}'  where key = 'portal_mfa';
-- Someone lost their phone: remove their authenticator, they set up a new one
-- at their next sign in:
--   delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'THEIR_EMAIL');

insert into public.app_settings (key, value, is_public)
values ('portal_mfa', '{"required": true}', false)
on conflict (key) do nothing;

create or replace function public.portal_mfa_required()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'required')::boolean from public.app_settings where key = 'portal_mfa'), true);
$$;
revoke all on function public.portal_mfa_required() from public, anon;
grant execute on function public.portal_mfa_required() to authenticated;

-- True when this sign in passed the authenticator code step.
create or replace function public.session_has_mfa()
returns boolean
language sql stable as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2';
$$;
revoke all on function public.session_has_mfa() from public, anon;
grant execute on function public.session_has_mfa() to authenticated;

create or replace function public.is_portal_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
     and (not public.portal_mfa_required() or public.session_has_mfa());
$$;

create or replace function public.owns_listing(p_listing_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.listing_owners o
    where o.listing_id = p_listing_id and o.user_id = auth.uid()
  ) and (not public.portal_mfa_required() or public.session_has_mfa());
$$;

-- Report
select 'two-step sign in required' as what, public.portal_mfa_required()::text as detail
union all
select 'accounts with an authenticator', (select count(distinct user_id)::text from auth.mfa_factors where status = 'verified')
union all
select 'admins', (select count(*)::text from public.profiles where is_admin);
