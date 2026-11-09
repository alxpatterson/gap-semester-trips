"use client";

import {
  BOOKING_TYPES,
  bookingsOn,
  CAL_VIEWS,
  dayNum,
  DOWS,
  fmtDate,
  fmtRange,
  fromDayNum,
  inPlanRange,
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
      ) : (
        <Agenda view={view} anchor={anchor} trips={trips} bookings={bookings} loaded={loaded} today={today} onTrip={onTrip} onBooking={onBooking} />
      )}

      <div className="legend">
        <span className="k-base"><i />Base</span>
        <span className="k-weekend"><i />Weekend trip</span>
        <span className="k-travel"><i />Travel leg</span>
        <span className="k-other"><i />Other</span>
        <span>Striped = still an idea</span>
      </div>
    </div>
  );
}

/** Day and week share one layout: a row per day, with the trips covering it and that day's bookings. */
function Agenda({
  view,
  anchor,
  trips,
  bookings,
  loaded,
  today,
  onTrip,
  onBooking,
}: {
  view: CalView;
  anchor: string;
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
}) {
  const days = viewDays(view, anchor);
  const one = view === "day";
  return (
    <div className={`agenda ${one ? "one" : ""}`}>
      {days.map((d) => {
        const here = tripsOn(trips, d);
        const items = bookingsOn(bookings, d);
        // "Wed, Oct 21 · Arrive in Kyoto": the day, then whatever starts on it.
        const arriving = here.find((t) => t.start_date === d);
        const where = arriving ? `Arrive in ${arriving.place || arriving.title}` : "";
        // A trip gets a card on the day it starts; on the days after it is just quiet context.
        const starting = here.filter((t) => t.start_date === d);
        const ongoing = here.filter((t) => t.start_date !== d);
        return (
          <div key={d} className={`aday ${d === today ? "today" : ""}`}>
            {(!one || where || d === today) && (
              <h3 className="ahead">
                <span>{one ? where : [`${DOWS[weekday(d)]}, ${fmtDate(d)}`, where].filter(Boolean).join(" · ")}</span>
                {d === today && <span className="pill booked">Today</span>}
              </h3>
            )}
            <div className="abody">
              {ongoing.length > 0 && (
                <div className="actxs">
                  {ongoing.map((t) => (
                    <button key={t.id} className={`actx k-${t.kind}`} onClick={() => onTrip(t.id)}>
                      <i />
                      {t.title}
                    </button>
                  ))}
                </div>
              )}
              {starting.map((t) => (
                <button key={t.id} className={`atrip k-${t.kind} ${t.status === "idea" ? "idea" : ""}`} onClick={() => onTrip(t.id)}>
                  <span className="t">{t.title}</span>
                  <span className="d">
                    {[t.place || KINDS[t.kind], fmtRange(t.start_date, t.end_date)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
              {items.map((b) => {
                const n = nights(b);
                const checkout = b.type === "stay" && b.end_date === d && b.date !== d;
                const top = [BOOKING_TYPES[b.type], b.time, b.provider].filter(Boolean).join(" · ");
                const bottom = [
                  checkout ? "Check out" : n ? `${fmtRange(b.date, b.end_date)} · ${n} night${n > 1 ? "s" : ""}` : "",
                  !checkout && Number(b.cost) > 0 ? money(b.cost) : "",
                ].filter(Boolean).join(" · ");
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
              {here.length === 0 && items.length === 0 && (
                <span className="anone">{loaded ? (one ? "Nothing planned for this day." : "Nothing planned") : "…"}</span>
              )}
            </div>
          </div>
        );
      })}
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
                <span style={{ minWidth: 0 }}>
                  <div className="t">{t.title}</div>
                  <div className="d">
                    {t.start_date ? fmtRange(t.start_date, t.end_date) : "No dates yet"}
                    {n > 0 && ` · ${n} booking${n > 1 ? "s" : ""}`}
                  </div>
                </span>
                <span className={`pill ${t.status}`}>{t.status}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
