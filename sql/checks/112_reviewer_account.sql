-- A49: Google Play reviewer demo account. Run ONLY after Kevin picks the account.
-- Change the email in BOTH places below. The account must already be signed up in the app.
-- +15555550100 is a fictional test number; it marks the phone step as done.

-- Step 1. Expect: verified   (no_such_account = sign up in the app first)
select case
  when (select id from auth.users where lower(email) = lower('rexinvestmentsllc@gmail.com')) is null then 'no_such_account'
  else public.service_mark_phone_verified(
         (select id from auth.users where lower(email) = lower('rexinvestmentsllc@gmail.com')), '+15555550100')
end as result;

-- Step 2 (run alone). Expect: is_admin false, phone_verified true.
select u.email, coalesce(p.is_admin, false) as is_admin, p.phone_verified_at is not null as phone_verified
from auth.users u left join public.profiles p on p.id = u.id
where lower(u.email) = lower('rexinvestmentsllc@gmail.com');
