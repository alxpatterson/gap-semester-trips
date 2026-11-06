"use client";

import { dayNum, fmtRange, fromDayNum, MONTHS_LONG, tripEnd } from "@/lib/logic";
import type { Booking, Trip } from "@/lib/types";

const ORDER = { base: 0, travel: 1, weekend: 2, other: 3 } as const;
export const MONTH_RANGE = ["2026-12", "2027-06"] as const;

export function shiftMonth(month: string, delta: number) {
  let [y, m] = month.split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function MonthGrid({
  month,
  trips,
  today,
  onMonth,
  onTrip,
}: {
  month: string;
  trips: Trip[];
  today: string;
  onMonth: (m: string) => void;
  onTrip: (id: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = dayNum(`${month}-01`);
  const weekday = (new Date(first * 864e5).getUTCDay() + 6) % 7; // Monday = 0
  const start = first - weekday;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const placed = trips
    .filter((t) => t.start_date)
    .map((t) => ({ t, a: dayNum(t.start_date!), b: dayNum(tripEnd(t)!) }))
    .sort((p, q) => ORDER[p.t.kind] - ORDER[q.t.kind] || p.a - q.a);

  return (
    <div className="panel">
      <div className="monthbar">
        <h2>
          {MONTHS_LONG[m - 1]} {y}
        </h2>
        <button className="btn" aria-label="Previous month" disabled={month <= MONTH_RANGE[0]} onClick={() => onMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <button className="btn" aria-label="Next month" disabled={month >= MONTH_RANGE[1]} onClick={() => onMonth(shiftMonth(month, 1))}>
          ›
        </button>
      </div>
      <div className="scroller">
        <div className="grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="dow">
              {d}
            </div>
          ))}
          {Array.from({ length: cells }, (_, i) => {
            const n = start + i;
            const ds = fromDayNum(n);
            const col = i % 7;
            const here = placed.filter((p) => p.a <= n && n <= p.b);
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
                      {showLabel ? t.title : " "}
                    </button>
                  );
                })}
                {here.length > 3 && <span className="more">+{here.length - 3} more</span>}
              </div>
            );
          })}
        </div>
      </div>
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
