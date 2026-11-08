# Gap Semester Trips

A shared trip planner for the January–May 2027 gap semester: a trip calendar, bookings sorted into Stays / Transport / Food / Events, a running budget, and a Schengen 90/180 day counter. It installs on a phone as an app and opens offline.

**Stack:** Next.js (App Router) · Supabase (Postgres, email sign-in, live updates) · Vercel hosting. New bookings arrive automatically from a daily Claude scheduled task that reads Gmail confirmations and writes them into Supabase.

---

## 1. Set up Supabase (about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com). Pick a region near you; save the database password somewhere safe.
2. **SQL Editor → New query**: paste all of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and run it. This creates the tables, sharing rules and live updates.
3. **Authentication → Sign In / Providers**: make sure **Email** is enabled (it is by default).
4. Copy the **Project URL** (just `https://<ref>.supabase.co`, without `/rest/v1/`) and the **publishable** key (`sb_publishable_…`; on older projects it's the **anon public** key). You need both in step 2.

## 2. Deploy to Vercel

1. At [vercel.com/new](https://vercel.com/new), import `alxpatterson/gap-semester-trips`.
2. Before deploying, add two **Environment Variables** (from step 1.4):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy. Note your site address (for example `gap-semester-trips.vercel.app`).
4. Back in Supabase → **Authentication → URL Configuration**:
   - **Site URL**: your Vercel address, e.g. `https://gap-semester-trips.vercel.app`
   - **Redirect URLs**: add the same address, plus `http://localhost:3000` for local development.

## 3. First sign-in

This app holds exactly one plan, the 2027 gap semester. It is created once in the SQL Editor (not from the app) with Alex as its owner, and `0002_single_plan.sql` removes any way to create another.

1. Open the site, enter your email, and click the link that arrives. You land straight in the plan.
2. Open **People** and add your girlfriend's email. She signs in with that email and sees the same plan; changes show up for both of you live.

Anyone else who signs in sees a "This planner is private" message and no data.

## 4. Put it on your phone

- **iPhone:** open the site in Safari → **Share** → **Add to Home Screen**. Sign in from Safari first.
- **Android:** Chrome offers **Install app**, or use the menu → **Add to Home screen**.

Once installed, the app opens full screen and shows your last-loaded trips and bookings even with no signal. Editing comes back when you reconnect.

## 5. Gmail sync

The daily Claude scheduled task currently writes to the Claude artifact version of this app. To move it here:

1. In claude.ai, connect the **Supabase** connector.
2. Ask Claude to copy your existing trips and bookings into this Supabase project and point the "Trip app Gmail sync" task at it.

The task inserts rows into `trips` and `bookings` (booking ids are `gm-<confirmation code>` so nothing duplicates) and updates `sync_status`, which drives the "Gmail synced" chip.

---

## Local development

```bash
cp .env.example .env.local   # fill in the two Supabase values
npm install
npm run dev                  # http://localhost:3000
npm test                     # logic tests (Schengen, budget, dates)
npm run build                # what Vercel runs
```

The offline service worker only registers in production builds (`npm run build && npm start`).

## How it's organized

| Path | What it is |
| --- | --- |
| `app/` | Layout, page, web app manifest, global styles and colour tokens |
| `components/TripApp.tsx` | Sign-in, plan loading, data, live updates, offline copy, sheets |
| `components/Calendar.tsx` | Month grid and trip list |
| `components/Bookings.tsx` | Booking tickets with type and status filters |
| `components/BudgetPanel.tsx` | Budget left, split by category |
| `components/Forms.tsx`, `Details.tsx` | Add/edit forms and detail sheets |
| `lib/logic.ts` | Pure functions: dates, Schengen count, budget, categories (tested in `logic.test.ts`) |
| `supabase/migrations/` | Database schema and row-level security |
| `public/sw.js` | Offline support |

### Data model

- **plans** — one shared plan, with `budget_usd` (default 10,000) and a note shown beside it.
- **plan_members** — emails allowed into a plan. Row-level security checks the signed-in email against this list.
- **trips** — `kind` (base / weekend / travel / other), `status` (idea / planned / booked), dates, place, `schengen`.
- **bookings** — `type` maps to the filter categories: `stay` → Stays; `flight`, `train`, `bus` → Transport; `food` → Food; `activity` → Events. `cost` is your own share in USD; `counts_in_budget` excludes things like Florence rent.
- **sync_status** — last Gmail sync run, counts and any error.
