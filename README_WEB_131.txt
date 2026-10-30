WEB UPDATE 131 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
Ask 30A limits, golf cart request emails, notification email settings, Play reviewer account

1. DATABASE (Supabase SQL editor), once:
     sql/106_ask30a_limits_golf_cart.sql
   Ends with 4 lines: the Ask 30A limits (30 / 5 / 2000), the admin email, the golf cart email,
   and "golf cart trigger 1".

2. PORTAL:
     cd portal
     npm run build
     npx firebase deploy --only hosting

3. PORTAL SETTINGS (Admin > App settings):
   - Notification emails: the admin email is still in30a.info@gmail.com, which nobody can read
     right now. Change it to Kevin's new address (for example dev@whilein.app or the business
     email he picks). Golf cart requests go there too, unless you fill in a separate golf cart email.
   - Ask 30A limits: starts at 30 per person per day, 5 per minute, 2,000 total per day.
     Kevin can change them here. It also shows today's questions so far.

4. CHECK the golf cart email:
   Book a golf cart in the app, then in the SQL editor:
     select to_email, subject, sent_at, last_error from email_outbox where kind = 'golf_cart_request' order by id desc limit 3;
   sent_at filled = sent. Empty sent_at and no error = the send-outbox cron is not running
   (Supabase > Integrations > Cron, every minute). An error = read it and send it to me.

5. PLAY REVIEWER ACCOUNT (A30), after signing up in the app with the reviewer email:
     sql/cleanup/A30_reviewer_account.sql
   Replace REVIEWER_EMAIL in both places, run it. It should say "verified", then a row with
   email_confirmed, phone_verified and terms_agreed all true.
   Then Play Console > App content > App access: see GOOGLE_PLAY_PREP.md section 6.

6. git add . && git commit -m "Update 131: Ask 30A limits, golf cart emails, notification settings" && git push
