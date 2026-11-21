import { describe, expect, it } from "vitest";
import { bookingEvent, bookingIcs, calendarFeed, escapeText, fold, icsFileName, icsStamp, parseTime, tripEvent, uid } from "./ics";
import type { Booking, Trip } from "./types";

const PLAN = "11111111-2222-3333-4444-555555555555";
const STAMP = "20261119T090000Z";

const trip = (over: Partial<Trip> = {}): Trip => ({
  plan_id: PLAN,
  id: "florence",
  title: "Florence",
  kind: "base",
  status: "booked",
  start_date: "2027-01-05",
  end_date: "2027-03-15",
  place: "Florence, Italy",
  schengen: true,
  notes: "",
  source: "",
  created_by: null,
  ...over,
});

const booking = (over: Partial<Booking> = {}): Booking => ({
  plan_id: PLAN,
  id: "b1",
  title: "Flight to Pisa",
  type: "flight",
  status: "booked",
  trip_id: null,
  date: "2027-01-04",
  end_date: null,
  time: "",
  arrive_time: "",
  provider: "",
  cost: 0,
  confirmation: "",
  link: "",
  notes: "",
  counts_in_budget: true,
  source: "",
  created_by: null,
  ...over,
});

const value = (lines: string[], key: string) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1);

describe("escaping and folding", () => {
  it("escapes the four characters that have meaning in a TEXT value", () => {
    expect(escapeText("Hotel; room 4, floor 2\\b")).toBe("Hotel\\; room 4\\, floor 2\\\\b");
    expect(escapeText("line one\nline two")).toBe("line one\\nline two");
    expect(escapeText("crlf\r\nhere")).toBe("crlf\\nhere");
  });

  it("leaves a short line alone", () => {
    expect(fold("SUMMARY:Dinner")).toBe("SUMMARY:Dinner");
  });

  it("folds at 75 octets, and unfolding gives back the original", () => {
    const line = `DESCRIPTION:${"a".repeat(300)}`;
    const folded = fold(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBe(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(" ")).toBe(true);
      expect(p.length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("never splits a multi-byte character", () => {
    // Each é is two octets, so a naive cut at 75 would land inside one.
    const line = `SUMMARY:${"é".repeat(80)}`;
    const folded = fold(line);
    expect(folded).not.toContain("�");
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("parseTime", () => {
  it("reads the ways a person writes a time", () => {
    expect(parseTime("09:40")).toEqual({ h: 9, m: 40 });
    expect(parseTime("9:40")).toEqual({ h: 9, m: 40 });
    expect(parseTime("14:00")).toEqual({ h: 14, m: 0 });
    expect(parseTime("7:30 pm")).toEqual({ h: 19, m: 30 });
    expect(parseTime("7:30PM")).toEqual({ h: 19, m: 30 });
    expect(parseTime("9am")).toEqual({ h: 9, m: 0 });
    expect(parseTime("12am")).toEqual({ h: 0, m: 0 });
    expect(parseTime("12pm")).toEqual({ h: 12, m: 0 });
  });

  it("gives up rather than guess", () => {
    for (const bad of ["", "morning", "soon", "25:00", "9:70", "13pm", "0pm"]) expect(parseTime(bad)).toBeNull();
  });
});

describe("trip events", () => {
  it("covers the whole trip, with an exclusive end date", () => {
    const lines = tripEvent(trip(), PLAN, STAMP);
    expect(value(lines, "DTSTART;VALUE=DATE")).toBe("20270105");
    expect(value(lines, "DTEND;VALUE=DATE")).toBe("20270316"); // the day after Mar 15
    expect(value(lines, "SUMMARY")).toBe("Florence");
    expect(value(lines, "LOCATION")).toBe("Florence\\, Italy");
    expect(value(lines, "TRANSP")).toBe("TRANSPARENT"); // doesn't make you look busy all month
  });

  it("treats a one-day trip as one day", () => {
    const lines = tripEvent(trip({ end_date: null }), PLAN, STAMP);
    expect(value(lines, "DTEND;VALUE=DATE")).toBe("20270106");
  });

  it("skips a trip with no dates", () => {
    expect(tripEvent(trip({ start_date: null }), PLAN, STAMP)).toEqual([]);
  });

  it("marks an idea as tentative", () => {
    expect(value(tripEvent(trip({ status: "idea" }), PLAN, STAMP), "STATUS")).toBe("TENTATIVE");
  });
});

describe("booking events", () => {
  it("ends a stay on the check-out day, not after it", () => {
    const lines = bookingEvent(booking({ type: "stay", date: "2027-01-05", end_date: "2027-01-09" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTSTART;VALUE=DATE")).toBe("20270105");
    expect(value(lines, "DTEND;VALUE=DATE")).toBe("20270109");
  });

  it("gives a timed booking a floating start and a length that suits its type", () => {
    const flight = bookingEvent(booking({ time: "09:40" }), undefined, PLAN, STAMP);
    expect(value(flight, "DTSTART")).toBe("20270104T094000");
    expect(value(flight, "DTEND")).toBe("20270104T114000");
    const other = bookingEvent(booking({ type: "other", time: "09:40" }), undefined, PLAN, STAMP);
    expect(value(other, "DTEND")).toBe("20270104T104000");
  });

  it("ends a journey when it actually lands, not two hours later", () => {
    const lines = bookingEvent(booking({ time: "09:40", arrive_time: "11:55" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTSTART")).toBe("20270104T094000");
    expect(value(lines, "DTEND")).toBe("20270104T115500");
  });

  it("gives a long haul its real length instead of a flat two hours", () => {
    const lines = bookingEvent(
      booking({ date: "2027-03-16", time: "13:05", arrive_time: "19:40", end_date: "2027-03-17" }),
      undefined,
      PLAN,
      STAMP,
    );
    expect(value(lines, "DTSTART")).toBe("20270316T130500");
    expect(value(lines, "DTEND")).toBe("20270317T194000"); // ~30 hours, Europe to Australia
  });

  it("works out an overnight flight even when no arrival date was given", () => {
    const lines = bookingEvent(booking({ time: "23:30", arrive_time: "06:10" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTSTART")).toBe("20270104T233000");
    expect(value(lines, "DTEND")).toBe("20270105T061000");
  });

  it("keeps a same-day arrival on the same day", () => {
    const lines = bookingEvent(booking({ time: "06:10", arrive_time: "23:30" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTEND")).toBe("20270104T233000");
  });

  it("falls back to the guess when the arrival time is unreadable", () => {
    const lines = bookingEvent(booking({ time: "09:40", arrive_time: "lunchtime" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTEND")).toBe("20270104T114000");
  });

  it("ignores an arrival time with no departure to hang it on", () => {
    const lines = bookingEvent(booking({ time: "", arrive_time: "11:55" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTSTART;VALUE=DATE")).toBe("20270104");
    expect(value(lines, "DTEND;VALUE=DATE")).toBe("20270105");
  });

  it("rolls a late booking into the next day", () => {
    const lines = bookingEvent(booking({ time: "23:30" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTSTART")).toBe("20270104T233000");
    expect(value(lines, "DTEND")).toBe("20270105T013000");
  });

  it("falls back to an all-day event when the time is unreadable", () => {
    const lines = bookingEvent(booking({ time: "morning" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTSTART;VALUE=DATE")).toBe("20270104");
    expect(value(lines, "DTEND;VALUE=DATE")).toBe("20270105");
  });

  it("spans a multi-day booking that isn't a stay, end date included", () => {
    const lines = bookingEvent(booking({ type: "activity", end_date: "2027-01-06" }), undefined, PLAN, STAMP);
    expect(value(lines, "DTEND;VALUE=DATE")).toBe("20270107");
  });

  it("says in the title when something isn't booked yet", () => {
    expect(value(bookingEvent(booking({ status: "todo" }), undefined, PLAN, STAMP), "SUMMARY")).toBe("To book: Flight to Pisa");
    expect(value(bookingEvent(booking({ status: "review" }), undefined, PLAN, STAMP), "SUMMARY")).toBe("Check: Flight to Pisa");
    expect(value(bookingEvent(booking({ status: "todo" }), undefined, PLAN, STAMP), "STATUS")).toBe("TENTATIVE");
    expect(value(bookingEvent(booking(), undefined, PLAN, STAMP), "STATUS")).toBe("CONFIRMED");
  });

  it("puts the provider, the code and the trip in the description, and borrows the trip's place", () => {
    const lines = bookingEvent(booking({ provider: "Ryanair", confirmation: "ABC123", trip_id: "florence" }), trip(), PLAN, STAMP);
    expect(value(lines, "DESCRIPTION")).toBe("Booked with Ryanair\\nConfirmation ABC123\\nTrip: Florence");
    expect(value(lines, "LOCATION")).toBe("Florence\\, Italy");
  });

  it("only passes on a link that is really a link", () => {
    expect(value(bookingEvent(booking({ link: "https://example.com/x" }), undefined, PLAN, STAMP), "URL")).toBe("https://example.com/x");
    expect(value(bookingEvent(booking({ link: "javascript:alert(1)" }), undefined, PLAN, STAMP), "URL")).toBeUndefined();
  });

  it("skips a booking with no date", () => {
    expect(bookingEvent(booking({ date: null }), undefined, PLAN, STAMP)).toEqual([]);
  });

  it("keeps a row's id, so a later fetch updates the event instead of adding a second one", () => {
    expect(uid("booking", "gm-ABC123", PLAN)).toBe(`booking-gm-ABC123.${PLAN}@trip-planner`);
    expect(uid("trip", "florence", PLAN)).not.toBe(uid("booking", "florence", PLAN));
  });
});

describe("the feed", () => {
  const feed = () =>
    calendarFeed({
      plan: { id: PLAN, name: "Winter 2027" },
      trips: [trip(), trip({ id: "nodate", start_date: null, end_date: null })],
      bookings: [booking(), booking({ id: "b2", date: null })],
      now: new Date("2026-11-19T09:00:00Z"),
    });

  it("wraps the events in one calendar, in CRLF lines", () => {
    const ics = feed();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("X-WR-CALNAME:Winter 2027");
    expect(ics.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
  });

  it("holds one event per dated row and nothing for the rest", () => {
    const ics = feed();
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain(`UID:trip-florence.${PLAN}@trip-planner`);
    expect(ics).toContain(`UID:booking-b1.${PLAN}@trip-planner`);
    expect(ics).toContain(`DTSTAMP:${STAMP}`);
  });

  it("asks clients that listen to refresh hourly", () => {
    expect(feed()).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
  });

  it("builds a one-event file for the add-to-calendar button", () => {
    const ics = bookingIcs(booking({ time: "09:40" }), trip(), PLAN, new Date("2026-11-19T09:00:00Z"));
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(ics).toContain("DTSTART:20270104T094000");
    expect(ics).toContain("X-WR-CALNAME:Flight to Pisa");
  });
});

describe("odds and ends", () => {
  it("makes a filename a phone won't choke on", () => {
    expect(icsFileName("Flight to Pisa")).toBe("flight-to-pisa.ics");
    expect(icsFileName("Hôtel — San Niccolò!")).toBe("h-tel-san-niccol.ics");
    expect(icsFileName("")).toBe("booking.ics");
    expect(icsFileName("!!!")).toBe("booking.ics");
  });

  it("stamps in UTC", () => {
    expect(icsStamp("2026-11-19T09:00:00.123Z")).toBe("20261119T090000Z");
  });
});
