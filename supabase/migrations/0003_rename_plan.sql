-- The header shows plans.name, so renaming the app in the code isn't enough: rename the row too.
-- Safe to re-run; it only touches a plan still carrying the old name.
update public.plans set name = 'Winter 2027' where name <> 'Winter 2027';
