# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Shared trip planner PWA for Alex's Jan–May 2027 gap semester (London from Dec 31 → Florence base ~Jan 5–Mar 15 with weekend trips → solo SE Asia/Australia ~Mar 16–May 28 → home for a June internship). Used by Alex and his girlfriend, mostly on phones while travelling.

## Git
- Work on `main`: commit there and push straight to `origin/main`, which Vercel deploys. No feature branches and no pull requests unless Alex asks for one.
- `npm test` and `npm run build` must both pass before every push, since a push is a deploy.

## Commands
- `npm run dev` — local dev (needs `.env.local`, see `.env.example`). The service worker only registers in a production build, so test offline with `npm run build && npm start`.
- `npm test` — vitest, three suites: `lib/logic.test.ts` (dates, Schengen, budget, tasks, and `lib/sync.ts`), `lib/ics.test.ts` (the calendar feed) and `lib/social.test.ts` (cost splitting in `lib/split.ts`, exchange rates in `lib/fx.ts`). Add a test when changing date, Schengen or budget logic.
  - one file: `npx vitest run lib/ics.test.ts`
  - one test by name: `npx vitest run -t "ends a stay on the check-out day"`
  - watch while working: `npx vitest`
- `npm run build` — must pass before pushing; Vercel deploys `main`. There is no lint script; `npx tsc --noEmit` is the fast typecheck when you don't need a full build.

## Deploying, and the migration trap
A push to `main` deploys within a minute, but migrations are **not** applied automatically — they are pasted into the Supabase SQL editor by hand. So a change that both reads a new column and ships to production puts the live app ahead of the database, and anything touching that column fails until the SQL is run. This has bitten twice. When adding a column:
- Reads can be made safe by selecting `*` rather than naming columns (this is why `TripApp` loads plans with `select("*")`).
- Writes cannot. A new field in an insert or update breaks saving — and breaks the nightly Gmail sync, which posts the same rows — until the migration lands. Say so prominently when handing over the SQL.

## Stack and structure
- Next.js App Router, React 19, TypeScript, plain CSS (`app/globals.css`). No UI library; keep it that way unless asked.
- Supabase via `@supabase/supabase-js`, browser-only client in `lib/supabase.ts`. Email + password sign-in, open sign-up (enable it in Supabase → Authentication → Sign In / Providers); an account with no plan lands on `Onboarding`. Data access is protected by row-level security on `plan_members` (see `supabase/migrations/0001_init.sql`). Members are `owner`, `editor` or `viewer`: reads go through `is_plan_member`, every write through `can_edit_plan`, so a viewer is blocked server-side as well as in the UI (`canEditPlan` in `lib/logic.ts` gates the controls). Schema changes go in a new numbered migration file, never by editing 0001.
- Pure logic lives in `lib/logic.ts`; components stay thin. `lib/ics.ts` (calendar output) and `lib/sync.ts` (the shapes and guards the Gmail sync must satisfy) are pure too, and both are unit-tested — `lib/ics.ts` runs on the server for the feed and in the browser for the per-booking button, so it must not use Node-only APIs (`TextEncoder`, not `Buffer`).
- `TripApp.tsx` is the one stateful component. Everything modal goes through a single `View` union (`trip` | `booking` | `trip-form` | `booking-form` | `people` | null) rendered into one `Sheet`; add a case there rather than a new overlay. It also subscribes to a Supabase realtime channel per plan (`plan-${planId}`) covering `trips`, `bookings`, `tasks` and `sync_status`, and reloads the lot on any change, so a tick on one phone appears on the other — a new table needs `alter publication supabase_realtime add table …` in its migration to behave the same way. The same effect reloads on reconnect and when the tab becomes visible, which is why you'll see repeat fetches while debugging.
- Offline/cache keys in localStorage: `gst:plan` and `gst:role` remember the last plan and the member's role so the UI can render before the network answers; `gst:cache:<planId>` holds the last loaded data; `gst:fx` holds the last exchange rates and when they were fetched. All reads are wrapped in try/catch because a PWA in private mode can throw.
- Doing trips with friends (0010, `components/Social.tsx`): a shared trip is its own plan with `plans.kind = 'group'`. "Share this trip" calls `share_trip()`, which creates the group plan and moves the trip and everything filed under it (bookings, tasks, `trip_notes`, `expenses`) into it, so the existing membership rules cover it unchanged. A personal plan also loads trips from the person's group plans (`sharedTrips`) for the calendar, the trip list and the Schengen count; those open read-only with a button to switch plans. Other tables: `profiles` (display name and pay handle, keyed by email), `booking_people` (who is on a booking) and `tasks.assignee`. Everything social hides itself when `expenses` can't be read, so the app behaves as before until the migration has run. The 0010 tables use a second realtime channel, `plan-${planId}-social`, opened only once they're known to exist.
- Splitting costs: `expenses` holds expenses and settlements in one table, with `shares` as JSON that a trigger checks adds up to `amount`. All the arithmetic is in `lib/split.ts`, done in whole cents and kept per currency: balances are never converted. `/api/fx` serves exchange rates (open.er-api.com, falling back to Frankfurter), cached for six hours; the app uses them only for "≈" totals. The Gmail sync looks up `gm-` rows across all of its owner's plans, so a booking moved into a shared trip is updated where it now lives rather than added again. A *new* booking dated during a shared trip the owner can edit is filed straight into it (`sharedTripFor` in `lib/sync.ts`): it takes the day it happens, or for a journey the day it lands, and the shortest covering trip wins. It overrides no trip or the base, but never another trip someone picked. The owner is added to `booking_people`. Existing bookings are never moved.
- To-do list: `tasks` table (0006), in the Home sidebar above All trips (the two tabs are Home and Bookings). Bucketed by due date with `taskGroup`; viewers can read it but can't tick anything, same `can_edit_plan` rule as the rest.
- Gmail sync: a daily scheduled Claude session reads Gmail and POSTs to `app/api/sync/route.ts`, which writes with the Supabase service key. The route, not the prompt, is the guard: it only inserts rows whose id starts with `gm-`, and on an existing row changes only `SYNC_UPDATABLE` and only when `source = 'gmail'`, so hand-edited bookings are safe. Needs `SYNC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` set on Vercel (never `NEXT_PUBLIC_*`). The prompt that drives it is **not in this repo** — it is a Claude scheduled task ("Trip app Gmail sync") bound to one session, so changing the booking fields the sync should populate means editing that task's prompt as well as the code.
- Calendar feed: `app/calendar/[token]/route.ts` serves a plan as iCalendar at `/calendar/<token>.ics`, built by `lib/ics.ts`, so it can be subscribed to from Google Calendar, Apple Calendar or Outlook. It reads with the same service key as the sync, so it needs no new environment variable. The token is `plans.calendar_token` (0008): 64 random characters, the feed's only credential, not writable through the API (column-level grants) and replaced by `rotate_calendar_token`. Times are *floating* — a booking's `time` is text and the app never records a zone, so pinning one would be a guess. Every member can see the link; editors and the owner can replace it.
- Google refreshes a subscribed URL only every 8–24 hours and ignores `REFRESH-INTERVAL`, so each booking also has an "Add to calendar" button (`AddToCalendar` in `components/ui.tsx`) that builds a one-event file in the browser for anything imminent.
- Offline: `public/sw.js` caches the app shell; `TripApp.tsx` keeps the last loaded data in localStorage and disables editing while offline.

