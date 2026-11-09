import type { Booking, BookingType, Category, Trip, TripKind } from "./types";

// ---------- Labels ----------
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DOWS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const KINDS = { base: "Base", weekend: "Weekend trip", travel: "Travel leg", other: "Other" } as const;
export const BOOKING_TYPES: Record<BookingType, string> = {
  stay: "Stay / housing",
  flight: "Flight",
  train: "Train",
  bus: "Bus / ferry",
  food: "Food",
  activity: "Event",
  other: "Other",
};
export const CATEGORIES: [Exclude<Category, "other">, string][] = [
  ["stays", "Stays"],
  ["transport", "Transport"],
  ["food", "Food"],
  ["events", "Events"],
];

export function categoryOf(type: BookingType): Category {
  if (type === "stay") return "stays";
  if (type === "flight" || type === "train" || type === "bus") return "transport";
  if (type === "food") return "food";
  if (type === "activity") return "events";
  return "other";
}

// ---------- Dates (all YYYY-MM-DD strings, compared as UTC day numbers) ----------
export const dayNum = (d: string) =>
  Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);
export const fromDayNum = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);

export function localToday(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const fmtDate = (d?: string | null) => (d ? `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}` : "");

export function fmtRange(a?: string | null, b?: string | null) {
  if (!a) return "";
  if (!b || a === b) return fmtDate(a);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${fmtDate(a)} – ${+b.slice(8, 10)}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export const tripEnd = (t: Pick<Trip, "start_date" | "end_date">) => t.end_date || t.start_date;

export function nights(b: Pick<Booking, "date" | "end_date">) {
  return b.date && b.end_date && b.end_date > b.date ? dayNum(b.end_date) - dayNum(b.date) : 0;
}

export const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

// ---------- Calendar views ----------
/** Day, week and month are the three ways the calendar tab can be read; week is the default. */
export type CalView = "day" | "week" | "month";
export const CAL_VIEWS: [CalView, string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

/** The plan's window. The calendar won't navigate past either end of it. */
export const PLAN_RANGE = ["2026-12-01", "2027-06-30"] as const;
/** Where the calendar opens when today falls outside the plan: the day the semester starts. */
export const PLAN_START = "2026-12-31";

export const addDays = (d: string, n: number) => fromDayNum(dayNum(d) + n);
/** Monday = 0, Sunday = 6 — the order the grid and the week view use. */
export const weekday = (d: string) => (new Date(dayNum(d) * 864e5).getUTCDay() + 6) % 7;
export const startOfWeek = (d: string) => addDays(d, -weekday(d));
export const daysInMonth = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

export function shiftMonth(month: string, delta: number) {
  let [y, m] = month.split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** First and last day a view shows, both inclusive. */
export function viewRange(view: CalView, anchor: string): { start: string; end: string } {
  if (view === "day") return { start: anchor, end: anchor };
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  const ym = anchor.slice(0, 7);
  return { start: `${ym}-01`, end: `${ym}-${daysInMonth(ym)}` };
}

/** Every day a day or week view lists, in order. */
export function viewDays(view: CalView, anchor: string) {
  const { start, end } = viewRange(view, anchor);
  return Array.from({ length: dayNum(end) - dayNum(start) + 1 }, (_, i) => addDays(start, i));
}

/** Step one day, week or month. The day of the month is clamped, so Jan 31 → Feb 28. */
export function shiftAnchor(view: CalView, anchor: string, delta: number) {
  if (view === "day") return addDays(anchor, delta);
  if (view === "week") return addDays(anchor, 7 * delta);
  const ym = shiftMonth(anchor.slice(0, 7), delta);
  return `${ym}-${String(Math.min(+anchor.slice(8, 10), daysInMonth(ym))).padStart(2, "0")}`;
}

/** Whether a view anchored on this day still shows any part of the plan's window. */
export function inPlanRange(view: CalView, anchor: string) {
  const { start, end } = viewRange(view, anchor);
  return end >= PLAN_RANGE[0] && start <= PLAN_RANGE[1];
}

/** The day the calendar opens on: today while the plan is running, otherwise its first day. */
export function initialAnchor(today: string) {
  return today >= PLAN_RANGE[0] && today <= PLAN_RANGE[1] ? today : PLAN_START;
}

export function viewTitle(view: CalView, anchor: string) {
  if (view === "day") return `${DOWS_LONG[weekday(anchor)]}, ${fmtDate(anchor)}`;
  if (view === "month") return `${MONTHS_LONG[+anchor.slice(5, 7) - 1]} ${anchor.slice(0, 4)}`;
  const { start, end } = viewRange("week", anchor);
  return fmtRange(start, end);
}

/** Trips covering a day, base first so the longest-running trip reads as the backdrop. */
/** Base first, so the longest-running trip reads as the backdrop behind the others. */
export const KIND_ORDER: Record<TripKind, number> = { base: 0, travel: 1, weekend: 2, other: 3 };
export function tripsOn<T extends Pick<Trip, "start_date" | "end_date" | "kind">>(trips: T[], day: string) {
  return trips
    .filter((t) => t.start_date && t.start_date <= day && tripEnd(t)! >= day)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.start_date!.localeCompare(b.start_date!));
}

/** Bookings to list under a day: the ones that happen on it, plus the day a stay is checked out of. */
export function bookingsOn<T extends Pick<Booking, "date" | "end_date" | "type" | "time">>(bookings: T[], day: string) {
  return bookings
    .filter((b) => b.date === day || (b.type === "stay" && !!b.end_date && b.end_date === day && b.date !== day))
    .sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
}

// ---------- Schengen ----------
/**
 * Days planned inside the Schengen area. A day counts when a Schengen trip covers it and no
 * non-Schengen weekend/travel trip covers it (so a Dublin weekend inside the Florence base pauses the count).
 */
export function schengenDays(trips: Pick<Trip, "start_date" | "end_date" | "schengen" | "kind">[]) {
  const inside = new Set<number>();
  const outside = new Set<number>();
  for (const t of trips) {
    if (!t.start_date) continue;
    const a = dayNum(t.start_date);
    const b = dayNum(tripEnd(t)!);
    for (let n = a; n <= b; n++) {
      if (t.schengen) inside.add(n);
      else if (t.kind !== "base") outside.add(n);
    }
  }
  let count = 0;
  for (const n of inside) if (!outside.has(n)) count++;
  return count;
}

/** Largest number of Schengen days inside any rolling 180-day window — the number the 90-day rule is checked against. */
export function maxSchengenWindow(trips: Pick<Trip, "start_date" | "end_date" | "schengen" | "kind">[]) {
  const inside = new Set<number>();
  const outside = new Set<number>();
  for (const t of trips) {
    if (!t.start_date) continue;
    for (let n = dayNum(t.start_date); n <= dayNum(tripEnd(t)!); n++) {
      if (t.schengen) inside.add(n);
      else if (t.kind !== "base") outside.add(n);
    }
  }
  const days = [...inside].filter((n) => !outside.has(n)).sort((x, y) => x - y);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < days.length; hi++) {
    while (days[hi] - days[lo] >= 180) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

// ---------- Budget ----------
export const inBudget = (b: Pick<Booking, "status" | "counts_in_budget">) => b.status === "booked" && b.counts_in_budget;

export function budgetSummary(bookings: Booking[], budget: number) {
  const byCategory: Record<Category, number> = { stays: 0, transport: 0, food: 0, events: 0, other: 0 };
  for (const b of bookings) if (inBudget(b)) byCategory[categoryOf(b.type)] += Number(b.cost) || 0;
  const spent = Object.values(byCategory).reduce((a, c) => a + c, 0);
  const planned = bookings
    .filter((b) => b.status !== "booked" && b.counts_in_budget)
    .reduce((a, b) => a + (Number(b.cost) || 0), 0);
  return { byCategory, spent, planned, left: budget - spent };
}
