WhileIn update 141 (WEB), Wednesday Nov 11, 2026
================================================

What is in this zip
  scripts/photo-samples/post-photo-samples.mjs   A58 Photo Wall samples from the team account
  scripts/photo-samples/manifest.example.csv     one row per photo, doubles as the license list

Nothing to deploy. No SQL. No app change.


1. PLAY BUILD CHECK (A29)
-------------------------
a. On your phone, open the internal testing link, accept, and install WhileIn from Google Play.
b. Play Console > Test and release > App bundle explorer > pick the new version > Permissions.
   These 10 must NOT be listed:
     android.permission.CAMERA
     android.permission.WRITE_EXTERNAL_STORAGE
     android.permission.ACCESS_MEDIA_LOCATION
     android.permission.SYSTEM_ALERT_WINDOW
     android.permission.ACCESS_ADSERVICES_AD_ID
     android.permission.ACCESS_ADSERVICES_ATTRIBUTION
     android.permission.ACCESS_BACKGROUND_LOCATION
     android.permission.FOREGROUND_SERVICE_LOCATION
     android.permission.RECORD_AUDIO
     com.google.android.gms.permission.AD_ID
   If any of them shows, tell me before Thursday.
c. Firebase console > whileinapp > Crashlytics > select the Android app > Enable.
   Open the Play-installed app once, then wait. The dashboard shows "app detected"
   within about 30 minutes.


2. A55 PHOTO UPLOAD CHECK (Play-installed build, not the preview app)
---------------------------------------------------------------------
a. Photo Wall > + > pick a photo from the gallery > tag a place > Post.
   Expected: "Thanks for sharing" and the photo shows for you as waiting for review.
b. Lost & Found > Post > add a photo > Post. Expected: the post saves with its photo.
c. Delete both test posts afterwards (long press or the menu on the post).
If either fails, write down the exact error text.


3. SCREENSHOTS FOR KEVIN (before water reports)
-----------------------------------------------
Take 6 to 8 from the Play-installed build, phone held upright.
  1 Home, top with Quick Actions
  2 Map with parking bubbles (tap Live Parking)
  3 Map with event bubbles (no chip selected)
  4 Transit
  5 Itinerary
  6 Weather
  7 A listing detail page with photos
  8 Ask WhileIn answering a question (e.g. "Where can I park near Seaside?")
Before taking them:
  - Home rows look finished (Kevin's rule)
  - full battery or hide the charging icon, Wi-Fi on, no notifications in the status bar
  - no personal names, emails or phone numbers on screen
  - skip Photo Wall until step 5 is done (then add it as a 9th)
Send Kevin the original PNG files (Drive folder or email attachments), not photos
compressed by a chat app.


4. GITHUB (when Kevin's invite to "whilein" arrives)
----------------------------------------------------
a. Accept the invite on raprapi93 and on whilein30a-app.
b. Logged in as whilein30a-app: each repo > Settings > General > Danger Zone >
   Transfer > New owner: whilein > type the repo name > I understand, transfer.
c. In each local folder:
     git remote set-url origin https://github.com/whilein/REPO-NAME.git
     git remote -v
     git push
d. Tell Kevin both repos are in, so he can give raprapi93 Write access.
   Then switch day-to-day pushes to raprapi93 (gh auth login, then gh auth setup-git).


5. A58 PHOTO WALL SAMPLES
-------------------------
a. Team account: in the app, sign up with the WhileIn team email Kevin wants used,
   first name "WhileIn", and set a PIN. Not the reviewer account, not admin.
b. Download 8 to 12 photos from unsplash.com or pexels.com only:
   beaches, dunes, sunsets, piers, 30A style streets. No faces, no logos or shop signs.
   Keep each photo's page link and the photographer's name.
c. Setup, once, in an empty folder outside the repos (Git Bash):
     mkdir ~/whilein-photo-samples && cd ~/whilein-photo-samples
     npm init -y
     npm install sharp@0.35.5
     copy post-photo-samples.mjs and manifest.example.csv here
     mkdir photos   (put the downloaded photos in it)
     cp manifest.example.csv manifest.csv
d. Fill manifest.csv, one row per photo:
     file          the file name inside photos/
     caption       short line shown under the photo (optional)
     place         a town or business name; an exact business name gets tagged
     source        Unsplash or Pexels
     photographer  name from the photo page
     photo_page    the unsplash.com or pexels.com link of that photo
     license       Unsplash License or Pexels License
     checked_no_faces_or_logos   yes, after you looked at the photo
e. Service role key, typed in the terminal only:
     read -s SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
f. Check first (posts nothing):
     node post-photo-samples.mjs --email=TEAM_EMAIL
   Fix any rows it lists.
g. Post:
     node post-photo-samples.mjs --email=TEAM_EMAIL --post
   Each photo is re-encoded (no GPS, no camera data), uploaded, and shown right away.
   Admin gets one "new photo to review" email per photo; those can be ignored.
h. unset SUPABASE_SERVICE_ROLE_KEY
i. Keep manifest.csv and posted.json together. That is the license list.
   To remove all samples later: node post-photo-samples.mjs --undo
j. Check the Photo Wall in the app, then take the Photo Wall screenshot.


6. TRELLO
---------
Move to For Testing / Done with the comments already written for updates 139 and 140
and the Stripe prep. A54, A56, A57, A60 done. A61 stays open until step 4 is finished.
A55 and A58: comment with the result of steps 2 and 5.
