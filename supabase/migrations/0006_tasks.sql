-- A plain checklist for everything that isn't a booking: visas, vaccinations, a new passport,
-- cancel the gym. Same membership rules as the rest: members read, editors and the owner write.
create table public.tasks (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  id         text not null default gen_random_uuid()::text,
  title      text not null,
  done       boolean not null default false,
  due        date,
  trip_id    text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  primary key (plan_id, id)
);
create index tasks_due_idx on public.tasks (plan_id, done, due);

alter table public.tasks enable row level security;

create policy "members read tasks"   on public.tasks for select using (public.is_plan_member(plan_id));
create policy "editors add tasks"    on public.tasks for insert with check (public.can_edit_plan(plan_id));
create policy "editors edit tasks"   on public.tasks for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "editors delete tasks" on public.tasks for delete using (public.can_edit_plan(plan_id));

-- So a tick on one phone shows up on the other.
alter publication supabase_realtime add table public.tasks;
