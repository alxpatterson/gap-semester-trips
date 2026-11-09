"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { initialAnchor, localToday, maxSchengenWindow, MONTHS, type CalView } from "@/lib/logic";
import type { Booking, Category, Plan, SyncStatus, Trip } from "@/lib/types";
import BudgetPanel from "./BudgetPanel";
import Bookings, { type CategoryFilter, type StatusFilter } from "./Bookings";
import { CalendarPanel, TripRail } from "./Calendar";
import { BookingDetail, TripDetail } from "./Details";
import { BookingForm, TripForm, type BookingInput, type TripInput } from "./Forms";
import InstallHint from "./InstallHint";
import { NotInvited, RecoveryScreen, SetPassword, SetupNeeded, SignIn } from "./SignIn";
import { Sheet, useToast } from "./ui";

type View =
  | { kind: "trip"; id: string }
  | { kind: "booking"; id: string }
  | { kind: "trip-form"; trip?: Partial<Trip> }
  | { kind: "booking-form"; booking?: Partial<Booking> }
  | { kind: "people" }
  | null;

type Cache = { plan: Plan; trips: Trip[]; bookings: Booking[]; sync: SyncStatus | null; savedAt: string };

const cacheKey = (planId: string) => `gst:cache:${planId}`;
const readCache = (planId: string): Cache | null => {
  try {
    const raw = localStorage.getItem(cacheKey(planId));
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
};
const writeCache = (c: Cache) => {
  try {
    localStorage.setItem(cacheKey(c.plan.id), JSON.stringify(c));
  } catch {}
};

export default function TripApp() {
  const [sb, setSb] = useState<SupabaseClient | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const client = getSupabase();
    setSb(client);
    if (!client) return;
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (sb === undefined || session === undefined) return null;
  if (sb === null) return <SetupNeeded />;
  if (!session) return <SignIn sb={sb} />;
  if (recovering) return <RecoveryScreen sb={sb} onDone={() => setRecovering(false)} />;
  return <PlanLoader sb={sb} email={session.user.email ?? ""} />;
}

function PlanLoader({ sb, email }: { sb: SupabaseClient; email: string }) {
  const [planId, setPlanId] = useState<string | null | undefined>(() => {
    try {
      return localStorage.getItem("gst:plan") || undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    let cancelled = false;
    sb.from("plan_members")
      .select("plan_id")
      .ilike("email", email)
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return; // Offline: keep the cached plan id, if any.
        const id = data?.[0]?.plan_id ?? null;
        setPlanId(id);
        try {
          if (id) localStorage.setItem("gst:plan", id);
          else localStorage.removeItem("gst:plan");
        } catch {}
      });
    return () => {
      cancelled = true;
    };
  }, [sb, email]);

  if (planId === undefined) return null;
  if (planId === null) return <NotInvited sb={sb} email={email} />;
  return <PlanView sb={sb} planId={planId} email={email} />;
}

