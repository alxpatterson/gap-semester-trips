"use client";

import { budgetSummary, CATEGORIES, money } from "@/lib/logic";
import type { Booking, Category, Plan } from "@/lib/types";

export const CATEGORY_COLOR: Record<Category, string> = {
  stays: "var(--k-base)",
  transport: "var(--k-travel)",
  food: "var(--k-weekend)",
  events: "var(--k-event)",
  other: "var(--k-other)",
};

export default function BudgetPanel({
  plan,
  bookings,
  loaded,
  onPickCategory,
}: {
  plan: Plan;
  bookings: Booking[];
  loaded: boolean;
  onPickCategory: (c: Category) => void;
}) {
  const budget = Number(plan.budget_usd) || 0;
  const { byCategory, spent, planned, left } = budgetSummary(bookings, budget);
  return (
    <section className="budget" aria-label="Budget">
      <div className="b-head">
        <span className="b-label">Budget left</span>
        <span className={`b-left ${left < 0 ? "neg" : ""}`}>{loaded ? (left < 0 ? "−" : "") + money(Math.abs(left)) : "—"}</span>
        <span className="b-of" title={`${money(spent)} booked of ${money(budget)}`}>
          of {money(budget)}
          {planned > 0 && ` · ${money(planned)} planned`}
          {plan.budget_note && ` · ${plan.budget_note}`}
        </span>
      </div>
      <div className="b-bar">
        {(Object.entries(byCategory) as [Category, number][])
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <span key={k} style={{ width: `${Math.min(100, (v / Math.max(budget, 1)) * 100)}%`, background: CATEGORY_COLOR[k] }} title={`${k}: ${money(v)}`} />
          ))}
      </div>
      <div className="b-cats">
        {CATEGORIES.map(([k, label]) => (
          <button key={k} className="b-cat" onClick={() => onPickCategory(k)} title={`Show ${label.toLowerCase()} bookings`}>
            <i style={{ background: CATEGORY_COLOR[k] }} />
            {label} <b>{money(byCategory[k])}</b>
          </button>
        ))}
        {byCategory.other > 0 && (
          <span className="b-cat">
            <i style={{ background: CATEGORY_COLOR.other }} />
            Other <b>{money(byCategory.other)}</b>
          </span>
        )}
      </div>
    </section>
  );
}
