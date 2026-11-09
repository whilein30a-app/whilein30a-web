-- 113 (update 137): run the two push senders every 15 minutes with pg_cron.
--   beach-flag-alerts      -> check-beach-flag-and-notify (A20)
--   send-scheduled-pushes  -> send-scheduled-pushes (booked and Nearby deal pushes)
--
-- BEFORE running this file:
--   1. Pick a random secret in Git Bash:   openssl rand -hex 24
--   2. Give it to the function:            npx supabase secrets set CRON_SECRET=<it> --project-ref ugeawvndcngviriaeyle
--   3. Give the same value to the database (SQL editor, alone, then delete it from history):
--        select vault.create_secret('<it>', 'cron_secret');
--      If it says the name already exists:
--        select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<it>');
--
-- The Authorization header is the app's public anon key (already inside the app),
-- needed because both functions check for a Supabase key. The beach flag function
-- only alerts on a NEW hazard flag, and send-scheduled-pushes only sends what is
-- due, so running every 15 minutes never repeats a push.
-- Safe to run twice: old jobs with these names are replaced.
-- Expect at the end: 2 rows, both active, schedule */15 * * * *.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('beach-flag-alerts', 'send-scheduled-pushes');

select cron.schedule('beach-flag-alerts', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://ugeawvndcngviriaeyle.supabase.co/functions/v1/check-beach-flag-and-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZWF3dm5kY25ndmlyaWFleWxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NTcwMDUsImV4cCI6MjEwMTMzMzAwNX0.7nbHR46T7blS-ofSpm4HYn8UbsrLeewGYZPfDquBZsc'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
$job$);

select cron.schedule('send-scheduled-pushes', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://ugeawvndcngviriaeyle.supabase.co/functions/v1/send-scheduled-pushes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZWF3dm5kY25ndmlyaWFleWxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NTcwMDUsImV4cCI6MjEwMTMzMzAwNX0.7nbHR46T7blS-ofSpm4HYn8UbsrLeewGYZPfDquBZsc',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$job$);

select jobname, schedule, active from cron.job
 where jobname in ('beach-flag-alerts', 'send-scheduled-pushes')
 order by jobname;
