import { describe, expect, it } from "vitest";
import {
  bookingsOn,
  budgetSummary,
  canEditPlan,
  categoryOf,
  fmtRange,
  inPlanRange,
  initialAnchor,
  maxSchengenWindow,
  openTasks,
  nights,
  schengenDays,
  shiftAnchor,
  sortTasks,
  startOfWeek,
  taskGroup,
  tripsOn,
  viewDays,
  viewRange,
  viewTitle,
} from "./logic";
import { normalizeBooking, processedIds, rowsOf, SyncError, updatableFields } from "./sync";
import type { Task } from "./types";
import type { Booking, Trip } from "./types";

const trip = (start: string, end: string, schengen: boolean, kind: "base" | "weekend" | "travel" = "weekend") => ({
  start_date: start,
  end_date: end,
  schengen,
  kind,
});

describe("schengenDays", () => {
  it("counts every day of a Schengen base, inclusive", () => {
    expect(schengenDays([trip("2027-01-05", "2027-03-15", true, "base")])).toBe(70);
  });
  it("pauses the count for a non-Schengen weekend inside the base", () => {
    const trips = [trip("2027-01-05", "2027-03-15", true, "base"), trip("2027-03-11", "2027-03-14", false)];
    expect(schengenDays(trips)).toBe(66);
  });
  it("does not double count overlapping Schengen trips", () => {
    const trips = [trip("2027-01-05", "2027-01-31", true, "base"), trip("2027-01-15", "2027-01-17", true)];
    expect(schengenDays(trips)).toBe(27);
  });
});

describe("maxSchengenWindow", () => {
  it("finds the busiest rolling 180-day window", () => {
    const trips = [trip("2027-01-01", "2027-03-31", true, "base"), trip("2027-09-01", "2027-09-10", true)];
    expect(maxSchengenWindow(trips)).toBe(90);
  });
});

describe("dates", () => {
  it("formats ranges compactly", () => {
    expect(fmtRange("2027-03-11", "2027-03-14")).toBe("Mar 11 – 14");
    expect(fmtRange("2026-12-31", "2027-01-04")).toBe("Dec 31 – Jan 4");
    expect(fmtRange("2027-03-11", null)).toBe("Mar 11");
  });
  it("counts nights for a stay", () => {
    expect(nights({ date: "2027-03-11", end_date: "2027-03-14" })).toBe(3);
    expect(nights({ date: "2027-03-11", end_date: null })).toBe(0);
  });
});

describe("budget", () => {
  const b = (type: Booking["type"], cost: number, status: Booking["status"] = "booked", counts = true) =>
    ({ type, cost, status, counts_in_budget: counts }) as Booking;

  it("maps booking types to the four filter categories", () => {
    expect(categoryOf("stay")).toBe("stays");
    expect(categoryOf("train")).toBe("transport");
    expect(categoryOf("food")).toBe("food");
    expect(categoryOf("activity")).toBe("events");
  });

  it("only counts booked items that count toward the budget", () => {
    const s = budgetSummary([b("flight", 181.6), b("stay", 495.01), b("stay", 900, "booked", false), b("food", 60, "todo")], 10000);
    expect(s.spent).toBeCloseTo(676.61);
    expect(s.left).toBeCloseTo(9323.39);
    expect(s.planned).toBe(60);
    expect(s.byCategory.stays).toBeCloseTo(495.01);
  });
});

