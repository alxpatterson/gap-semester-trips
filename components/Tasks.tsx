"use client";

import { useState } from "react";
import { fmtDate, openTasks, sortTasks, taskGroup, TASK_GROUPS, type TaskGroup } from "@/lib/logic";
import type { Task } from "@/lib/types";

export default function Tasks({
  tasks,
  loaded,
  today,
  canEdit,
  saving,
  onAdd,
  onToggle,
  onDelete,
}: {
  tasks: Task[];
  loaded: boolean;
  today: string;
  canEdit: boolean;
  saving: boolean;
  onAdd: (title: string, due: string | null) => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [showDone, setShowDone] = useState(false);

  const sorted = sortTasks(tasks);
  const open = sorted.filter((t) => !t.done);
  const done = sorted.filter((t) => t.done);

  const groups = TASK_GROUPS.map(([key, label]) => ({
    key,
    label,
    items: (key === "done" ? done : open).filter((t) => taskGroup(t, today) === key),
  })).filter((g) => g.items.length > 0 && (g.key !== "done" || showDone));

  return (
    <section className="panel todo-panel" aria-label="To do">
      <h3>
        To do{loaded && openTasks(tasks) > 0 && <span className="n"> {openTasks(tasks)}</span>}
      </h3>
      {canEdit && (
        <form
          className="todo-add"
          onSubmit={(e) => {
            e.preventDefault();
            const text = title.trim();
            if (!text) return;
            onAdd(text, due || null);
            setTitle("");
            setDue("");
          }}
        >
          <input
            aria-label="What needs doing?"
            placeholder="Renew passport, book Dublin hostel…"
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input aria-label="Due date (optional)" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn primary" disabled={saving || !title.trim()}>
            Add
          </button>
        </form>
      )}

      {!loaded && <p className="empty">Loading your list…</p>}
      {loaded && tasks.length === 0 && (
        <p className="empty">
          <strong>Nothing on the list.</strong> {canEdit ? "Add the things that aren't bookings — visas, jabs, a new passport." : ""}
        </p>
      )}
      {loaded && tasks.length > 0 && open.length === 0 && !showDone && <p className="empty">
        <strong>All done.</strong> Nothing outstanding.
      </p>}

      {groups.map((g) => (
        <div key={g.key}>
          <div className="month-label">
            {g.label} <span className="n">{g.items.length}</span>
          </div>
          <ul className="todo">
            {g.items.map((t) => (
              <li key={t.id} className={`${t.done ? "is-done" : ""} ${taskGroup(t, today) === "overdue" ? "is-late" : ""}`}>
                <label>
                  <input type="checkbox" checked={t.done} disabled={!canEdit || saving} onChange={() => onToggle(t)} />
                  <span className="t">{t.title}</span>
                </label>
                {t.due && <span className="d">{fmtDate(t.due)}</span>}
                {canEdit && (
                  <button className="x small" aria-label={`Delete ${t.title}`} disabled={saving} onClick={() => onDelete(t)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {done.length > 0 && (
        <button className="btn ghost small todo-toggle" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide" : "Show"} {done.length} done
        </button>
      )}
    </section>
  );
}

export type { TaskGroup };
