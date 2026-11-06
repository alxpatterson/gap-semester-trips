export type TripKind = "base" | "weekend" | "travel" | "other";
export type TripStatus = "idea" | "planned" | "booked";
export type BookingType = "stay" | "flight" | "train" | "bus" | "food" | "activity" | "other";
export type BookingStatus = "todo" | "booked" | "review";
export type Category = "stays" | "transport" | "food" | "events" | "other";

export interface Plan {
  id: string;
  name: string;
  budget_usd: number;
  budget_note: string;
}

export interface Trip {
  plan_id: string;
  id: string;
  title: string;
  kind: TripKind;
  status: TripStatus;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null;
  place: string;
  schengen: boolean;
  notes: string;
  source: string;
  created_by: string | null;
}

export interface Booking {
  plan_id: string;
  id: string;
  title: string;
  type: BookingType;
  status: BookingStatus;
  trip_id: string | null;
  date: string | null; // YYYY-MM-DD (departure, check-in or event day)
  end_date: string | null; // check-out for stays
  time: string;
  provider: string;
  cost: number;
  confirmation: string;
  link: string;
  notes: string;
  counts_in_budget: boolean;
  source: string;
  created_by: string | null;
}

export interface SyncStatus {
  plan_id: string;
  last_run: string | null;
  added: number;
  updated: number;
  review: number;
  last_error: string;
}