describe("calendar views", () => {
  it("starts weeks on Monday", () => {
    expect(startOfWeek("2027-01-07")).toBe("2027-01-04"); // a Thursday
    expect(startOfWeek("2027-01-04")).toBe("2027-01-04"); // already Monday
    expect(startOfWeek("2027-01-03")).toBe("2026-12-28"); // Sunday belongs to the week before
  });

  it("covers the right days in each view", () => {
    expect(viewRange("day", "2027-02-10")).toEqual({ start: "2027-02-10", end: "2027-02-10" });
    expect(viewRange("week", "2027-02-10")).toEqual({ start: "2027-02-08", end: "2027-02-14" });
    expect(viewRange("month", "2027-02-10")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
    expect(viewDays("week", "2027-02-10")).toHaveLength(7);
    expect(viewDays("day", "2027-02-10")).toEqual(["2027-02-10"]);
    expect(viewDays("month", "2027-01-15")).toHaveLength(31);
  });

  it("steps by one day, week or month and clamps the day of the month", () => {
    expect(shiftAnchor("day", "2027-02-28", 1)).toBe("2027-03-01");
    expect(shiftAnchor("week", "2027-02-10", -1)).toBe("2027-02-03");
    expect(shiftAnchor("month", "2027-01-31", 1)).toBe("2027-02-28");
    expect(shiftAnchor("month", "2027-01-15", -1)).toBe("2026-12-15");
  });

  it("stops navigating once a view leaves the plan window", () => {
    expect(inPlanRange("month", "2026-12-01")).toBe(true);
    expect(inPlanRange("month", "2026-11-30")).toBe(false);
    expect(inPlanRange("week", "2026-11-30")).toBe(true); // that week still reaches Dec 1
    expect(inPlanRange("day", "2027-07-01")).toBe(false);
  });

  it("opens on today during the semester and on its first day otherwise", () => {
    expect(initialAnchor("2027-02-10")).toBe("2027-02-10");
    expect(initialAnchor("2026-11-08")).toBe("2026-12-31");
    expect(initialAnchor("2027-08-01")).toBe("2026-12-31");
  });

  it("titles each view", () => {
    expect(viewTitle("day", "2027-02-10")).toBe("Wednesday, Feb 10");
    expect(viewTitle("week", "2027-02-10")).toBe("Feb 8 – 14");
    expect(viewTitle("month", "2027-02-10")).toBe("February 2027");
  });

  it("lists the trips covering a day, base first", () => {
    const base = { id: "b", title: "Florence", kind: "base", start_date: "2027-01-05", end_date: "2027-03-15" } as Trip;
    const away = { id: "w", title: "Dublin", kind: "weekend", start_date: "2027-02-10", end_date: "2027-02-12" } as Trip;
    expect(tripsOn([away, base], "2027-02-11").map((t) => t.id)).toEqual(["b", "w"]);
    expect(tripsOn([away, base], "2027-02-14").map((t) => t.id)).toEqual(["b"]);
    expect(tripsOn([away, base], "2027-04-01")).toEqual([]);
  });

  it("lists a day's bookings by time, and a stay's check-out day", () => {
    const stay = { id: "s", type: "stay", date: "2027-02-10", end_date: "2027-02-12", time: "" } as Booking;
    const flight = { id: "f", type: "flight", date: "2027-02-10", end_date: null, time: "07:20" } as Booking;
    expect(bookingsOn([stay, flight], "2027-02-10").map((b) => b.id)).toEqual(["f", "s"]);
    expect(bookingsOn([stay, flight], "2027-02-12").map((b) => b.id)).toEqual(["s"]);
    expect(bookingsOn([stay, flight], "2027-02-11")).toEqual([]);
  });
});

describe("canEditPlan", () => {
  it("lets the owner and editors edit while online and live", () => {
    expect(canEditPlan("owner", true, false)).toBe(true);
    expect(canEditPlan("editor", true, false)).toBe(true);
  });
  it("never lets a viewer edit", () => {
    expect(canEditPlan("viewer", true, false)).toBe(false);
  });
  it("still blocks editing offline or on a stale copy", () => {
    expect(canEditPlan("owner", false, false)).toBe(false);
    expect(canEditPlan("editor", true, true)).toBe(false);
  });
  it("blocks editing when the role isn't known yet", () => {
    expect(canEditPlan(null, true, false)).toBe(false);
  });
});

describe("sync payloads", () => {
  const plan = "plan-1";

  it("rebuilds a booking from a whitelist and ignores anything else", () => {
    const row = normalizeBooking(
      { id: "GM-ABC123", title: " Ryanair FR2104 ", type: "flight", date: "2027-02-11", time: "07:20", cost: "64.005", plan_id: "somewhere-else", created_by: "someone", source: "hand" },
      plan,
    );
    expect(row).toMatchObject({ plan_id: plan, id: "gm-abc123", title: "Ryanair FR2104", cost: 64.01, source: "gmail", created_by: null });
  });

  it("files a booking under a trip made by hand, but won't name one", () => {
    expect(normalizeBooking({ id: "gm-a", type: "stay", trip_id: "florence" }, plan).trip_id).toBe("florence");
    expect(normalizeBooking({ id: "gm-a", type: "stay" }, plan).trip_id).toBeNull();
    expect(() => normalizeBooking({ id: "gm-a", type: "stay", trip_id: "../x" }, plan)).toThrow(SyncError);
  });

  it("refuses ids it could use to touch a hand-made row", () => {
    expect(() => normalizeBooking({ id: "my-own-booking", type: "flight" }, plan)).toThrow(SyncError);
    expect(() => normalizeBooking({ id: "gm-../../etc", type: "flight" }, plan)).toThrow(SyncError);
  });

  it("rejects nonsense fields rather than writing them", () => {
    expect(() => normalizeBooking({ id: "gm-a", type: "spaceship" }, plan)).toThrow(SyncError);
    expect(() => normalizeBooking({ id: "gm-a", type: "flight", date: "11/02/2027" }, plan)).toThrow(SyncError);
    expect(() => normalizeBooking({ id: "gm-a", type: "stay", date: "2027-02-11", end_date: "2027-02-01" }, plan)).toThrow(SyncError);
    expect(() => normalizeBooking({ id: "gm-a", type: "flight", cost: -5 }, plan)).toThrow(SyncError);
  });

  it("only offers the movable fields when a booking already exists", () => {
    const row = normalizeBooking({ id: "gm-a", type: "flight", title: "Later flight", cost: 99, notes: "mine" }, plan);
    expect(Object.keys(updatableFields(row)).sort()).toEqual(["date", "end_date", "status", "time", "title"]);
  });

  it("keeps the newest processed ids and drops duplicates", () => {
    expect(processedIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: 350 }, (_, i) => `m${i}`);
    expect(processedIds(many, ["last"]).length).toBe(300);
    expect(processedIds(many, ["last"]).at(-1)).toBe("last");
  });

  it("refuses an oversized or malformed batch", () => {
    expect(() => rowsOf(Array.from({ length: 201 }, () => ({})), "bookings")).toThrow(SyncError);
    expect(() => rowsOf("nope", "bookings")).toThrow(SyncError);
    expect(rowsOf(undefined, "bookings")).toEqual([]);
  });
});

