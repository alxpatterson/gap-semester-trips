"use client";

import { BOOKING_TYPES, dayNum, fmtDate, fmtRange, KINDS, money, tripEnd } from "@/lib/logic";
import type { Booking, Trip } from "@/lib/types";
import { BookingPill, CopyCode, DeleteButton } from "./ui";

export function TripDetail({
  trip,
  bookings,
  canEdit,
  onOpenBooking,
  onAddBooking,
  onEdit,
  onDelete,
}: {
  trip: Trip;
  bookings: Booking[];
  canEdit: boolean;
  onOpenBooking: (id: string) => void;
  onAddBooking: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const days = trip.start_date ? dayNum(tripEnd(trip)!) - dayNum(trip.start_date) + 1 : 0;
  const list = bookings.filter((b) => b.trip_id === trip.id).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
  return (
    <>
      <dl className="facts">
        <dt>Type</dt>
        <dd>{KINDS[trip.kind]}</dd>
        <dt>Dates</dt>
        <dd className="mono">{trip.start_date ? `${fmtRange(trip.start_date, trip.end_date)} · ${days} day${days > 1 ? "s" : ""}` : "Not set"}</dd>
        {trip.place && (
          <>
            <dt>Where</dt>
            <dd>{trip.place}</dd>
          </>
        )}
        <dt>Schengen</dt>
        <dd>{trip.schengen ? "Yes, counts toward 90 days" : "No"}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`pill ${trip.status}`}>{trip.status}</span>
        </dd>
        {trip.notes && (
          <>
            <dt>Notes</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{trip.notes}</dd>
          </>
        )}
      </dl>
      <div className="section-t">Bookings</div>
      <div className="mini-bk">
        {list.length === 0 && <p className="empty" style={{ padding: "4px 0" }}>No bookings on this trip yet.</p>}
        {list.map((b) => (
          <button key={b.id} onClick={() => onOpenBooking(b.id)}>
            <span className="d">{b.date ? fmtDate(b.date) : "—"}</span>
            <span className="n">{b.title}</span>
            <BookingPill status={b.status} />
          </button>
        ))}
      </div>
      {canEdit && (
        <div className="row-actions">
          <button className="btn primary small" onClick={onAddBooking}>
            + Booking
          </button>
          <button className="btn small" onClick={onEdit}>
            Edit trip
          </button>
          <DeleteButton onConfirm={onDelete} />
        </div>
      )}
    </>
  );
}

export function BookingDetail({
  booking,
  trip,
  canEdit,
  toast,
  onEdit,
  onDelete,
}: {
  booking: Booking;
  trip?: Trip;
  canEdit: boolean;
  toast: (m: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const b = booking;
  const safeLink = /^https?:\/\//i.test(b.link) ? b.link : "";
  return (
    <>
      <dl className="facts">
        <dt>Type</dt>
        <dd>{BOOKING_TYPES[b.type]}</dd>
        <dt>When</dt>
        <dd className="mono">
          {b.date ? fmtRange(b.date, b.end_date) : "Not set"}
          {b.time && ` · ${b.time}`}
        </dd>
        {trip && (
          <>
            <dt>Trip</dt>
            <dd>{trip.title}</dd>
          </>
        )}
        {b.provider && (
          <>
            <dt>Provider</dt>
            <dd>{b.provider}</dd>
          </>
        )}
        {b.confirmation && (
          <>
            <dt>Confirmation</dt>
            <dd>
              <CopyCode code={b.confirmation} toast={toast} />
            </dd>
          </>
        )}
        {Number(b.cost) > 0 && (
          <>
            <dt>Cost</dt>
            <dd className="mono">
              {money(b.cost)}
              {!b.counts_in_budget && " · not counted in budget"}
            </dd>
          </>
        )}
        <dt>Status</dt>
        <dd>
          <BookingPill status={b.status} />
        </dd>
        {safeLink && (
          <>
            <dt>Link</dt>
            <dd>
              <a href={safeLink} target="_blank" rel="noopener noreferrer">
                {b.source === "gmail" ? "Open email" : "Open link"}
              </a>
            </dd>
          </>
        )}
        {b.notes && (
          <>
            <dt>Notes</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{b.notes}</dd>
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
