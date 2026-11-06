# Gap Semester Trips: notes for Claude

Shared trip planner PWA for Alex's Jan–May 2027 gap semester (London from Dec 31 → Florence base ~Jan 5–Mar 15 with weekend trips → solo SE Asia/Australia ~Mar 16–May 28 → home for a June internship). Used by Alex and his girlfriend, mostly on phones while travelling.

## Commands
- `npm run dev` — local dev (needs `.env.local`, see `.env.example`)
- `npm test` — vitest for `lib/logic.ts`; add a test when changing date, Schengen or budget logic
- `npm run build` — must pass before pushing; Vercel deploys `main`

## Stack and structure
- Next.js App Router, React 19, TypeScript, plain CSS (`app/globals.css`). No UI library; keep it that way unless asked.
- Supabase via `@supabase/supabase-js`, browser-only client in `lib/supabase.ts`. Email magic-link sign-in. Data access is protected by row-level security on `plan_members` (see `supabase/migrations/0001_init.sql`). Schema changes go in a new numbered migration file, never by editing 0001.
- Pure logic lives in `lib/logic.ts`; components stay thin.
- Offline: `public/sw.js` caches the app shell; `TripApp.tsx` keeps the last loaded data in localStorage and disables editing while offline.

## Domain rules
- Booking `type` → filter category: stay → Stays; flight/train/bus → Transport; food → Food; activity → Events; other → Other.
- Budget = plan.budget_usd minus the cost of bookings that are `booked` and `counts_in_budget`. Cost is Alex's own share in USD (group bookings are split).
- Schengen: a day counts when a `schengen` trip covers it and no non-Schengen weekend/travel trip covers it. The chip shows the max over any rolling 180-day window; warn above 80, alert above 90.
- Bookings synced from Gmail have `source = 'gmail'` and ids `gm-<confirmation code>`; don't change that id scheme, the daily sync relies on it to avoid duplicates.

## Design
- Colour tokens are CSS variables on `:root` with a dark-mode override; use tokens, never literal colours in components.
- Fonts: Bricolage Grotesque (display), IBM Plex Sans (body), IBM Plex Mono (dates, codes, money).
- Must work at 390px wide with no sideways scroll, and respect safe-area insets (it runs full-screen on iPhone).

## Don't
- Commit `.env*` files or real booking data (confirmation codes, phone numbers).
- Add server-side secrets to `NEXT_PUBLIC_*` variables.
