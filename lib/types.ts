export type MemberRole = "owner" | "editor" | "viewer";
export type TripKind = "base" | "weekend" | "travel" | "other";
export type TripStatus = "idea" | "planned" | "booked";
export type BookingType = "stay" | "flight" | "train" | "bus" | "food" | "activity" | "other";
export type BookingStatus = "todo" | "booked" | "review";
export type Category = "stays" | "transport" | "food" | "events" | "other";

export interface Plan {
  id: string;
  name: string;
  budget_usd: number; // the budget, in the plan's own currency — the column name predates currencies
  budget_note: string;
  start_date: string | null; // YYYY-MM-DD, the first day the calendar will show
  end_date: string | null;
  currency: string; // ISO code, e.g. "USD", "EUR"
  track_schengen: boolean;
  calendar_token?: string | null; // the secret in the calendar feed's URL (0008)
  kind?: PlanKind; // 0010; missing before that migration, which means personal
}

/** A personal plan is someone's own trip; a group plan is one trip shared with friends (0010). */
export type PlanKind = "personal" | "group";

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
  arrive_time: string; // when a flight/train/bus lands; end_date carries the day if it lands on the next one (0009)
  provider: string;
  cost: number;
  confirmation: string;
  link: string;
  notes: string;
  counts_in_budget: boolean;
  source: string;
  created_by: string | null;
}

export interface Task {
  plan_id: string;
  id: string;
  title: string;
  done: boolean;
  due: string | null; // YYYY-MM-DD
  trip_id: string | null;
  created_by: string | null;
  done_at: string | null;
  assignee?: string | null; // an email (0010)
}

export interface SyncStatus {
  plan_id: string;
  last_run: string | null;
  added: number;
  updated: number;
  review: number;
  last_error: string;
}

// ---------- Doing it with friends (0010) ----------
export interface Member {
  email: string;
  role: MemberRole;
}

export interface Profile {
  email: string;
  display_name: string;
  pay_handle: string; // a Venmo/PayPal/Revolut handle or link
}

export interface BookingPerson {
  plan_id: string;
  booking_id: string;
  email: string;
}

export interface TripNote {
  plan_id: string;
  id: string;
  trip_id: string;
  author: string;
  body: string;
  created_at: string;
}

/** A country marked by hand rather than earned by a trip (0012). */
export type MarkKind = "been" | "planned" | "wish";

export interface CountryMark {
  plan_id: string;
  code: string; // ISO 3166-1 alpha-3
  mark: MarkKind;
  created_by: string;
}

export type ExpenseKind = "expense" | "settlement";

export interface Share {
  email: string;
  amount: number;
}

export interface Expense {
  plan_id: string;
  id: string;
  kind: ExpenseKind;
  title: string;
  amount: number;
  currency: string;
  paid_by: string; // for a settlement, the person paying back
  date: string;
  trip_id: string | null;
  booking_id: string | null;
  shares: Share[]; // for a settlement, the one person being paid
  notes: string;
}
