"use client";

/**
 * Doing a trip with friends: who's on each booking, trip notes, sharing a trip, and splitting costs.
 * Thin views over lib/split.ts and lib/fx.ts; every write goes back through TripApp.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BOOKING_TYPES, JOURNEY_TYPES, fmtDate, localToday, timeSpan } from "@/lib/logic";
import { convert, currencyChoices, ratesStale, totalIn, type Rates } from "@/lib/fx";
import { allTransfers, balances, cents, nameOf, payLink, shareOf, splitEvenly, splitProblem, type Transfer } from "@/lib/split";
import type { Booking, BookingPerson, Expense, Member, Profile, Share, Trip, TripNote } from "@/lib/types";
import { DeleteButton, TypeTile } from "./ui";

// ---------- Formatting ----------
/** Money to the cent, for splits — the budget rounds to whole units, but "you owe €33.34" shouldn't. */
export function amount(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---------- Exchange rates ----------
const FX_KEY = "gst:fx";

/** The latest rates: the saved copy at once, then a fresh one from /api/fx if that copy is over six hours old. */
export function useRates() {
  const [fx, setFx] = useState<Rates | null>(() => {
    try {
      const raw = localStorage.getItem(FX_KEY);
      return raw ? ((JSON.parse(raw) as { fx: Rates }).fx ?? null) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    let at: number | null = null;
    try {
      const raw = localStorage.getItem(FX_KEY);
      at = raw ? ((JSON.parse(raw) as { at: number }).at ?? null) : null;
    } catch {}
    if (!ratesStale(fx, at)) return;
    let cancelled = false;
    fetch("/api/fx")
      .then((r) => (r.ok ? (r.json() as Promise<Rates>) : null))
      .then((next) => {
        if (cancelled || !next?.rates) return;
        setFx(next);
        try {
          localStorage.setItem(FX_KEY, JSON.stringify({ fx: next, at: Date.now() }));
        } catch {}
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only on mount: the saved copy is what decides whether to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return fx;
}

function RatesNote({ fx }: { fx: Rates | null }) {
  if (!fx) return <p className="fine">Converted totals appear once exchange rates have loaded.</p>;
  return (
    <p className="fine">
      ≈ totals use rates from {fmtDate(fx.updated.slice(0, 10))} ({fx.source}). Amounts are owed in the currency they were paid in.
    </p>
  );
}

// ---------- Splitting costs ----------
export type ExpenseInput = Omit<Expense, "plan_id" | "id">;

/** The money panel on the Bookings tab: where you stand, who should pay whom, and what's been spent. */
export function Balances({
  expenses,
  members,
  profiles,
  me,
  currency,
  canEdit,
  onAdd,
  onOpen,
  onSettle,
}: {
  expenses: Expense[];
  members: Member[];
  profiles: Profile[];
  me: string;
  currency: string;
  canEdit: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onSettle: (t: Transfer) => void;
}) {
  const fx = useRates();
  const b = useMemo(() => balances(expenses), [expenses]);
  const transfers = useMemo(() => allTransfers(b), [b]);
  const mine = Object.fromEntries(
    Object.entries(b)
      .map(([cur, book]) => [cur, (book[me.toLowerCase()] ?? 0) / 100] as const)
      .filter(([, v]) => v !== 0),
  );
  const net = totalIn(mine, currency, fx);
  const spent = shareOf(expenses, me);
  const spentTotal = totalIn(spent, currency, fx);
  const name = (e: string) => (same(e, me) ? "You" : nameOf(e, profiles));
  const list = [...expenses].sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id));

  if (members.length < 2 && expenses.length === 0) return null;

  return (
    <section className="panel split" aria-label="Split costs">
      <div className="split-head">
        <h3>Split costs</h3>
        {canEdit && (
          <button className="btn primary small" onClick={onAdd}>
            + Expense
          </button>
        )}
      </div>

      <div className="split-stand">
        {Object.keys(mine).length === 0 ? (
          <span className="big">You&apos;re square</span>
        ) : (
          Object.entries(mine).map(([cur, v]) => (
            <span key={cur} className={`big ${v < 0 ? "neg" : ""}`}>
              {v > 0 ? "You're owed " : "You owe "}
              {amount(Math.abs(v), cur)}
            </span>
          ))
        )}
        {fx && net.converted && Object.keys(mine).length > 1 && (
          <span className="sub">
            ≈ {net.total >= 0 ? "owed" : "owing"} {amount(Math.abs(net.total), currency)} overall
            {net.missing.length > 0 && ` (not counting ${net.missing.join(", ")})`}
          </span>
        )}
        {Object.keys(spent).length > 0 && (
          <span className="sub">
            Your share so far: {Object.entries(spent).map(([cur, v]) => amount(v, cur)).join(" + ")}
            {spentTotal.converted && !spentTotal.missing.length && ` ≈ ${amount(spentTotal.total, currency)}`}
          </span>
        )}
      </div>

      {transfers.length > 0 && (
        <>
          <div className="section-t">To settle up</div>
          <ul className="people">
            {transfers.map((t) => {
              const toProfile = profiles.find((p) => same(p.email, t.to));
              const link = same(t.from, me) && toProfile ? payLink(toProfile.pay_handle) : null;
              return (
                <li key={`${t.currency}-${t.from}-${t.to}`}>
                  <span>
                    {name(t.from)} → {name(t.to)} <b className="num">{amount(t.amount, t.currency)}</b>
                    {same(t.from, me) && toProfile?.pay_handle && !link && <span className="fine"> · {toProfile.pay_handle}</span>}
                  </span>
                  <span className="row-actions tight">
                    {link && (
                      <a className="btn small" href={link} target="_blank" rel="noopener noreferrer">
                        Pay
                      </a>
                    )}
                    {canEdit && (
                      <button className="btn small" onClick={() => onSettle(t)}>
                        Mark paid
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="section-t">Expenses</div>
      {list.length === 0 && <p className="empty">Nothing yet. Add who paid for what and the app works out who owes whom.</p>}
      <ul className="xlist">
        {list.map((x) => {
          const myPart = x.shares.find((s) => same(s.email, me))?.amount ?? 0;
          return (
            <li key={x.id}>
              <button onClick={() => onOpen(x.id)}>
                <span className="d">{fmtDate(x.date)}</span>
                <span className="n">
                  <span className="ttl">{x.kind === "settlement" ? `${name(x.paid_by)} paid ${name(x.shares[0]?.email ?? "")} back` : x.title || "Expense"}</span>
                  <span className="sub">
                    {x.kind === "settlement"
                      ? "Settlement"
                      : `${name(x.paid_by)} paid · split ${x.shares.length} way${x.shares.length > 1 ? "s" : ""}${myPart ? ` · your share ${amount(myPart, x.currency)}` : ""}`}
                  </span>
                </span>
                <span className="num">{amount(Number(x.amount), x.currency)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <RatesNote fx={fx} />
    </section>
  );
}

/** One expense or settlement, read-only, with edit and delete for editors. */
export function ExpenseDetail({
  expense,
  profiles,
  me,
  currency,
  trips,
  canEdit,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  profiles: Profile[];
  me: string;
  currency: string;
  trips: Trip[];
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fx = useRates();
  const x = expense;
  const name = (e: string) => (same(e, me) ? "You" : nameOf(e, profiles));
  const approx = x.currency !== currency ? convert(Number(x.amount), x.currency, currency, fx) : null;
  const trip = trips.find((t) => t.id === x.trip_id);
  return (
    <>
      <dl className="facts">
        <dt>Amount</dt>
        <dd className="num">
          {amount(Number(x.amount), x.currency)}
          {approx !== null && <span className="fine"> ≈ {amount(approx, currency)}</span>}
        </dd>
        <dt>{x.kind === "settlement" ? "From" : "Paid by"}</dt>
        <dd>{name(x.paid_by)}</dd>
        <dt>Date</dt>
        <dd>{fmtDate(x.date)}</dd>
        {trip && (
          <>
            <dt>Trip</dt>
            <dd>{trip.title}</dd>
          </>
        )}
        <dt>{x.kind === "settlement" ? "To" : "Split"}</dt>
        <dd>
          {x.shares.map((s) => (
            <div key={s.email}>
              {name(s.email)} <span className="num">{amount(s.amount, x.currency)}</span>
            </div>
          ))}
        </dd>
        {x.notes && (
          <>
            <dt>Notes</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{x.notes}</dd>
          </>
        )}
      </dl>
      {canEdit && (
        <div className="row-actions">
          <button className="btn small" onClick={onEdit}>
            Edit
          </button>
          <DeleteButton onConfirm={onDelete} />
        </div>
      )}
    </>
  );
}

/** Add or edit an expense — or, with kind "settlement", record one person paying another back. */
export function ExpenseForm({
  expense,
  members,
  profiles,
  me,
  currency,
  trips,
  saving,
  onSave,
  onCancel,
}: {
  expense?: Partial<Expense>;
  members: Member[];
  profiles: Profile[];
  me: string;
  currency: string;
  trips: Trip[];
  saving: boolean;
  onSave: (x: ExpenseInput) => void;
  onCancel: () => void;
}) {
  const fx = useRates();
  const settlement = expense?.kind === "settlement";
  const people = members.map((m) => m.email.toLowerCase());
  const label = (e: string) => (same(e, me) ? `${nameOf(e, profiles)} (you)` : nameOf(e, profiles));

  const [amt, setAmt] = useState(expense?.amount ? String(expense.amount) : "");
  const [cur, setCur] = useState((expense?.currency || currency).toUpperCase());
  const [paidBy, setPaidBy] = useState((expense?.paid_by || me).toLowerCase());
  const [to, setTo] = useState((expense?.shares?.[0]?.email || people.find((p) => !same(p, paidBy)) || "").toLowerCase());
  const initialIn = expense?.shares?.length ? expense.shares.map((s) => s.email.toLowerCase()) : people;
  const [included, setIncluded] = useState<string[]>(initialIn);
  // Custom amounts start as whatever was saved; an even split recomputes them on every change.
  const evenBefore =
    !expense?.shares?.length ||
    JSON.stringify(splitEvenly(Number(expense.amount), initialIn)) ===
      JSON.stringify(expense.shares.map((s) => ({ email: s.email.toLowerCase(), amount: Number(s.amount) })));
  const [mode, setMode] = useState<"even" | "custom">(evenBefore ? "even" : "custom");
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries((expense?.shares ?? []).map((s) => [s.email.toLowerCase(), String(s.amount)])),
  );
  const [error, setError] = useState("");

  const n = Number(amt) || 0;
  const shares: Share[] = settlement
    ? [{ email: to, amount: n }]
    : mode === "even"
      ? splitEvenly(n, included)
      : included.map((e) => ({ email: e, amount: Number(custom[e]) || 0 }));
  const approx = cur !== currency ? convert(n, cur, currency, fx) : null;
  const left = mode === "custom" && !settlement ? (cents(n) - shares.reduce((a, s) => a + cents(s.amount), 0)) / 100 : 0;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (settlement && same(paidBy, to)) return setError("Pick two different people.");
    const problem = splitProblem(n, shares);
    if (problem) return setError(problem);
    setError("");
    onSave({
      kind: settlement ? "settlement" : "expense",
      title: settlement ? "Settle up" : s("title"),
      amount: Math.round(n * 100) / 100,
      currency: cur,
      paid_by: paidBy,
      date: s("date") || localToday(),
      trip_id: s("trip_id") || null,
      booking_id: expense?.booking_id ?? null,
      shares,
      notes: s("notes"),
    });
  };

  return (
    <form className="f" onSubmit={submit}>
      {!settlement && (
        <label>
          What
          <input name="title" required maxLength={100} defaultValue={expense?.title ?? ""} placeholder="Dinner in Trastevere" />
        </label>
      )}
      <div className="two">
        <label>
          Amount
          <input type="number" min={0.01} step="0.01" inputMode="decimal" required value={amt} onChange={(e) => setAmt(e.target.value)} />
        </label>
        <label>
          Currency
          <select value={cur} onChange={(e) => setCur(e.target.value)}>
            {currencyChoices(fx, [currency, cur]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {approx !== null && n > 0 && <p className="fine">≈ {amount(approx, currency)} at today&apos;s rate</p>}
      <div className="two">
        <label>
          {settlement ? "Who paid" : "Paid by"}
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {people.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
        {settlement ? (
          <label>
            Paid back to
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {people.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Date
            <input name="date" type="date" defaultValue={expense?.date ?? localToday()} />
          </label>
        )}
      </div>
      {settlement && (
        <label>
          Date
          <input name="date" type="date" defaultValue={expense?.date ?? localToday()} />
        </label>
      )}

      {!settlement && (
        <>
          <div className="split-mode tabs seg" role="group" aria-label="How to split">
            <button type="button" aria-pressed={mode === "even"} onClick={() => setMode("even")}>
              Evenly
            </button>
            <button type="button" aria-pressed={mode === "custom"} onClick={() => setMode("custom")}>
              Custom amounts
            </button>
          </div>
          <ul className="split-who">
            {people.map((p) => {
              const on = included.includes(p);
              const share = shares.find((s) => s.email === p);
              return (
                <li key={p}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setIncluded((list) => (e.target.checked ? [...list, p] : list.filter((x) => x !== p)))}
                    />
                    {label(p)}
                  </label>
                  {on &&
                    (mode === "custom" ? (
                      <input
                        aria-label={`${label(p)}'s share`}
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={custom[p] ?? ""}
                        onChange={(e) => setCustom((c) => ({ ...c, [p]: e.target.value }))}
                      />
                    ) : (
                      <span className="num">{amount(share?.amount ?? 0, cur)}</span>
                    ))}
                </li>
              );
            })}
          </ul>
          {mode === "custom" && n > 0 && left !== 0 && (
            <p className="fine">{amount(Math.abs(left), cur)} {left > 0 ? "still to assign" : "too much assigned"}</p>
          )}
          <label>
            Trip
            <select name="trip_id" defaultValue={expense?.trip_id ?? ""}>
              <option value="">No trip</option>
              {[...trips]
                .sort((a, b) => (a.start_date || "9").localeCompare(b.start_date || "9"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <label>
        Notes
        <textarea name="notes" maxLength={1000} defaultValue={expense?.notes ?? ""} />
      </label>
      {error && <p className="empty" style={{ color: "var(--alert)", padding: 0 }}>{error}</p>}
      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : settlement ? "Record payment" : "Save expense"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- Who's on a booking ----------
/** Toggle chips for each member of the plan; tap to put someone on this booking or take them off. */
export function BookingPeople({
  booking,
  people,
  members,
  profiles,
  me,
  canEdit,
  onToggle,
}: {
  booking: Booking;
  people: BookingPerson[];
  members: Member[];
  profiles: Profile[];
  me: string;
  canEdit: boolean;
  onToggle: (email: string, on: boolean) => void;
}) {
  if (members.length < 2) return null;
  const on = new Set(people.filter((p) => p.booking_id === booking.id).map((p) => p.email));
  return (
    <>
      <div className="section-t">Who&apos;s on it</div>
      <div className="tchips">
        {members.map((m) => {
          const e = m.email.toLowerCase();
          const active = on.has(e);
          return (
            <button key={e} className="tchip" aria-pressed={active} disabled={!canEdit} onClick={() => onToggle(e, !active)}>
              {same(e, me) ? "You" : nameOf(e, profiles)}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------- A trip, with friends ----------
/** Everything social under a trip: arrivals, costs, the notes thread, and sharing it. */
export function TripSocial({
  trip,
  bookings,
  people,
  notes,
  expenses,
  members,
  profiles,
  me,
  currency,
  canEdit,
  canShare,
  saving,
  onOpenBooking,
  onAddExpense,
  onAddNote,
  onDeleteNote,
  onShare,
}: {
  trip: Trip;
  bookings: Booking[];
  people: BookingPerson[];
  notes: TripNote[];
  expenses: Expense[];
  members: Member[];
  profiles: Profile[];
  me: string;
  currency: string;
  canEdit: boolean;
  canShare: boolean;
  saving: boolean;
  onOpenBooking: (id: string) => void;
  onAddExpense: () => void;
  onAddNote: (body: string) => Promise<boolean>;
  onDeleteNote: (id: string) => void;
  onShare: (emails: string[]) => void;
}) {
  const [note, setNote] = useState("");
  const [sharing, setSharing] = useState(false);
  const [invite, setInvite] = useState("");
  const name = (e: string) => (same(e, me) ? "You" : nameOf(e, profiles));

  const journeys = bookings
    .filter((b) => b.trip_id === trip.id && JOURNEY_TYPES.includes(b.type))
    .sort((a, b) => `${a.date ?? "9"} ${a.time}`.localeCompare(`${b.date ?? "9"} ${b.time}`));
  const tripNotes = notes.filter((n) => n.trip_id === trip.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const tripCosts = expenses.filter((x) => x.trip_id === trip.id && x.kind === "expense");
  const byCur: Record<string, number> = {};
  for (const x of tripCosts) byCur[x.currency] = (byCur[x.currency] ?? 0) + Number(x.amount);
  const tripBookings = bookings.filter((b) => b.trip_id === trip.id).length;
  const emails = invite
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  return (
    <>
      {members.length > 1 && journeys.length > 0 && (
        <>
          <div className="section-t">Getting there</div>
          <ul className="arrivals">
            {journeys.map((b) => {
              const who = people.filter((p) => p.booking_id === b.id).map((p) => name(p.email));
              return (
                <li key={b.id}>
                  <button onClick={() => onOpenBooking(b.id)}>
                    <TypeTile type={b.type} />
                    <span className="n">
                      <span className="ttl">{b.title}</span>
                      <span className="sub">
                        {[b.date ? fmtDate(b.date) : "", timeSpan(b), BOOKING_TYPES[b.type]].filter(Boolean).join(" · ")}
                      </span>
                      <span className="sub">{who.length ? who.join(", ") : "Nobody marked on it yet"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(members.length > 1 || tripCosts.length > 0) && (
        <>
          <div className="section-t">Shared costs</div>
          <div className="row-actions">
            <span className="num">
              {tripCosts.length
                ? `${Object.entries(byCur).map(([c, v]) => amount(v, c)).join(" + ")} over ${tripCosts.length} expense${tripCosts.length > 1 ? "s" : ""}`
                : "Nothing split yet"}
            </span>
            {canEdit && (
              <button className="btn small" onClick={onAddExpense}>
                + Expense
              </button>
            )}
          </div>
        </>
      )}

      {(members.length > 1 || tripNotes.length > 0) && (
        <>
          <div className="section-t">Notes</div>
          <ul className="tnotes">
            {tripNotes.length === 0 && <li className="empty">Meeting points, who&apos;s bringing what, door codes…</li>}
            {tripNotes.map((n) => (
              <li key={n.id}>
                <span className="who">
                  {name(n.author)} · {fmtDate(n.created_at.slice(0, 10))}
                </span>
                <span className="body">{n.body}</span>
                {same(n.author, me) && canEdit && (
                  <button className="x small" aria-label="Delete note" onClick={() => onDeleteNote(n.id)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form
              className="todo-add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!note.trim()) return;
                if (await onAddNote(note.trim())) setNote("");
              }}
            >
              <input aria-label="Add a note" placeholder="Meet at the station at 9" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn primary" disabled={saving || !note.trim()}>
                Post
              </button>
            </form>
          )}
        </>
      )}

      {canShare && (
        <>
          <div className="section-t">Friends</div>
          {!sharing ? (
            <div className="row-actions">
              <span className="fine">Doing this one with friends? Share it so they can add bookings and split costs.</span>
              <button className="btn small" onClick={() => setSharing(true)}>
                Share this trip
              </button>
            </div>
          ) : (
            <form
              className="f"
              onSubmit={(e) => {
                e.preventDefault();
                onShare(emails);
              }}
            >
              <label>
                Friends&apos; emails
                <textarea
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="sam@example.com, jo@example.com"
                  maxLength={2000}
                  rows={2}
                />
              </label>
              <p className="fine">
                This moves {trip.title}
                {tripBookings ? ` and its ${tripBookings} booking${tripBookings > 1 ? "s" : ""}` : ""} into a new shared trip. It still shows
                on your calendar, and everyone on this plan keeps access. The people above can edit it; anyone without an account gets in when
                they sign up with that email. You can&apos;t undo this from the app.
              </p>
              <div className="row-actions">
                <button className="btn primary" disabled={saving}>
                  {saving ? "Sharing…" : emails.length ? `Share with ${emails.length} ${emails.length > 1 ? "people" : "person"}` : "Share"}
                </button>
                <button className="btn" type="button" onClick={() => setSharing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </>
  );
}

// ---------- Your profile ----------
/** Your name and how people pay you back, shown to anyone you share a plan with. */
export function ProfileForm({
  profile,
  me,
  onSave,
}: {
  profile: Profile | undefined;
  me: string;
  onSave: (p: { display_name: string; pay_handle: string }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <div className="row-actions">
        <span>
          {profile?.display_name || me.split("@")[0]}
          {profile?.pay_handle && <span className="fine"> · paid via {profile.pay_handle}</span>}
        </span>
        <button className="btn small" onClick={() => setOpen(true)}>
          Edit name
        </button>
      </div>
    );
  return (
    <form
      className="f"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const ok = await onSave({
          display_name: String(f.get("display_name") ?? "").trim().slice(0, 40),
          pay_handle: String(f.get("pay_handle") ?? "").trim().slice(0, 80),
        });
        setBusy(false);
        if (ok) setOpen(false);
      }}
    >
      <label>
        Your name
        <input name="display_name" maxLength={40} defaultValue={profile?.display_name ?? ""} placeholder={me.split("@")[0]} />
      </label>
      <label>
        How friends pay you back
        <input name="pay_handle" maxLength={80} defaultValue={profile?.pay_handle ?? ""} placeholder="paypal.me/you, revolut.me/you or @you on Venmo" />
      </label>
      <div className="row-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
