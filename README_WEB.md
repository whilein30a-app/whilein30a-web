WEB UPDATE 117 (backend + Business Portal + static site)

1. sql/090_engagement_v2_and_business_portal.sql: run in Supabase SQL editor.
2. update profiles set is_admin = true where id = '<your user id>';
3. Deploy supabase/functions notify-new-deal and send-sponsor-report.
   Secrets: CRON_SECRET, RESEND_API_KEY, PORTAL_URL.
4. portal/: see portal/README.md (Firebase Hosting or Cloudflare Pages).
5. web/: privacy.html and _headers for the static site.
