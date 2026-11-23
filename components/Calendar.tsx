"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import {
  BOOKING_TYPES,
  categoryOf,
  bookingsOn,
  CAL_VIEWS,
  dayNum,
  DOWS,
  fmtDate,
  fmtRange,
  fromDayNum,
  inPlanRange,
  KIND_ORDER,
  KINDS,
  money,
  MONTHS_LONG,
  nights,
  rangeMonths,
  shiftAnchor,
  timeSpan,
  tripsOn,
  tripEnd,
  viewDays,
  viewTitle,
  weekday,
  type CalView,
  type PlanRange,
} from "@/lib/logic";
import type { Booking, Trip } from "@/lib/types";
import { TypeTile } from "./ui";


/**
 * Click a day, or drag across several, to start something on those dates. A mouse or pen drags
 * straight away; a finger has to press and hold first, because a swipe on a phone is how you scroll.
 * Anything already on a day (a trip bar, a booking) keeps its own click.
 */
function useDayPick(enabled: boolean, onPick?: (start: string, end: string) => void) {
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  const st = useRef<{ id: number; a: string; touch: boolean; armed: boolean; x: number; y: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const box = useRef<HTMLElement | null>(null);
  const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-day]")?.dataset.day ?? null;

  // Once a finger has been held, the browser must not take the gesture over as a scroll.
  useEffect(() => {
    const el = box.current;
    if (!el || !enabled) return;
    const stop = (e: TouchEvent) => st.current?.armed && e.cancelable && e.preventDefault();
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, [enabled]);

  const end = () => {
    if (st.current?.timer) clearTimeout(st.current.timer);
    st.current = null;
    setSel(null);
  };

  if (!enabled) return { sel: null, bind: {}, ref: box };
  const bind = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input")) return;
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
      if (!a) return;
      const touch = e.pointerType === "touch";
      st.current = { id: e.pointerId, a, touch, armed: !touch, x: e.clientX, y: e.clientY };
      if (touch) {
        st.current.timer = setTimeout(() => {
          if (!st.current) return;
          st.current.armed = true;
          setSel({ a, b: a });
          try { navigator.vibrate?.(8); } catch {}
        }, 350);
      } else {
        setSel({ a, b: a });
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      }
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const c = st.current;
      if (!c || e.pointerId !== c.id) return;
      if (!c.armed) {
        // Moved before the hold finished: they are scrolling, so leave them to it.
        if (Math.hypot(e.clientX - c.x, e.clientY - c.y) > 8) end();
        return;
      }
      const d = dayAt(e.clientX, e.clientY);
      if (d) setSel((cur) => (cur && cur.b !== d ? { a: c.a, b: d } : cur));
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const c = st.current;
      if (!c || e.pointerId !== c.id) return;
      const d = (c.armed && dayAt(e.clientX, e.clientY)) || (c.touch && !c.armed ? c.a : null) || sel?.b || c.a;
      const a = c.a;
      end();
      if (d) onPick?.(a <= d ? a : d, a <= d ? d : a);
    },
    onPointerCancel: end,
  };
  return { sel, bind, ref: box };
}

const inSel = (sel: { a: string; b: string } | null, d: string) => !!sel && d >= (sel.a < sel.b ? sel.a : sel.b) && d <= (sel.a < sel.b ? sel.b : sel.a);

