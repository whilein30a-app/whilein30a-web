WEB UPDATE 139 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
A54 PIN check spoof test, A57 beach access points per stretch. Nothing to deploy.

1. Unzip:
     cd ~/Documents/in30a-web
     unzip -o ~/Downloads/in30A_139_WEB.zip -d .

2. A54, part A (offline, safe, takes a second):
     node scripts/test-pin-spoof.mjs
   Expect "PART A: all passed". This checks the IP rule in pin-login, including the
   x-forwarded-for fallback (the fallback cannot be reached from outside, so this is
   where it is tested).

3. A54, part B (live). Read first: it locks PIN sign in from YOUR internet connection
   (everyone on the same Wi-Fi) until you run the cleanup in step 4. Uses made-up
   emails (@example.invalid) and PIN 000000 only.
     node scripts/test-pin-spoof.mjs --live
   Expect "PART B: PASS. Locked at request #N" (N is 21 or less).
   If it stops with an HTTP error about cf-connecting-ip, run:
     node scripts/test-pin-spoof.mjs --live --no-cf
   FAIL means the fake headers were believed. Send me the whole output.

4. Cleanup right after step 3, SQL Editor:
     delete from public.pin_source_attempts;
     delete from public.pin_attempts where email like 'pinspoof-%@example.invalid';

5. A57: SQL Editor, run PART 1 of sql/checks/139_beach_access_by_stretch.sql, then PART 2.
   PART 1: points per stretch. 0 = a stretch with no access point (Kevin wants to know).
   PART 2: every point with its stretch and distance from the town centre.
   Send me both results. Note: the stretch is the nearest of the app's 12 town
   centres (constants/towns.ts). Some of those centres may be off, so a point can land
   in the neighbouring stretch; PART 2 shows that.

6. Commit:
     git add -A && git commit -m "Update 139: PIN spoof test, beach access per stretch check" && git push
