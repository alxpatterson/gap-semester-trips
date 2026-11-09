"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { categoryOf } from "@/lib/logic";
import type { Booking, BookingType } from "@/lib/types";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button className="overlay" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <h2 id="sheet-title">{title}</h2>
          <button ref={closeRef} className="x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2200);
  }, []);
  const node = msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
  return { toast, node };
}

/** Two-tap delete so nothing is removed by a stray tap. */
export function DeleteButton({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`btn small danger ${armed ? "armed" : ""}`}
      disabled={disabled}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? "Tap again to delete" : "Delete"}
    </button>
  );
}

export function CopyCode({ code, toast }: { code: string; toast: (m: string) => void }) {
  return (
    <button
      className="code"
      title="Copy confirmation code"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(code);
          toast(`Copied ${code}`);
        } catch {
          const range = document.createRange();
          range.selectNodeContents(e.currentTarget);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          toast("Selected. Press copy.");
        }
      }}
    >
      {code}
    </button>
  );
}

export function BookingPill({ status }: { status: Booking["status"] }) {
  if (status === "booked") return <span className="pill booked">Booked</span>;
  if (status === "review") return <span className="pill review">Check</span>;
  return <span className="pill todo">To book</span>;
}

/** A square icon tile, coloured by the booking's category — the anchor on every booking row. */
const ICONS: Record<BookingType, string> = {
  stay: "M3 19v-9M3 14h18v5M7 14v-4h5a3 3 0 0 1 3 3v1",
  flight: "M21 3 11 13M21 3l-6.5 18-3.5-8-8-3.5L21 3Z",
  train: "M6 3h12v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM6 9h12M9.5 21 7 18M14.5 21 17 18",
  bus: "M4 5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 21v-3M16 21v-3",
  food: "M5 3v7a2 2 0 0 0 4 0V3M7 10v11M18 3c-1.6 2-2.5 4-2.5 6.5 0 1.9.8 2.9 2.5 2.9s2.5-1 2.5-2.9C20.5 7 19.6 5 18 3ZM18 12.4V21",
  activity: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM12 7v10",
  other: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
};

export function TypeTile({ type }: { type: BookingType }) {
  return (
    <span className={`tile c-${categoryOf(type)}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[type]} />
      </svg>
    </span>
  );
}
