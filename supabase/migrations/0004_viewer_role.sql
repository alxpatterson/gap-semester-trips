-- A view-only role: a viewer reads everything on the plan but cannot change anything.
-- Reads stay keyed to is_plan_member; every write now goes through can_edit_plan.

alter table public.plan_members drop constraint if exists plan_members_role_check;
alter table public.plan_members add constraint plan_members_role_check
  check (role in ('owner', 'editor', 'viewer'));

create or replace function public.can_edit_plan(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.plan_members m
    where m.plan_id = p
      and m.role in ('owner', 'editor')
      and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "members update plan"     on public.plans;
drop policy if exists "members add trips"       on public.trips;
drop policy if exists "members edit trips"      on public.trips;
drop policy if exists "members delete trips"    on public.trips;
drop policy if exists "members add bookings"    on public.bookings;
drop policy if exists "members edit bookings"   on public.bookings;
drop policy if exists "members delete bookings" on public.bookings;

create policy "editors update plan"     on public.plans    for update using (public.can_edit_plan(id)) with check (public.can_edit_plan(id));
create policy "editors add trips"       on public.trips    for insert with check (public.can_edit_plan(plan_id));
create policy "editors edit trips"      on public.trips    for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "editors delete trips"    on public.trips    for delete using (public.can_edit_plan(plan_id));
create policy "editors add bookings"    on public.bookings for insert with check (public.can_edit_plan(plan_id));
create policy "editors edit bookings"   on public.bookings for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "editors delete bookings" on public.bookings for delete using (public.can_edit_plan(plan_id));

-- Adding someone now takes a role. Still owner-only, and still never grants 'owner'.
-- The old two-argument version has to go: left in place, a two-argument call matches both and errors.
drop function if exists public.add_plan_member(uuid, text);
create or replace function public.add_plan_member(p uuid, member_email text, member_role text default 'viewer')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.plan_members where plan_id = p and role = 'owner'
                 and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception 'Only the plan owner can add people';
  end if;
  if member_role not in ('editor', 'viewer') then
    raise exception 'Role must be editor or viewer';
  end if;
  insert into public.plan_members (plan_id, email, role) values (p, lower(trim(member_email)), member_role)
  on conflict (plan_id, email) do update set role = excluded.role;
end $$;

-- Flip someone between viewer and editor later, without touching the dashboard.
create or replace function public.set_plan_member_role(p uuid, member_email text, member_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.plan_members where plan_id = p and role = 'owner'
                 and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception 'Only the plan owner can change roles';
  end if;
  if member_role not in ('editor', 'viewer') then
    raise exception 'Role must be editor or viewer';
  end if;
  update public.plan_members set role = member_role
   where plan_id = p and lower(email) = lower(trim(member_email)) and role <> 'owner';
end $$;

grant execute on function public.add_plan_member(uuid, text, text) to authenticated;
grant execute on function public.set_plan_member_role(uuid, text, text) to authenticated;
