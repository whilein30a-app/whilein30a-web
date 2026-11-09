-- Update 137 checks. Run each part alone.

-- PART 1 (before 113): other schedules already calling the same functions?
-- Anything listed here besides the two names from 113 is a duplicate: send it to Raffy's Claude.
select jobid, jobname, schedule, active, left(command, 120) as command
from cron.job
where command ilike '%check-beach-flag%' or command ilike '%send-scheduled-pushes%';

-- PART 2 (after 113, wait 15 minutes): the last runs.
-- Expect status_code 200 for both. beach flag answers {"notified":false,...} on a calm day.
-- 401 = CRON_SECRET in Supabase secrets and cron_secret in vault are not the same value.
-- 404 = the function is not deployed.
select r.created, r.status_code, left(r.content::text, 160) as answer
from net._http_response r
order by r.created desc
limit 6;

-- PART 3: last beach flag state.
select last_notified_status, last_checked_at from public.beach_flag_notification_state where id = 1;
