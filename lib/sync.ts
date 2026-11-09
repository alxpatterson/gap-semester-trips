/**
 * Shapes and checks for the daily Gmail sync. The sync runs as a scheduled Claude session that
 * reads Gmail and POSTs what it finds to /api/sync, so nothing here trusts its input: every row is
 * rebuilt field by field from a whitelist, and the rules that protect hand-edited data live here
 * rather than in the prompt.
 */
import type { BookingStatus, BookingType, TripKind, TripStatus } from "./types";

/** Rows the sync creates are prefixed, so it can never invent or overwrite a hand-made id. */
export const SYNC_ID_PREFIX = "gm-";
export const SYNC_SOURCE = "gmail";

/** On a booking it already created, the sync may only move it in time or change its status. */
export const SYNC_UPDATABLE = ["title", "date", "end_date", "time", "status"] as const;

export const MAX_ROWS = 200;
export const MAX_PROCESSED_IDS = 300;

const BOOKING_TYPES: BookingType[] = ["stay", "flight", "train", "bus", "food", "activity", "other"];
const BOOKING_STATUSES: BookingStatus[] = ["todo", "booked", "review"];
const TRIP_KINDS: TripKind[] = ["base", "weekend", "travel", "other"];
const TRIP_STATUSES: TripStatus[] = ["idea", "planned", "booked"];

export class SyncError extends Error {}

const str = (v: unknown, max: number, field: string) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new SyncError(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new SyncError(`${field} is longer than ${max} characters`);
  return s;
};

const date = (v: unknown, field: string) => {
  const s = str(v, 10, field);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new SyncError(`${field} must be YYYY-MM-DD`);
  return s;
};

const oneOf = <T extends string>(v: unknown, allowed: T[], field: string): T => {
  const s = str(v, 20, field);
  if (!allowed.includes(s as T)) throw new SyncError(`${field} must be one of ${allowed.join(", ")}`);
  return s as T;
};

const money = (v: unknown, field: string) => {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new SyncError(`${field} must be a number between 0 and 1,000,000`);
  return Math.round(n * 100) / 100;
};

/** An id the sync only points at — an existing trip it is filing a booking under, made by anyone. */
export const refId = (v: unknown, field: string) => {
  const id = str(v, 80, field);
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SyncError(`${field} may only hold letters, digits, hyphens and underscores`);
  return id;
};

/** An id of a row the sync creates: prefixed, so it can never name a row somebody made by hand. */
export const syncId = (v: unknown, field: string) => {
  const id = str(v, 80, field).toLowerCase();
  if (!id.startsWith(SYNC_ID_PREFIX)) throw new SyncError(`${field} must start with "${SYNC_ID_PREFIX}"`);
  if (!/^[a-z0-9-]+$/.test(id)) throw new SyncError(`${field} may only hold letters, digits and hyphens`);
  return id;
};

/** A booking row the sync is allowed to insert. Fields it must never set are fixed here. */
export function normalizeBooking(input: Record<string, unknown>, planId: string) {
  const date_ = date(input.date, "date");
  const end = date(input.end_date, "end_date");
  if (date_ && end && end < date_) throw new SyncError("end_date is before date");
  return {
    plan_id: planId,
    id: syncId(input.id, "booking id"),
    title: str(input.title, 100, "title") || "Untitled booking",
    type: oneOf(input.type, BOOKING_TYPES, "type"),
    status: oneOf(input.status ?? "booked", BOOKING_STATUSES, "status"),
    trip_id: refId(input.trip_id, "trip_id"),
    date: date_,
    end_date: end,
    time: str(input.time, 10, "time"),
    provider: str(input.provider, 60, "provider"),
    cost: money(input.cost, "cost"),
    confirmation: str(input.confirmation, 40, "confirmation"),
    link: str(input.link, 500, "link"),
    notes: str(input.notes, 1000, "notes"),
    counts_in_budget: input.counts_in_budget !== false,
    source: SYNC_SOURCE,
    created_by: null,
  };
}

/** A trip row the sync is allowed to insert. */
export function normalizeTrip(input: Record<string, unknown>, planId: string) {
  const start = date(input.start_date, "start_date");
  const end = date(input.end_date, "end_date");
  if (start && end && end < start) throw new SyncError("end_date is before start_date");
  return {
    plan_id: planId,
    id: syncId(input.id, "trip id"),
    title: str(input.title, 80, "title") || "Untitled trip",
    kind: oneOf(input.kind ?? "travel", TRIP_KINDS, "kind"),
    status: oneOf(input.status ?? "booked", TRIP_STATUSES, "status"),
    start_date: start,
    end_date: end,
    place: str(input.place, 100, "place"),
    schengen: input.schengen === true,
    notes: str(input.notes, 1000, "notes"),
    source: SYNC_SOURCE,
    created_by: null,
  };
}

/** The slice of an existing booking the sync may change — never cost, notes, trip or budget flag. */
export function updatableFields(row: ReturnType<typeof normalizeBooking>) {
  const out: Record<string, unknown> = {};
  for (const f of SYNC_UPDATABLE) out[f] = row[f];
  return out;
}

export function processedIds(previous: unknown, incoming: unknown) {
  const list = [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]
    .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)
    .map((v) => v.trim());
  return [...new Set(list)].slice(-MAX_PROCESSED_IDS);
}

export function rowsOf(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SyncError(`${field} must be a list`);
  if (value.length > MAX_ROWS) throw new SyncError(`${field} holds more than ${MAX_ROWS} rows`);
  return value.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new SyncError(`${field} holds something that isn't a row`);
    return v as Record<string, unknown>;
  });
}
