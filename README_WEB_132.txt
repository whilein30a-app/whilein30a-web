WEB UPDATE 132 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
C1 security: Supabase advisor items

Do APP 132 steps 1 to 4 first (the app update must be out before profiles go private).

1. DATABASE (Supabase SQL editor), once:
     sql/107_c1_security.sql
   Fixes, from your Oct 30 policy report:
   - get_admin_analytics: admins only (anon could run it).
   - The 7 "always true" insert policies (bookings, affiliate clicks, beach flag, bug,
     parking, restroom and shuttle reports): still open to everyone, but each now checks
     its fields, and nobody can post under someone else's user id.
   - profiles: anyone could read every user's email, phone, push token and admin flag.
     Now everyone reads only their own (admins read all). First names for posts come from
     public_first_names; the login screen uses login_first_name.
   - itineraries and their stops: curated ones for everyone, your own for you (before:
     everyone's trip plans were readable).
   - Bucket listing: the two public read policies on listing-photos and photo-wall are
     removed. Photo links keep working (public buckets serve files by link).
   It ends with a short report. Expected: no "still always true" lines,
   "anon can run get_admin_analytics false", "profiles readable by anyone false",
   "storage read policies left 0". Send me anything else it shows.

2. LEAKED PASSWORD PROTECTION (dashboard switch, not SQL):
   Supabase > Authentication > Sign In / Providers > Email (Password settings) >
   "Prevent use of leaked passwords" ON. Needs the Pro plan; if the switch is greyed out,
   tell Kevin. Note: the app's password is the 6 digit PIN, so very common PINs (123456,
   111111) will be refused at sign up from then on, with Supabase's message shown.

3. ADVISOR: Supabase > Advisors > Security Advisor > Refresh. Send me a screenshot of
   anything still listed under Errors or Warnings.

4. git add . && git commit -m "Update 132: C1 security advisor fixes" && git push
