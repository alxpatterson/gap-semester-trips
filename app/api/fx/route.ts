/**
 * Exchange rates for the split-costs screens.
 *
 * Asks open.er-api.com (free, no key, updated daily, covers Asian currencies such as VND), falling
 * back to Frankfurter (European Central Bank rates). Both fetches are cached by Next for six hours
 * and the response is cached at Vercel's edge for the same, so however many phones ask, the
 * upstream sources see a handful of requests a day. No secrets and no database involved.
 */
import { FX_MAX_AGE_SECONDS, parseErApi, parseFrankfurter, type Rates } from "@/lib/fx";

export const runtime = "nodejs";

async function get(url: string, parse: (j: unknown) => Rates | null) {
  try {
    const res = await fetch(url, { next: { revalidate: FX_MAX_AGE_SECONDS }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}

export async function GET() {
  const rates =
    (await get("https://open.er-api.com/v6/latest/USD", parseErApi)) ??
    (await get("https://api.frankfurter.dev/v1/latest?base=USD", parseFrankfurter));
  if (!rates) return Response.json({ error: "Exchange rates are unavailable right now" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(rates, {
    headers: { "Cache-Control": `public, s-maxage=${FX_MAX_AGE_SECONDS}, stale-while-revalidate=86400` },
  });
}
