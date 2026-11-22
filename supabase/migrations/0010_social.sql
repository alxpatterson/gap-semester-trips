-- Doing trips with friends: shared trips, people on bookings, trip notes, assigned to-dos and a
-- ledger for splitting costs.
--
-- A shared trip is its own small plan (kind = 'group'). "Share this trip" moves the trip, its
-- bookings, to-dos, notes and expenses out of your plan into a new group plan and adds your friends
-- to it, so every existing rule — is_plan_member for reads, can_edit_plan for writes, the viewer
-- role — applies to it unchanged. The app then shows group trips on your own calendar too.
--
-- Run this BEFORE deploying the code that uses it. Only new tables and one new column on tasks
-- (assignee) are added; the app omits assignee from a write unless one is picked, but picking one
-- fails until this has run.

-- 1. Group plans --------------------------------------------------------------------------------
alter table public.plans add column if not exists kind text not null default 'personal';
alter table public.plans drop constraint if exists plans_kind_check;
alter table public.plans add constraint plans_kind_check check (kind in ('personal', 'group'));
-- kind is deliberately left out of the column grant from 0008: only share_trip() sets it.

-- Owning a group trip must not stop someone creating their own trip, so only personal plans count.
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
  if exists (
    select 1 from public.plan_members m join public.plans p on p.id = m.plan_id
     where lower(m.email) = who and m.role = 'owner' and p.kind = 'personal'
  ) then
    raise exception 'You already have a trip';
  end if;
  if ends is not null and starts is not null and ends < starts then
    raise exception 'The end date is before the start date';
  end if;

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

-- 2. Profiles -----------------------------------------------------------------------------------
-- Membership is by email, and other people's rows in auth.users can't be read from the browser,
-- so this is where a name and a way to be paid live. You can see the profile of anyone you share a
-- plan with, and write only your own.
create table if not exists public.profiles (
  email        text primary key check (email = lower(email)),
  display_name text not null default '' check (length(display_name) <= 40),
  pay_handle   text not null default '' check (length(pay_handle) <= 80),
  updated_at   timestamptz not null default now()
);

create or replace function public.shares_a_plan_with(other text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_members a
      join public.plan_members b on a.plan_id = b.plan_id
     where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and lower(b.email) = lower(other)
  );
$$;

