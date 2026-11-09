"use client";

import { useEffect, useRef } from "react";

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
  nights,
  shiftAnchor,
  tripsOn,
  tripEnd,
  viewDays,
  viewTitle,
  weekday,
  type CalView,
} from "@/lib/logic";
import type { Booking, Trip } from "@/lib/types";
import { TypeTile } from "./ui";

export function CalendarPanel({
  view,
  anchor,
  trips,
  bookings,
  loaded,
  today,
  onView,
  onAnchor,
  onTrip,
  onBooking,
}: {
  view: CalView;
  anchor: string;
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onView: (v: CalView) => void;
  onAnchor: (d: string) => void;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
}) {
  const step = view === "month" ? "month" : view === "week" ? "week" : "day";
  return (
    <div className="panel">
      <div className="monthbar">
        <h2>{viewTitle(view, anchor)}</h2>
        <div className="navs">
          <button className="btn" aria-label={`Previous ${step}`} disabled={!inPlanRange(view, shiftAnchor(view, anchor, -1))} onClick={() => onAnchor(shiftAnchor(view, anchor, -1))}>
            ‹
          </button>
          <button className="btn" aria-label={`Next ${step}`} disabled={!inPlanRange(view, shiftAnchor(view, anchor, 1))} onClick={() => onAnchor(shiftAnchor(view, anchor, 1))}>
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

      {view === "month" ? (
        <MonthGrid month={anchor.slice(0, 7)} trips={trips} today={today} onTrip={onTrip} />
      ) : view === "week" ? (
        <WeekGrid anchor={anchor} trips={trips} bookings={bookings} today={today} onTrip={onTrip} onBooking={onBooking} />
      ) : (
        <DayView anchor={anchor} trips={trips} bookings={bookings} loaded={loaded} today={today} onTrip={onTrip} onBooking={onBooking} />
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
  trips,
  bookings,
  loaded,
  today,
  onTrip,
  onBooking,
}: {
  anchor: string;
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
          const top = [BOOKING_TYPES[b.type], b.time, b.provider].filter(Boolean).join(" · ");
          const bottom = [
            checkout ? "Check out" : n ? `${fmtRange(b.date, b.end_date)} · ${n} night${n > 1 ? "s" : ""}` : "",
            !checkout && Number(b.cost) > 0 ? money(b.cost) : "",
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
}: {
  anchor: string;
  trips: Trip[];
  bookings: Booking[];
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
}) {
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
      <div className="wgrid">
        {days.map((d) => (
          <div key={`h-${d}`} className={`wdow ${d === today ? "today" : ""}`}>
            <span>{DOWS[weekday(d)]}</span>
            <b>{+d.slice(8)}</b>
          </div>
        ))}
        {lanes.length > 0 &&
          days.map((d) => {
            const n = dayNum(d);
            const col = weekday(d);
            return (
              <div key={`p-${d}`} className={`wplace ${d === today ? "today" : ""}`}>
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
            <div key={d} className={`wcell ${d === today ? "today" : ""}`}>
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

function MonthGrid({ month, trips, today, onTrip }: { month: string; trips: Trip[]; today: string; onTrip: (id: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const first = dayNum(`${month}-01`);
  const weekdayOfFirst = (new Date(first * 864e5).getUTCDay() + 6) % 7; // Monday = 0
  const start = first - weekdayOfFirst;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

  return (
    <div className="scroller">
      <div className="grid">
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
            <div key={ds} className={`cell ${ds.slice(0, 7) !== month ? "out" : ""} ${ds === today ? "today" : ""}`}>
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
}: {
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onTrip: (id: string) => void;
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
