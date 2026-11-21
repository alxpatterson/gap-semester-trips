import { describe, expect, it } from "vitest";
import { convert, currencyChoices, parseErApi, parseFrankfurter, ratesStale, totalIn, type Rates } from "./fx";
import { allTransfers, balances, nameOf, payLink, settleUp, shareOf, splitEvenly, splitProblem } from "./split";
import type { Expense } from "./types";

const A = "alex@example.com";
const S = "sam@example.com";
const J = "jo@example.com";

const exp = (p: Partial<Expense> & Pick<Expense, "amount" | "paid_by" | "shares">): Expense => ({
  plan_id: "p",
  id: Math.random().toString(36),
  kind: "expense",
  title: "",
  currency: "EUR",
  date: "2027-02-10",
  trip_id: null,
  booking_id: null,
  notes: "",
  ...p,
});

describe("splitEvenly", () => {
  it("never loses or invents a cent", () => {
    const s = splitEvenly(100, [A, S, J]);
    expect(s.map((x) => x.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(s.reduce((a, x) => a + x.amount * 100, 0)).toBeCloseTo(10000, 6);
  });
  it("lower-cases and drops duplicate people", () => {
    expect(splitEvenly(10, ["Sam@Example.com", S, ""])).toEqual([{ email: S, amount: 10 }]);
  });
  it("returns nothing with nobody to split with", () => {
    expect(splitEvenly(10, [])).toEqual([]);
  });
});

describe("splitProblem", () => {
  it("accepts shares that add up", () => {
    expect(splitProblem(100, splitEvenly(100, [A, S, J]))).toBeNull();
  });
  it("says how far off a custom split is", () => {
    expect(splitProblem(100, [{ email: A, amount: 60 }, { email: S, amount: 30 }])).toBe("The shares are 10.00 short of the amount.");
    expect(splitProblem(50, [{ email: A, amount: 60 }])).toBe("The shares are 10.00 over the amount.");
  });
  it("rejects a zero amount, an empty split and a person twice", () => {
    expect(splitProblem(0, [{ email: A, amount: 0 }])).toMatch(/above zero/);
    expect(splitProblem(10, [])).toMatch(/at least one/);
    expect(splitProblem(10, [{ email: A, amount: 5 }, { email: "ALEX@example.com", amount: 5 }])).toMatch(/twice/);
  });
});

describe("balances and settleUp", () => {
  it("credits the payer and debits everyone in the split, per currency", () => {
    const b = balances([
      exp({ amount: 90, paid_by: A, shares: splitEvenly(90, [A, S, J]) }),
      exp({ amount: 20, currency: "USD", paid_by: S, shares: splitEvenly(20, [A, S]) }),
    ]);
    expect(b.EUR).toEqual({ [A]: 6000, [S]: -3000, [J]: -3000 });
    expect(b.USD).toEqual({ [S]: 1000, [A]: -1000 });
  });

  it("a settlement squares the people in it", () => {
    const b = balances([
      exp({ amount: 90, paid_by: A, shares: splitEvenly(90, [A, S, J]) }),
      exp({ kind: "settlement", amount: 30, paid_by: S, shares: [{ email: A, amount: 30 }] }),
    ]);
    expect(b.EUR).toEqual({ [A]: 3000, [J]: -3000 });
  });

  it("drops a currency once everyone in it is square", () => {
    const b = balances([
      exp({ amount: 10, paid_by: A, shares: [{ email: S, amount: 10 }] }),
      exp({ kind: "settlement", amount: 10, paid_by: S, shares: [{ email: A, amount: 10 }] }),
    ]);
    expect(b).toEqual({});
  });

  it("suggests the fewest payments, and the same ones on every phone", () => {
    const t = settleUp({ [A]: 6000, [S]: -2000, [J]: -4000 }, "EUR");
    expect(t).toEqual([
      { from: J, to: A, amount: 40, currency: "EUR" },
      { from: S, to: A, amount: 20, currency: "EUR" },
    ]);
  });

  it("chains through a middle person rather than paying twice", () => {
    // Jo owes Sam 10, Sam owes Alex 10: one payment, Jo → Alex.
    expect(settleUp({ [A]: 1000, [S]: 0, [J]: -1000 }, "EUR")).toEqual([{ from: J, to: A, amount: 10, currency: "EUR" }]);
  });

  it("lists every currency", () => {
    const t = allTransfers({ USD: { [A]: 500, [S]: -500 }, EUR: { [S]: 100, [J]: -100 } });
    expect(t.map((x) => x.currency)).toEqual(["EUR", "USD"]);
  });
});

describe("shareOf", () => {
  it("adds up one person's shares and ignores settlements", () => {
    const list = [
      exp({ amount: 90, paid_by: A, shares: splitEvenly(90, [A, S, J]) }),
      exp({ amount: 10, paid_by: S, shares: [{ email: A, amount: 10 }] }),
      exp({ kind: "settlement", amount: 30, paid_by: S, shares: [{ email: A, amount: 30 }] }),
    ];
    expect(shareOf(list, "ALEX@example.com")).toEqual({ EUR: 40 });
  });
});

describe("nameOf and payLink", () => {
  it("uses a profile name, else the email before the @", () => {
    expect(nameOf(S, [{ email: S, display_name: "Sam" }])).toBe("Sam");
    expect(nameOf(J, [{ email: S, display_name: "Sam" }])).toBe("jo");
  });
  it("links only what is safely a link", () => {
    expect(payLink("paypal.me/samtravels")).toBe("https://paypal.me/samtravels");
    expect(payLink("https://revolut.me/sam")).toBe("https://revolut.me/sam");
    expect(payLink("@sam on venmo")).toBeNull();
    expect(payLink("javascript:alert(1)")).toBeNull();
  });
});

const fx: Rates = { base: "USD", rates: { USD: 1, EUR: 0.9, THB: 36 }, updated: "2027-02-10T00:00:00Z", source: "test" };

describe("fx", () => {
  it("converts through the base", () => {
    expect(convert(90, "EUR", "USD", fx)).toBeCloseTo(100);
    expect(convert(360, "THB", "EUR", fx)).toBeCloseTo(9);
    expect(convert(5, "EUR", "eur", null)).toBe(5);
    expect(convert(5, "EUR", "VND", fx)).toBeNull();
  });

  it("totals a mix and names what it couldn't convert", () => {
    expect(totalIn({ EUR: 90, THB: 360, VND: 1000 }, "USD", fx)).toEqual({ total: 110, missing: ["VND"], converted: true });
    expect(totalIn({ USD: 5 }, "USD", null)).toEqual({ total: 5, missing: [], converted: false });
  });

  it("reads both sources and refuses junk", () => {
    const er = parseErApi({ result: "success", base_code: "USD", time_last_update_unix: 1800000000, rates: { EUR: 0.9, VND: 25000 } });
    expect(er?.rates).toEqual({ EUR: 0.9, VND: 25000, USD: 1 });
    expect(er?.updated).toBe("2027-01-15T08:00:00.000Z");
    expect(parseFrankfurter({ base: "USD", date: "2027-02-10", rates: { EUR: 0.9 } })?.rates.EUR).toBe(0.9);
    expect(parseErApi({ result: "error" })).toBeNull();
    expect(parseErApi({ result: "success", base_code: "USD", rates: { EUR: "0.9" } })).toBeNull();
    expect(parseFrankfurter({ base: "USD", date: "2027-02-10", rates: {} })).toBeNull();
  });

  it("refetches after six hours", () => {
    const now = 1_000_000_000_000;
    expect(ratesStale(fx, now - 60_000, now)).toBe(false);
    expect(ratesStale(fx, now - 7 * 3600_000, now)).toBe(true);
    expect(ratesStale(null, now, now)).toBe(true);
  });

  it("offers common currencies first, then the rest of the table", () => {
    const list = currencyChoices({ ...fx, rates: { ...fx.rates, AAA: 1 } }, ["kzt"]);
    expect(list.slice(0, 2)).toEqual(["USD", "EUR"]);
    expect(list).toContain("KZT");
    expect(list.at(-1)).toBe("AAA");
  });
});
