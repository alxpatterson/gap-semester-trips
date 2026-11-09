-- The daily Gmail sync remembers which messages it has already read, so it never processes one twice.
-- It writes through /api/sync with the service key, which bypasses RLS; no policy change is needed.
alter table public.sync_status add column if not exists processed_ids text[] not null default '{}';
