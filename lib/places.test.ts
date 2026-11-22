import { describe, expect, it } from "vitest";
import { countriesIn, countriesOfTrip, countryVisits, knownPlaces, normalize, tripStatus } from "./places";
import { COUNTRIES, MAP_HEIGHT, MAP_WIDTH, projectLonLat } from "./countries";
import type { Trip } from "./types";

const trip = (t: Partial<Trip>): Trip => ({
  plan_id: "p",
  id: Math.random().toString(36).slice(2),
  title: "",
  kind: "weekend",
  status: "planned",
  start_date: null,
  end_date: null,
  place: "",
  schengen: false,
  notes: "",
  source: "",
  created_by: null,
  ...t,
});

describe("reading a place", () => {
  it("takes the country straight from its name", () => {
    expect(countriesIn("Italy", true)).toEqual(["ITA"]);
    expect(countriesIn("Thailand", true)).toEqual(["THA"]);
  });
  it("knows cities", () => {
    expect(countriesIn("Florence", true)).toEqual(["ITA"]);
    expect(countriesIn("Siem Reap", true)).toEqual(["KHM"]);
    expect(countriesIn("Queenstown", true)).toEqual(["NZL"]);
  });
  it("ignores accents, case and punctuation", () => {
    expect(countriesIn("Kraków", true)).toEqual(["POL"]);
    expect(countriesIn("reykjavík!", true)).toEqual(["ISL"]);
    expect(countriesIn("Ho Chi Minh City", true)).toEqual(["VNM"]);
  });
  it("gives the city and the country one answer, not two", () => {
    expect(countriesIn("Florence, Italy", true)).toEqual(["ITA"]);
  });
  it("lists every country a journey touches, in order", () => {
    expect(countriesIn("Bangkok → Hanoi", true)).toEqual(["THA", "VNM"]);
    expect(countriesIn("Rome, Vienna, Prague", true)).toEqual(["ITA", "AUT", "CZE"]);
  });
  it("prefers the longest name it can match", () => {
    expect(countriesIn("New York", true)).toEqual(["USA"]);
    expect(countriesIn("Jersey", true)).toEqual(["JEY"]);
    expect(countriesIn("Equatorial Guinea", true)).toEqual(["GNQ"]);
    expect(countriesIn("Papua New Guinea", true)).toEqual(["PNG"]);
  });
  it("finds nothing in text that names nowhere", () => {
    expect(countriesIn("TBD", true)).toEqual([]);
    expect(countriesIn("a long weekend somewhere warm", true)).toEqual([]);
    expect(countriesIn("", true)).toEqual([]);
  });
  it("only reads the risky names in a Where box", () => {
    expect(countriesIn("Nice", true)).toEqual(["FRA"]);
    expect(countriesIn("Nice weekend away", false)).toEqual([]);
    expect(countriesIn("Split", true)).toEqual(["HRV"]);
  });
  it("normalizes to plain words", () => {
    expect(normalize("  Côte d'Azur! ")).toBe("cote d azur");
  });
});

describe("placing a trip", () => {
  it("uses the Where box when there is one", () => {
    expect(countriesOfTrip({ place: "Florence", title: "Base" })).toEqual(["ITA"]);
  });
  it("falls back to the title when there isn't", () => {
    expect(countriesOfTrip({ place: "", title: "Weekend in Barcelona" })).toEqual(["ESP"]);
  });
  it("does not let a title override a Where box", () => {
    expect(countriesOfTrip({ place: "Lisbon", title: "flying from Madrid" })).toEqual(["PRT"]);
  });
});

describe("what a trip says about a country", () => {
  const today = "2027-02-10";
  it("reads a trip covering today as being there now", () => {
    expect(tripStatus({ start_date: "2027-02-08", end_date: "2027-02-12", status: "booked" }, today)).toBe("now");
  });
  it("reads a finished trip as been", () => {
    expect(tripStatus({ start_date: "2027-01-02", end_date: "2027-01-05", status: "booked" }, today)).toBe("been");
  });
  it("reads a trip still to come as booked", () => {
    expect(tripStatus({ start_date: "2027-03-01", end_date: "2027-03-04", status: "planned" }, today)).toBe("booked");
  });
  it("leaves an idea an idea, whenever it was", () => {
    expect(tripStatus({ start_date: "2027-01-02", end_date: "2027-01-05", status: "idea" }, today)).toBe("idea");
    expect(tripStatus({ start_date: null, end_date: null, status: "planned" }, today)).toBe("idea");
  });
});

