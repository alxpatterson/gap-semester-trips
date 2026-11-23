-- Two more kinds of journey, so a car hire or a ferry gets its own icon instead of sharing "bus".
-- Until this has been run, saving a booking of type car or boat fails; every other type is unaffected.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.bookings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''flight''%';
  if c is not null then execute format('alter table public.bookings drop constraint %I', c); end if;
end $$;

alter table public.bookings
  add constraint bookings_type_check
  check (type in ('stay','flight','train','bus','car','boat','food','activity','other'));
