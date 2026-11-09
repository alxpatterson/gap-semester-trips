# Gap Semester Trips: notes for Claude

Shared trip planner PWA for Alex's Jan–May 2027 gap semester (London from Dec 31 → Florence base ~Jan 5–Mar 15 with weekend trips → solo SE Asia/Australia ~Mar 16–May 28 → home for a June internship). Used by Alex and his girlfriend, mostly on phones while travelling.

## Git
- Work on `main`: commit there and push straight to `origin/main`, which Vercel deploys. No feature branches and no pull requests unless Alex asks for one.
- `npm test` and `npm run build` must both pass before every push, since a push is a deploy.

## Commands
- `npm run dev` — local dev (needs `.env.local`, see `.env.example`)
- `npm test` — vitest for `lib/logic.ts`; add a test when changing date, Schengen or budget logic
- `npm run build` — must pass before pushing; Vercel deploys `main`

## Stack and structure
- Next.js App Router, React 19, TypeScript, plain CSS (`app/globals.css`). No UI library; keep it that way unless asked.
- Supabase via `@supabase/supabase-js`, browser-only client in `lib/supabase.ts`. Email + password sign-in (public sign-ups disabled in Supabase; accounts are created in the dashboard). Data access is protected by row-level security on `plan_members` (see `supabase/migrations/0001_init.sql`). Members are `owner`, `editor` or `viewer`: reads go through `is_plan_member`, every write through `can_edit_plan`, so a viewer is blocked server-side as well as in the UI (`canEditPlan` in `lib/logic.ts` gates the controls). Schema changes go in a new numbered migration file, never by editing 0001.
- Pure logic lives in `lib/logic.ts`; components stay thin.
- To-do list: `tasks` table (0006), in the Home sidebar above All trips (the two tabs are Home and Bookings). Bucketed by due date with `taskGroup`; viewers can read it but can't tick anything, same `can_edit_plan` rule as the rest.
- Gmail sync: a daily scheduled Claude session reads Gmail and POSTs to `app/api/sync/route.ts`, which writes with the Supabase service key. The route, not the prompt, is the guard: it only inserts rows whose id starts with `gm-`, and on an existing row changes only `SYNC_UPDATABLE` and only when `source = 'gmail'`, so hand-edited bookings are safe. Needs `SYNC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` set on Vercel (never `NEXT_PUBLIC_*`).
- Offline: `public/sw.js` caches the app shell; `TripApp.tsx` keeps the last loaded data in localStorage and disables editing while offline.

## Scope
- Single-purpose: one plan (the 2027 gap semester), owned by Alex, shared with people he adds under People. Don't add plan creation, onboarding or multi-plan features unless asked.

## Domain rules
- Booking `type` → filter category: stay → Stays; flight/train/bus → Transport; food → Food; activity → Events; other → Other.
- Budget = plan.budget_usd minus the cost of bookings that are `booked` and `counts_in_budget`. Cost is Alex's own share in USD (group bookings are split).
- Schengen: a day counts when a `schengen` trip covers it and no non-Schengen weekend/travel trip covers it. The chip shows the max over any rolling 180-day window; warn above 80, alert above 90.
- Bookings synced from Gmail have `source = 'gmail'` and ids `gm-<confirmation code>`; don't change that id scheme, the daily sync relies on it to avoid duplicates.

## Design
- Colour tokens are CSS variables on `:root` with a dark-mode override; use tokens, never literal colours in components. Warm neutral ground, near-white cards, pastel hues. Pastels are fills only: text on a solid pastel uses `--tint-ink`, text on a translucent wash mixes the hue into `--ink`, and `--link` / `--alert` are the readable versions of the accent and of red. Check contrast before changing any of them.
- Cards carry `--shadow` instead of a border. Radius scale is `--r-sm/--r-md/--r-lg`; nothing is a capsule.
- Every booking row starts with a `TypeTile` (`components/ui.tsx`): a square icon tile tinted by the booking's category.
- Fonts: Plus Jakarta Sans throughout (700/800 for headings, tight tracking); IBM Plex Mono only for confirmation codes. Numbers use `font-variant-numeric: tabular-nums` rather than a mono face.
- Must work at 390px wide with no sideways scroll, and respect safe-area insets (it runs full-screen on iPhone).

## Don't
- Commit `.env*` files or real booking data (confirmation codes, phone numbers).
- Add server-side secrets to `NEXT_PUBLIC_*` variables.