## Scope
- Multi-tenant since 0007: anyone can make an account, and an invite code (`invite_codes`, redeemed by `create_plan_with_invite`) buys one trip of their own. A person owns at most one plan but can be a member of others' — the header shows a picker only when they belong to more than one.
- Nothing about one trip is hardcoded any more: dates, budget and currency are columns on `plans`, edited under Trip settings. The Schengen chip isn't a setting — it appears by itself once any trip on the plan is marked `schengen`, so a trip outside Europe never shows it. (`plans.track_schengen` survives from 0007 and is unused.) `planRange()` falls back to a year around today when a plan has no dates. Keep it that way — no Florence, no 2027, no USD in the code.
- The Gmail sync is Alex's alone: it reaches the app through `/api/sync` with a shared secret and writes to the plan named by `SYNC_PLAN_ID` (required once more than one plan exists). Friends have no sync.

## Domain rules
- Booking `type` → filter category: stay → Stays; flight/train/bus → Transport; food → Food; activity → Events; other → Other.
- A booking's `end_date` means "the day this ends": check-out for a stay, the landing day for an overnight journey, the last day of a multi-day event otherwise. `arrive_time` (0009) is only asked for on flight/train/bus; with it the calendar feed gives the event its real length, and without it falls back to a two-hour guess. An arrival no later than the departure, with no `end_date`, is read as landing the next morning.
- Budget = plan.budget_usd minus the cost of bookings that are `booked` and `counts_in_budget`. Cost is Alex's own share in USD (group bookings are split).
- Schengen: a day counts when a `schengen` trip covers it and no non-Schengen weekend/travel trip covers it. The chip shows the max over any rolling 180-day window; warn above 80, alert above 90.
- Bookings synced from Gmail have `source = 'gmail'` and ids `gm-<confirmation code>`; don't change that id scheme, the daily sync relies on it to avoid duplicates.

## Design
- Colour tokens are CSS variables on `:root` with a dark-mode override; use tokens, never literal colours in components. Warm neutral ground, near-white cards, pastel hues. Pastels are fills only: text on a solid pastel uses `--tint-ink`, text on a translucent wash mixes the hue into `--ink`, and `--link` / `--alert` are the readable versions of the accent and of red. Check contrast before changing any of them.
- Cards carry `--shadow` instead of a border. Radius scale is `--r-sm/--r-md/--r-lg`; nothing is a capsule.
- Every booking row starts with a `TypeTile` (`components/ui.tsx`): a square icon tile tinted by the booking's category.
- Fonts: Plus Jakarta Sans throughout (700/800 for headings, tight tracking); IBM Plex Mono only for confirmation codes. Numbers use `font-variant-numeric: tabular-nums` rather than a mono face.
- Must work at 390px wide with no sideways scroll, and respect safe-area insets (it runs full-screen on iPhone).

## README
`README.md` is the setup guide, and it predates 0007 — it still says there is exactly one plan, that sign-ups are off, and that a stranger sees a "private" message. All three are wrong now. Don't take it as a description of current behaviour, and don't copy from it.

## Don't
- Commit `.env*` files or real booking data (confirmation codes, phone numbers).
- Add server-side secrets to `NEXT_PUBLIC_*` variables.
