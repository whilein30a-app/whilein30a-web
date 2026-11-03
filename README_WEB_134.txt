WEB UPDATE 134 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
4-digit PIN with lockout, two-step sign in (authenticator app), reviews: owner replies,
reports, delete; photo location removed on portal uploads

Do these IN THIS ORDER. Step 3 must come after you have set up your own authenticator,
or the portal will show you no data until you do.

1. DATABASE, part 1 (Supabase SQL editor):
     sql/108_pin_lockout.sql
   Ends with: pin lockout {"max_fails": 5, "lock_minutes": 15}, accounts with a PIN stored here 0, pgcrypto.

2. PORTAL (your firebase-config.ts is not in this zip, so your Analytics values stay):
     cd portal
     npm run build
     npx firebase deploy --only hosting
   Then open portal.whilein.app, sign in. It asks you to set up two-step sign in:
   scan the QR code with an authenticator app (Google Authenticator, Microsoft
   Authenticator, 1Password), type the code. Do this for your admin account now.
   If the portal says MFA is disabled: Supabase > Authentication > Multi-Factor > TOTP: enable.

3. DATABASE, part 2:
     sql/109_portal_mfa.sql
     sql/110_reviews_replies_reports.sql
   109 ends with: two-step sign in required true, accounts with an authenticator 1 (or more), admins.
   110 ends with: policy link https://whilein.app/review-policy, auto-hide after reports 3,
   reviews deleted with the account yes, owner replies 0, open reports 0.

4. FUNCTION (admin pushes now also need the authenticator step):
     npx supabase functions deploy admin-send-push --project-ref ugeawvndcngviriaeyle

5. CHECK
   - Portal > Account settings shows "Two-step sign in: On".
   - Sign out and in again: it asks for the code.
   - Portal > Reviews (new menu item for businesses): reviews of the business, Reply, Edit reply,
     Delete reply, and the Review Policy link.
   - Portal > Admin > Reviews opens on "Reported" (empty for now).
   - Upload a logo or photo from a phone picture: it uploads as before (location and camera data
     are now removed in the browser first).

6. git add . && git commit -m "Update 134: PIN lockout, two-step sign in, review replies and reports" && git push

IF SOMEONE LOSES THEIR PHONE (SQL editor):
   delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'THEIR_EMAIL');
   They set up a new authenticator at their next sign in.
EMERGENCY, nobody can get a code:
   update public.app_settings set value = '{"required": false}' where key = 'portal_mfa';
   (set it back to true afterwards)

WHAT CHANGED
- PIN (sql/108): the PIN is checked in the database. 5 wrong PINs for one email locks it for
  15 minutes. Supabase's own limits count per IP address, not per account, so they don't cover
  this; that's why it's ours. New accounts use 4 digits, and their real Supabase password is a
  long random value, so the PIN can't be guessed through Supabase's login. Existing accounts keep
  their 6-digit PIN and get the same lockout from their first sign in after the update.
  Simple PINs (1111, 1234, 4321 and similar) are refused.
- Two-step sign in (sql/109): admins and business owners count as admin or owner only after the
  authenticator code. This covers the portal, payments, admin pushes and the admin screens in the app.
- Reviews (sql/110):
  - Owners: one public reply per review from the portal, edit or delete it, shown as
    "Response from the owner" (with "Edited" if changed).
  - Visitors: edit or delete their own review; "Edited" label; deleting a review or the account
    removes it and the average updates.
  - Report button on every review with Kevin's 8 reasons. Reports go to Admin > Reviews > Reported
    and email the admin address. Only different accounts count; the business's own owner's report
    is kept but never counts. 3 counted reports hide the review until an admin restores it
    (app_settings > reviews > auto_hide_reports). Restore or "Keep up" closes the reports and the
    count starts again. Ban reviewer or reporter from the same card.
  - Businesses still can't hide, delete or reorder reviews. Nothing reads plan or sponsor tier.
- Photos (A16): logos, covers, gallery photos and sponsor images uploaded in the portal lose GPS
  and all other photo data before upload.
