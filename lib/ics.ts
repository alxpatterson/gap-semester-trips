/**
 * iCalendar (RFC 5545) output, so a plan can be subscribed to from Google Calendar, Apple
 * Calendar or Outlook instead of only being read in the app.
 *
 * Two things are built from the same pieces: a whole-plan feed served at /calendar/<token>.ics
 * and a single event for the "Add to calendar" button on a booking. Everything here is pure, so
 * it runs on the server for the feed and in the browser for the button.
 *
 * Times are deliberately *floating* — a DTSTART with no timezone and no Z. The app stores a time
 * as text ("09:40") and never records which zone it was written in, so pinning one would be a
 * guess. Floating means every client shows 09:40, which is what someone reading "09:40" wants.
 */
import type { Booking, Plan, Trip } from "./types";
import { addDays } from "./logic";

const CRLF = "\r\n";

/**
 * Fold at 75 octets, per RFC 5545 — counted in UTF-8 bytes, and never mid-character.
 * TextEncoder rather than Buffer, because this module also runs in the browser.
 */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  const out: string[] = [];
  let at = 0;
  let limit = 75; // the first line gets 75; continuations lose one octet to the leading space
  while (at < bytes.length) {
    let take = Math.min(limit, bytes.length - at);
    // Don't cut a multi-byte character in half: 0b10xxxxxx is a continuation byte.
    while (take > 1 && (bytes[at + take] & 0xc0) === 0x80) take--;
    out.push(decoder.decode(bytes.subarray(at, at + take)));
    at += take;
    limit = 74;
  }
  return out.join(`${CRLF} `);
}

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export const escapeText = (s: string) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

/** 2027-01-05 → 20270105, for a VALUE=DATE property. */
export const icsDate = (d: string) => d.replace(/-/g, "");

/** A UTC timestamp for DTSTAMP. */
export const icsStamp = (iso: string) => `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;

/**
 * The `time` column is free text a person typed, so take what can be read and ignore the rest:
 * "09:40", "9:40", "7:30 pm", "9am" all work; "morning" doesn't and becomes an all-day event.
 */
export function parseTime(time: string): { h: number; m: number } | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(time ?? "");
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return { h, m: min };
}

/** A floating date-time: 2027-01-05 + 9:40 → 20270105T094000. */
export const icsLocal = (date: string, h: number, m: number) =>
  `${icsDate(date)}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;

/** Fallback length for a timed booking with no arrival time — a guess, so keep it modest. */
const HOURS: Record<Booking["type"], number> = { flight: 2, train: 2, bus: 2, activity: 2, food: 2, stay: 1, other: 1 };

const plus = (date: string, h: number, m: number, hours: number) => {
  const end = h + hours;
  return end < 24 ? icsLocal(date, end, m) : icsLocal(addDays(date, 1), end - 24, m);
};

/** Stable and unique: the row id already is, within its plan. */
export const uid = (kind: "trip" | "booking", id: string, planId: string) => `${kind}-${id}.${planId}@trip-planner`;

const STATUS: Record<Booking["status"], string> = { booked: "CONFIRMED", todo: "TENTATIVE", review: "TENTATIVE" };

/** Unbooked things say so in the title, since a calendar shows nothing else about them. */
const PREFIX: Record<Booking["status"], string> = { booked: "", todo: "To book: ", review: "Check: " };

type Line = [string, string];

function vevent(lines: Line[]): string[] {
  return ["BEGIN:VEVENT", ...lines.filter(([, v]) => v !== "").map(([k, v]) => fold(`${k}:${v}`)), "END:VEVENT"];
}

/** A trip becomes one all-day block, so the calendar shows where you are. */
export function tripEvent(trip: Trip, planId: string, stamp: string): string[] {
  if (!trip.start_date) return [];
  const last = trip.end_date || trip.start_date;
  return vevent([
    ["UID", uid("trip", trip.id, planId)],
    ["DTSTAMP", stamp],
    ["DTSTART;VALUE=DATE", icsDate(trip.start_date)],
    ["DTEND;VALUE=DATE", icsDate(addDays(last, 1))],
    ["SUMMARY", escapeText(trip.title)],
    ["LOCATION", escapeText(trip.place)],
    ["DESCRIPTION", escapeText(trip.notes)],
    ["STATUS", trip.status === "booked" ? "CONFIRMED" : "TENTATIVE"],
    ["TRANSP", "TRANSPARENT"],
    ["SEQUENCE", "0"],
  ]);
}

