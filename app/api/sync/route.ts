/**
 * The daily Gmail sync writes here.
 *
 * A scheduled Claude session reads Gmail, then GETs this route for what the plan already holds and
 * POSTs what it found. It authenticates with a shared secret and writes with the Supabase service
 * key, so both live only in server environment variables, never in NEXT_PUBLIC_*.
 *
 * The route, not the prompt, decides what the sync may touch: it can only insert rows whose id
 * starts with "gm-", and on a row that already exists it may only change the fields in
 * SYNC_UPDATABLE, and only when that row came from the sync in the first place. Anything Alex or
 * his girlfriend typed is therefore safe from it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { MAX_PROCESSED_IDS, normalizeBooking, normalizeTrip, processedIds, rowsOf, SYNC_SOURCE, SyncError, updatableFields } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status });

function authorized(req: Request) {
  const secret = process.env.SYNC_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 16 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

function admin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** This app holds exactly one plan (see 0002_single_plan.sql); refuse to guess if that ever changes. */
async function onlyPlan(sb: SupabaseClient) {
  const { data, error } = await sb.from("plans").select("id,budget_usd").limit(2);
  if (error) throw new SyncError(`Couldn't read the plan: ${error.message}`);
  if (!data || data.length !== 1) throw new SyncError(`Expected exactly one plan, found ${data?.length ?? 0}`);
  return data[0] as { id: string; budget_usd: number };
}

/** What the sync needs in order to dedupe: which emails it has seen, and what the plan already holds. */
export async function GET(req: Request) {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);
  const sb = admin();
  if (!sb) return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 500);
  try {
    const plan = await onlyPlan(sb);
    const [trips, bookings, status] = await Promise.all([
      sb.from("trips").select("id,title,kind,status,start_date,end_date,place,schengen").eq("plan_id", plan.id),
      sb.from("bookings").select("id,title,type,status,date,end_date,trip_id,source").eq("plan_id", plan.id),
      sb.from("sync_status").select("last_run,added,updated,review,last_error,processed_ids").eq("plan_id", plan.id).maybeSingle(),
    ]);
    if (trips.error || bookings.error) return json({ error: trips.error?.message ?? bookings.error?.message }, 500);
    return json({
      plan: { id: plan.id, budget_usd: plan.budget_usd },
      trips: trips.data ?? [],
      bookings: bookings.data ?? [],
      sync: status.data ?? null,
    });
  } catch (e) {
    return json({ error: e instanceof SyncError ? e.message : "Unexpected error" }, 400);
  }
}

/** Takes { trips, bookings, processedIds, lastError } and reports what it actually did. */
export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);
  const sb = admin();
  if (!sb) return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 500);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  try {
    const plan = await onlyPlan(sb);
    const trips = rowsOf(body.trips, "trips").map((t) => normalizeTrip(t, plan.id));
    const bookings = rowsOf(body.bookings, "bookings").map((b) => normalizeBooking(b, plan.id));

    // Trips: only ever created, never changed — dates and names are Alex's to edit.
    let tripsAdded = 0;
    if (trips.length) {
      const { data: have } = await sb.from("trips").select("id").eq("plan_id", plan.id).in("id", trips.map((t) => t.id));
      const known = new Set((have ?? []).map((r) => r.id as string));
      const fresh = trips.filter((t) => !known.has(t.id));
      if (fresh.length) {
        const { error } = await sb.from("trips").insert(fresh);
        if (error) return json({ error: `Couldn't add trips: ${error.message}` }, 500);
        tripsAdded = fresh.length;
      }
    }

    // A booking may be filed under any trip that exists, including ones made by hand; an id that
    // matches nothing is dropped rather than failing the batch, so the booking still lands.
    const { data: allTrips } = await sb.from("trips").select("id").eq("plan_id", plan.id);
    const tripIds = new Set((allTrips ?? []).map((t) => t.id as string));
    let unfiled = 0;
    for (const b of bookings) {
      if (b.trip_id && !tripIds.has(b.trip_id)) {
        b.trip_id = null;
        unfiled++;
      }
    }

    let added = 0;
    let updated = 0;
    let skipped = 0;
    if (bookings.length) {
      const { data: have, error } = await sb
        .from("bookings")
        .select("id,source")
        .eq("plan_id", plan.id)
        .in("id", bookings.map((b) => b.id));
      if (error) return json({ error: `Couldn't read bookings: ${error.message}` }, 500);
      const known = new Map((have ?? []).map((r) => [r.id as string, r.source as string]));

      const fresh = bookings.filter((b) => !known.has(b.id));
      if (fresh.length) {
        const { error: insertError } = await sb.from("bookings").insert(fresh);
        if (insertError) return json({ error: `Couldn't add bookings: ${insertError.message}` }, 500);
        added = fresh.length;
      }

      for (const b of bookings.filter((x) => known.has(x.id))) {
        // Someone took this booking over by hand: leave it exactly as they left it.
        if (known.get(b.id) !== SYNC_SOURCE) {
          skipped++;
          continue;
        }
        const { error: updateError } = await sb
          .from("bookings")
          .update(updatableFields(b))
          .eq("plan_id", plan.id)
          .eq("id", b.id)
          .eq("source", SYNC_SOURCE);
        if (updateError) return json({ error: `Couldn't update ${b.id}: ${updateError.message}` }, 500);
        updated++;
      }
    }

    const { data: previous } = await sb.from("sync_status").select("processed_ids").eq("plan_id", plan.id).maybeSingle();
    const seen = processedIds(previous?.processed_ids, body.processedIds);
    const { error: statusError } = await sb.from("sync_status").upsert(
      {
        plan_id: plan.id,
        last_run: new Date().toISOString(),
        added: added + tripsAdded,
        updated,
        review: bookings.filter((b) => b.status === "review").length,
        last_error: typeof body.lastError === "string" ? body.lastError.slice(0, 500) : "",
        processed_ids: seen,
      },
      { onConflict: "plan_id" },
    );
    if (statusError) return json({ error: `Couldn't record the run: ${statusError.message}` }, 500);

    return json({ added, updated, skipped, tripsAdded, unfiled, review: bookings.filter((b) => b.status === "review").length, remembered: seen.length, limit: MAX_PROCESSED_IDS });
  } catch (e) {
    return json({ error: e instanceof SyncError ? e.message : "Unexpected error" }, 400);
  }
}
