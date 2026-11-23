-- More than one trip each, and a target to aim the map at.
--
-- 0007 gave everyone exactly one trip of their own: an invite code bought it, and
-- create_plan_with_invite refuses a second. That made sense when the app was one gap semester.
-- It isn't any more — a trip planner you can only use once is a strange thing — so anyone who is
-- already in can make as many as they like, and the invite code goes back to being what it
-- actually is: the gate on a brand new account.

-- 1. A trip without burning an invite ------------------------------------------------------------
-- Deliberately not a relaxation of create_plan_with_invite: that one still refuses a second trip,
-- so a code is still one account's way in, and this one is only reachable once you have an account.
create or replace function public.create_plan(
  plan_name text,
  starts    date,
  ends      date,
  budget    numeric,
  curr      text,
  schengen  boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  who    text := lower(coalesce(auth.jwt() ->> 'email', ''));
  new_id uuid;
begin
  if who = '' then
    raise exception 'Sign in first';
  end if;
  -- Being on somebody's trip already is the proof that you came in through the front door.
  if not exists (select 1 from public.plan_members m where lower(m.email) = who) then
    raise exception 'Use an invite code for your first trip';
  end if;
  if ends is not null and starts is not null and ends < starts then
    raise exception 'The end date is before the start date';
  end if;

  insert into public.plans (name, budget_usd, budget_note, start_date, end_date, currency, track_schengen, created_by)
  values (
    coalesce(nullif(btrim(plan_name), ''), 'My trip'),
    greatest(coalesce(budget, 0), 0),
    '',
    starts,
    ends,
    upper(coalesce(nullif(btrim(curr), ''), 'USD')),
    coalesce(schengen, true),
    auth.uid()
  )
  returning id into new_id;

  insert into public.plan_members (plan_id, email, role) values (new_id, who, 'owner');
  return new_id;
end $$;

grant execute on function public.create_plan(text, date, date, numeric, text, boolean) to authenticated;

-- 2. How many countries you're aiming for --------------------------------------------------------
-- On the profile rather than the plan: a goal is a thing about a person, not about one trip, and
-- the map can count across every trip they have. Null means they haven't set one, which is why
-- the map shows no bar until they do rather than inventing a denominator.
alter table public.profiles add column if not exists countries_goal int;
alter table public.profiles drop constraint if exists profiles_countries_goal_check;
alter table public.profiles add constraint profiles_countries_goal_check
  check (countries_goal is null or (countries_goal between 1 and 250));
