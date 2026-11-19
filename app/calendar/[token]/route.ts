/**
 * The subscribable calendar feed: /calendar/<token>.ics
 *
 * A calendar app fetches this with no cookie and no sign-in, so the token in the URL is the whole
 * credential. It is 64 random hex characters, it is looked up with an exact match on a unique
 * index, and it can be replaced from Trip settings if it ever leaks. Nothing but the plan it names
 * is readable through it, and only for reading.
 *
 * Reads run with the service key, like /api/sync, because there is no session to go by.
 */
import { createClient } from "@supabase/supabase-js";
import { calendarFeed } from "@/lib/ics";
import type { Booking, Trip } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw ?? "").replace(/\.ics$/i, "");
  // Checked before touching the database, so a junk URL costs nothing.
  if (!/^[0-9a-f]{32,128}$/.test(token)) return text("Not found", 404);

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return text("The calendar feed isn't configured on this server", 500);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const plan = await sb.from("plans").select("id,name").eq("calendar_token", token).maybeSingle();
  if (plan.error) return text("Couldn't read the trip", 500);
  if (!plan.data) return text("Not found", 404);

  const [trips, bookings] = await Promise.all([
    sb.from("trips").select("*").eq("plan_id", plan.data.id),
    sb.from("bookings").select("*").eq("plan_id", plan.data.id),
  ]);
  if (trips.error || bookings.error) return text("Couldn't read the trip", 500);

  const body = calendarFeed({
    plan: plan.data as { id: string; name: string },
    trips: (trips.data ?? []) as Trip[],
    bookings: (bookings.data ?? []) as Booking[],
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Private, so the feed is never held in a shared cache in front of the app.
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename="trip.ics"`,
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
