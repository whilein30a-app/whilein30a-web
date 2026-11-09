WEB UPDATE 137 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
Push schedules (A20 and booked deal pushes), Stripe prep in test mode (not linked).

1. PUSH SCHEDULES (do APP 137 step 2 first)
   a. SQL Editor: run PART 1 of sql/checks/113_cron_check.sql. If it lists any job
      not named beach-flag-alerts or send-scheduled-pushes, send me the output first.
   b. Deploy the deal push sender (from this folder):
        npx supabase functions deploy send-scheduled-pushes --project-ref ugeawvndcngviriaeyle
   c. Secret, Git Bash:
        openssl rand -hex 24
        npx supabase secrets set CRON_SECRET=<that value> --project-ref ugeawvndcngviriaeyle
   d. SQL Editor, alone (then delete it from the history):
        select vault.create_secret('<same value>', 'cron_secret');
      If it says the name exists:
        select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<same value>');
   e. SQL Editor: run sql/113_push_crons.sql. Expect 2 rows, active, */15 * * * *.
      If it says pg_net or pg_cron is missing: Database > Extensions, turn them on, run again.
   f. Wait 15 minutes, run PART 2 of 113_cron_check.sql. Expect status 200 twice.
      401 = the two secret values differ. 404 = function not deployed.

2. STRIPE PREP (test mode, nothing is linked, nobody can pay)
   a. Stripe dashboard, Test mode ON (top right):
      - Settings > Business: public name WhileIn, support email, statement descriptor WHILEIN.
      - Settings > Branding: logo, colors.
      - Settings > Billing > Customer portal: allow update payment method, view invoices,
        cancel at period end. Turn OFF "switch plans" (plan changes go through the portal Plan page).
   b. Developers > API keys: copy the test SECRET key (sk_test_...).
      Never paste it in chat, Trello or a file.
   c. Git Bash, in this folder:
        STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup-prices.js
      It makes 4 products and 14 prices (Founding and Standard, monthly and yearly,
      single and Nearby push) and prints one SQL line. Running it twice reuses them.
      If you run it again within a minute, check Products for duplicates.
   d. SQL Editor: run that printed SQL line (saves the price IDs).
   e. Store the key for the functions (not live yet, just ready):
        npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... PORTAL_URL=https://portal.whilein.app --project-ref ugeawvndcngviriaeyle
   f. SQL Editor: run sql/checks/113_stripe_ready.sql. Expect:
        sql 105 run true, portal_url https://portal.whilein.app,
        checkout online false, prices saved 14.
      If "sql 105 run" is false, send me the output (105 needs to run first).

   NOT today (this is the linking step, when Kevin says go):
     deploy stripe-checkout, stripe-portal, stripe-webhook (--no-verify-jwt),
     add the webhook in Stripe and set STRIPE_WEBHOOK_SECRET,
     save the publishable key in Admin > App settings, then a test payment.

3. Commit:
     git add -A && git commit -m "Update 137: push schedules, Stripe prep (test, not linked)" && git push
