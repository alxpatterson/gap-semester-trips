"use client";

import { useState, type FormEvent } from "react";
import { BOOKING_TYPES, KINDS } from "@/lib/logic";
import type { Booking, Trip } from "@/lib/types";

export type TripInput = Pick<Trip, "title" | "kind" | "status" | "start_date" | "end_date" | "place" | "schengen" | "notes">;
export type BookingInput = Pick<
  Booking,
  "title" | "type" | "status" | "trip_id" | "date" | "end_date" | "time" | "provider" | "cost" | "confirmation" | "link" | "notes" | "counts_in_budget"
>;

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export function TripForm({
  trip,
  saving,
  onSave,
  onCancel,
}: {
  trip?: Partial<Trip>;
  saving: boolean;
  onSave: (t: TripInput) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "");
    const data: TripInput = {
      title: s("title").trim(),
      kind: s("kind") as Trip["kind"],
      status: s("status") as Trip["status"],
      start_date: orNull(s("start_date")),
      end_date: orNull(s("end_date")),
      place: s("place").trim(),
      schengen: fd.get("schengen") === "on",
      notes: s("notes").trim(),
    };
    if (data.start_date && data.end_date && data.end_date < data.start_date) return setError("The end date is before the start date.");
    setError("");
    onSave(data);
  };
  return (
    <form className="f" onSubmit={submit}>
      <label>
        Name
        <input id="tf-title" name="title" required maxLength={80} defaultValue={trip?.title ?? ""} placeholder="Weekend in Rome" />
      </label>
      <div className="two">
        <label>
          Type
          <select id="tf-kind" name="kind" defaultValue={trip?.kind ?? "weekend"}>
            {Object.entries(KINDS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select id="tf-status" name="status" defaultValue={trip?.status ?? "idea"}>
            <option value="idea">Idea</option>
            <option value="planned">Planned</option>
            <option value="booked">Booked</option>
          </select>
        </label>
      </div>
      <div className="two">
        <label>
          Start
          <input id="tf-start" type="date" name="start_date" defaultValue={trip?.start_date ?? ""} />
        </label>
        <label>
          End
          <input id="tf-end" type="date" name="end_date" defaultValue={trip?.end_date ?? ""} />
        </label>
      </div>
      <label>
        Where
        <input id="tf-place" name="place" maxLength={100} defaultValue={trip?.place ?? ""} placeholder="Rome, Italy" />
      </label>
      <label className="check">
        <input id="tf-schengen" type="checkbox" name="schengen" defaultChecked={!!trip?.schengen} />
        Inside the Schengen area (counts toward 90 days)
      </label>
      <label>
        Notes
        <textarea id="tf-notes" name="notes" maxLength={2000} defaultValue={trip?.notes ?? ""} />
      </label>
      {error && <p className="empty" style={{ color: "var(--bad)", padding: 0 }}>{error}</p>}
      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save trip"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BookingForm({
  booking,
  trips,
  saving,
  onSave,
  onCancel,
}: {
  booking?: Partial<Booking>;
  trips: Trip[];
  saving: boolean;
  onSave: (b: BookingInput) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const sortedTrips = [...trips].sort((a, b) => (a.start_date || "9").localeCompare(b.start_date || "9"));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "");
    const data: BookingInput = {
      title: s("title").trim(),
      type: s("type") as Booking["type"],
      status: s("status") as Booking["status"],
      trip_id: orNull(s("trip_id")),
      date: orNull(s("date")),
      end_date: orNull(s("end_date")),
      time: s("time"),
      provider: s("provider").trim(),
      cost: Number(s("cost")) || 0,
      confirmation: s("confirmation").trim(),
      link: s("link").trim(),
      notes: s("notes").trim(),
      counts_in_budget: fd.get("counts_in_budget") === "on",
    };
    if (data.date && data.end_date && data.end_date < data.date) return setError("Check-out is before the date.");
    setError("");
    onSave(data);
  };
  return (
    <form className="f" onSubmit={submit}>
      <label>
        What
        <input id="bf-title" name="title" required maxLength={100} defaultValue={booking?.title ?? ""} placeholder="Florence → Rome, Frecciarossa" />
      </label>
      <div className="two">
        <label>
          Type
          <select id="bf-type" name="type" defaultValue={booking?.type ?? "flight"}>
            {Object.entries(BOOKING_TYPES).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select id="bf-status" name="status" defaultValue={booking?.status ?? "todo"}>
            <option value="todo">To book</option>
            <option value="booked">Booked</option>
            <option value="review">Needs review</option>
          </select>
        </label>
      </div>
      <label>
        Trip
        <select id="bf-trip" name="trip_id" defaultValue={booking?.trip_id ?? ""}>
          <option value="">No trip</option>
          {sortedTrips.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </label>
      <div className="two">
        <label>
          Date (or check-in)
          <input id="bf-date" type="date" name="date" defaultValue={booking?.date ?? ""} />
        </label>
        <label>
          Time
          <input id="bf-time" type="time" name="time" defaultValue={booking?.time ?? ""} />
        </label>
      </div>
      <label>
        Until (check-out, optional)
        <input id="bf-end" type="date" name="end_date" defaultValue={booking?.end_date ?? ""} />
      </label>
      <div className="two">
        <label>
          Provider
          <input id="bf-provider" name="provider" maxLength={60} defaultValue={booking?.provider ?? ""} placeholder="Trenitalia" />
        </label>
        <label>
          Your cost (USD)
          <input id="bf-cost" type="number" min={0} step="0.01" inputMode="decimal" name="cost" defaultValue={booking?.cost ? String(booking.cost) : ""} />
        </label>
      </div>
      <label>
        Confirmation code
        <input id="bf-conf" name="confirmation" maxLength={40} defaultValue={booking?.confirmation ?? ""} placeholder="PNR or booking ref" />
      </label>
      <label>
        Link
        <input id="bf-link" type="url" name="link" maxLength={500} defaultValue={booking?.link ?? ""} placeholder="https://" />
      </label>
      <label className="check">
        <input id="bf-budget" type="checkbox" name="counts_in_budget" defaultChecked={booking?.counts_in_budget ?? true} />
        Counts toward the budget
      </label>
      <label>
        Notes
        <textarea id="bf-notes" name="notes" maxLength={2000} defaultValue={booking?.notes ?? ""} />
      </label>
      {error && <p className="empty" style={{ color: "var(--bad)", padding: 0 }}>{error}</p>}
      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save booking"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
