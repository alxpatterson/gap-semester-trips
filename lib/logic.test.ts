import { describe, expect, it } from "vitest";
import { budgetSummary, categoryOf, fmtRange, maxSchengenWindow, nights, schengenDays } from "./logic";
import type { Booking } from "./types";

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
