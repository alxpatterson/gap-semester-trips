/**
 * Exchange rates, for display only. Expenses are stored and settled in the currency they were paid
 * in; these rates turn a mix of euros, baht and dollars into one rough total.
 *
 * Rates come from /api/fx, which refreshes them from a free daily source at most every few hours,
 * and the browser keeps the last copy so a converted total still shows offline. Pure apart from the
 * types, so it runs on the server and in the browser and is unit-tested.
 */

export type Rates = {
  base: string; // every rate is "units of that currency per 1 base"
  rates: Record<string, number>;
  updated: string; // ISO time the source last published these
  source: string;
};

/** How long the route lets a set of rates be served before fetching again. */
export const FX_MAX_AGE_SECONDS = 6 * 60 * 60;

const goodRates = (r: unknown): r is Record<string, number> =>
  !!r && typeof r === "object" && Object.values(r as object).length > 0 &&
  Object.values(r as object).every((v) => typeof v === "number" && Number.isFinite(v) && v > 0);

/** open.er-api.com: { result: "success", base_code, time_last_update_unix, rates }. Covers 160+ currencies. */
export function parseErApi(json: unknown): Rates | null {
  const j = json as { result?: string; base_code?: string; time_last_update_unix?: number; rates?: unknown };
  if (j?.result !== "success" || typeof j.base_code !== "string" || !goodRates(j.rates)) return null;
  return {
    base: j.base_code.toUpperCase(),
    rates: { ...j.rates, [j.base_code.toUpperCase()]: 1 },
    updated: new Date((j.time_last_update_unix ?? 0) * 1000).toISOString(),
    source: "open.er-api.com",
  };
}

/** Frankfurter (European Central Bank): { base, date, rates }. ~30 currencies — no VND, for one. */
export function parseFrankfurter(json: unknown): Rates | null {
  const j = json as { base?: string; date?: string; rates?: unknown };
  if (typeof j?.base !== "string" || typeof j.date !== "string" || !goodRates(j.rates)) return null;
  return {
    base: j.base.toUpperCase(),
    rates: { ...j.rates, [j.base.toUpperCase()]: 1 },
    updated: new Date(`${j.date}T16:00:00Z`).toISOString(),
    source: "frankfurter.dev (ECB)",
  };
}

/** amount in `from` expressed in `to`, or null when either currency isn't in the table. */
export function convert(amount: number, from: string, to: string, fx: Rates | null): number | null {
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b) return amount;
  const ra = fx?.rates[a];
  const rb = fx?.rates[b];
  if (!ra || !rb) return null;
  return (amount / ra) * rb;
}

/**
 * Add up amounts in several currencies as one, in `to`. Currencies the table lacks are left out
 * and named, so the screen can say the total is partial rather than quietly wrong.
 */
export function totalIn(byCurrency: Record<string, number>, to: string, fx: Rates | null) {
  let total = 0;
  const missing: string[] = [];
  for (const [cur, amount] of Object.entries(byCurrency)) {
    const v = convert(amount, cur, to, fx);
    if (v === null) missing.push(cur);
    else total += v;
  }
  return { total, missing, converted: Object.keys(byCurrency).some((c) => c.toUpperCase() !== to.toUpperCase()) };
}

/** Whether a cached copy is old enough to be worth asking the server again. */
export const ratesStale = (fx: Rates | null, fetchedAt: number | null, now = Date.now()) =>
  !fx || !fetchedAt || now - fetchedAt > FX_MAX_AGE_SECONDS * 1000;

/** The currencies offered when entering an expense: the common travel ones first, then the rest. */
export const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "CHF", "AUD", "NZD", "THB", "VND", "IDR", "SGD", "MYR", "JPY", "CAD"];

export function currencyChoices(fx: Rates | null, extra: string[] = []) {
  const all = new Set([...COMMON_CURRENCIES, ...extra.map((c) => c.toUpperCase())]);
  const rest = Object.keys(fx?.rates ?? {}).filter((c) => !all.has(c)).sort();
  return [...all, ...rest];
}