describe("the countries the map colours in", () => {
  const today = "2027-02-10";

  it("gathers a country's trips and counts its days", () => {
    const { visits } = countryVisits(
      [
        trip({ place: "Florence", start_date: "2027-01-05", end_date: "2027-01-09", status: "booked" }),
        trip({ place: "Rome", start_date: "2027-01-20", end_date: "2027-01-22", status: "booked" }),
      ],
      today,
    );
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ code: "ITA", name: "Italy", status: "been", days: 8, first: "2027-01-05", last: "2027-01-22" });
  });

  it("counts a day shared by two trips once", () => {
    const { visits } = countryVisits(
      [
        trip({ place: "Italy", start_date: "2027-01-05", end_date: "2027-01-10", status: "booked" }),
        trip({ place: "Italy", start_date: "2027-01-08", end_date: "2027-01-12", status: "booked" }),
      ],
      today,
    );
    expect(visits[0].days).toBe(8);
  });

  it("gives a country the strongest standing of its trips", () => {
    const { visits } = countryVisits(
      [
        trip({ place: "Italy", start_date: "2027-03-01", end_date: "2027-03-04", status: "idea" }),
        trip({ place: "Italy", start_date: "2027-01-05", end_date: "2027-01-09", status: "booked" }),
      ],
      today,
    );
    expect(visits[0].status).toBe("been");
  });

  it("colours every country a single trip crosses", () => {
    const { visits } = countryVisits([trip({ place: "Bangkok → Hanoi", start_date: "2027-04-01", end_date: "2027-04-02" })], today);
    expect(visits.map((v) => v.code).sort()).toEqual(["THA", "VNM"]);
  });

  it("sets aside the trips it cannot place", () => {
    const { visits, unplaced } = countryVisits([trip({ title: "Somewhere sunny" }), trip({ place: "Lisbon" })], today);
    expect(visits.map((v) => v.code)).toEqual(["PRT"]);
    expect(unplaced).toHaveLength(1);
  });

  it("puts where you are now first, then where you have been", () => {
    const { visits } = countryVisits(
      [
        trip({ place: "Spain", start_date: "2027-03-01", end_date: "2027-03-04", status: "idea" }),
        trip({ place: "Italy", start_date: "2027-02-08", end_date: "2027-02-12", status: "booked" }),
        trip({ place: "France", start_date: "2027-01-01", end_date: "2027-01-04", status: "booked" }),
        trip({ place: "Japan", start_date: "2027-05-01", end_date: "2027-05-09", status: "planned" }),
      ],
      today,
    );
    expect(visits.map((v) => v.status)).toEqual(["now", "been", "booked", "idea"]);
  });

  it("ignores a trip with no dates rather than counting days for it", () => {
    const { visits } = countryVisits([trip({ place: "Peru" })], today);
    expect(visits[0]).toMatchObject({ code: "PER", days: 0, first: null, last: null, status: "idea" });
  });
});

describe("the outlines the map draws", () => {
  it("has a shape for every country the gazetteer can name", () => {
    const drawn = new Set(COUNTRIES.map((c) => c.code));
    const missing = [...new Set(knownPlaces().values())].filter((code) => !drawn.has(code));
    expect(missing).toEqual([]);
  });
  it("gives every country a label point inside the map", () => {
    for (const c of COUNTRIES) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(MAP_WIDTH);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(MAP_HEIGHT);
    }
  });
  it("has no duplicate countries", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
  });
  it("projects with the same maths the outlines were built with", () => {
    // Greenwich at the equator: halfway across, and below the middle because the band is not centred.
    expect(projectLonLat(0, 0).x).toBeCloseTo(MAP_WIDTH / 2, 6);
    const rome = projectLonLat(12.5, 41.9);
    const italy = COUNTRIES.find((c) => c.code === "ITA")!;
    expect(Math.hypot(rome.x - italy.x, rome.y - italy.y)).toBeLessThan(120);
  });
});
