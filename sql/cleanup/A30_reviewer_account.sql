-- A30: finish the Google Play reviewer account.
-- First sign up in the app with the reviewer email and a 6 digit PIN, confirm
-- the email, tick the Terms box and open the app once. Then:
--   1. Replace REVIEWER_EMAIL below (both places) with that email.
--   2. Run the whole file in the Supabase SQL editor.
-- It confirms a reserved test phone number (555-0100, never rings anyone) for
-- this one account, so Google's reviewers can use Rate without a text code.
-- After the app is approved: change the PIN and delete any ratings it posted.

select public.service_mark_phone_verified(
  (select id from auth.users where lower(email) = lower('REVIEWER_EMAIL')),
  '+15555550100') as phone_result;          -- should say: verified

-- Check: one row, email confirmed, phone verified, Terms agreed.
select u.email,
       u.email_confirmed_at is not null as email_confirmed,
       p.phone_verified_at is not null as phone_verified,
       exists (select 1 from public.terms_acceptances t where t.user_id = u.id) as terms_agreed
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower('REVIEWER_EMAIL');
