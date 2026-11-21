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
import { MAX_PROCESSED_IDS, normalizeBooking, normalizeTrip, processedIds, rowsOf, sharedTripFor, SYNC_SOURCE, SyncError, updatableFields, type SharedTrip } from "@/lib/sync";
import type { TripKind } from "@/lib/types";

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

/**
 * Which plan the Gmail sync writes to. Other people have their own plans now, so this must never
 * guess: SYNC_PLAN_ID names it, and the only case left where guessing is safe is a database with
 * exactly one plan in it.
 */
async function syncPlan(sb: SupabaseClient) {
  const pinned = process.env.SYNC_PLAN_ID;
  if (pinned) {
    const { data, error } = await sb.from("plans").select("id,budget_usd").eq("id", pinned).maybeSingle();
    if (error) throw new SyncError(`Couldn't read the plan: ${error.message}`);
    if (!data) throw new SyncError("SYNC_PLAN_ID doesn't match any plan");
    return data as { id: string; budget_usd: number };
  }
  const { data, error } = await sb.from("plans").select("id,budget_usd").limit(2);
  if (error) throw new SyncError(`Couldn't read the plan: ${error.message}`);
  if (!data || data.length !== 1) {
    throw new SyncError(`There are ${data?.length ?? 0} plans — set SYNC_PLAN_ID to say which one the sync writes to`);
  }
  return data[0] as { id: string; budget_usd: number };
}

/**
 * The plans a sync-made row may have moved to: every plan the sync plan's owner belongs to, which
 * includes trips they shared with friends (0010). Looking only there, rather than across every
 * plan, means nobody else's rows can ever be mistaken for the sync's own.
 */
async function ownerPlans(sb: SupabaseClient, planId: string) {
  const { data: owners } = await sb.from("plan_members").select("email").eq("plan_id", planId).eq("role", "owner");
  const emails = (owners ?? []).map((o) => (o.email as string).toLowerCase());
  if (!emails.length) return { mine: [planId], owners: emails, shared: [] as SharedTrip[] };
  const { data } = await sb.from("plan_members").select("plan_id,role").in("email", emails);
  const mine = [...new Set([planId, ...(data ?? []).map((r) => r.plan_id as string)])];

  // Group plans the owner can edit, and their dated trips: where a new booking from Gmail may be
  // filed when it falls during one. plans is read with * so this works before 0010 added `kind`
  // (there are simply no group plans then).
  const editable = (data ?? []).filter((r) => r.role !== "viewer" && r.plan_id !== planId).map((r) => r.plan_id as string);
  let shared: SharedTrip[] = [];
  if (editable.length) {
    const { data: plans } = await sb.from("plans").select("*").in("id", editable);
    const groups = (plans ?? []).filter((p) => p.kind === "group").map((p) => p.id as string);
    if (groups.length) {
      const { data: trips } = await sb.from("trips").select("plan_id,id,title,start_date,end_date,place").in("plan_id", groups);
      shared = (trips ?? []) as SharedTrip[];
    }
  }
  return { mine, owners: emails, shared };
}

/** What the sync needs in order to dedupe: which emails it has seen, and what the plan already holds. */
export async function GET(req: Request) {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);
  const sb = admin();
  if (!sb) return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 500);
  try {
    const plan = await syncPlan(sb);
    const { shared } = await ownerPlans(sb, plan.id);
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
      // Trips shared with friends. A new booking dated during one is filed there automatically,
      // so the sync needn't do anything with these; they're here so it knows they exist.
      sharedTrips: shared,
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
    const plan = await syncPlan(sb);
    const trips = rowsOf(body.trips, "trips").map((t) => normalizeTrip(t, plan.id));
    const { mine, owners, shared } = await ownerPlans(sb, plan.id);
    const bookings = rowsOf(body.bookings, "bookings").map((b) => normalizeBooking(b, plan.id));

    // Trips: only ever created, never changed — dates and names are Alex's to edit.
    let tripsAdded = 0;
    if (trips.length) {
      // Looked up across the owner's plans: a trip shared with friends (0010) now lives in its
      // group plan, and must not be recreated here.
      const { data: have } = await sb.from("trips").select("id").in("plan_id", mine).in("id", trips.map((t) => t.id));
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
    const { data: allTrips } = await sb.from("trips").select("id,kind").eq("plan_id", plan.id);
    const tripKinds = new Map((allTrips ?? []).map((t) => [t.id as string, t.kind as TripKind]));
    let unfiled = 0;
    // A booking that happens during a trip shared with friends goes into that trip's plan, so the
    // others see it too. Only the plan and trip change; whether it is new is decided below exactly
    // as before, and one already in the database stays where it is.
    const toShared = new Set<string>();
    for (const b of bookings) {
      const target = sharedTripFor(b, shared, tripKinds);
      if (target) {
        b.plan_id = target.plan_id;
        b.trip_id = target.id;
        toShared.add(b.id);
      } else if (b.trip_id && !tripKinds.has(b.trip_id)) {
        b.trip_id = null;
        unfiled++;
      }
    }

    let added = 0;
    let sharedAdded = 0;
    let updated = 0;
    let skipped = 0;
    if (bookings.length) {
      // Across the owner's plans, like trips above: a booking moved into a shared trip is still
      // updated where it now lives, rather than being added again to this plan.
      const { data: have, error } = await sb
        .from("bookings")
        .select("id,source,plan_id")
        .in("plan_id", mine)
        .in("id", bookings.map((b) => b.id));
      if (error) return json({ error: `Couldn't read bookings: ${error.message}` }, 500);
      const known = new Map((have ?? []).map((r) => [r.id as string, r.source as string]));
      const home = new Map((have ?? []).map((r) => [r.id as string, r.plan_id as string]));

      const fresh = bookings.filter((b) => !known.has(b.id));
      if (fresh.length) {
        const { error: insertError } = await sb.from("bookings").insert(fresh);
        if (insertError) return json({ error: `Couldn't add bookings: ${insertError.message}` }, 500);
        added = fresh.length;
        // Mark the owner as on each booking filed into a shared trip, so friends can see whose it is.
        // Best effort: a failure here mustn't undo bookings that were saved.
        const onIt = fresh
          .filter((b) => toShared.has(b.id))
          .flatMap((b) => owners.map((email) => ({ plan_id: b.plan_id, booking_id: b.id, email })));
        if (onIt.length) await sb.from("booking_people").upsert(onIt, { onConflict: "plan_id,booking_id,email", ignoreDuplicates: true });
        sharedAdded = fresh.filter((b) => toShared.has(b.id)).length;
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
          .eq("plan_id", home.get(b.id) ?? plan.id)
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

    return json({ added, sharedAdded, updated, skipped, tripsAdded, unfiled, review: bookings.filter((b) => b.status === "review").length, remembered: seen.length, limit: MAX_PROCESSED_IDS });
  } catch (e) {
    return json({ error: e instanceof SyncError ? e.message : "Unexpected error" }, 400);
  }
}
