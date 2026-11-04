WEB UPDATE 135 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
Lost & Found reports and admin page, PIN limit per IP and device.
Do these before the app steps.

1. Supabase > SQL Editor: run sql/111_lost_found_reports_pin_ip_limit.sql
   Expect 4 rows:
     lost & found row security            on
     lost & found auto-hide after reports 3
     lost & found open reports            0
     pin limit per ip/device              20 wrong tries per 60 minutes
   If the first row says OFF, stop and send me the output.

2. Portal:
     cd portal
     npm run build && npx firebase deploy --only hosting
   It must say "Deploying to 'whileinapp'".

3. Commit:
     cd ..
     git add -A && git commit -m "Update 135: Lost & Found reports, PIN limit per IP and device" && git push

Check: portal.whilein.app > Admin > Lost & Found opens (empty "Nothing reported" is fine).