export function CalendarPanel({
  view,
  anchor,
  range,
  currency,
  trips,
  bookings,
  loaded,
  today,
  onView,
  onAnchor,
  onTrip,
  onBooking,
  onPickDays,
}: {
  view: CalView;
  anchor: string;
  range: PlanRange;
  currency: string;
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onView: (v: CalView) => void;
  onAnchor: (d: string) => void;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  /** Set when the person can edit: a click or drag over days asks to add something on them. */
  onPickDays?: (start: string, end: string) => void;
}) {
  const all = view === "all";
  const step = view === "month" || all ? "month" : view === "week" ? "week" : "day";
  return (
    <div className="panel">
      <div className="monthbar">
        <h2>{all ? fmtRange(range.start, range.end) : viewTitle(view, anchor)}</h2>
        <div className="navs">
          <button className="btn" aria-label={`Previous ${step}`} disabled={all || !inPlanRange(view, shiftAnchor(view, anchor, -1), range)} onClick={() => onAnchor(shiftAnchor(view, anchor, -1))}>
            ‹
          </button>
          <button className="btn" aria-label={`Next ${step}`} disabled={all || !inPlanRange(view, shiftAnchor(view, anchor, 1), range)} onClick={() => onAnchor(shiftAnchor(view, anchor, 1))}>
            ›
          </button>
          <div className="tabs seg" role="group" aria-label="Calendar view">
            {CAL_VIEWS.map(([v, label]) => (
              <button key={v} aria-pressed={view === v} onClick={() => onView(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {all ? (
        <div className="allview">
          {rangeMonths(range).map((m) => (
            <section key={m} className="allmonth">
              <button className="allhead" onClick={() => { onAnchor(`${m}-01` < range.start ? range.start : `${m}-01`); onView("month"); }}>
                {MONTHS_LONG[+m.slice(5) - 1]} {m.slice(0, 4)}
              </button>
              <MonthGrid month={m} trips={trips} today={today} onTrip={onTrip} onPickDays={onPickDays} />
            </section>
          ))}
        </div>
      ) : view === "month" ? (
        <MonthGrid month={anchor.slice(0, 7)} trips={trips} today={today} onTrip={onTrip} onPickDays={onPickDays} />
      ) : view === "week" ? (
        <WeekGrid anchor={anchor} trips={trips} bookings={bookings} today={today} onTrip={onTrip} onBooking={onBooking} onPickDays={onPickDays} />
      ) : (
        <DayView anchor={anchor} currency={currency} trips={trips} bookings={bookings} loaded={loaded} today={today} onTrip={onTrip} onBooking={onBooking} />
      )}

      <div className="legend">
        <span className="k-base"><i />Base</span>
        <span className="k-weekend"><i />Weekend trip</span>
        <span className="k-travel"><i />Travel leg</span>
        <span className="k-other"><i />Other</span>
        <span className="note">Striped = still an idea</span>
      </div>
    </div>
  );
}

/** Day view: where you are, then what's booked — kept as two separate sections. */
function DayView({
  anchor,
  currency,
  trips,
  bookings,
  loaded,
  today,
  onTrip,
  onBooking,
}: {
  anchor: string;
  currency: string;
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
}) {
  const here = tripsOn(trips, anchor);
  const items = bookingsOn(bookings, anchor);
  return (
    <div className={`agenda ${anchor === today ? "today" : ""}`}>
      <section className="asec place">
        <h3 className="asec-t">Where you are</h3>
        {here.length === 0 && <p className="anone">{loaded ? "No trip covers this day." : "…"}</p>}
        {here.map((t) => (
          <button key={t.id} className={`atrip k-${t.kind} ${t.status === "idea" ? "idea" : ""}`} onClick={() => onTrip(t.id)}>
            <span className="t">{t.start_date === anchor ? `Arrive in ${t.place || t.title}` : t.title}</span>
            <span className="d">{[t.place || KINDS[t.kind], fmtRange(t.start_date, t.end_date)].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
      </section>

      <section className="asec">
        <h3 className="asec-t">Itinerary</h3>
        {items.length === 0 && <p className="anone">{loaded ? "Nothing booked for this day." : "…"}</p>}
        {items.map((b) => {
          const n = nights(b);
          const checkout = b.type === "stay" && b.end_date === anchor && b.date !== anchor;
          const top = [BOOKING_TYPES[b.type], timeSpan(b), b.provider].filter(Boolean).join(" · ");
          const bottom = [
            checkout ? "Check out" : n ? `${fmtRange(b.date, b.end_date)} · ${n} night${n > 1 ? "s" : ""}` : "",
            !checkout && Number(b.cost) > 0 ? money(b.cost, currency) : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button key={`${b.id}-${checkout ? "out" : "in"}`} className="abook" onClick={() => onBooking(b.id)}>
              <TypeTile type={b.type} />
              <span className="n">
                <span className="ttl">{b.title}</span>
                <span className="sub">{top}</span>
                {bottom && <span className="sub">{bottom}</span>}
              </span>
              <span className={`pill ${b.status}`}>{b.status}</span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

/**
 * Week: seven columns side by side. Trips run as continuous bars across the top, each in a fixed
 * lane so a bar lines up across the days it covers, then each day lists its own bookings.
 */
function WeekGrid({
  anchor,
  trips,
  bookings,
  today,
  onTrip,
  onBooking,
  onPickDays,
}: {
  anchor: string;
  trips: Trip[];
  bookings: Booking[];
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onPickDays?: (start: string, end: string) => void;
}) {
  const pick = useDayPick(!!onPickDays, onPickDays);
  const days = viewDays("week", anchor);
  // On a narrow screen only the first few columns fit, so bring the current day into view.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const col = box.querySelector<HTMLElement>(".wcell.today") ?? box.querySelector<HTMLElement>(".wcell");
    if (!col) return;
    box.scrollLeft = Math.max(0, Math.min(col.offsetLeft - 8, box.scrollWidth - box.clientWidth));
  }, [anchor, today]);
  const from = dayNum(days[0]);
  const to = dayNum(days[6]);
  const lanes = trips
    .filter((t) => t.start_date && dayNum(t.start_date) <= to && dayNum(tripEnd(t)!) >= from)
    .map((t) => ({ t, a: dayNum(t.start_date!), b: dayNum(tripEnd(t)!) }))
    .sort((p, q) => KIND_ORDER[p.t.kind] - KIND_ORDER[q.t.kind] || p.a - q.a);

  return (
    <div className="scroller" ref={scroller}>
      <div className="wgrid" ref={pick.ref as React.RefObject<HTMLDivElement>} {...pick.bind}>
        {days.map((d) => (
          <div key={`h-${d}`} data-day={d} className={`wdow ${d === today ? "today" : ""} ${inSel(pick.sel, d) ? "sel" : ""}`}>
            <span>{DOWS[weekday(d)]}</span>
            <b>{+d.slice(8)}</b>
          </div>
        ))}
        {lanes.length > 0 &&
          days.map((d) => {
            const n = dayNum(d);
            const col = weekday(d);
            return (
              <div key={`p-${d}`} data-day={d} className={`wplace ${d === today ? "today" : ""} ${inSel(pick.sel, d) ? "sel" : ""}`}>
                {lanes.map(({ t, a, b }) =>
                  a <= n && n <= b ? (
                    <button
                      key={t.id}
                      className={`bar k-${t.kind} ${t.status === "idea" ? "idea" : ""} ${n === a ? "s" : ""} ${n === b || col === 6 ? "e" : ""} ${
                        n === a || col === 0 ? "" : "cont"
                      }`}
                      title={`${t.title} · ${fmtRange(t.start_date, t.end_date)}`}
                      onClick={() => onTrip(t.id)}
                    >
                      {/* Repeated per column so a scrolled phone still names the bar; hidden once the whole week fits. */}
                      <span className="lbl">{t.title}</span>
                    </button>
                  ) : (
                    <span key={t.id} className="bar gap" aria-hidden="true" />
                  ),
                )}
              </div>
            );
          })}
        {days.map((d) => {
          const items = bookingsOn(bookings, d);
          return (
            <div key={d} data-day={d} className={`wcell ${d === today ? "today" : ""} ${inSel(pick.sel, d) ? "sel" : ""}`}>
              {items.map((b) => {
                const checkout = b.type === "stay" && b.end_date === d && b.date !== d;
                return (
                  <button
                    key={`${b.id}-${checkout ? "out" : "in"}`}
                    className={`wbk c-${categoryOf(b.type)}`}
                    title={`${b.title} · ${BOOKING_TYPES[b.type]}`}
                    onClick={() => onBooking(b.id)}
                  >
                    {b.time && <span className="tm">{b.time}</span>}
                    <span className="n">{checkout ? `${b.title} · out` : b.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthGrid({ month, trips, today, onTrip, onPickDays }: { month: string; trips: Trip[]; today: string; onTrip: (id: string) => void; onPickDays?: (start: string, end: string) => void }) {
  const pick = useDayPick(!!onPickDays, onPickDays);
  const [y, m] = month.split("-").map(Number);
  const first = dayNum(`${month}-01`);
  const weekdayOfFirst = (new Date(first * 864e5).getUTCDay() + 6) % 7; // Monday = 0
  const start = first - weekdayOfFirst;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

  return (
    <div className="scroller">
      <div className="grid" ref={pick.ref as React.RefObject<HTMLDivElement>} {...pick.bind}>
        {DOWS.map((d) => (
          <div key={d} className="dow">
            {d}
          </div>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const n = start + i;
          const ds = fromDayNum(n);
          const col = i % 7;
          const here = tripsOn(trips, ds).map((t) => ({ t, a: dayNum(t.start_date!), b: dayNum(tripEnd(t)!) }));
          return (
            <div key={ds} data-day={ds} className={`cell ${ds.slice(0, 7) !== month ? "out" : ""} ${ds === today ? "today" : ""} ${inSel(pick.sel, ds) ? "sel" : ""}`}>
              <span className="dnum">{+ds.slice(8)}</span>
              {here.slice(0, 3).map(({ t, a, b }) => {
                const showLabel = n === a || col === 0 || ds.endsWith("-01");
                return (
                  <button
                    key={t.id}
                    className={`bar k-${t.kind} ${t.status === "idea" ? "idea" : ""} ${n === a ? "s" : ""} ${n === b || col === 6 ? "e" : ""}`}
                    title={`${t.title} · ${fmtRange(t.start_date, t.end_date)}`}
                    onClick={() => onTrip(t.id)}
                  >
                    {showLabel ? t.title : " "}
                  </button>
                );
              })}
              {here.length > 3 && <span className="more">+{here.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TripRail({
  trips,
  bookings,
  loaded,
  today,
  onTrip,
  sharedIn,
}: {
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onTrip: (id: string) => void;
  /** Trips from a shared (group) plan, by id → that plan's name, labelled so they read as shared. */
  sharedIn?: Record<string, string>;
}) {
  const list = [...trips].sort((a, b) => (a.start_date || "9").localeCompare(b.start_date || "9"));
  return (
    <aside className="panel rail">
      <h3>All trips</h3>
      <ul className="trip-list">
        {!loaded && <li className="empty">Loading your trips…</li>}
        {loaded && list.length === 0 && (
          <li className="empty">
            <strong>No trips yet.</strong> Add your base and weekend trips with <strong>+ Trip</strong>.
          </li>
        )}
        {list.map((t) => {
          const n = bookings.filter((b) => b.trip_id === t.id).length;
          const past = !!tripEnd(t) && tripEnd(t)! < today;
          return (
            <li key={t.id}>
              <button className={`trip-item k-${t.kind} ${past ? "past" : ""}`} onClick={() => onTrip(t.id)}>
                <span className="sw" />
                <span className="t">{t.title}</span>
                <span className={`pill ${t.status}`}>{t.status}</span>
                <span className="d">
                  {sharedIn?.[t.id] && "Shared · "}
                  {t.start_date ? fmtRange(t.start_date, t.end_date) : "No dates yet"}
                  {n > 0 && ` · ${n} booking${n > 1 ? "s" : ""}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
