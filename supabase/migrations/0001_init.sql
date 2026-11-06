-- Gap Semester Trips: schema
-- Run once in Supabase → SQL Editor (or `supabase db push`).
--
-- Model: a "plan" is one shared trip plan (you + your girlfriend). Everyone whose email is in
-- plan_members can read and edit that plan's trips and bookings. Row-level security enforces it.
-- The daily Claude Gmail sync writes through the Supabase connector, which bypasses RLS.

create extension if not exists pgcrypto;

-- Plans -----------------------------------------------------------------------------------------
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  budget_usd  numeric(10,2) not null default 10000,
  budget_note text not null default 'excludes Florence rent',
  created_at  timestamptz not null default now()
);

create table public.plan_members (
  plan_id  uuid not null references public.plans(id) on delete cascade,
  email    text not null,
  role     text not null default 'editor' check (role in ('owner','editor')),
  added_at timestamptz not null default now(),
  primary key (plan_id, email)
);
create index plan_members_email_idx on public.plan_members (lower(email));

-- Trips -----------------------------------------------------------------------------------------
create table public.trips (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  id         text not null default gen_random_uuid()::text,
  title      text not null,
  kind       text not null default 'weekend' check (kind in ('base','weekend','travel','other')),
  status     text not null default 'idea'    check (status in ('idea','planned','booked')),
  start_date date,
  end_date   date,
  place      text not null default '',
  schengen   boolean not null default false,
  notes      text not null default '',
  source     text not null default 'manual',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, id),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- Bookings --------------------------------------------------------------------------------------
-- type → filter category:  stay → Stays · flight/train/bus → Transport · food → Food · activity → Events
create table public.bookings (
  plan_id          uuid not null references public.plans(id) on delete cascade,
  id               text not null default gen_random_uuid()::text,
  title            text not null,
  type             text not null default 'flight' check (type in ('stay','flight','train','bus','food','activity','other')),
  status           text not null default 'todo'   check (status in ('todo','booked','review')),
  trip_id          text,
  date             date,
  end_date         date,
  time             text not null default '',
  provider         text not null default '',
  cost             numeric(10,2) not null default 0,
  confirmation     text not null default '',
  link             text not null default '',
  notes            text not null default '',
  counts_in_budget boolean not null default true,
  source           text not null default 'manual',
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (plan_id, id)
);
create index bookings_trip_idx on public.bookings (plan_id, trip_id);

-- Gmail sync status (written by the Claude scheduled task) ---------------------------------------
create table public.sync_status (
  plan_id       uuid primary key references public.plans(id) on delete cascade,
  last_run      timestamptz,
  added         int not null default 0,
  updated       int not null default 0,
  review        int not null default 0,
  last_error    text not null default '',
  processed_ids text[] not null default '{}'
);

-- updated_at ------------------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trips_touch    before update on public.trips    for each row execute function public.touch_updated_at();
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();

-- Membership helpers ----------------------------------------------------------------------------
create or replace function public.is_plan_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_members m
    where m.plan_id = p and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Lets a signed-in person start a new plan and makes them its owner.
create or replace function public.create_plan(plan_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid; me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me = '' then raise exception 'Sign in first'; end if;
  insert into public.plans (name) values (coalesce(nullif(trim(plan_name), ''), 'My trip')) returning id into new_id;
  insert into public.plan_members (plan_id, email, role) values (new_id, me, 'owner');
  return new_id;
end $$;

-- Lets a plan owner invite someone by email (they sign in with that email to get access).
create or replace function public.add_plan_member(p uuid, member_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.plan_members where plan_id = p and role = 'owner'
                 and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception 'Only the plan owner can add people';
  end if;
  insert into public.plan_members (plan_id, email) values (p, lower(trim(member_email)))
  on conflict do nothing;
end $$;

-- Row-level security ----------------------------------------------------------------------------
alter table public.plans        enable row level security;
alter table public.plan_members enable row level security;
alter table public.trips        enable row level security;
alter table public.bookings     enable row level security;
alter table public.sync_status  enable row level security;

create policy "members read plan"     on public.plans        for select using (public.is_plan_member(id));
create policy "members update plan"   on public.plans        for update using (public.is_plan_member(id));
create policy "members read members"  on public.plan_members for select using (public.is_plan_member(plan_id));

create policy "members read trips"    on public.trips for select using (public.is_plan_member(plan_id));
create policy "members add trips"     on public.trips for insert with check (public.is_plan_member(plan_id));
create policy "members edit trips"    on public.trips for update using (public.is_plan_member(plan_id)) with check (public.is_plan_member(plan_id));
create policy "members delete trips"  on public.trips for delete using (public.is_plan_member(plan_id));

create policy "members read bookings"   on public.bookings for select using (public.is_plan_member(plan_id));
create policy "members add bookings"    on public.bookings for insert with check (public.is_plan_member(plan_id));
create policy "members edit bookings"   on public.bookings for update using (public.is_plan_member(plan_id)) with check (public.is_plan_member(plan_id));
create policy "members delete bookings" on public.bookings for delete using (public.is_plan_member(plan_id));

create policy "members read sync"     on public.sync_status for select using (public.is_plan_member(plan_id));

grant execute on function public.create_plan(text) to authenticated;
grant execute on function public.add_plan_member(uuid, text) to authenticated;

-- Live updates in the app -----------------------------------------------------------------------
alter publication supabase_realtime add table public.trips, public.bookings, public.sync_status;
