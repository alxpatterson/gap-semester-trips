-- Pin the search_path on the two trigger functions that were missing it.
--
-- Every other function here already sets `search_path = public`; these two predate the habit
-- (touch_updated_at from 0001) or were written without it (check_expense_shares from 0010). A
-- function with a mutable search_path resolves unqualified names against whatever the caller's
-- path happens to be, so pinning it closes the gap and makes the schema consistent with itself.
--
-- ALTER rather than CREATE OR REPLACE: the bodies are correct, only the setting is missing.
alter function public.touch_updated_at() set search_path = public;
alter function public.check_expense_shares() set search_path = public;
