import type { Booking, BookingType, Category, Trip } from "./types";

// ---------- Labels ----------
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