function PlanView({ sb, planId, email }: { sb: SupabaseClient; planId: string; email: string }) {
  const cached = useMemo(() => readCache(planId), [planId]);
  const [plan, setPlan] = useState<Plan | null>(cached?.plan ?? null);
  const [trips, setTrips] = useState<Trip[]>(cached?.trips ?? []);
  const [bookings, setBookings] = useState<Booking[]>(cached?.bookings ?? []);
  const [sync, setSync] = useState<SyncStatus | null>(cached?.sync ?? null);
  const [loaded, setLoaded] = useState(!!cached);
  const [stale, setStale] = useState<string | null>(null); // savedAt of the offline copy being shown
  const [online, setOnline] = useState(true);

  const today = localToday();
  const [tab, setTab] = useState<"cal" | "book">("cal");
  const [calView, setCalView] = useState<CalView>("month");
  const [anchor, setAnchor] = useState(() => initialAnchor(today));
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [view, setView] = useState<View>(null);
  const [saving, setSaving] = useState(false);
  const { toast, node: toastNode } = useToast();

  const load = useCallback(async () => {
    const [p, t, b, s] = await Promise.all([
      sb.from("plans").select("id,name,budget_usd,budget_note").eq("id", planId).single(),
      sb.from("trips").select("*").eq("plan_id", planId),
      sb.from("bookings").select("*").eq("plan_id", planId),
      sb.from("sync_status").select("plan_id,last_run,added,updated,review,last_error").eq("plan_id", planId).maybeSingle(),
    ]);
    if (p.error || t.error || b.error) {
      setStale(readCache(planId)?.savedAt ?? null);
      setLoaded(true);
      return;
    }
    const next: Cache = {
      plan: p.data as Plan,
      trips: (t.data ?? []) as Trip[],
      bookings: ((b.data ?? []) as Booking[]).map((x) => ({ ...x, cost: Number(x.cost) || 0 })),
      sync: (s.data as SyncStatus | null) ?? null,
      savedAt: new Date().toISOString(),
    };
    setPlan(next.plan);
    setTrips(next.trips);
    setBookings(next.bookings);
    setSync(next.sync);
    setStale(null);
    setLoaded(true);
    writeCache(next);
  }, [sb, planId]);

  // Initial load, live updates from Supabase (your edits, your girlfriend's, and the Gmail sync), and refresh on reconnect.
  useEffect(() => {
    load();
    const channel = sb
      .channel(`plan-${planId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trips", filter: `plan_id=eq.${planId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `plan_id=eq.${planId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_status", filter: `plan_id=eq.${planId}` }, () => load())
      .subscribe();
    const goOnline = () => {
      setOnline(true);
      load();
    };
    const goOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      sb.removeChannel(channel);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sb, planId, load]);

  const canEdit = online && !stale;
  const schengen = maxSchengenWindow(trips);

  // ---------- Writes ----------
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setSaving(true);
    const { error } = await fn();
    setSaving(false);
    if (error) {
      toast(online ? `Couldn't save: ${error.message}` : "You're offline, so changes can't be saved");
      return false;
    }
    toast(ok);
    await load();
    return true;
  };

  const saveTrip = async (data: TripInput, id?: string) => {
    const done = await run(
      () => (id ? sb.from("trips").update(data).eq("plan_id", planId).eq("id", id) : sb.from("trips").insert({ ...data, plan_id: planId, id: crypto.randomUUID() })),
      id ? "Trip saved" : "Trip added",
    );
    if (!done) return;
    if (data.start_date) setAnchor(data.start_date);
    setView(id ? { kind: "trip", id } : null);
  };

  const saveBooking = async (data: BookingInput, id?: string) => {
    const done = await run(
      () => (id ? sb.from("bookings").update(data).eq("plan_id", planId).eq("id", id) : sb.from("bookings").insert({ ...data, plan_id: planId, id: crypto.randomUUID() })),
      id ? "Booking saved" : "Booking added",
    );
    if (done) setView(id ? { kind: "booking", id } : null);
  };

  const remove = async (table: "trips" | "bookings", id: string) => {
    if (await run(() => sb.from(table).delete().eq("plan_id", planId).eq("id", id), "Deleted")) setView(null);
  };

  const pickCategory = (c: Category) => {
    setCategory(c);
    setTab("book");
  };

  // ---------- Sync chip ----------
  let syncChip: React.ReactNode = null;
  if (sync?.last_run) {
    const t = new Date(sync.last_run);
    const isStale = Date.now() - t.getTime() > 3 * 864e5;
    const cls = sync.last_error ? "bad" : isStale || sync.review > 0 ? "warn" : "";
    const title = sync.last_error
      ? `Last sync had a problem: ${sync.last_error}`
      : `Last sync added ${sync.added}, updated ${sync.updated}${sync.review ? `, ${sync.review} to check` : ""}. Runs daily.`;
    syncChip = (
      <span className={`chip ${cls}`} title={title}>
        <span className="dot" />
        Gmail synced {MONTHS[t.getMonth()]} {t.getDate()}
      </span>
    );
  }

  // ---------- Sheet contents ----------
  let sheet: React.ReactNode = null;
  if (view?.kind === "trip") {
    const trip = trips.find((t) => t.id === view.id);
    if (trip)
      sheet = (
        <Sheet title={trip.title} onClose={() => setView(null)}>
          <TripDetail
            trip={trip}
            bookings={bookings}
            canEdit={canEdit}
            onOpenBooking={(id) => setView({ kind: "booking", id })}
            onAddBooking={() => setView({ kind: "booking-form", booking: { trip_id: trip.id, date: trip.start_date } })}
            onEdit={() => setView({ kind: "trip-form", trip })}
            onDelete={() => remove("trips", trip.id)}
          />
        </Sheet>
      );
  } else if (view?.kind === "booking") {
    const booking = bookings.find((b) => b.id === view.id);
    if (booking)
      sheet = (
        <Sheet title={booking.title} onClose={() => setView(null)}>
          <BookingDetail
            booking={booking}
            trip={trips.find((t) => t.id === booking.trip_id)}
            canEdit={canEdit}
            toast={toast}
            onEdit={() => setView({ kind: "booking-form", booking })}
            onDelete={() => remove("bookings", booking.id)}
          />
        </Sheet>
      );
  } else if (view?.kind === "trip-form") {
    sheet = (
      <Sheet title={view.trip?.id ? "Edit trip" : "New trip"} onClose={() => setView(null)}>
        <TripForm trip={view.trip} saving={saving} onSave={(d) => saveTrip(d, view.trip?.id)} onCancel={() => setView(view.trip?.id ? { kind: "trip", id: view.trip.id } : null)} />
      </Sheet>
    );
  } else if (view?.kind === "booking-form") {
    sheet = (
      <Sheet title={view.booking?.id ? "Edit booking" : "New booking"} onClose={() => setView(null)}>
        <BookingForm
          booking={view.booking}
          trips={trips}
          saving={saving}
          onSave={(d) => saveBooking(d, view.booking?.id)}
          onCancel={() => setView(view.booking?.id ? { kind: "booking", id: view.booking.id } : null)}
        />
      </Sheet>
    );
  } else if (view?.kind === "people") {
    sheet = (
      <Sheet title="People" onClose={() => setView(null)}>
        <People sb={sb} planId={planId} email={email} toast={toast} />
      </Sheet>
    );
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>{plan?.name || "Winter 2027"}</h1>
        </div>
        <div className="chips">
          {syncChip}
          <span className={`chip ${schengen > 90 ? "bad" : schengen > 80 ? "warn" : ""}`} title="Most planned days inside the Schengen area in any 180-day window (limit 90)">
            <span className="dot" />
            Schengen <b>{loaded ? schengen : "–"}</b> / 90 days
          </span>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "cal"} onClick={() => setTab("cal")}>
            Calendar
          </button>
          <button role="tab" aria-selected={tab === "book"} onClick={() => setTab("book")}>
            Bookings
          </button>
        </div>
        <div className="actions">
          {canEdit && (
            <button className="btn primary" onClick={() => setView({ kind: "trip-form" })}>
              + Trip
            </button>
          )}
          <button className="btn" onClick={() => setView({ kind: "people" })}>
            People
          </button>
        </div>
      </header>

      <InstallHint />
      {(stale || !online) && (
        <div className="banner">
          You&apos;re offline. Showing the copy saved {stale ? new Date(stale).toLocaleString() : "earlier"}; editing comes back when you reconnect.
        </div>
      )}

      {plan && <BudgetPanel plan={plan} bookings={bookings} loaded={loaded} onPickCategory={pickCategory} />}

      {tab === "cal" ? (
        <section className="cal-layout">
          <CalendarPanel
            view={calView}
            anchor={anchor}
            trips={trips}
            bookings={bookings}
            loaded={loaded}
            today={today}
            onView={setCalView}
            onAnchor={setAnchor}
            onTrip={(id) => setView({ kind: "trip", id })}
            onBooking={(id) => setView({ kind: "booking", id })}
          />
          <TripRail trips={trips} bookings={bookings} loaded={loaded} today={today} onTrip={(id) => setView({ kind: "trip", id })} />
        </section>
      ) : (
        <Bookings
          bookings={bookings}
          trips={trips}
          loaded={loaded}
          category={category}
          status={status}
          canEdit={canEdit}
          onCategory={setCategory}
          onStatus={setStatus}
          onAdd={() => setView({ kind: "booking-form" })}
          onOpen={(id) => setView({ kind: "booking", id })}
          toast={toast}
        />
      )}

      {sheet}
      {toastNode}
    </div>
  );
}

function People({ sb, planId, email, toast }: { sb: SupabaseClient; planId: string; email: string; toast: (m: string) => void }) {
  const [members, setMembers] = useState<{ email: string; role: string }[] | null>(null);
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    const { data } = await sb.from("plan_members").select("email,role").eq("plan_id", planId).order("added_at");
    setMembers(data ?? []);
  }, [sb, planId]);
  useEffect(() => {
    load();
  }, [load]);

  const isOwner = members?.some((m) => m.role === "owner" && m.email.toLowerCase() === email.toLowerCase());

  return (
    <>
      <p className="empty" style={{ padding: 0 }}>
        Everyone here can see and edit this plan. Each person also needs an account with a password, created in Supabase → Authentication →
        Users → Add user.
      </p>
      <ul className="people">
        {members === null && <li>Loading…</li>}
        {members?.map((m) => (
          <li key={m.email}>
            <span>{m.email}</span>
            <span className="pill idea">{m.role}</span>
          </li>
        ))}
      </ul>
      {isOwner && (
        <form
          className="f"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const { error } = await sb.rpc("add_plan_member", { p: planId, member_email: invite });
            setBusy(false);
            if (error) return toast(`Couldn't add: ${error.message}`);
            toast(`Added ${invite}`);
            setInvite("");
            load();
          }}
        >
          <label>
            Add someone by email
            <input id="invite-email" type="email" required value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? "Adding…" : "Add to plan"}
          </button>
        </form>
      )}
      <div className="section-t">Signed in as</div>
      <div className="row-actions">
        <span>{email}</span>
        {!changing && (
          <button className="btn small" onClick={() => setChanging(true)}>
            Change password
          </button>
        )}
        <button className="btn small" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </div>
      {changing && (
        <SetPassword
          sb={sb}
          onDone={() => {
            setChanging(false);
            toast("Password changed");
          }}
          onCancel={() => setChanging(false)}
        />
      )}
    </>
  );
}
