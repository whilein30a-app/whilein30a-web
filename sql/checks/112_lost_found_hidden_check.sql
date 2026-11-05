-- Update 136: confirm hidden Lost & Found posts are blocked by the database.
-- Run PART 1 alone, then PART 2 alone (the SQL editor shows only the last result).

-- PART 1. Expect: row_security_on = true, hidden_policy = 1 or more.
select
  (select relrowsecurity from pg_class where oid = 'public.lost_found_posts'::regclass) as row_security_on,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'lost_found_posts' and qual ilike '%is_hidden%') as hidden_policy,
  (select count(*) from public.lost_found_posts where is_hidden) as hidden_posts_now;

-- PART 2. Reads the table as a signed-in user who posted nothing.
-- Expect: hidden_posts_this_user_can_see = 0 (and visible_posts = the live ones).
-- If hidden_posts_now in part 1 was 0, this proves little: hide one post first
-- (Portal > Admin > Lost & Found > Hide), run this, then Restore it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
select
  count(*) filter (where is_hidden) as hidden_posts_this_user_can_see,
  count(*) filter (where not is_hidden) as visible_posts
from public.lost_found_posts;
