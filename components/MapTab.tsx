"use client";

import { useEffect, useState, type ComponentType } from "react";
import { fmtDate, fmtRange, money, tripEnd } from "@/lib/logic";
import { countryName, VISIT_LABELS, type CountryVisit, type VisitStatus } from "@/lib/places";
import type { Booking, Trip } from "@/lib/types";
import type { WorldMapProps } from "./WorldMap";
import { BookingPill, TypeTile } from "./ui";

/**
 * The Map tab: the world with every country a trip touches coloured in, and the same thing as a
 * list beside it, because a list is easier to read on a phone than Monaco is to tap.
 *
 * The map itself is a separate module, fetched the first time this tab is opened. It carries the
 * country outlines, and there is no reason to make someone who only ever looks at the calendar
 * download them.
 */

const STATUS_HINT: Record<VisitStatus, string> = {
  now: "where you are today",
  been: "trips that have happened",
  booked: "trips still to come",
  idea: "somewhere you might go",
};

export default function MapTab({
  visits,
  unplaced,
  loaded,
  selected,
  onCountry,
  onTrip,
}: {
  visits: CountryVisit[];
  /** Trips with no country in them, listed so they can be given one. */
  unplaced: Trip[];
  loaded: boolean;
  selected: string | null;
  onCountry: (code: string) => void;
  onTrip: (id: string) => void;
}) {
  const been = visits.filter((v) => v.status === "been" || v.status === "now").length;
  const ahead = visits.filter((v) => v.status === "booked").length;

  return (
    <section className="cal-layout">
      <div className="panel">
        <div className="monthbar">
          <h2>Countries</h2>
          <div className="chips">
            <span className="chip" title="Countries with a trip on them">
              <span className="dot" />
              <b>{loaded ? visits.length : "–"}</b> in all
            </span>
            {been > 0 && (
              <span className="chip" title="Countries you have been to, or are in today">
                <span className="dot" />
                <b>{been}</b> been
              </span>
            )}
            {ahead > 0 && (
              <span className="chip" title="Countries you have a trip booked in">
                <span className="dot" style={{ background: "var(--k-travel)" }} />
                <b>{ahead}</b> to come
              </span>
            )}
          </div>
        </div>

        <MapCanvas visits={visits} selected={selected} onPick={onCountry} />

        <div className="legend">
          {(["been", "now", "booked", "idea"] as const).map((status) => (
            <span key={status} title={STATUS_HINT[status]}>
              <i className={`wm-key v-${status}`} />
              {VISIT_LABELS[status]}
            </span>
          ))}
        </div>
        <p className="fine map-note">
          Countries come from what&apos;s in each trip&apos;s <strong>Where</strong> box. Tap a country for its trips and bookings.
        </p>
      </div>

      <div className="side">
        <aside className="panel rail">
          <h3>Every country</h3>
          <ul className="trip-list">
            {!loaded && <li className="empty">Loading your trips…</li>}
            {loaded && visits.length === 0 && (
              <li className="empty">
                <strong>Nothing on the map yet.</strong> Put a city or country in a trip&apos;s <strong>Where</strong> box and it&apos;ll
                appear here.
              </li>
            )}
            {visits.map((v) => (
              <li key={v.code}>
                <button className={`trip-item country-item v-${v.status} ${selected === v.code ? "on" : ""}`} onClick={() => onCountry(v.code)}>
                  <span className="sw" />
                  <span className="t">{v.name}</span>
                  <span className="pill">{VISIT_LABELS[v.status]}</span>
                  <span className="d">
                    {v.trips.length} trip{v.trips.length > 1 ? "s" : ""}
                    {v.days > 0 && ` · ${v.days} day${v.days > 1 ? "s" : ""}`}
                    {v.first && ` · ${fmtRange(v.first, v.last)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {unplaced.length > 0 && (
          <aside className="panel rail">
            <h3>Not on the map</h3>
            <p className="fine">
              No country could be read out of {unplaced.length === 1 ? "this trip" : "these trips"}. Add a city or country to the{" "}
              <strong>Where</strong> box and {unplaced.length === 1 ? "it" : "they"}&apos;ll appear.
            </p>
            <ul className="trip-list">
              {unplaced.map((t) => (
                <li key={t.id}>
                  <button className="trip-item" onClick={() => onTrip(t.id)}>
                    <span className="sw" style={{ background: "var(--line)" }} />
                    <span className="t">{t.title}</span>
                    <span className="d">{t.place ? t.place : t.start_date ? fmtRange(t.start_date, t.end_date) : "No dates yet"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}

/**
 * Loads the map module the first time the tab is opened. On a phone with no signal that fetch can
 * fail, and the rest of the tab still works, so the failure says so plainly instead of blanking.
 */
function MapCanvas(props: WorldMapProps) {
  const [Map, setMap] = useState<ComponentType<WorldMapProps> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    import("./WorldMap")
      .then((mod) => live && setMap(() => mod.default))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (Map) return <Map {...props} />;
  return (
    <div className="wm wm-waiting">
      {failed ? "The map couldn't load. It needs to be opened once with a connection before it works offline." : "Loading the map…"}
    </div>
  );
}

/**
 * One country, in the sheet: how long was spent there, which trips, and every booking filed under
 * them. A country with nothing on it still opens, so a tap on the map is never a dead end.
 */
export function CountryDetail({
  code,
  visit,
  bookings,
  currency,
  canEdit,
  sharedIn,
  today,
  onTrip,
  onBooking,
  onAddTrip,
}: {
  code: string;
  visit?: CountryVisit;
  bookings: Booking[];
  currency: string;
  canEdit: boolean;
  sharedIn: Record<string, string>;
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onAddTrip: (place: string) => void;
}) {
  const name = countryName(code);
  const tripIds = new Set((visit?.trips ?? []).map((t) => t.id));
  const here = bookings.filter((b) => b.trip_id && tripIds.has(b.trip_id)).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
  const spent = here.reduce((sum, b) => sum + (Number(b.cost) || 0), 0);
  const shared = (visit?.trips ?? []).filter((t) => sharedIn[t.id]);

  if (!visit) {
    return (
      <>
        <p className="empty" style={{ padding: "4px 0" }}>
          No trips in {name} yet.
        </p>
        {canEdit && (
          <div className="row-actions">
            <button className="btn primary small" onClick={() => onAddTrip(name)}>
              + Trip to {name}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <dl className="facts">
        <dt>Status</dt>
        <dd>
          <span className={`pill country-pill v-${visit.status}`}>{VISIT_LABELS[visit.status]}</span>
        </dd>
        <dt>Trips</dt>
        <dd>
          {visit.trips.length}
          {visit.days > 0 && ` · ${visit.days} day${visit.days > 1 ? "s" : ""} in all`}
        </dd>
        {visit.first && (
          <>
            <dt>When</dt>
            <dd className="mono">{fmtRange(visit.first, visit.last)}</dd>
          </>
        )}
        {here.length > 0 && (
          <>
            <dt>Bookings</dt>
            <dd>
              {here.length}
              {spent > 0 && ` · ${money(spent, currency)}`}
            </dd>
          </>
        )}
      </dl>

      <div className="section-t">Trips</div>
      <ul className="trip-list">
        {[...visit.trips]
          .sort((a, b) => (a.start_date || "9").localeCompare(b.start_date || "9"))
          .map((t) => (
            <li key={t.id}>
              <button className={`trip-item k-${t.kind} ${tripEnd(t) && tripEnd(t)! < today ? "past" : ""}`} onClick={() => onTrip(t.id)}>
                <span className="sw" />
                <span className="t">{t.title}</span>
                <span className={`pill ${t.status}`}>{t.status}</span>
                <span className="d">
                  {sharedIn[t.id] && "Shared · "}
                  {t.start_date ? fmtRange(t.start_date, t.end_date) : "No dates yet"}
                  {t.place && ` · ${t.place}`}
                </span>
              </button>
            </li>
          ))}
      </ul>

      <div className="section-t">Bookings</div>
      {here.length === 0 && (
        <p className="empty" style={{ padding: "4px 0" }}>
          {shared.length === visit.trips.length && shared.length > 0
            ? "These are shared trips — their bookings live in the plan they're shared in."
            : "Nothing booked here yet."}
        </p>
      )}
      <div className="country-bk">
        {here.map((b) => (
          <button key={b.id} className="abook" onClick={() => onBooking(b.id)}>
            <TypeTile type={b.type} />
            <span className="n">
              <span className="ttl">{b.title}</span>
              <span className="sub">
                {b.date ? fmtDate(b.date) : "No date"}
                {Number(b.cost) > 0 && ` · ${money(b.cost, currency)}`}
              </span>
            </span>
            <BookingPill status={b.status} />
          </button>
        ))}
      </div>
    </>
  );
}
