"use client";

import { BOOKING_TYPES, CATEGORIES, categoryOf, fmtRange, money, MONTHS, MONTHS_LONG, nights } from "@/lib/logic";
import type { Booking, BookingStatus, Category, Trip } from "@/lib/types";
import { BookingPill, CopyCode } from "./ui";

export type StatusFilter = "all" | Exclude<BookingStatus, "review">;
export type CategoryFilter = "all" | Category;

export default function Bookings({
  bookings,
  trips,
  loaded,
  category,
  status,
  canEdit,
  onCategory,
  onStatus,
  onAdd,
  onOpen,
  toast,
}: {
  bookings: Booking[];
  trips: Trip[];
  loaded: boolean;
  category: CategoryFilter;
  status: StatusFilter;
  canEdit: boolean;
  onCategory: (c: CategoryFilter) => void;
  onStatus: (s: StatusFilter) => void;
  onAdd: () => void;
  onOpen: (id: string) => void;
  toast: (m: string) => void;
}) {
  const matchesStatus = (b: Booking) => status === "all" || b.status === status;
  const matchesCat = (b: Booking, c: CategoryFilter) => c === "all" || categoryOf(b.type) === c;
  const count = (c: CategoryFilter) => bookings.filter((b) => matchesCat(b, c) && matchesStatus(b)).length;

  const list = bookings
    .filter((b) => matchesStatus(b) && matchesCat(b, category))
    .sort((a, b) => ((a.date || "9") + a.time).localeCompare((b.date || "9") + b.time));

  const groups: { key: string; items: Booking[] }[] = [];
  for (const b of list) {
    const key = b.date ? b.date.slice(0, 7) : "none";
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
    groups[groups.length - 1].items.push(b);
  }

  return (
    <section>
      <div className="bk-head">
        <div className="filters" role="group" aria-label="Filter by type">
          {([["all", "All types"], ...CATEGORIES] as [CategoryFilter, string][]).map(([k, label]) => (
            <button key={k} aria-pressed={category === k} onClick={() => onCategory(k)}>
              {label}
              {loaded && <span className="n"> {count(k)}</span>}
            </button>
          ))}
        </div>
        <div className="filters" role="group" aria-label="Filter by status">
          {([["all", "Any status"], ["booked", "Booked"], ["todo", "To book"]] as [StatusFilter, string][]).map(([k, label]) => (
            <button key={k} aria-pressed={status === k} onClick={() => onStatus(k)}>
              {label}
            </button>
          ))}
        </div>
        {canEdit && (
          <button className="btn primary small add" onClick={onAdd}>
            + Booking
          </button>
        )}
      </div>

      {!loaded && <p className="empty">Loading bookings…</p>}
      {loaded && list.length === 0 && (
        <p className="empty">
          <strong>{bookings.length ? "Nothing matches these filters." : "No bookings yet."}</strong>{" "}
          {!bookings.length && "Bookings from your Gmail confirmations show up here automatically each morning."}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <div className="month-label">{g.key === "none" ? "No date yet" : `${MONTHS_LONG[+g.key.slice(5) - 1]} ${g.key.slice(0, 4)}`}</div>
          <div className="tickets">
            {g.items.map((b) => {
              const trip = trips.find((t) => t.id === b.trip_id);
              const n = nights(b);
              const meta = [
                n ? `${fmtRange(b.date, b.end_date)}, ${n} night${n > 1 ? "s" : ""}` : "",
                trip?.title,
                b.provider,
                b.source === "gmail" ? "From Gmail" : "",
              ].filter(Boolean);
              return (
                <div
                  key={b.id}
                  className="ticket"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(b.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(b.id)}
                >
                  <div className="when">
                    <span className="m">{b.date ? MONTHS[+b.date.slice(5, 7) - 1] : "—"}</span>
                    <span className="dd">{b.date ? +b.date.slice(8) : "?"}</span>
                    {b.time && <span className="tm">{b.time}</span>}
                  </div>
                  <div className="main">
                    <span className="type">{BOOKING_TYPES[b.type]}</span>
                    <span className="ttl">{b.title}</span>
                    {meta.length > 0 && <span className="meta">{meta.join(" · ")}</span>}
                  </div>
                  <div className="side">
                    <BookingPill status={b.status} />
                    {b.confirmation && <CopyCode code={b.confirmation} toast={toast} />}
                    {Number(b.cost) > 0 && <span className="cost">{money(b.cost)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
