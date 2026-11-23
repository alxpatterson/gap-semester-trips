"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { canEditPlan, fmtRange, initialAnchor, localToday, money, MONTHS, planRange, type CalView } from "@/lib/logic";
import { countryVisits } from "@/lib/places";
import type { Booking, BookingPerson, Category, CountryMark, Expense, MarkKind, Member, MemberRole, Plan, PlanKind, Profile, SyncStatus, Task, Trip, TripNote } from "@/lib/types";
import { nameOf } from "@/lib/split";
import BudgetPanel, { BudgetChip } from "./BudgetPanel";
import CalendarFeed from "./CalendarFeed";
import Bookings, { type CategoryFilter, type StatusFilter } from "./Bookings";
import Tasks from "./Tasks";
import { CalendarPanel, TripRail } from "./Calendar";
import { BookingDetail, TripDetail } from "./Details";
import { BookingForm, PlanForm, TripForm, type BookingInput, type PlanInput, type TripInput } from "./Forms";
import InstallHint from "./InstallHint";
import MapTab from "./MapTab";
import { Onboarding, RecoveryScreen, SetPassword, SetupNeeded, SignIn } from "./SignIn";
import { Balances, BookingPeople, ExpenseDetail, ExpenseForm, ProfileForm, TripSocial, type ExpenseInput } from "./Social";
import { Sheet, useToast } from "./ui";

type View =
  | { kind: "trip"; id: string }
  | { kind: "booking"; id: string }
  | { kind: "trip-form"; trip?: Partial<Trip> }
  | { kind: "booking-form"; booking?: Partial<Booking> }
  | { kind: "people" }
  | { kind: "country"; code: string }
  | { kind: "new-plan" }
  | { kind: "expense"; id: string }
  | { kind: "expense-form"; expense?: Partial<Expense> }
  | null;

/** Everything for doing a trip with friends (0010). Absent from caches saved before it existed. */
type Social = {
  on: boolean; // false until the 0010 tables exist, which hides every control that would write to them
  members: Member[];
  profiles: Profile[];
  expenses: Expense[];
  people: BookingPerson[];
  notes: TripNote[];
  sharedTrips: Trip[]; // trips from group plans you're on, shown on your own calendar
};
const NO_SOCIAL: Social = { on: false, members: [], profiles: [], expenses: [], people: [], notes: [], sharedTrips: [] };

/** Countries marked by hand (0012). Like the social tables, off until the migration has run. */
type Marks = { on: boolean; rows: CountryMark[] };
const NO_MARKS: Marks = { on: false, rows: [] };

/** Which trips the map counts: just this one, or every trip this person is on. */
export type MapScope = "plan" | "all";

/** Trips and marks from every trip you're on, which is what the map's All view counts. */
type Everywhere = { trips: Trip[]; marks: CountryMark[] };
const NOWHERE: Everywhere = { trips: [], marks: [] };

type Cache = {
  plan: Plan;
  trips: Trip[];
  bookings: Booking[];
  tasks: Task[];
  sync: SyncStatus | null;
  social?: Social;
  marks?: Marks;
  everywhere?: Everywhere;
  savedAt: string;
};
type Membership = { plan_id: string; role: MemberRole; name: string; kind: PlanKind };

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
  const [role, setRole] = useState<MemberRole | null>(() => {
    try {
      return (localStorage.getItem("gst:role") as MemberRole | null) ?? null;
    } catch {
      return null;
    }
  });
  // Someone can own one trip and be a guest on a friend's, so keep the whole list for the picker.
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    sb.from("plan_members")
      // plans(*) rather than naming columns, so this works before and after 0010 added `kind`.
      .select("plan_id,role,plans(*)")
      .ilike("email", email)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return; // Offline: keep the cached plan id and role, if any.
        const rows: Membership[] = (data ?? []).map((r) => {
          const p = r.plans as { name?: string; kind?: PlanKind } | null;
          return { plan_id: r.plan_id as string, role: r.role as MemberRole, name: p?.name ?? "Trip", kind: p?.kind ?? "personal" };
        });
        // Your own trip first, so that's what opens; then other people's; shared trips last.
        const rank = (m: Membership) => (m.kind === "group" ? 2 : m.role === "owner" ? 0 : 1);
        rows.sort((a, b) => rank(a) - rank(b));
        setMemberships(rows);
        let chosen = rows.find((r) => r.plan_id === localStorage.getItem("gst:plan")) ?? rows[0];
        setPlanId(chosen?.plan_id ?? null);
        setRole(chosen?.role ?? null);
        try {
          if (chosen) {
            localStorage.setItem("gst:plan", chosen.plan_id);
            localStorage.setItem("gst:role", chosen.role);
          } else {
            localStorage.removeItem("gst:plan");
            localStorage.removeItem("gst:role");
          }
        } catch {}
      });
    return () => {
      cancelled = true;
    };
  }, [sb, email, reload]);

  const pick = (id: string) => {
    const m = memberships.find((x) => x.plan_id === id);
    if (!m) return;
    setPlanId(m.plan_id);
    setRole(m.role);
    try {
      localStorage.setItem("gst:plan", m.plan_id);
      localStorage.setItem("gst:role", m.role);
    } catch {}
  };

  if (planId === undefined) return null;
  if (planId === null) return <Onboarding sb={sb} email={email} onCreated={() => setReload((n) => n + 1)} />;
  // After a trip is shared: remember the new plan as the one to open, then reload the list.
  const plansChanged = (openId: string) => {
    try {
      localStorage.setItem("gst:plan", openId);
    } catch {}
    setReload((n) => n + 1);
  };
  return <PlanView sb={sb} planId={planId} email={email} role={role} memberships={memberships} onPickPlan={pick} onPlansChanged={plansChanged} />;
}

