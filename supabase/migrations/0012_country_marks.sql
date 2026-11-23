-- Marking a country on the map without a trip for it.
--
-- Until now a country was coloured in only because some trip's Where box named it, so there was
-- no way to say "I've been to Japan" about a trip that isn't in this plan, or "I'd like to go" to
-- somewhere with nothing booked. This is that: one row per country per plan, holding which of the
-- three it is. Trips still win where a country has both — the mark is only another way for a
-- country to earn its colour.
--
-- Run this BEFORE deploying, as always. Nothing existing changes, and the app hides the marking
-- buttons until it can read this table, so the map behaves exactly as it does today until it has
-- run — but the moment someone taps Been, the write fails until it has.

create table if not exists public.country_marks (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  -- ISO 3166-1 alpha-3, as lib/countries.ts spells it.
  code       text not null check (code = upper(code) and length(code) = 3),
  mark       text not null check (mark in ('been', 'planned', 'wish')),
  created_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now(),
  primary key (plan_id, code)
);

alter table public.country_marks enable row level security;
create policy "members read country marks"   on public.country_marks for select using (public.is_plan_member(plan_id));
create policy "editors add country marks"    on public.country_marks for insert with check (public.can_edit_plan(plan_id));
create policy "editors change country marks" on public.country_marks for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "editors clear country marks"  on public.country_marks for delete using (public.can_edit_plan(plan_id));

-- So a mark made on one phone shows up on the other, the same as a ticked to-do.
alter publication supabase_realtime add table public.country_marks;