export function bookingEvent(booking: Booking, trip: Trip | undefined, planId: string, stamp: string): string[] {
  const b = booking;
  if (!b.date) return [];
  const at = parseTime(b.time);

  let start: Line;
  let end: Line;
  if (b.type === "stay" && b.end_date && b.end_date > b.date) {
    // A stay covers the nights between check-in and check-out, and DTEND is exclusive — so the
    // check-out date is the end, not the day after it.
    start = ["DTSTART;VALUE=DATE", icsDate(b.date)];
    end = ["DTEND;VALUE=DATE", icsDate(b.end_date)];
  } else if (at) {
    const arrives = parseTime(b.arrive_time);
    start = ["DTSTART", icsLocal(b.date, at.h, at.m)];
    if (arrives) {
      // end_date holds the arrival day when one was given. Without it, an arrival no later than the
      // departure can only mean the overnight case, so it lands the next morning.
      const sameDay = arrives.h * 60 + arrives.m > at.h * 60 + at.m;
      const lands = b.end_date && b.end_date > b.date ? b.end_date : sameDay ? b.date : addDays(b.date, 1);
      end = ["DTEND", icsLocal(lands, arrives.h, arrives.m)];
    } else {
      end = ["DTEND", plus(b.date, at.h, at.m, HOURS[b.type])];
    }
  } else {
    const last = b.end_date && b.end_date > b.date ? b.end_date : b.date;
    start = ["DTSTART;VALUE=DATE", icsDate(b.date)];
    end = ["DTEND;VALUE=DATE", icsDate(addDays(last, 1))];
  }

  const details = [
    b.provider && `Booked with ${b.provider}`,
    b.confirmation && `Confirmation ${b.confirmation}`,
    trip && `Trip: ${trip.title}`,
    b.notes,
  ].filter(Boolean) as string[];

  return vevent([
    ["UID", uid("booking", b.id, planId)],
    ["DTSTAMP", stamp],
    start,
    end,
    ["SUMMARY", escapeText(`${PREFIX[b.status]}${b.title}`)],
    ["LOCATION", escapeText(trip?.place ?? "")],
    ["DESCRIPTION", escapeText(details.join("\n"))],
    ["URL", /^https?:\/\//i.test(b.link) ? b.link : ""],
    ["STATUS", STATUS[b.status]],
    ["SEQUENCE", "0"],
  ]);
}

const wrap = (name: string, body: string[], extra: Line[] = []) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//gap-semester-trips//Trip planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${escapeText(name)}`),
    ...extra.map(([k, v]) => fold(`${k}:${v}`)),
    ...body,
    "END:VCALENDAR",
  ].join(CRLF) + CRLF;

/**
 * The whole plan as one subscribable calendar. Google refreshes a subscribed URL on its own
 * schedule (roughly every 8–24 hours) and ignores REFRESH-INTERVAL; Apple honours it.
 */
export function calendarFeed({
  plan,
  trips,
  bookings,
  now = new Date(),
}: {
  plan: Pick<Plan, "id" | "name">;
  trips: Trip[];
  bookings: Booking[];
  now?: Date;
}): string {
  const stamp = icsStamp(now.toISOString());
  const byId = new Map(trips.map((t) => [t.id, t]));
  const events = [
    ...[...trips].sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? "")).flatMap((t) => tripEvent(t, plan.id, stamp)),
    ...[...bookings]
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      .flatMap((b) => bookingEvent(b, b.trip_id ? byId.get(b.trip_id) : undefined, plan.id, stamp)),
  ];
  return wrap(plan.name || "Trip", events, [
    ["X-WR-CALDESC", escapeText(`Trips and bookings from ${plan.name || "the trip planner"}`)],
    ["REFRESH-INTERVAL;VALUE=DURATION", "PT1H"],
    ["X-PUBLISHED-TTL", "PT1H"],
  ]);
}

/** One booking, for the "Add to calendar" button — no subscription, no waiting for a refresh. */
export function bookingIcs(booking: Booking, trip: Trip | undefined, planId: string, now = new Date()): string {
  return wrap(booking.title || "Booking", bookingEvent(booking, trip, planId, icsStamp(now.toISOString())));
}

/** A filename a phone won't choke on. */
export const icsFileName = (title: string) =>
  `${(title || "booking").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "booking"}.ics`;
