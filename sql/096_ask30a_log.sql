-- 096: Ask 30A question log (Kevin, Oct 22, 2026).
-- Every question asked in Ask 30A is stored with the time, whether it was answered, and
-- any thumbs up or down. No name, email, user id or device id is stored. The admin
-- portal lists them so weak or unanswered questions can become vetted rule cards.
-- Safe to run more than once. New table carries explicit grants (Supabase, Oct 30).

create table if not exists public.ask30a_log (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  asked_at timestamptz not null default now(),
  answered boolean not null default false,
  weak boolean not null default false,
  tool text,
  results integer not null default 0,
  rating smallint check (rating in (-1, 1)),
  rated_at timestamptz,
  reviewed boolean not null default false,
  admin_note text
);
create index if not exists ask30a_log_asked_idx on public.ask30a_log (asked_at desc);

alter table public.ask30a_log enable row level security;
revoke all on public.ask30a_log from anon, authenticated;
grant select, insert, update, delete on public.ask30a_log to service_role;
-- No policies on purpose: the app never reads or writes this table directly.
-- The edge function writes with the service role, and the two functions below are the only doors.

-- Thumbs on one answer. The id is only known to the phone that got the answer.
create or replace function public.rate_ask30a_answer(p_id uuid, p_rating integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_rating is not null and p_rating not in (-1, 1) then
    raise exception 'Rating must be 1 or -1';
  end if;
  update public.ask30a_log
  set rating = p_rating::smallint, rated_at = case when p_rating is null then null else now() end
  where id = p_id;
end $$;
revoke all on function public.rate_ask30a_answer(uuid, integer) from public;
grant execute on function public.rate_ask30a_answer(uuid, integer) to anon, authenticated;

-- Admin list. p_filter: all, todo (not reviewed and weak, unanswered or thumbs down),
-- unanswered, weak, down.
create or replace function public.admin_ask30a_log(p_filter text default 'todo', p_limit integer default 100, p_offset integer default 0)
returns table (
  id uuid, question text, asked_at timestamptz, answered boolean, weak boolean, tool text,
  results integer, rating smallint, reviewed boolean, admin_note text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  return query
  select l.id, l.question, l.asked_at, l.answered, l.weak, l.tool, l.results, l.rating, l.reviewed, l.admin_note
  from public.ask30a_log l
  where case p_filter
    when 'todo' then not l.reviewed and (not l.answered or l.weak or l.rating = -1)
    when 'unanswered' then not l.answered
    when 'weak' then l.weak
    when 'down' then l.rating = -1
    else true end
  order by l.asked_at desc
  limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
end $$;
revoke all on function public.admin_ask30a_log(text, integer, integer) from public, anon;
grant execute on function public.admin_ask30a_log(text, integer, integer) to authenticated;

create or replace function public.admin_ask30a_summary(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  select jsonb_build_object(
    'days', p_days,
    'total', count(*),
    'answered', count(*) filter (where answered),
    'unanswered', count(*) filter (where not answered),
    'weak', count(*) filter (where weak),
    'up', count(*) filter (where rating = 1),
    'down', count(*) filter (where rating = -1),
    'to_review', count(*) filter (where not reviewed and (not answered or weak or rating = -1))
  ) into r
  from public.ask30a_log
  where asked_at >= now() - make_interval(days => greatest(p_days, 1));
  return r;
end $$;
revoke all on function public.admin_ask30a_summary(integer) from public, anon;
grant execute on function public.admin_ask30a_summary(integer) to authenticated;

create or replace function public.admin_ask30a_mark(p_id uuid, p_reviewed boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_portal_admin() then
    raise exception 'Not allowed';
  end if;
  update public.ask30a_log
  set reviewed = p_reviewed, admin_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
  where id = p_id;
end $$;
revoke all on function public.admin_ask30a_mark(uuid, boolean, text) from public, anon;
grant execute on function public.admin_ask30a_mark(uuid, boolean, text) to authenticated;
