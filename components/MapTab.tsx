"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { fmtDate, fmtRange, money, tripEnd } from "@/lib/logic";
import { countryName, MARK_LABELS, MARKS, VISIT_LABELS, visitLabel, type CountryVisit, type VisitStatus } from "@/lib/places";
import type { Booking, MarkKind, Trip } from "@/lib/types";
import type { WorldMapProps } from "./WorldMap";
import { BookingPill, TypeTile } from "./ui";

/**
 * The Map tab: the world across the whole tab with every country a trip touches coloured in, a
 * count of them above it, and the same countries as a list underneath — a list being easier to
 * read on a phone than Monaco is to tap.
 *
 * Tapping a country opens a card over the map rather than the side sheet, so the map stays in
 * view behind it; the trips and bookings inside the card still open the usual sheets.
 *
 * The map itself is a separate module, fetched the first time this tab is opened. It carries the
 * country outlines, and there is no reason to make someone who only ever looks at the calendar
 * download them.
 */

/** Sovereign states, near enough, for "% of the world" to mean what people expect. */
const COUNTRIES_IN_THE_WORLD = 195;

const STATUS_HINT: Record<VisitStatus, string> = {
  now: "where you are today",
  been: "trips that have happened",
  booked: "trips still to come",
  idea: "somewhere you might go",
};