describe("to-do list", () => {
  const today = "2027-02-11";
  const task = (over: Partial<Task>): Task =>
    ({ plan_id: "p", id: "t", title: "x", done: false, due: null, trip_id: null, created_by: null, done_at: null, ...over });

  it("sorts a due date into the right bucket", () => {
    expect(taskGroup(task({ due: "2027-02-09" }), today)).toBe("overdue");
    expect(taskGroup(task({ due: today }), today)).toBe("today");
    expect(taskGroup(task({ due: "2027-02-16" }), today)).toBe("soon");
    expect(taskGroup(task({ due: "2027-02-19" }), today)).toBe("later");
    expect(taskGroup(task({ due: null }), today)).toBe("someday");
    expect(taskGroup(task({ due: "2027-02-09", done: true }), today)).toBe("done");
  });

  it("puts the soonest first, undated last and done at the bottom", () => {
    const list = [
      task({ id: "none", due: null }),
      task({ id: "done", done: true, due: "2027-01-01", done_at: "2027-02-10T10:00:00Z" }),
      task({ id: "late", due: "2027-02-01" }),
      task({ id: "soon", due: "2027-02-14" }),
    ];
    expect(sortTasks(list).map((t) => t.id)).toEqual(["late", "soon", "none", "done"]);
  });

  it("counts only what is still outstanding", () => {
    expect(openTasks([task({ done: false }), task({ done: true }), task({ done: false })])).toBe(2);
  });
});
