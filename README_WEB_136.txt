WEB UPDATE 136 (unzip into C:\Users\raffy\Documents\in30a-web, choose Replace)
November 2026 events, Lost & Found database check, reviewer account SQL.
No portal build needed.

1. Events. Supabase > SQL Editor: run sql/112_november_2026_events.sql
   Expect a "loaded now" row (about 630) and a row per category:
     Arts ~20, Classes ~22, Festival ~55, Live Music ~350, Special Event ~185
   Safe to run twice: rows with the same title, venue and date are skipped.
   What it loads:
     - Daily file from Nov 5 to Nov 30, each with its ticket or info link.
     - Arts and Classes file as November. Entries already in the daily file are
       not added again (57 merged). Runs become one event per date:
       A Christmas Carol on Sundays to Dec 20, The Art of Play Nov 9 to 13,
       Christmas Reflections nightly to Dec 31.
     - "Tuesday, November 13" (After-Hours Writing Night) is on Nov 13 as written.
       "Wednesday, November 14" (Chip & Dip Platter) is on Nov 14 as written.
   Not loaded (ask Kevin): "Enchanted Forest Terrarium Garden Party" has no day
   number. Baytowne on Ice after November (no daily times). Class listings with
   no date (Shacks Art, The Shard Shop, ECTC classes, and so on).
   Full list with notes: sql/112_november_2026_events_review.csv

2. Check in the app (Events): Nov 5 shows Baytowne on Ice and Kaylee Rose;
   Nov 13 shows After-Hours Writing Night; Dec 6 shows A Christmas Carol.
   Then move the card to For Testing.

3. Lost & Found check. SQL Editor: sql/checks/112_lost_found_hidden_check.sql
   Run PART 1 alone: row_security_on true, hidden_policy 1 or more.
   Run PART 2 alone: hidden_posts_this_user_can_see 0.
   Send me both results.

4. Reviewer account (ONLY after Kevin picks it): sql/checks/112_reviewer_account.sql
   Step 1 must say "verified". Step 2: is_admin false, phone_verified true.
   Send Kevin the login privately, never in Trello or chat.

5. Commit:
     git add -A && git commit -m "Update 136: November 2026 events, Lost & Found check" && git push