export default function MapTab({
  visits,
  unplaced,
  bookings,
  loaded,
  today,
  currency,
  canEdit,
  canMark,
  sharedIn,
  selected,
  onCountry,
  onMark,
  onTrip,
  onBooking,
  onAddTrip,
}: {
  visits: CountryVisit[];
  /** Trips with no country in them, listed so they can be given one. */
  unplaced: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  currency: string;
  canEdit: boolean;
  /** False until the 0012 table exists, which hides every button that would write to it. */
  canMark: boolean;
  sharedIn: Record<string, string>;
  selected: string | null;
  onCountry: (code: string | null) => void;
  onMark: (code: string, mark: MarkKind | null) => void;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onAddTrip: (place: string) => void;
}) {
  const been = visits.filter((v) => v.status === "been" || v.status === "now");
  const ahead = visits.filter((v) => v.status === "booked");
  const days = visits.reduce((sum, v) => sum + (v.status === "been" || v.status === "now" ? v.days : 0), 0);
  const share = Math.round((been.length / COUNTRIES_IN_THE_WORLD) * 100);

  // Picking from the list flies the map to that country; the count is what re-triggers it, so
  // picking the same one twice brings the map back rather than doing nothing.
  const [focus, setFocus] = useState<{ code: string; n: number } | null>(null);
  const flights = useRef(0);
  const openFromList = (code: string) => {
    flights.current += 1;
    setFocus({ code, n: flights.current });
    onCountry(code);
  };

  const visit = visits.find((v) => v.code === selected);

  return (
    <section className="map-layout">
      <div className="panel map-panel">
        <div className="map-stats">
          <div className="stat">
            <b>{loaded ? been.length : "–"}</b>
            <span>countries visited</span>
          </div>
          <div className="stat">
            <b>{loaded ? `${share}%` : "–"}</b>
            <span>of the world</span>
          </div>
          <div className="stat">
            <b>{loaded ? days : "–"}</b>
            <span>days away</span>
          </div>
          <div className="stat">
            <b>{loaded ? ahead.length : "–"}</b>
            <span>still to come</span>
          </div>
        </div>
        <div className="world-bar" role="img" aria-label={`${been.length} of ${COUNTRIES_IN_THE_WORLD} countries visited`}>
          <span style={{ width: `${Math.min(100, (been.length / COUNTRIES_IN_THE_WORLD) * 100)}%` }} />
        </div>

        <MapCanvas
          visits={visits}
          selected={selected}
          onPick={onCountry}
          focus={focus ?? undefined}
          popup={
            selected ? (
              <CountryPopup
                code={selected}
                visit={visit}
                bookings={bookings}
                currency={currency}
                canEdit={canEdit}
                canMark={canMark}
                sharedIn={sharedIn}
                today={today}
                onClose={() => onCountry(null)}
                onMark={onMark}
                onTrip={onTrip}
                onBooking={onBooking}
                onAddTrip={onAddTrip}
              />
            ) : null
          }
        />

        <div className="legend">
          {(["been", "now", "booked", "idea"] as const).map((status) => (
            <span key={status} title={STATUS_HINT[status]}>
              <i className={`wm-key v-${status}`} />
              {VISIT_LABELS[status]}
            </span>
          ))}
        </div>
      </div>

      <aside className="panel rail">
        <h3>
          Every country <span className="n">{loaded ? visits.length : ""}</span>
        </h3>
        {!loaded && <p className="empty">Loading your trips…</p>}
        {loaded && visits.length === 0 && (
          <p className="empty">
            <strong>Nothing on the map yet.</strong> Put a city or country in a trip&apos;s <strong>Where</strong> box and it&apos;ll appear
            here.
          </p>
        )}
        <ul className="country-grid">
          {visits.map((v) => (
            <li key={v.code}>
              <button className={`trip-item country-item v-${v.status} ${selected === v.code ? "on" : ""}`} onClick={() => openFromList(v.code)}>
                <span className="sw" />
                <span className="t">{v.name}</span>
                <span className="pill">{visitLabel(v)}</span>
                <span className="d">
                  {v.trips.length} trip{v.trips.length > 1 ? "s" : ""}
                  {v.days > 0 && ` · ${v.days} day${v.days > 1 ? "s" : ""}`}
                  {v.first && ` · ${fmtRange(v.first, v.last)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="fine map-note">
          Countries come from what&apos;s in each trip&apos;s <strong>Where</strong> box. Tap one on the map to mark it{" "}
          <strong>Been</strong>, <strong>Planned</strong> or <strong>Wish list</strong> without a trip.
        </p>
      </aside>

      {unplaced.length > 0 && (
        <aside className="panel rail">
          <h3>Not on the map</h3>
          <p className="fine">
            No country could be read out of {unplaced.length === 1 ? "this trip" : "these trips"}. Add a city or country to the{" "}
            <strong>Where</strong> box and {unplaced.length === 1 ? "it" : "they"}&apos;ll appear.
          </p>
          <ul className="country-grid">
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
 * One country, as a card over the map: how long was spent there, which trips, and every booking
 * filed under them. A country with nothing on it still opens, so a tap is never a dead end.
 */
export function CountryPopup({
  code,
  visit,
  bookings,
  currency,
  canEdit,
  canMark,
  sharedIn,
  today,
  onClose,
  onMark,
  onTrip,
  onBooking,
  onAddTrip,
}: {
  code: string;
  visit?: CountryVisit;
  bookings: Booking[];
  currency: string;
  canEdit: boolean;
  canMark: boolean;
  sharedIn: Record<string, string>;
  today: string;
  onClose: () => void;
  onMark: (code: string, mark: MarkKind | null) => void;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onAddTrip: (place: string) => void;
}) {
  const name = countryName(code);
  const tripIds = new Set((visit?.trips ?? []).map((t) => t.id));
  const here = bookings.filter((b) => b.trip_id && tripIds.has(b.trip_id)).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
  const spent = here.reduce((sum, b) => sum + (Number(b.cost) || 0), 0);
  const allShared = !!visit?.trips.length && visit.trips.every((t) => sharedIn[t.id]);

  // Escape closes it, the way the sheet does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wm-pop" role="dialog" aria-label={name}>
      <div className="wm-pop-head">
        <h3>{name}</h3>
        {visit && (
          <span className={`pill country-pill v-${visit.status}`}>{visitLabel(visit)}</span>
        )}
        <button className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {!visit || !visit.trips.length ? (
        <div className="wm-pop-body">
          <p className="empty" style={{ padding: "2px 0" }}>
            {visit?.mark ? `On your map as ${MARK_LABELS[visit.mark].toLowerCase()}. No trips here yet.` : "No trips here yet."}
          </p>
          <MarkPicker code={code} name={name} mark={visit?.mark ?? null} canEdit={canEdit} canMark={canMark} onMark={onMark} onAddTrip={onAddTrip} />
        </div>
      ) : (
        <div className="wm-pop-body">
          <p className="wm-pop-sum">
            <b>{visit.trips.length}</b> trip{visit.trips.length > 1 ? "s" : ""}
            {visit.days > 0 && (
              <>
                {" · "}
                <b>{visit.days}</b> day{visit.days > 1 ? "s" : ""}
              </>
            )}
            {here.length > 0 && (
              <>
                {" · "}
                <b>{here.length}</b> booking{here.length > 1 ? "s" : ""}
                {spent > 0 && ` · ${money(spent, currency)}`}
              </>
            )}
          </p>

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
                    </span>
                  </button>
                </li>
              ))}
          </ul>

          <MarkPicker code={code} name={name} mark={visit.mark} canEdit={canEdit} canMark={canMark} onMark={onMark} onAddTrip={null} />

          {here.length > 0 && <div className="section-t">Bookings</div>}
          {here.length === 0 && allShared && (
            <p className="fine">These are shared trips — their bookings live in the plan they&apos;re shared in.</p>
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
        </div>
      )}
    </div>
  );
}

/**
 * Been, Planned or Wish list — the three ways to put a country on the map by hand, for anywhere
 * a trip doesn't already cover. Tapping the one that's set clears it.
 *
 * Hidden entirely until the 0012 table can be read, so the map behaves as it did before the
 * migration rather than offering a button whose write would fail.
 */
function MarkPicker({
  code,
  name,
  mark,
  canEdit,
  canMark,
  onMark,
  onAddTrip,
}: {
  code: string;
  name: string;
  mark: MarkKind | null;
  canEdit: boolean;
  canMark: boolean;
  onMark: (code: string, mark: MarkKind | null) => void;
  /** Null on a country that already has trips, where another one isn't the obvious next thing. */
  onAddTrip: ((place: string) => void) | null;
}) {
  if (!canEdit) return null;
  return (
    <div className="mark-row">
      {canMark && (
        <>
          <span className="mark-label">Mark as</span>
          <span className="marks">
            {MARKS.map(([kind, label]) => (
              <button
                key={kind}
                className={`mark v-${kind}`}
                aria-pressed={mark === kind}
                title={mark === kind ? `Take ${name} off the map` : `Mark ${name} as ${label.toLowerCase()}`}
                onClick={() => onMark(code, mark === kind ? null : kind)}
              >
                {label}
              </button>
            ))}
          </span>
        </>
      )}
      {onAddTrip && (
        <button className="btn small" onClick={() => onAddTrip(name)}>
          + Trip
        </button>
      )}
    </div>
  );
}
