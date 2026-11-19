-- Make the app something a friend can sign up for. Each person creates one trip of their own, with
-- its own dates, budget, currency and visa counter — all of which used to be hardcoded in the app.
-- Everything else is unchanged: row-level security on plan_members already keeps plans apart.

-- 1. Settings that were hardcoded ---------------------------------------------------------------
alter table public.plans add column if not exists start_date     date;
alter table public.plans add column if not exists end_date       date;
alter table public.plans add column if not exists currency       text    not null default 'USD';
alter table public.plans add column if not exists track_schengen boolean not null default true;
alter table public.plans add column if not exists created_by     uuid;

-- The existing plan keeps the window the calendar used to hardcode.
update public.plans
   set start_date = coalesce(start_date, date '2026-12-01'),
       end_date   = coalesce(end_date,   date '2027-06-30');

alter table public.plans add constraint plans_dates_ordered
  check (end_date is null or start_date is null or end_date >= start_date);

-- 2. Invite codes -------------------------------------------------------------------------------
-- A code buys one thing: the right to create one trip. No policies are defined on this table, so
-- with RLS on, nobody can read or write it through the API — only the function below, which runs as
-- its owner. That means codes can't be listed, guessed at in bulk, or marked used by hand.
create table if not exists public.invite_codes (
  code       text primary key,
  note       text not null default '',
  max_uses   int  not null default 1 check (max_uses > 0),
  uses       int  not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;

-- 3. Creating a trip ----------------------------------------------------------------------------
-- 0002 removed create_plan so nobody could make a second plan. This puts it back, but gated: a
-- valid code, and only if you don't already own a trip. Being a member of someone else's doesn't
-- count, so a person who was invited to a friend's trip can still make their own.
create or replace function public.create_plan_with_invite(
  invite    text,
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
  if exists (select 1 from public.plan_members m where lower(m.email) = who and m.role = 'owner') then
    raise exception 'You already have a trip';
  end if;
  if ends is not null and starts is not null and ends < starts then
    raise exception 'The end date is before the start date';
  end if;

  -- Claiming the code and counting the use are the same statement, so two people racing on the
  -- last use of a code can't both win.
  update public.invite_codes c
     set uses = c.uses + 1
   where c.code = btrim(invite)
     and c.uses < c.max_uses
     and (c.expires_at is null or c.expires_at > now());
  if not found then
    raise exception 'That invite code is not valid';
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

grant execute on function public.create_plan_with_invite(text, text, date, date, numeric, text, boolean) to authenticated;

-- 4. Some codes to hand out ---------------------------------------------------------------------
-- Single use each. Mint more later with:
--   insert into public.invite_codes (code, note) values ('SOMECODE', 'for whoever');
insert into public.invite_codes (code, note) values
  ('TRIP-7QK2', 'spare'), ('TRIP-M4XD', 'spare'), ('TRIP-B9VN', 'spare'),
  ('TRIP-R3HC', 'spare'), ('TRIP-ZP68', 'spare'), ('TRIP-L5WT', 'spare'),
  ('TRIP-J2FQ', 'spare'), ('TRIP-X8DM', 'spare'), ('TRIP-K6YR', 'spare'),
  ('TRIP-N4SB', 'spare')
on conflict (code) do nothing;
