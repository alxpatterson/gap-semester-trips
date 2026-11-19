-- Let a plan be subscribed to from Google Calendar, Apple Calendar or Outlook.
--
-- The app serves an iCalendar feed at /calendar/<token>.ics. That URL is the only credential a
-- calendar app has, so the token is long and random, it can be replaced if it leaks, and nobody
-- can choose their own: the column is not writable through the API, only by the function below.

-- 1. The token ----------------------------------------------------------------------------------
alter table public.plans add column if not exists calendar_token text;

-- Two UUIDv4s with the hyphens stripped: 64 hex characters, and no pgcrypto needed.
create or replace function public.new_calendar_token() returns text
language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

update public.plans set calendar_token = public.new_calendar_token() where calendar_token is null;

alter table public.plans alter column calendar_token set default public.new_calendar_token();
alter table public.plans alter column calendar_token set not null;
create unique index if not exists plans_calendar_token_idx on public.plans (calendar_token);

-- 2. Nobody sets their own token ----------------------------------------------------------------
-- Members may still edit the plan's name, dates, budget and currency, and the existing
-- "editors update plan" policy still decides who. Column-level privileges only narrow which
-- columns an UPDATE may name — and Postgres ignores them while a table-wide grant is in place,
-- so that has to go first.
revoke update on public.plans from authenticated;
grant update (name, budget_usd, budget_note, start_date, end_date, currency, track_schengen)
  on public.plans to authenticated;

-- 3. Replacing a leaked link --------------------------------------------------------------------
-- Runs as its owner, so it can write the column the caller can't. Editors and the owner only.
create or replace function public.rotate_calendar_token(p uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  token text;
begin
  if not public.can_edit_plan(p) then
    raise exception 'Only the trip owner or an editor can replace the calendar link';
  end if;
  token := public.new_calendar_token();
  update public.plans set calendar_token = token where id = p;
  return token;
end $$;

grant execute on function public.rotate_calendar_token(uuid) to authenticated;
