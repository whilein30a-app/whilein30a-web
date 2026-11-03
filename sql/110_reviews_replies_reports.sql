-- 110: Reviews: owner replies, delete your own review, Report button with
-- automatic hiding, review policy link (Kevin's review card, Nov 3, 2026).
-- Run once in the Supabase SQL editor after 109. Safe to run again.
--
--  1. A verified owner (approved claim) posts one public reply per review from
--     the portal, and can edit or delete it. Shown as "Response from the owner".
--  2. People can edit (already in sql/101) or delete their own review. Deleting
--     a review, or the account, removes it, and the average updates by itself
--     (listing_review_stats only counts visible reviews).
--  3. Report: every review has a Report button with 8 reasons. Reports go to
--     the admin queue (Admin > Reviews > Reported) and email the admin address.
--     Only reports from different accounts count, and a report from the
--     reviewed business's own owner is kept but never counts. At 3 counted
--     reports (app_settings > reviews > auto_hide_reports) the review is
--     hidden until an admin looks at it. Restoring it brings it back and
--     starts the count again.
--  4. Businesses still cannot hide, delete or reorder reviews, and nothing
--     here reads a plan or sponsor tier.
--  5. Admins block someone who keeps breaking the rules or filing false
--     reports with the existing posting ban (sql/102). Banned accounts cannot
--     review, reply or report.

-- ---------------------------------------------------------------------
-- 0. Settings: new policy address, auto-hide number
-- ---------------------------------------------------------------------
update public.app_settings
set value = jsonb_set(value, '{policy_url}', '"https://whilein.app/review-policy"')
where key = 'reviews' and coalesce(value->>'policy_url', '') in ('', 'https://in30a.app/review-policy');
update public.app_settings
set value = value || '{"auto_hide_reports": 3}'
where key = 'reviews' and not (value ? 'auto_hide_reports');

-- ---------------------------------------------------------------------
-- 1. Deleting an account deletes its reviews
-- ---------------------------------------------------------------------
do $$
declare
  fk record;
  target text;
begin
  select c.conname, c.confrelid::regclass::text as tgt, c.confdeltype into fk
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.conrelid = 'public.reviews'::regclass and c.contype = 'f' and a.attname = 'user_id'
  limit 1;
  if fk.conname is not null and fk.confdeltype = 'c' then
    return; -- already cascades
  end if;
  target := coalesce(fk.tgt, 'auth.users');
  if fk.conname is not null then
    execute format('alter table public.reviews drop constraint %I', fk.conname);
  end if;
  -- Reviews whose account is already gone.
  execute format('delete from public.reviews r where not exists (select 1 from %s u where u.id = r.user_id)', target);
  execute format('alter table public.reviews add constraint reviews_user_id_fkey foreign key (user_id) references %s(id) on delete cascade', target);
end $$;

-- ---------------------------------------------------------------------
-- 2. Delete your own review
-- ---------------------------------------------------------------------
create or replace function public.delete_my_review(p_listing_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  delete from public.reviews where listing_id = p_listing_id and user_id = auth.uid() and status <> 'removed';
  if not found then
    raise exception 'There is no review of yours to delete here.';
  end if;
end $$;
revoke all on function public.delete_my_review(uuid) from public, anon;
grant execute on function public.delete_my_review(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Owner replies
-- ---------------------------------------------------------------------
create table if not exists public.review_replies (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  listing_id uuid not null,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 2 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited boolean not null default false
);
create index if not exists review_replies_listing_idx on public.review_replies (listing_id);
alter table public.review_replies enable row level security;
drop policy if exists review_replies_read on public.review_replies;
create policy review_replies_read on public.review_replies for select to anon, authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.status = 'visible'));
revoke insert, update, delete on public.review_replies from anon, authenticated;
grant select on public.review_replies to anon, authenticated;

create or replace function public.portal_reply_to_review(p_review_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.reviews;
  clean text := nullif(trim(coalesce(p_body, '')), '');
begin
  select * into r from public.reviews where id = p_review_id;
  if r.id is null or r.status <> 'visible' then
    raise exception 'Review not found.';
  end if;
  if not public.owns_listing(r.listing_id) then
    raise exception 'Only the verified owner of this business can reply.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and posting_banned_at is not null) then
    raise exception 'Your account cannot post right now. Contact hello@whilein.app.';
  end if;
  if clean is null or char_length(clean) < 2 or char_length(clean) > 1000 then
    raise exception 'The reply must be 2 to 1000 characters.';
  end if;
  insert into public.review_replies (review_id, listing_id, author_id, body)
  values (r.id, r.listing_id, auth.uid(), clean)
  on conflict (review_id) do update set
    body = excluded.body, author_id = excluded.author_id, updated_at = now(),
    edited = public.review_replies.edited or public.review_replies.body is distinct from excluded.body;
end $$;
revoke all on function public.portal_reply_to_review(uuid, text) from public, anon;
grant execute on function public.portal_reply_to_review(uuid, text) to authenticated;

create or replace function public.portal_delete_reply(p_review_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  lid uuid;
begin
  select listing_id into lid from public.review_replies where review_id = p_review_id;
  if lid is null then
    return;
  end if;
  if not (public.owns_listing(lid) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  delete from public.review_replies where review_id = p_review_id;
end $$;
revoke all on function public.portal_delete_reply(uuid) from public, anon;
grant execute on function public.portal_delete_reply(uuid) to authenticated;

-- The owner's list: visible reviews, newest first (the same order everyone sees).
create or replace function public.portal_listing_reviews(p_listing_id uuid)
returns table (
  id uuid, rating integer, comment text, created_at timestamptz, edited boolean,
  reply text, reply_updated_at timestamptz, reply_edited boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.owns_listing(p_listing_id) or public.is_portal_admin()) then
    raise exception 'Not allowed';
  end if;
  return query
    select r.id, r.rating::int, r.comment, r.created_at, r.edit_count > 0,
           rr.body, rr.updated_at, rr.edited
    from public.reviews r
    left join public.review_replies rr on rr.review_id = r.id
    where r.listing_id = p_listing_id and r.status = 'visible'
    order by r.created_at desc
    limit 500;
end $$;
revoke all on function public.portal_listing_reviews(uuid) from public, anon;
grant execute on function public.portal_listing_reviews(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Reports
-- ---------------------------------------------------------------------
create table if not exists public.review_reports (
  id bigint generated always as identity primary key,
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('abusive', 'discriminatory', 'personal_info', 'false_misleading',
                                         'fake_conflict', 'paid', 'spam_unrelated', 'illegal')),
  note text check (note is null or char_length(note) <= 500),
  counts boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index if not exists review_reports_one_open
  on public.review_reports (review_id, reporter) where resolved_at is null;
create index if not exists review_reports_open_idx on public.review_reports (review_id) where resolved_at is null;
alter table public.review_reports enable row level security;
revoke all on public.review_reports from public, anon, authenticated;

alter table public.review_moderation_log drop constraint if exists review_moderation_log_action_check;
alter table public.review_moderation_log add constraint review_moderation_log_action_check
  check (action in ('hide', 'remove', 'restore', 'auto_hide', 'dismiss'));

create or replace function public.review_report_reason_label(p_reason text)
returns text language sql immutable as $$
  select case p_reason
    when 'abusive' then 'Abusive or harassing'
    when 'discriminatory' then 'Discriminatory'
    when 'personal_info' then 'Personal information'
    when 'false_misleading' then 'False or misleading'
    when 'fake_conflict' then 'Fake or conflict of interest'
    when 'paid' then 'Paid review'
    when 'spam_unrelated' then 'Spam or unrelated'
    when 'illegal' then 'Illegal or infringing'
    else p_reason end;
$$;

-- Returns {hidden: true} when this report hid the review.
create or replace function public.report_review(p_review_id uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.reviews;
  is_owner boolean;
  n_counted int;
  n_open int;
  threshold int := greatest(1, coalesce((select (value->>'auto_hide_reports')::int from public.app_settings where key = 'reviews'), 3));
  lname text;
begin
  if uid is null then
    raise exception 'Sign in to report a review.';
  end if;
  if exists (select 1 from public.profiles where id = uid and posting_banned_at is not null) then
    raise exception 'Your account cannot report reviews right now. Contact hello@whilein.app.';
  end if;
  select * into r from public.reviews where id = p_review_id;
  if r.id is null or r.status <> 'visible' then
    raise exception 'This review is no longer shown.';
  end if;
  if r.user_id = uid then
    raise exception 'You cannot report your own review. You can edit or delete it instead.';
  end if;
  if p_reason is null or p_reason not in ('abusive', 'discriminatory', 'personal_info', 'false_misleading',
                                          'fake_conflict', 'paid', 'spam_unrelated', 'illegal') then
    raise exception 'Pick a reason.';
  end if;
  if (select count(*) from public.review_reports where reporter = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of reports today. Please try again tomorrow.';
  end if;

  is_owner := exists (select 1 from public.listing_owners where listing_id = r.listing_id and user_id = uid);

  perform pg_advisory_xact_lock(hashtext('review_report:' || p_review_id::text));
  begin
    insert into public.review_reports (review_id, reporter, reason, note, counts)
    values (r.id, uid, p_reason, left(nullif(trim(coalesce(p_note, '')), ''), 500), not is_owner);
  exception when unique_violation then
    raise exception 'You already reported this review. An admin will look at it.';
  end;

  select count(*) filter (where counts), count(*) into n_counted, n_open
  from public.review_reports where review_id = r.id and resolved_at is null;
  select name into lname from public.listings where id = r.listing_id;

  if n_counted >= threshold then
    update public.reviews set status = 'hidden' where id = r.id and status = 'visible';
    insert into public.review_moderation_log (review_id, admin_id, action, rule, note)
    values (r.id, null, 'auto_hide', null, format('%s reports from different accounts', n_counted));
    begin
      perform public.queue_email(public.admin_notify_address(), 'review_auto_hidden',
        'Review hidden after reports: ' || coalesce(lname, 'a place'),
        'A review of ' || coalesce(lname, 'a place') || ' got ' || n_counted || ' reports from different accounts and is hidden until you look at it.' || E'\n\n' ||
        'Portal > Admin > Reviews > Reported. Restore it if it breaks no rule.', null);
    exception when others then null;
    end;
    return jsonb_build_object('hidden', true);
  end if;

  if n_open = 1 then
    begin
      perform public.queue_email(public.admin_notify_address(), 'review_reported',
        'Review reported: ' || coalesce(lname, 'a place'),
        'A review of ' || coalesce(lname, 'a place') || ' was reported: ' || public.review_report_reason_label(p_reason) || '.' || E'\n\n' ||
        'Please check it within 24 hours: Portal > Admin > Reviews > Reported.', null);
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('hidden', false);
end $$;
revoke all on function public.report_review(uuid, text, text) from public, anon;
grant execute on function public.report_review(uuid, text, text) to authenticated;

-- Admin queue: reviews with open reports, oldest first (target: 24 hours).
create or replace function public.admin_review_reports()
returns table (
  review_id uuid, listing_id uuid, listing_name text, rating integer, comment text, status text,
  reviewer_id uuid, reviewer_email text, counted_reports integer, owner_reports integer,
  first_report_at timestamptz, reports jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select r.id, r.listing_id, l.name, r.rating::int, r.comment, r.status, r.user_id, u.email::text,
           (count(*) filter (where rp.counts))::int, (count(*) filter (where not rp.counts))::int,
           min(rp.created_at),
           jsonb_agg(jsonb_build_object(
             'reporter', rp.reporter, 'email', ru.email, 'reason', public.review_report_reason_label(rp.reason),
             'note', rp.note, 'counts', rp.counts, 'at', rp.created_at,
             'banned', coalesce(rpp.posting_banned_at is not null, false)) order by rp.created_at)
    from public.review_reports rp
    join public.reviews r on r.id = rp.review_id
    join public.listings l on l.id = r.listing_id
    left join auth.users u on u.id = r.user_id
    left join auth.users ru on ru.id = rp.reporter
    left join public.profiles rpp on rpp.id = rp.reporter
    where rp.resolved_at is null
    group by r.id, r.listing_id, l.name, r.rating, r.comment, r.status, r.user_id, u.email
    order by min(rp.created_at);
end $$;
revoke all on function public.admin_review_reports() from public, anon;
grant execute on function public.admin_review_reports() to authenticated;

-- Moderation, now also closing reports:
--   hide / remove: the reports were right (closed as upheld)
--   restore: the review comes back and the report count starts again
--   dismiss: the review stays up and its open reports are closed
create or replace function public.admin_moderate_review(p_id uuid, p_action text, p_rule text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  rules text[] := array['Spam or advertising', 'Off-topic or not about this place', 'Hate, harassment or threats',
                        'Personal information', 'Conflict of interest (owner, staff, competitor)',
                        'Not a genuine experience', 'Illegal or explicit content'];
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  if p_action not in ('hide', 'remove', 'restore', 'dismiss') then
    raise exception 'Bad action';
  end if;
  if p_action in ('hide', 'remove') and (p_rule is null or not (p_rule = any (rules))) then
    raise exception 'Pick the rule this review breaks. A negative review that breaks no rule stays up.';
  end if;
  if p_action = 'dismiss' then
    if not exists (select 1 from public.reviews where id = p_id) then
      raise exception 'Review not found';
    end if;
  else
    update public.reviews
    set status = case p_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'visible' end
    where id = p_id;
    if not found then
      raise exception 'Review not found';
    end if;
  end if;
  update public.review_reports
  set resolved_at = now(),
      resolution = case p_action when 'hide' then 'upheld' when 'remove' then 'upheld' when 'restore' then 'restored' else 'dismissed' end
  where review_id = p_id and resolved_at is null;
  insert into public.review_moderation_log (review_id, admin_id, action, rule, note)
  values (p_id, auth.uid(), p_action, case when p_action in ('hide', 'remove') then p_rule end, left(nullif(trim(p_note), ''), 500));
end $$;
revoke all on function public.admin_moderate_review(uuid, text, text, text) from public, anon;
grant execute on function public.admin_moderate_review(uuid, text, text, text) to authenticated;

-- Report
select 'policy link' as what, (select value->>'policy_url' from public.app_settings where key = 'reviews') as detail
union all
select 'auto-hide after reports', (select value->>'auto_hide_reports' from public.app_settings where key = 'reviews')
union all
select 'reviews deleted with the account', (select case confdeltype when 'c' then 'yes' else 'no' end from pg_constraint where conname = 'reviews_user_id_fkey')
union all
select 'owner replies', (select count(*)::text from public.review_replies)
union all
select 'open reports', (select count(*)::text from public.review_reports where resolved_at is null);
