"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan } from "@/lib/types";

/**
 * The subscribable calendar link. The URL is the only credential a calendar app has, so it is
 * shown with that said plainly and with a way to replace it.
 */
export default function CalendarFeed({
  sb,
  plan,
  canEdit,
  onRotated,
  toast,
}: {
  sb: SupabaseClient;
  plan: Plan;
  canEdit: boolean;
  onRotated: () => void;
  toast: (m: string) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState(plan.calendar_token ?? "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => setToken(plan.calendar_token ?? ""), [plan.calendar_token]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  // Nothing to show until the migration that adds the column has been run.
  if (!token || !origin) return null;
  const url = `${origin}/calendar/${token}.ics`;

  const rotate = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("rotate_calendar_token", { p: plan.id });
    setBusy(false);
    setArmed(false);
    if (error) return toast(`Couldn't replace the link: ${error.message}`);
    if (typeof data === "string") setToken(data);
    toast("New link. The old one has stopped working.");
    onRotated();
  };

  return (
    <>
      <div className="section-t">Calendar feed</div>
      <p className="empty" style={{ padding: 0 }}>
        Subscribe to this link in Google Calendar, Apple Calendar or Outlook and every trip and booking appears there. Anyone holding
        it can read the trip, so treat it like a password. Google picks up changes on its own schedule &mdash; usually within a day.
      </p>
      <div className="feed">
        <input readOnly aria-label="Calendar feed link" value={url} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast("Link copied");
            } catch {
              toast("Press and hold the link to copy it.");
            }
          }}
        >
          Copy
        </button>
      </div>
      <div className="row-actions">
        <a className="btn small" href={url.replace(/^https?:/, "webcal:")}>
          Add to Apple Calendar or Outlook
        </a>
        {canEdit && (
          <button className={`btn small danger ${armed ? "armed" : ""}`} disabled={busy} onClick={() => (armed ? rotate() : setArmed(true))}>
            {busy ? "Replacing…" : armed ? "Tap again — everyone resubscribes" : "Replace link"}
          </button>
        )}
      </div>
    </>
  );
}
