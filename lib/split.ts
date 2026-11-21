/**
 * Splitting costs between friends. Pure, so it is unit-tested and runs anywhere.
 *
 * Everything is worked in whole cents so a three-way split of 100 never loses or invents a cent.
 * Balances are kept per currency: money paid in euros is owed in euros. Converting to one currency
 * is only ever an estimate for display (see lib/fx.ts), never what is stored or settled.
 */
import type { Expense, Share } from "./types";

export const cents = (n: number) => Math.round((Number(n) || 0) * 100);
export const fromCents = (c: number) => Math.round(c) / 100;
const norm = (e: string) => e.trim().toLowerCase();

/**
 * Divide an amount evenly. Leftover cents go one each to the first people in the list, so
 * 100 between three is 33.34 / 33.33 / 33.33 and the shares always add back up.
 */
export function splitEvenly(amount: number, emails: string[]): Share[] {
  const people = [...new Set(emails.map(norm).filter(Boolean))];
  if (!people.length) return [];
  const total = cents(amount);
  const base = Math.floor(total / people.length);
  let extra = total - base * people.length;
  return people.map((email) => {
    const c = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return { email, amount: fromCents(c) };
  });
}

/** Why a split can't be saved, or null if it can. Mirrors the check the database makes. */
export function splitProblem(amount: number, shares: Share[]): string | null {
  if (!(cents(amount) > 0)) return "Enter an amount above zero.";
  if (!shares.length) return "Pick at least one person to split it with.";
  const seen = new Set<string>();
  for (const s of shares) {
    if (!s.email) return "Each share needs a person.";
    if (seen.has(norm(s.email))) return "Someone is in the split twice.";
    seen.add(norm(s.email));
    if (cents(s.amount) < 0) return "A share can't be negative.";
  }
  const diff = cents(amount) - shares.reduce((a, s) => a + cents(s.amount), 0);
  if (diff !== 0) return `The shares are ${fromCents(Math.abs(diff)).toFixed(2)} ${diff > 0 ? "short of" : "over"} the amount.`;
  return null;
}

/** currency → email → cents. Positive means the group owes them; negative means they owe the group. */
export type Balances = Record<string, Record<string, number>>;

/**
 * Whoever paid is owed the amount, and everyone in the shares owes their part. A settlement is the
 * same sum: the person paying back is credited, the person paid is debited, and both move to zero.
 */
export function balances(expenses: Pick<Expense, "amount" | "currency" | "paid_by" | "shares">[]): Balances {
  const out: Balances = {};
  for (const x of expenses) {
    const cur = (x.currency || "").toUpperCase();
    const book = (out[cur] ??= {});
    const payer = norm(x.paid_by);
    book[payer] = (book[payer] ?? 0) + cents(x.amount);
    for (const s of x.shares ?? []) {
      const who = norm(s.email);
      book[who] = (book[who] ?? 0) - cents(s.amount);
    }
  }
  // Drop people who are square, and currencies where everyone is.
  for (const cur of Object.keys(out)) {
    for (const who of Object.keys(out[cur])) if (out[cur][who] === 0) delete out[cur][who];
    if (!Object.keys(out[cur]).length) delete out[cur];
  }
  return out;
}

export type Transfer = { from: string; to: string; amount: number; currency: string };

/**
 * The fewest payments that square a group in one currency: repeatedly have the person who owes the
 * most pay the person owed the most. Ties break by email so every phone suggests the same payments.
 */
export function settleUp(book: Record<string, number>, currency: string): Transfer[] {
  const debtors = Object.entries(book).filter(([, c]) => c < 0).map(([e, c]) => ({ e, c: -c }));
  const creditors = Object.entries(book).filter(([, c]) => c > 0).map(([e, c]) => ({ e, c }));
  const order = (a: { e: string; c: number }, b: { e: string; c: number }) => b.c - a.c || a.e.localeCompare(b.e);
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(order);
    creditors.sort(order);
    const d = debtors[0];
    const k = creditors[0];
    const pay = Math.min(d.c, k.c);
    out.push({ from: d.e, to: k.e, amount: fromCents(pay), currency });
    d.c -= pay;
    k.c -= pay;
    if (d.c === 0) debtors.shift();
    if (k.c === 0) creditors.shift();
  }
  return out;
}

/** Suggested payments for every currency, biggest first within each. */
export function allTransfers(b: Balances): Transfer[] {
  return Object.keys(b)
    .sort()
    .flatMap((cur) => settleUp(b[cur], cur));
}

/** What one person's own share of the spending comes to, per currency (settlements excluded). */
export function shareOf(expenses: Pick<Expense, "kind" | "currency" | "shares">[], email: string): Record<string, number> {
  const me = norm(email);
  const out: Record<string, number> = {};
  for (const x of expenses) {
    if (x.kind === "settlement") continue;
    for (const s of x.shares ?? []) {
      if (norm(s.email) !== me) continue;
      const cur = (x.currency || "").toUpperCase();
      out[cur] = fromCents(cents(out[cur] ?? 0) + cents(s.amount));
    }
  }
  return out;
}

/** "Sam" from a profile, otherwise the part of the email before the @. */
export function nameOf(email: string, profiles: { email: string; display_name: string }[]) {
  const e = norm(email);
  const p = profiles.find((x) => norm(x.email) === e);
  return p?.display_name?.trim() || e.split("@")[0] || e;
}

/**
 * A pay handle as a link where it is one: a full https link, or a bare paypal.me / revolut.me /
 * venmo.com / monzo.me / cash.app address. Anything else ("@sam on Venmo") is shown as text.
 */
export function payLink(handle: string): string | null {
  const h = handle.trim();
  if (/^https:\/\/\S+$/i.test(h)) return h;
  if (/^(paypal\.me|revolut\.me|venmo\.com|monzo\.me|cash\.app)\/[\w.$-]+\/?$/i.test(h)) return `https://${h}`;
  return null;
}