alter table public.profiles enable row level security;
create policy "read shared profiles" on public.profiles for select
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.shares_a_plan_with(email));
create policy "write own profile" on public.profiles for insert
  with check (email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "edit own profile" on public.profiles for update
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (email = lower(coalesce(auth.jwt() ->> 'email', '')));
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- 3. Who is on each booking ---------------------------------------------------------------------
-- The foreign key cascades on update, so these move with the booking when a trip is shared.
create table if not exists public.booking_people (
  plan_id    uuid not null,
  booking_id text not null,
  email      text not null check (email = lower(email)),
  primary key (plan_id, booking_id, email),
  foreign key (plan_id, booking_id) references public.bookings (plan_id, id) on delete cascade on update cascade
);

alter table public.booking_people enable row level security;
create policy "members read booking people"   on public.booking_people for select using (public.is_plan_member(plan_id));
create policy "editors add booking people"    on public.booking_people for insert with check (public.can_edit_plan(plan_id));
create policy "editors remove booking people" on public.booking_people for delete using (public.can_edit_plan(plan_id));

-- 4. Trip notes ---------------------------------------------------------------------------------
-- A short thread per trip for meeting points and the like. Editors post; you delete only your own.
create table if not exists public.trip_notes (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  id         text not null default gen_random_uuid()::text,
  trip_id    text not null,
  author     text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  primary key (plan_id, id)
);
create index if not exists trip_notes_trip_idx on public.trip_notes (plan_id, trip_id, created_at);

alter table public.trip_notes enable row level security;
create policy "members read notes" on public.trip_notes for select using (public.is_plan_member(plan_id));
create policy "editors post notes" on public.trip_notes for insert
  with check (public.can_edit_plan(plan_id) and author = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "authors delete notes" on public.trip_notes for delete
  using (author = lower(coalesce(auth.jwt() ->> 'email', '')) and public.is_plan_member(plan_id));

-- 5. Expenses and settlements -------------------------------------------------------------------
-- One table for both. An expense: paid_by paid `amount`, and `shares` says who it was for.
-- A settlement: paid_by paid one person back, and `shares` holds that one person. The balance
-- arithmetic is the same either way, which is why they share a table. Amounts stay in the
-- currency they were paid in; the app converts only for display.
create table if not exists public.expenses (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  id         text not null default gen_random_uuid()::text,
  kind       text not null default 'expense' check (kind in ('expense', 'settlement')),
  title      text not null default '' check (length(title) <= 100),
  amount     numeric(12,2) not null check (amount > 0),
  currency   text not null check (currency ~ '^[A-Z]{3}$'),
  paid_by    text not null check (paid_by = lower(paid_by)),
  date       date not null default current_date,
  trip_id    text,
  booking_id text,
  shares     jsonb not null default '[]'::jsonb,
  notes      text not null default '' check (length(notes) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, id)
);
create index if not exists expenses_trip_idx on public.expenses (plan_id, trip_id);

-- The shares must add up to the amount, whatever client wrote the row.
create or replace function public.check_expense_shares() returns trigger language plpgsql as $$
declare
  total numeric := 0;
  s     jsonb;
begin
  if jsonb_typeof(new.shares) <> 'array' or jsonb_array_length(new.shares) = 0 then
    raise exception 'An expense needs at least one person to split it with';
  end if;
  for s in select * from jsonb_array_elements(new.shares) loop
    if coalesce(s ->> 'email', '') = '' or (s ->> 'amount')::numeric < 0 then
      raise exception 'Each share needs a person and an amount of zero or more';
    end if;
    total := total + (s ->> 'amount')::numeric;
  end loop;
  if abs(total - new.amount) > 0.01 then
    raise exception 'The shares add up to % but the amount is %', total, new.amount;
  end if;
  return new;
end $$;
create trigger expenses_check before insert or update on public.expenses for each row execute function public.check_expense_shares();
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();

alter table public.expenses enable row level security;
create policy "members read expenses"   on public.expenses for select using (public.is_plan_member(plan_id));
create policy "editors add expenses"    on public.expenses for insert with check (public.can_edit_plan(plan_id));
create policy "editors edit expenses"   on public.expenses for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "editors delete expenses" on public.expenses for delete using (public.can_edit_plan(plan_id));

-- 6. Assigned to-dos ----------------------------------------------------------------------------
alter table public.tasks add column if not exists assignee text;

-- 7. Sharing a trip -----------------------------------------------------------------------------
-- Makes a group plan from one trip and moves everything filed under that trip into it. The caller
-- becomes its owner; everyone on the old plan keeps access (an owner there becomes an editor
-- here, a viewer stays a viewer); each invitee is added as an editor. Invitees without an account
-- get access as soon as they sign up with that email, because membership is by email.
create or replace function public.share_trip(from_plan uuid, trip text, invitees text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  who    text := lower(coalesce(auth.jwt() ->> 'email', ''));
  src    public.plans%rowtype;
  t      public.trips%rowtype;
  new_id uuid;
  raw    text;
  addr   text;
begin
  if who = '' then
    raise exception 'Sign in first';
  end if;
  if not public.can_edit_plan(from_plan) then
    raise exception 'Only the owner or an editor can share a trip';
  end if;
  select * into src from public.plans where id = from_plan;
  if src.kind = 'group' then
    raise exception 'This trip is already shared — add people under Trip settings';
  end if;
  select * into t from public.trips where plan_id = from_plan and id = trip;
  if not found then
    raise exception 'Trip not found';
  end if;
  if coalesce(array_length(invitees, 1), 0) > 20 then
    raise exception 'Add up to 20 people at a time';
  end if;

  insert into public.plans (name, budget_usd, budget_note, start_date, end_date, currency, track_schengen, created_by, kind)
  values (left(t.title, 60), 0, '', t.start_date, coalesce(t.end_date, t.start_date), src.currency, false, auth.uid(), 'group')
  returning id into new_id;

  insert into public.plan_members (plan_id, email, role) values (new_id, who, 'owner');
  insert into public.plan_members (plan_id, email, role)
    select new_id, lower(m.email), case when m.role = 'viewer' then 'viewer' else 'editor' end
      from public.plan_members m
     where m.plan_id = from_plan and lower(m.email) <> who
  on conflict do nothing;
  foreach raw in array coalesce(invitees, '{}') loop
    addr := lower(btrim(raw));
    if addr ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      insert into public.plan_members (plan_id, email, role) values (new_id, addr, 'editor') on conflict do nothing;
    end if;
  end loop;

  update public.trips      set plan_id = new_id where plan_id = from_plan and id = trip;
  update public.bookings   set plan_id = new_id where plan_id = from_plan and trip_id = trip; -- booking_people follow by cascade
  update public.tasks      set plan_id = new_id where plan_id = from_plan and trip_id = trip;
  update public.trip_notes set plan_id = new_id where plan_id = from_plan and trip_id = trip;
  update public.expenses   set plan_id = new_id where plan_id = from_plan and trip_id = trip;
  return new_id;
end $$;

grant execute on function public.share_trip(uuid, text, text[]) to authenticated;

-- 8. Live updates -------------------------------------------------------------------------------
alter publication supabase_realtime add table public.booking_people, public.trip_notes, public.expenses;
