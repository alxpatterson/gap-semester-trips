-- When a flight, train or bus lands.
--
-- Until now a booking stored only a departure time, so the calendar feed had to guess a length —
-- every flight came out two hours, whether it was Florence to Paris or Florence to Bangkok.
--
-- The arrival DATE needs no new column: `end_date` already means "the day this ends", which for a
-- stay is check-out and for an overnight flight is the morning you land. It stays empty when a
-- journey begins and ends on the same day.
alter table public.bookings add column if not exists arrive_time text not null default '';