function PlanView({
  sb,
  planId,
  email,
  role,
  memberships,
  onPickPlan,
  onPlansChanged,
}: {
  sb: SupabaseClient;
  planId: string;
  email: string;
  role: MemberRole | null;
  memberships: Membership[];
  onPickPlan: (id: string) => void;
  onPlansChanged: (openId: string) => void;
}) {
  const cached = useMemo(() => readCache(planId), [planId]);
  const [plan, setPlan] = useState<Plan | null>(cached?.plan ?? null);
  const [trips, setTrips] = useState<Trip[]>(cached?.trips ?? []);
  const [bookings, setBookings] = useState<Booking[]>(cached?.bookings ?? []);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks ?? []);
  const [sync, setSync] = useState<SyncStatus | null>(cached?.sync ?? null);
  const [social, setSocial] = useState<Social>(cached?.social ?? NO_SOCIAL);
  const [marks, setMarks] = useState<Marks>(cached?.marks ?? NO_MARKS);
  const [everywhere, setEverywhere] = useState<Everywhere>(cached?.everywhere ?? NOWHERE);
  const [loaded, setLoaded] = useState(!!cached);
  const [stale, setStale] = useState<string | null>(null); // savedAt of the offline copy being shown
  const [online, setOnline] = useState(true);

  const today = localToday();
  const [tab, setTab] = useState<"home" | "map" | "book">("home");
  const [calView, setCalView] = useState<CalView>("month");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [view, setView] = useState<View>(null);
  const [saving, setSaving] = useState(false);
  const { toast, node: toastNode } = useToast();

  // Group plans to pull trips from — only onto a personal plan, never from a group plan into another.
  const groupIds = useMemo(
    () => memberships.filter((m) => m.kind === "group" && m.plan_id !== planId).map((m) => m.plan_id),
    [memberships, planId],
  );
  const groupKey = groupIds.join(",");
  // Every trip this person is on, their own and other people's — the map can count across them all.
  const everyKey = useMemo(() => memberships.map((m) => m.plan_id).sort().join(","), [memberships]);

  const load = useCallback(async () => {
    const [p, t, b, k, s, social, cm, every] = await Promise.all([
      // Every column, rather than a list: the calendar token arrived in 0008, and naming a column
      // the database doesn't have yet would fail the whole load on a deploy that got there first.
      sb.from("plans").select("*").eq("id", planId).single(),
      sb.from("trips").select("*").eq("plan_id", planId),
      sb.from("bookings").select("*").eq("plan_id", planId),
      sb.from("tasks").select("*").eq("plan_id", planId),
      sb.from("sync_status").select("plan_id,last_run,added,updated,review,last_error").eq("plan_id", planId).maybeSingle(),
      loadSocial(sb, planId, groupKey ? groupKey.split(",") : []),
      // Tolerated missing, like the social tables: no table, no marking buttons, same map as before.
      sb.from("country_marks").select("*").eq("plan_id", planId),
      loadEverywhere(sb, everyKey ? everyKey.split(",") : [planId]),
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
      tasks: (k.data ?? []) as Task[],
      sync: (s.data as SyncStatus | null) ?? null,
      social,
      marks: { on: !cm.error, rows: (cm.data ?? []) as CountryMark[] },
      everywhere: every,
      savedAt: new Date().toISOString(),
    };
    setPlan(next.plan);
    setTrips(next.trips);
    setBookings(next.bookings);
    setTasks(next.tasks);
    setSync(next.sync);
    setSocial(social);
    setMarks(next.marks!);
    setEverywhere(every);
    setStale(null);
    setLoaded(true);
    writeCache(next);
  }, [sb, planId, groupKey, everyKey]);

  // Initial load, live updates from Supabase (your edits, your girlfriend's, and the Gmail sync), and refresh on reconnect.
  useEffect(() => {
    load();
    const channel = sb
      .channel(`plan-${planId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trips", filter: `plan_id=eq.${planId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `plan_id=eq.${planId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `plan_id=eq.${planId}` }, () => load())
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

  // The 0010 tables get their own channel, opened only once they're known to exist, so a database
  // without them can't break live updates for everything else.
  useEffect(() => {
    if (!social.on) return;
    const channel = sb.channel(`plan-${planId}-social`);
    for (const table of ["expenses", "booking_people", "trip_notes"])
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `plan_id=eq.${planId}` }, () => load());
    channel.subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, planId, load, social.on]);

  // Marks get their own channel, opened only once the table is known to exist, so that a
  // database without it can't break live updates for everything else.
  useEffect(() => {
    if (!marks.on) return;
    const channel = sb
      .channel(`plan-${planId}-marks`)
      .on("postgres_changes", { event: "*", schema: "public", table: "country_marks", filter: `plan_id=eq.${planId}` }, () => load())
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, planId, load, marks.on]);

  const range = useMemo(() => planRange(plan, today), [plan, today]);
  // The window isn't known until the plan loads, so settle the opening day once it is.
  const day = anchor ?? initialAnchor(today, range);
  const canEdit = canEditPlan(role, online, !!stale);
  const isGroup = plan?.kind === "group";
  const me = email.toLowerCase();
  // Your calendar, the trip list and the Schengen count include trips you're on in shared plans.
  const allTrips = useMemo(() => [...trips, ...social.sharedTrips], [trips, social.sharedTrips]);
  const sharedIn = useMemo<Record<string, string>>(
    () => ({
      ...Object.fromEntries(social.sharedTrips.map((t) => [t.id, memberships.find((m) => m.plan_id === t.plan_id)?.name ?? "a shared trip"])),
      ...(isGroup ? Object.fromEntries(trips.map((t) => [t.id, plan?.name ?? "this shared trip"])) : {}),
    }),
    [social.sharedTrips, memberships, isGroup, trips, plan?.name],
  );
  // What the Map tab draws. The open country is held in the View union like every other
  // selection, but its card is drawn on the map itself rather than in the sheet.
  // The map counts either this trip (plus anything shared into it) or every trip you're on.
  const [mapScope, setMapScope] = useState<MapScope>("plan");
  const map = useMemo(() => {
    const trips = mapScope === "all" ? everywhere.trips : allTrips;
    const seen = mapScope === "all" ? everywhere.marks : marks.rows;
    return countryVisits(trips, today, seen);
  }, [mapScope, everywhere, allTrips, marks.rows, today]);
  const goal = social.profiles.find((x) => x.email === me)?.countries_goal ?? null;
  const withFriends = social.on && social.members.length > 1;
  const people = withFriends ? social.members.map((m) => ({ email: m.email.toLowerCase(), label: m.email.toLowerCase() === me ? "Me" : nameOf(m.email, social.profiles) })) : [];
  // A group plan is created with no budget; showing "$0 left" there would only confuse.
  const showBudget = !!plan && !(isGroup && !(Number(plan.budget_usd) > 0));

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

  // assignee is only sent when one is picked, so adding a to-do keeps working before 0010 has run.
  const addTask = (title: string, due: string | null, assignee: string | null) =>
    run(() => sb.from("tasks").insert({ plan_id: planId, id: crypto.randomUUID(), title, due, ...(assignee ? { assignee } : {}) }), "Added");

  const toggleTask = (t: Task) =>
    run(
      () => sb.from("tasks").update({ done: !t.done, done_at: t.done ? null : new Date().toISOString() }).eq("plan_id", planId).eq("id", t.id),
      t.done ? "Back on the list" : "Ticked off",
    );

  const deleteTask = (t: Task) => run(() => sb.from("tasks").delete().eq("plan_id", planId).eq("id", t.id), "Deleted");

  /** Mark a country been, planned or wished for — or clear it. Nothing to do with trips. */
  const setMark = (code: string, mark: MarkKind | null) =>
    run(
      () =>
        mark
          ? sb.from("country_marks").upsert({ plan_id: planId, code, mark }, { onConflict: "plan_id,code" })
          : sb.from("country_marks").delete().eq("plan_id", planId).eq("code", code),
      mark ? "Marked on the map" : "Taken off the map",
    );

  /** A whole new trip of your own. No invite code: that is only the gate on a new account. */
  const createPlan = async (data: PlanInput) => {
    setSaving(true);
    const { data: id, error } = await sb.rpc("create_plan", data);
    setSaving(false);
    if (error) return toast(`Couldn't create it: ${error.message}`);
    toast(`${data.plan_name} is ready`);
    setView(null);
    onPlansChanged(id as string);
  };

  /** How many countries you're aiming for. Kept on you, not the trip, so it spans all of them. */
  const saveGoal = (n: number | null) =>
    run(() => sb.from("profiles").upsert({ email: me, countries_goal: n }, { onConflict: "email" }), n ? `Aiming for ${n}` : "Goal cleared");

  const remove = async (table: "trips" | "bookings", id: string) => {
    if (await run(() => sb.from(table).delete().eq("plan_id", planId).eq("id", id), "Deleted")) setView(null);
  };

  // ---------- Doing it with friends (0010) ----------
  const saveExpense = async (data: ExpenseInput, id?: string) => {
    const done = await run(
      () =>
        id
          ? sb.from("expenses").update(data).eq("plan_id", planId).eq("id", id)
          : sb.from("expenses").insert({ ...data, plan_id: planId, id: crypto.randomUUID() }),
      data.kind === "settlement" ? "Payment recorded" : id ? "Expense saved" : "Expense added",
    );
    if (done) setView(id ? { kind: "expense", id } : null);
  };

  const deleteExpense = async (id: string) => {
    if (await run(() => sb.from("expenses").delete().eq("plan_id", planId).eq("id", id), "Deleted")) setView(null);
  };

  const toggleOnBooking = (bookingId: string, who: string, on: boolean) =>
    run(
      () =>
        on
          ? sb.from("booking_people").insert({ plan_id: planId, booking_id: bookingId, email: who })
          : sb.from("booking_people").delete().eq("plan_id", planId).eq("booking_id", bookingId).eq("email", who),
      on ? "Added to the booking" : "Taken off the booking",
    );

  const addNote = (tripId: string, body: string) =>
    run(() => sb.from("trip_notes").insert({ plan_id: planId, id: crypto.randomUUID(), trip_id: tripId, author: me, body }), "Posted");

  const deleteNote = (id: string) => run(() => sb.from("trip_notes").delete().eq("plan_id", planId).eq("id", id), "Deleted");

  const shareTrip = async (trip: Trip, invitees: string[]) => {
    setSaving(true);
    const { data, error } = await sb.rpc("share_trip", { from_plan: planId, trip: trip.id, invitees });
    setSaving(false);
    if (error) return toast(`Couldn't share: ${error.message}`);
    toast(`${trip.title} is shared`);
    setView(null);
    onPlansChanged(data as string);
  };

  const saveProfile = async (p: { display_name: string; pay_handle: string }) =>
    run(() => sb.from("profiles").upsert({ email: me, ...p }, { onConflict: "email" }), "Saved");

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
  if (view?.kind === "new-plan") {
    sheet = (
      <Sheet title="New trip" onClose={() => setView(null)}>
        <PlanForm saving={saving} onSave={createPlan} onCancel={() => setView(null)} />
      </Sheet>
    );
  } else if (view?.kind === "trip") {
    const trip = trips.find((t) => t.id === view.id);
    const elsewhere = trip ? undefined : social.sharedTrips.find((t) => t.id === view.id);
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
          {social.on && (
            <TripSocial
              trip={trip}
              bookings={bookings}
              people={social.people}
              notes={social.notes}
              expenses={social.expenses}
              members={social.members}
              profiles={social.profiles}
              me={me}
              currency={plan?.currency ?? "USD"}
              canEdit={canEdit}
              canShare={canEdit && !isGroup}
              saving={saving}
              onOpenBooking={(id) => setView({ kind: "booking", id })}
              onAddExpense={() => setView({ kind: "expense-form", expense: { kind: "expense", trip_id: trip.id } })}
              onAddNote={(body) => addNote(trip.id, body)}
              onDeleteNote={deleteNote}
              onShare={(emails) => shareTrip(trip, emails)}
            />
          )}
        </Sheet>
      );
    else if (elsewhere)
      sheet = (
        <Sheet title={elsewhere.title} onClose={() => setView(null)}>
          <TripDetail
            trip={elsewhere}
            bookings={[]}
            canEdit={false}
            onOpenBooking={() => {}}
            onAddBooking={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            external={{ name: sharedIn[elsewhere.id], onOpen: () => onPickPlan(elsewhere.plan_id) }}
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
            currency={plan?.currency ?? "USD"}
            canEdit={canEdit}
            toast={toast}
            onEdit={() => setView({ kind: "booking-form", booking })}
            onDelete={() => remove("bookings", booking.id)}
          />
          {social.on && (
            <BookingPeople
              booking={booking}
              people={social.people}
              members={social.members}
              profiles={social.profiles}
              me={me}
              canEdit={canEdit}
              onToggle={(who, on) => toggleOnBooking(booking.id, who, on)}
            />
          )}
          {withFriends && canEdit && Number(booking.cost) > 0 && (
            <div className="row-actions">
              <button
                className="btn small"
                onClick={() =>
                  setView({
                    kind: "expense-form",
                    expense: { kind: "expense", title: booking.title, trip_id: booking.trip_id, booking_id: booking.id, date: booking.date ?? undefined },
                  })
                }
              >
                Split this cost
              </button>
            </div>
          )}
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
      <Sheet title="Profile" onClose={() => setView(null)}>
        <Account sb={sb} email={email} profile={social.profiles.find((p) => p.email === me)} social={social.on} onSaveProfile={saveProfile} toast={toast} />
        <div className="section-t">Your trips</div>
        <ul className="my-trips">
          {memberships.map((m) => (
            <li key={m.plan_id}>
              <button
                className={m.plan_id === planId ? "on" : ""}
                onClick={() => {
                  setView(null);
                  if (m.plan_id !== planId) onPickPlan(m.plan_id);
                }}
              >
                <span className="tick" aria-hidden="true">{m.plan_id === planId ? "✓" : ""}</span>
                <span className="nm">{m.name}</span>
                {m.kind === "group" ? <span className="sub">Shared</span> : m.role !== "owner" ? <span className="sub">Guest</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="row-actions">
          <button className="btn small" onClick={() => setView({ kind: "new-plan" })}>
            + New trip
          </button>
        </div>
        <div className="section-t">Trip settings{plan ? ` · ${plan.name}` : ""}</div>
        <PlanSettings sb={sb} plan={plan} canEdit={canEdit} onSaved={load} toast={toast} />
        {plan && <CalendarFeed sb={sb} plan={plan} canEdit={canEdit} onRotated={load} toast={toast} />}
        <People sb={sb} planId={planId} email={email} role={role} toast={toast} />
      </Sheet>
    );
  } else if (view?.kind === "expense") {
    const expense = social.expenses.find((x) => x.id === view.id);
    if (expense)
      sheet = (
        <Sheet title={expense.kind === "settlement" ? "Payment" : expense.title || "Expense"} onClose={() => setView(null)}>
          <ExpenseDetail
            expense={expense}
            profiles={social.profiles}
            me={me}
            currency={plan?.currency ?? "USD"}
            trips={trips}
            canEdit={canEdit}
            onEdit={() => setView({ kind: "expense-form", expense })}
            onDelete={() => deleteExpense(expense.id)}
          />
        </Sheet>
      );
  } else if (view?.kind === "expense-form") {
    const x = view.expense;
    sheet = (
      <Sheet title={x?.kind === "settlement" ? "Record a payment" : x?.id ? "Edit expense" : "New expense"} onClose={() => setView(null)}>
        <ExpenseForm
          expense={x}
          members={social.members}
          profiles={social.profiles}
          me={me}
          currency={plan?.currency ?? "USD"}
          trips={trips}
          saving={saving}
          onSave={(d) => saveExpense(d, x?.id)}
          onCancel={() => setView(x?.id ? { kind: "expense", id: x.id } : null)}
        />
      </Sheet>
    );
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <TripPicker
            name={plan?.name || "Trip planner"}
            planId={planId}
            memberships={memberships}
            onPick={onPickPlan}
            onNew={() => setView({ kind: "new-plan" })}
            onSettings={() => setView({ kind: "people" })}
          />
        </div>
        <div className="chips">
          {showBudget && plan && <BudgetChip plan={plan} bookings={bookings} loaded={loaded} onOpen={() => setTab("book")} />}
          {syncChip}
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "home"} onClick={() => setTab("home")}>
            Home
          </button>
          <button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>
            Map
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
          <button className="avatar" aria-label="Your profile and trip settings" title="Profile" onClick={() => setView({ kind: "people" })}>
            {initialsOf(social.profiles.find((x) => x.email === me)?.display_name, me)}
          </button>
        </div>
      </header>

      <InstallHint />
      {(stale || !online) && (
        <div className="banner">
          You&apos;re offline. Showing the copy saved {stale ? new Date(stale).toLocaleString() : "earlier"}; editing comes back when you reconnect.
        </div>
      )}

      {tab === "map" ? (
        <MapTab
          visits={map.visits}
          unplaced={map.unplaced}
          bookings={bookings}
          loaded={loaded}
          today={today}
          currency={plan?.currency ?? "USD"}
          canEdit={canEdit}
          sharedIn={sharedIn}
          canMark={marks.on}
          scope={mapScope}
          planName={plan?.name ?? "this trip"}
          tripCount={memberships.length}
          goal={goal}
          selected={view?.kind === "country" ? view.code : null}
          onCountry={(code) => setView(code ? { kind: "country", code } : null)}
          onScope={setMapScope}
          onMark={setMark}
          onGoal={saveGoal}
          onTrip={(id) => setView({ kind: "trip", id })}
          onBooking={(id) => setView({ kind: "booking", id })}
          onAddTrip={(place) => setView({ kind: "trip-form", trip: { place } })}
        />
      ) : tab === "home" ? (
        <section className="cal-layout">
          <CalendarPanel
            view={calView}
            anchor={day}
            range={range}
            currency={plan?.currency ?? "USD"}
            trips={allTrips}
            bookings={bookings}
            loaded={loaded}
            today={today}
            onView={setCalView}
            onAnchor={setAnchor}
            onTrip={(id) => setView({ kind: "trip", id })}
            onBooking={(id) => setView({ kind: "booking", id })}
          />
          <div className="side">
            <Tasks
              tasks={tasks}
              loaded={loaded}
              today={today}
              canEdit={canEdit}
              saving={saving}
              onAdd={addTask}
              onToggle={toggleTask}
              onDelete={deleteTask}
              people={people}
              me={me}
            />
            {social.on && (
              <Balances
                expenses={social.expenses}
                members={social.members}
                profiles={social.profiles}
                me={me}
                currency={plan?.currency ?? "USD"}
                canEdit={canEdit}
                onAdd={() => setView({ kind: "expense-form", expense: { kind: "expense" } })}
                onOpen={(id) => setView({ kind: "expense", id })}
                onSettle={(t) =>
                  setView({
                    kind: "expense-form",
                    expense: { kind: "settlement", paid_by: t.from, amount: t.amount, currency: t.currency, shares: [{ email: t.to, amount: t.amount }] },
                  })
                }
              />
            )}
            <TripRail
              trips={allTrips}
              bookings={bookings}
              loaded={loaded}
              today={today}
              sharedIn={sharedIn}
              onTrip={(id) => setView({ kind: "trip", id })}
            />
          </div>
        </section>
      ) : (
        <>
          {showBudget && plan && <BudgetPanel plan={plan} bookings={bookings} loaded={loaded} onPickCategory={pickCategory} />}
          <Bookings
            bookings={bookings}
            trips={trips}
            loaded={loaded}
            currency={plan?.currency ?? "USD"}
            category={category}
            status={status}
            canEdit={canEdit}
            onCategory={setCategory}
            onStatus={setStatus}
            onAdd={() => setView({ kind: "booking-form" })}
            onOpen={(id) => setView({ kind: "booking", id })}
            toast={toast}
          />
        </>
      )}

      {sheet}
      {toastNode}
    </div>
  );
}


/**
 * Which trip you're looking at, and the way to start another. The name in the top left is the
 * button: tapping it lists every trip you're on, your own first, with a tick beside this one.
 *
 * Hand-rolled rather than a <select> because the menu holds actions as well as trips, and an
 * option that isn't a trip reads badly in a native picker.
 */
function TripPicker({
  name,
  planId,
  memberships,
  onPick,
  onNew,
  onSettings,
}: {
  name: string;
  planId: string;
  memberships: Membership[];
  onPick: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const choose = (id: string) => {
    setOpen(false);
    if (id !== planId) onPick(id);
  };

  return (
    <div className="picker" ref={box}>
      <button className="plan-pick" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="nm">{name}</span>
        <span className="caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="picker-menu" role="menu">
          {memberships.length > 0 && <div className="picker-head">Your trips</div>}
          {memberships.map((m) => (
            <button key={m.plan_id} role="menuitem" className={m.plan_id === planId ? "on" : ""} onClick={() => choose(m.plan_id)}>
              <span className="tick" aria-hidden="true">
                {m.plan_id === planId ? "✓" : ""}
              </span>
              <span className="nm">{m.name}</span>
              {m.kind === "group" ? <span className="sub">Shared</span> : m.role !== "owner" ? <span className="sub">Guest</span> : null}
            </button>
          ))}
          <div className="picker-rule" />
          <button role="menuitem" onClick={() => { setOpen(false); onNew(); }}>
            <span className="tick" aria-hidden="true">+</span>
            <span className="nm">New trip</span>
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
            <span className="tick" aria-hidden="true" />
            <span className="nm">Trip settings</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The things that used to be hardcoded: what the trip is called, when it runs, the budget. */
function PlanSettings({
  sb,
  plan,
  canEdit,
  onSaved,
  toast,
}: {
  sb: SupabaseClient;
  plan: Plan | null;
  canEdit: boolean;
  onSaved: () => void;
  toast: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!plan) return null;
  if (!open)
    return (
      <div className="row-actions">
        <span className="empty" style={{ padding: 0 }}>
          {plan.name} · {plan.start_date && plan.end_date ? `${fmtRange(plan.start_date, plan.end_date)}` : "no dates set"} ·{" "}
          {money(Number(plan.budget_usd) || 0, plan.currency)}
        </span>
        {canEdit && (
          <button className="btn small" onClick={() => setOpen(true)}>
            Edit trip
          </button>
        )}
      </div>
    );

  return (
    <form
      className="f"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget as HTMLFormElement);
        setBusy(true);
        const { error } = await sb
          .from("plans")
          .update({
            name: String(f.get("name") ?? "").trim() || plan.name,
            start_date: String(f.get("start_date") ?? "") || null,
            end_date: String(f.get("end_date") ?? "") || null,
            budget_usd: Number(f.get("budget")) || 0,
            currency: String(f.get("currency") ?? "USD"),
            budget_note: String(f.get("budget_note") ?? "").trim(),
          })
          .eq("id", plan.id);
        setBusy(false);
        if (error) return toast(`Couldn't save: ${error.message}`);
        toast("Trip saved");
        setOpen(false);
        onSaved();
      }}
    >
      <label>
        Trip name
        <input name="name" required maxLength={60} defaultValue={plan.name} />
      </label>
      <div className="two">
        <label>
          Starts
          <input name="start_date" type="date" defaultValue={plan.start_date ?? ""} />
        </label>
        <label>
          Ends
          <input name="end_date" type="date" defaultValue={plan.end_date ?? ""} />
        </label>
      </div>
      <div className="two">
        <label>
          Budget
          <input name="budget" type="number" min={0} step={100} defaultValue={Number(plan.budget_usd) || 0} />
        </label>
        <label>
          Currency
          <select name="currency" defaultValue={plan.currency || "USD"}>
            {["USD", "EUR", "GBP", "AUD", "CAD", "JPY", "CHF", "SEK", "NZD", "SGD"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Budget note
        <input name="budget_note" maxLength={60} defaultValue={plan.budget_note} placeholder="excludes rent" />
      </label>
      <div className="row-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save trip"}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Up to two letters for the avatar: from the display name if there is one, else the email. */
function initialsOf(name: string | null | undefined, email: string): string {
  const words = (name?.trim() || email.split("@")[0].replace(/[._-]+/g, " ")).split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** The top of the profile sheet: who you are, then the account actions. */
function Account({
  sb,
  email,
  profile,
  social,
  onSaveProfile,
  toast,
}: {
  sb: SupabaseClient;
  email: string;
  profile: Profile | undefined;
  social: boolean;
  onSaveProfile: (p: { display_name: string; pay_handle: string }) => Promise<boolean>;
  toast: (m: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const me = email.toLowerCase();
  return (
    <>
      <div className="account">
        <span className="avatar big" aria-hidden="true">{initialsOf(profile?.display_name, me)}</span>
        <div className="who">
          <b>{profile?.display_name || me.split("@")[0]}</b>
          <span>{email}</span>
        </div>
      </div>
      {social && <ProfileForm profile={profile} me={me} onSave={onSaveProfile} />}
      <div className="row-actions">
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

function People({
  sb,
  planId,
  email,
  role,
  toast,
}: {
  sb: SupabaseClient;
  planId: string;
  email: string;
  role: MemberRole | null;
  toast: (m: string) => void;
}) {
  const [members, setMembers] = useState<{ email: string; role: string }[] | null>(null);
  const [invite, setInvite] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<MemberRole, "owner">>("viewer");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await sb.from("plan_members").select("email,role").eq("plan_id", planId).order("added_at");
    setMembers(data ?? []);
  }, [sb, planId]);
  useEffect(() => {
    load();
  }, [load]);

  const isOwner = role === "owner";

  const setRole = async (memberEmail: string, next: Exclude<MemberRole, "owner">) => {
    setBusy(true);
    const { error } = await sb.rpc("set_plan_member_role", { p: planId, member_email: memberEmail, member_role: next });
    setBusy(false);
    if (error) return toast(`Couldn't change: ${error.message}`);
    toast(`${memberEmail} is now ${next === "viewer" ? "view only" : "an editor"}`);
    load();
  };

  return (
    <>
      <p className="empty" style={{ padding: 0 }}>
        Editors can change trips, bookings and the budget. Viewers see everything but can&apos;t change anything. Someone without an
        account gets in by signing up with the email you add here.
      </p>
      {role === "viewer" && <p className="empty" style={{ padding: 0 }}>You have view-only access to this plan.</p>}
      <ul className="people">
        {members === null && <li>Loading…</li>}
        {members?.map((m) => {
          const self = m.email.toLowerCase() === email.toLowerCase();
          return (
            <li key={m.email}>
              <span>
                {m.email}
                {self && " (you)"}
              </span>
              {isOwner && m.role !== "owner" ? (
                <select
                  aria-label={`Access for ${m.email}`}
                  className="role"
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => setRole(m.email, e.target.value as Exclude<MemberRole, "owner">)}
                >
                  <option value="viewer">View only</option>
                  <option value="editor">Can edit</option>
                </select>
              ) : (
                <span className="pill idea">{m.role === "viewer" ? "view only" : m.role}</span>
              )}
            </li>
          );
        })}
      </ul>
      {isOwner && (
        <form
          className="f"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const { error } = await sb.rpc("add_plan_member", { p: planId, member_email: invite, member_role: inviteRole });
            setBusy(false);
            if (error) return toast(`Couldn't add: ${error.message}`);
            toast(`Added ${invite} as ${inviteRole === "viewer" ? "view only" : "an editor"}`);
            setInvite("");
            load();
          }}
        >
          <label>
            Add someone by email
            <input id="invite-email" type="email" required value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
          <label>
            Access
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<MemberRole, "owner">)}>
              <option value="viewer">View only</option>
              <option value="editor">Can edit</option>
            </select>
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? "Adding…" : "Add to plan"}
          </button>
        </form>
      )}
    </>
  );
}

/**
 * Every trip this person is on, across all of their plans, for the map's All view. Row-level
 * security already limits this to plans they belong to, so the id list is a narrowing and not a
 * guard. Marks are tolerated missing exactly as they are for the open plan.
 */
async function loadEverywhere(sb: SupabaseClient, planIds: string[]): Promise<Everywhere> {
  if (!planIds.length) return NOWHERE;
  const [trips, marks] = await Promise.all([
    sb.from("trips").select("*").in("plan_id", planIds),
    sb.from("country_marks").select("*").in("plan_id", planIds),
  ]);
  return { trips: (trips.data ?? []) as Trip[], marks: (marks.data ?? []) as CountryMark[] };
}

/**
 * The 0010 tables, loaded alongside the rest. Every query tolerates the table not existing yet: if
 * expenses can't be read, the whole social layer stays off and the app behaves exactly as before.
 */
async function loadSocial(sb: SupabaseClient, planId: string, groupIds: string[]): Promise<Social> {
  const [members, profiles, expenses, people, notes, shared] = await Promise.all([
    sb.from("plan_members").select("email,role").eq("plan_id", planId).order("added_at"),
    sb.from("profiles").select("*"),
    sb.from("expenses").select("*").eq("plan_id", planId),
    sb.from("booking_people").select("*").eq("plan_id", planId),
    sb.from("trip_notes").select("*").eq("plan_id", planId),
    groupIds.length ? sb.from("trips").select("*").in("plan_id", groupIds) : Promise.resolve({ data: [], error: null }),
  ]);
  return {
    on: !expenses.error,
    members: ((members.data ?? []) as Member[]).map((m) => ({ ...m, email: m.email.toLowerCase() })),
    profiles: (profiles.data ?? []) as Profile[],
    expenses: ((expenses.data ?? []) as Expense[]).map((x) => ({
      ...x,
      amount: Number(x.amount) || 0,
      shares: (Array.isArray(x.shares) ? x.shares : []).map((s) => ({ email: String(s.email).toLowerCase(), amount: Number(s.amount) || 0 })),
    })),
    people: (people.data ?? []) as BookingPerson[],
    notes: (notes.data ?? []) as TripNote[],
    sharedTrips: (shared.data ?? []) as Trip[],
  };
}
