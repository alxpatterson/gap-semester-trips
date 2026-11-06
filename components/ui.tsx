"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Booking } from "@/lib/types";

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
