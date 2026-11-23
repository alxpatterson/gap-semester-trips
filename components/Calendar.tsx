"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";

import {
  BOOKING_TYPES,
  categoryOf,
  bookingsOn,
  daySchedule,
  DOWS_LONG,
  hhmm,
  CAL_VIEWS,
  dayNum,
  DOWS,
  fmtDate,
  fmtRange,
  fromDayNum,
  inPlanRange,
  KIND_ORDER,
  KINDS,
  money,
  MONTHS_LONG,
  nights,
  rangeMonths,
  shiftAnchor,
  timeSpan,
  tripsOn,
  tripEnd,
  viewDays,
  viewTitle,
  weekday,
  type CalView,
  type PlanRange,
} from "@/lib/logic";
import type { Booking, Trip } from "@/lib/types";
import { TypeTile } from "./ui";


/**
 * Click (or tap) a day to open it hour by hour. Drag across several, or right-click one, to start
 * something on those dates. A mouse or pen drags straight away; a finger has to press and hold
 * first, because a swipe on a phone is how you scroll. Anything already on a day (a trip bar, a
 * booking) keeps its own click.
 */
function useDayPick(onOpen: (day: string) => void, onPick?: (start: string, end: string) => void) {
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  const st = useRef<{ id: number; a: string; touch: boolean; armed: boolean; x: number; y: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const lastType = useRef("mouse");
  const box = useRef<HTMLElement | null>(null);
  const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-day]")?.dataset.day ?? null;
  const canPick = !!onPick;

  // Once a finger has been held, the browser must not take the gesture over as a scroll.
  useEffect(() => {
    const el = box.current;
    if (!el || !canPick) return;
    const stop = (e: TouchEvent) => st.current?.armed && e.cancelable && e.preventDefault();
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, [canPick]);

  const end = () => {
    if (st.current?.timer) clearTimeout(st.current.timer);
    st.current = null;
    setSel(null);
  };

  const bind = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      lastType.current = e.pointerType;
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input")) return;
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
      if (!a) return;
      const touch = e.pointerType === "touch";
      st.current = { id: e.pointerId, a, touch, armed: !touch && canPick, x: e.clientX, y: e.clientY };
      if (touch) {
        if (canPick)
          st.current.timer = setTimeout(() => {
            if (!st.current) return;
            st.current.armed = true;
            setSel({ a, b: a });
            try { navigator.vibrate?.(8); } catch {}
          }, 350);
      } else if (canPick) {
        setSel({ a, b: a });
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      }
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const c = st.current;
      if (!c || e.pointerId !== c.id) return;
      if (!c.armed) {
        // A finger that moved before the hold finished is scrolling, so leave it to it.
        if (c.touch && Math.hypot(e.clientX - c.x, e.clientY - c.y) > 8) end();
        return;
      }
      const d = dayAt(e.clientX, e.clientY);
      if (d) setSel((cur) => (cur && cur.b !== d ? { a: c.a, b: d } : cur));
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const c = st.current;
      if (!c || e.pointerId !== c.id) return;
      const a = c.a;
      // A tap, or a click that never left its day, opens the day.
      if (!c.armed) {
        end();
        if (!c.touch || Math.hypot(e.clientX - c.x, e.clientY - c.y) <= 8) onOpen(a);
        return;
      }
      const d = dayAt(e.clientX, e.clientY) || sel?.b || a;
      end();
      if (d === a && !c.touch) return onOpen(a);
      onPick?.(a <= d ? a : d, a <= d ? d : a);
    },
    onPointerCancel: end,
    onContextMenu: (e: RMouseEvent<HTMLElement>) => {
      // A held finger fires this too on Android; that gesture belongs to the drag above.
      if (!onPick || lastType.current === "touch") return;
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
      if (!a) return;
      e.preventDefault();
      end();
      onPick(a, a);
    },
  };
  return { sel, bind, ref: box };
}

/**
 * Hovering a day with a mouse, after a moment, zooms a card out of it with everything on that day.
 * Once one is showing, moving to the next day swaps it straight away. Touch never sees it: a tap
 * opens the day instead.
 */
function useDayPeek() {
  const [peek, setPeek] = useState<{ day: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showing = useRef<string | null>(null);
  const hide = () => {
    clearTimeout(timer.current);
    showing.current = null;
    setPeek(null);
  };
  useEffect(() => {
    if (!peek) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [peek]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const bind = {
    onPointerOver: (e: RPointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-peek]");
      const day = cell?.dataset.peek;
      if (!cell || !day || day === showing.current) return;
      clearTimeout(timer.current);
      const show = () => {
        showing.current = day;
        setPeek({ day, rect: cell.getBoundingClientRect() });
      };
      if (showing.current) show();
      else timer.current = setTimeout(show, 280);
    },
    onPointerLeave: hide,
    onPointerDownCapture: hide,
  };
  return { peek, bind };
}

const inSel = (sel: { a: string; b: string } | null, d: string) => !!sel && d >= (sel.a < sel.b ? sel.a : sel.b) && d <= (sel.a < sel.b ? sel.b : sel.a);

export function CalendarPanel({
  view,
  anchor,
  range,
  currency,
  trips,
  bookings,
  loaded,
  today,
  onView,
  onAnchor,
  onTrip,
  onBooking,
  onPickDays,
  onAdd,
}: {
  view: CalView;
  anchor: string;
  range: PlanRange;
  currency: string;
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onView: (v: CalView) => void;
  onAnchor: (d: string) => void;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  /** Set when the person can edit: a drag over days, or a right-click on one, asks to add something on them. */
  onPickDays?: (start: string, end: string) => void;
  /** Set when the person can edit: the day view's right-click menu. */
  onAdd?: (what: "trip" | "booking", date: string, time?: string) => void;
}) {
  const all = view === "all";
  const openDay = (d: string) => {
    onAnchor(d);
    onView("day");
  };
  const step = view === "month" || all ? "month" : view === "week" ? "week" : "day";
  return (
    <div className="panel">
      <div className="monthbar">
        <h2>{all ? fmtRange(range.start, range.end) : viewTitle(view, anchor)}</h2>
        <div className="navs">
          <button className="btn" aria-label={`Previous ${step}`} disabled={all || !inPlanRange(view, shiftAnchor(view, anchor, -1), range)} onClick={() => onAnchor(shiftAnchor(view, anchor, -1))}>
            ‹
          </button>
          <button className="btn" aria-label={`Next ${step}`} disabled={all || !inPlanRange(view, shiftAnchor(view, anchor, 1), range)} onClick={() => onAnchor(shiftAnchor(view, anchor, 1))}>
            ›
          </button>
          <div className="tabs seg" role="group" aria-label="Calendar view">
            {CAL_VIEWS.map(([v, label]) => (
              <button key={v} aria-pressed={view === v} onClick={() => onView(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {all ? (
        <div className="allview">
          {rangeMonths(range).map((m) => (
            <section key={m} className="allmonth">
              <button className="allhead" onClick={() => { onAnchor(`${m}-01` < range.start ? range.start : `${m}-01`); onView("month"); }}>
                {MONTHS_LONG[+m.slice(5) - 1]} {m.slice(0, 4)}
              </button>
              <MonthGrid month={m} trips={trips} bookings={bookings} today={today} onTrip={onTrip} onOpenDay={openDay} onPickDays={onPickDays} />
            </section>
          ))}
        </div>
      ) : view === "month" ? (
        <MonthGrid month={anchor.slice(0, 7)} trips={trips} bookings={bookings} today={today} onTrip={onTrip} onOpenDay={openDay} onPickDays={onPickDays} />
      ) : view === "week" ? (
        <WeekGrid anchor={anchor} trips={trips} bookings={bookings} today={today} onTrip={onTrip} onBooking={onBooking} onOpenDay={openDay} onPickDays={onPickDays} />
      ) : (
        <DayView anchor={anchor} currency={currency} trips={trips} bookings={bookings} loaded={loaded} today={today} onTrip={onTrip} onBooking={onBooking} onAdd={onAdd} />
      )}

      <div className="legend">
        <span className="k-base"><i />Base</span>
        <span className="k-weekend"><i />Weekend trip</span>
        <span className="k-travel"><i />Travel leg</span>
        <span className="k-other"><i />Other</span>
        <span className="note">Striped = still an idea</span>
      </div>
    </div>
  );
}

/** The card a hovered day zooms out into: where you are, then everything on it in time order. */
function DayPeek({ day, rect, trips, bookings }: { day: string; rect: DOMRect; trips: Trip[]; bookings: Booking[] }) {
  const box = useRef<HTMLDivElement>(null);
  const W = 280;
  const right = rect.right + 10 + W <= window.innerWidth - 8;
  const left = right ? rect.right + 10 : Math.max(8, rect.left - 10 - W);
  const [top, setTop] = useState(rect.top);
  // Keep the whole card on screen once its height is known.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(rect.top, window.innerHeight - h - 8)));
  }, [rect, day]);
  const here = tripsOn(trips, day);
  const items = bookingsOn(bookings, day);
  return (
    <div
      ref={box}
      className="peek"
      role="tooltip"
      style={{ left, top, width: W, transformOrigin: `${right ? "left" : "right"} ${Math.max(0, rect.top + rect.height / 2 - top)}px` }}
    >
      <div className="peek-h">
        <span>{DOWS_LONG[weekday(day)]}</span>
        <b>{fmtDate(day)}</b>
      </div>
      {here.map((t) => (
        <div key={t.id} className={`peek-trip k-${t.kind} ${t.status === "idea" ? "idea" : ""}`}>
          <span className="t">{t.title}</span>
          <span className="d">{[t.place, fmtRange(t.start_date, t.end_date)].filter(Boolean).join(" · ")}</span>
        </div>
      ))}
      {items.map((b) => {
        const checkout = b.type === "stay" && b.end_date === day && b.date !== day;
        return (
          <div key={`${b.id}-${checkout ? "out" : "in"}`} className="peek-bk">
            <TypeTile type={b.type} />
            <span className="n">
              <span className="ttl">{checkout ? `Check out · ${b.title}` : b.title}</span>
              <span className="sub">{[timeSpan(b) || BOOKING_TYPES[b.type], b.provider].filter(Boolean).join(" · ")}</span>
            </span>
          </div>
        );
      })}
      {!here.length && !items.length && <p className="anone">Nothing planned yet.</p>}
      <p className="peek-hint">Click for the hour-by-hour</p>
    </div>
  );
}

const HOUR = 52; // px per hour on the day's timeline

/**
 * Day view: where you are and anything without a time across the top, then the day hour by hour,
 * each booking a block from when it starts to when it lands or ends. Right-click (or press and hold
 * on a phone) anywhere on it to add a booking at that time or a trip from that day.
 */
function DayView({
  anchor,
  currency,
  trips,
  bookings,
  loaded,
  today,
  onTrip,
  onBooking,
  onAdd,
}: {
  anchor: string;
  currency: string;
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onAdd?: (what: "trip" | "booking", date: string, time?: string) => void;
}) {
  const here = tripsOn(trips, anchor);
  const { allDay, timed } = daySchedule(bookings, anchor);
  const scroller = useRef<HTMLDivElement>(null);
  const hours = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; time?: string } | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Open on the morning, or on the first thing that day if it's earlier or later.
  const first = timed.length ? Math.min(...timed.map((t) => t.start)) : 8 * 60;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const at = anchor === today ? now.getHours() * 60 - 90 : Math.min(first, 8 * 60) - 30;
    el.scrollTop = Math.max(0, (at / 60) * HOUR);
  }, [anchor]);
  useEffect(() => {
    if (anchor !== today) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [anchor, today]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest(".ctx-menu")) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  /** The half hour under a point on the timeline, or none when the point is above it. */
  const timeAt = (clientY: number) => {
    const el = hours.current;
    if (!el) return undefined;
    const y = clientY - el.getBoundingClientRect().top;
    if (y < 0) return undefined;
    return hhmm(Math.min(23 * 60 + 30, Math.floor(((y / HOUR) * 60) / 30) * 30));
  };
  const openMenu = (x: number, y: number) => onAdd && setMenu({ x: Math.min(x, window.innerWidth - 228), y: Math.min(y, window.innerHeight - 110), time: timeAt(y) });
  const add = (what: "trip" | "booking") => {
    const t = menu?.time;
    setMenu(null);
    onAdd?.(what, anchor, what === "booking" ? t : undefined);
  };

  const touchBind = onAdd
    ? {
        onContextMenu: (e: RMouseEvent) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        },
        // iOS never fires contextmenu, so a held finger opens the same menu.
        onPointerDown: (e: RPointerEvent) => {
          if (e.pointerType !== "touch" || (e.target as HTMLElement).closest("button")) return;
          const { clientX: x, clientY: y } = e;
          hold.current = { x, y, timer: setTimeout(() => { hold.current = null; openMenu(x, y); }, 500) };
        },
        onPointerMove: (e: RPointerEvent) => {
          const h = hold.current;
          if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) {
            clearTimeout(h.timer);
            hold.current = null;
          }
        },
        onPointerUp: () => {
          if (hold.current) clearTimeout(hold.current.timer);
          hold.current = null;
        },
      }
    : {};
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className={`dayv ${anchor === today ? "today" : ""}`} {...touchBind}>
      <div className="dayv-top">
        {here.map((t) => (
          <button key={t.id} className={`atrip k-${t.kind} ${t.status === "idea" ? "idea" : ""}`} onClick={() => onTrip(t.id)}>
            <span className="t">{t.start_date === anchor ? `Arrive in ${t.place || t.title}` : t.title}</span>
            <span className="d">{[t.place || KINDS[t.kind], fmtRange(t.start_date, t.end_date)].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
        {loaded && !here.length && <p className="anone">No trip covers this day.</p>}
        {allDay.length > 0 && (
          <div className="allday">
            <span className="allday-t">All day</span>
            {allDay.map((b) => {
              const checkout = b.type === "stay" && b.end_date === anchor && b.date !== anchor;
              const n = nights(b);
              return (
                <button key={b.id} className={`wbk c-${categoryOf(b.type)}`} onClick={() => onBooking(b.id)}>
                  <span className="n">
                    {checkout ? `Check out · ${b.title}` : b.title}
                    {!checkout && n ? ` · ${n} night${n > 1 ? "s" : ""}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="hours-scroll" ref={scroller}>
        <div className="hours" ref={hours} style={{ height: 24 * HOUR }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hour" style={{ top: h * HOUR, height: HOUR }}>
              <span className="hl">{h === 0 ? "" : hhmm(h * 60)}</span>
            </div>
          ))}
          {anchor === today && <div className="now-line" style={{ top: (nowMin / 60) * HOUR }} aria-hidden="true" />}
          <div className="blocks">
            {timed.map(({ b, start, end, col, cols, fromBefore, intoAfter }) => {
              const short = end - start < 50;
              return (
                <button
                  key={b.id}
                  className={`hblock c-${categoryOf(b.type)} ${short ? "short" : ""} ${fromBefore ? "cut-top" : ""} ${intoAfter ? "cut-bot" : ""}`}
                  style={{ top: (start / 60) * HOUR + 1, height: ((end - start) / 60) * HOUR - 2, left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - 4px)` }}
                  onClick={() => onBooking(b.id)}
                  title={`${b.title} · ${hhmm(start)}–${hhmm(end)}`}
                >
                  <span className="tm">{fromBefore ? `→ ${b.arrive_time}` : timeSpan(b)}</span>
                  <span className="ttl">{b.title}</span>
                  {!short && (b.provider || Number(b.cost) > 0) && (
                    <span className="sub">{[b.provider, Number(b.cost) > 0 ? money(b.cost, currency) : ""].filter(Boolean).join(" · ")}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {onAdd && (
        <p className="dayv-hint">
          <span className="mouse">Right-click a time to add something.</span>
          <span className="finger">Press and hold a time to add something.</span>
        </p>
      )}

      {menu && (
        <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button role="menuitem" onClick={() => add("booking")}>
            Add a booking{menu.time ? ` at ${menu.time}` : ""}
          </button>
          <button role="menuitem" onClick={() => add("trip")}>
            Add a trip from {fmtDate(anchor)}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Week: seven columns side by side. Trips run as continuous bars across the top, each in a fixed
 * lane so a bar lines up across the days it covers, then each day lists its own bookings.
 */
function WeekGrid({
  anchor,
  trips,
  bookings,
  today,
  onTrip,
  onBooking,
  onOpenDay,
  onPickDays,
  mini = false,
}: {
  anchor: string;
  trips: Trip[];
  bookings: Booking[];
  today: string;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onOpenDay: (day: string) => void;
  onPickDays?: (start: string, end: string) => void;
  /** The small copy on Home: all seven days fit the width, so nothing scrolls sideways. */
  mini?: boolean;
}) {
  const pick = useDayPick(onOpenDay, onPickDays);
  const peek = useDayPeek();
  const days = viewDays("week", anchor);
  // On a narrow screen only the first few columns fit, so bring the current day into view.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const col = box.querySelector<HTMLElement>(".wcell.today") ?? box.querySelector<HTMLElement>(".wcell");
    if (!col) return;
    box.scrollLeft = Math.max(0, Math.min(col.offsetLeft - 8, box.scrollWidth - box.clientWidth));
  }, [anchor, today]);
  const from = dayNum(days[0]);
  const to = dayNum(days[6]);
  const lanes = trips
    .filter((t) => t.start_date && dayNum(t.start_date) <= to && dayNum(tripEnd(t)!) >= from)
    .map((t) => ({ t, a: dayNum(t.start_date!), b: dayNum(tripEnd(t)!) }))
    .sort((p, q) => KIND_ORDER[p.t.kind] - KIND_ORDER[q.t.kind] || p.a - q.a);

  return (
    <div className="scroller" ref={scroller}>
      <div className={`wgrid ${mini ? "mini" : ""}`} ref={pick.ref as React.RefObject<HTMLDivElement>} {...pick.bind} {...peek.bind}>
        {days.map((d) => (
          <div key={`h-${d}`} data-day={d} data-peek={d} className={`wdow ${d === today ? "today" : ""} ${inSel(pick.sel, d) ? "sel" : ""}`}>
            <span>{DOWS[weekday(d)]}</span>
            <b>{+d.slice(8)}</b>
          </div>
        ))}
        {lanes.length > 0 &&
          days.map((d) => {
            const n = dayNum(d);
            const col = weekday(d);
            return (
              <div key={`p-${d}`} data-day={d} className={`wplace ${d === today ? "today" : ""} ${inSel(pick.sel, d) ? "sel" : ""}`}>
                {lanes.map(({ t, a, b }) =>
                  a <= n && n <= b ? (
                    <button
                      key={t.id}
                      className={`bar k-${t.kind} ${t.status === "idea" ? "idea" : ""} ${n === a ? "s" : ""} ${n === b || col === 6 ? "e" : ""} ${
                        n === a || col === 0 ? "" : "cont"
                      }`}
                      title={`${t.title} · ${fmtRange(t.start_date, t.end_date)}`}
                      onClick={() => onTrip(t.id)}
                    >
                      {/* Repeated per column so a scrolled phone still names the bar; hidden once the whole week fits. */}
                      <span className="lbl">{t.title}</span>
                    </button>
                  ) : (
                    <span key={t.id} className="bar gap" aria-hidden="true" />
                  ),
                )}
              </div>
            );
          })}
        {days.map((d) => {
          const items = bookingsOn(bookings, d);
          return (
            <div key={d} data-day={d} data-peek={d} className={`wcell ${d === today ? "today" : ""} ${inSel(pick.sel, d) ? "sel" : ""}`}>
              {items.map((b) => {
                const checkout = b.type === "stay" && b.end_date === d && b.date !== d;
                return (
                  <button
                    key={`${b.id}-${checkout ? "out" : "in"}`}
                    className={`wbk c-${categoryOf(b.type)}`}
                    title={`${b.title} · ${BOOKING_TYPES[b.type]}`}
                    onClick={() => onBooking(b.id)}
                  >
                    {b.time && <span className="tm">{b.time}</span>}
                    <span className="n">{checkout ? `${b.title} · out` : b.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {peek.peek && <DayPeek key={peek.peek.day} {...peek.peek} trips={trips} bookings={bookings} />}
    </div>
  );
}

/**
 * Home's calendar: the week around the calendar's own anchor, smaller, so paging it here moves the
 * Calendar tab too. A day opens hour by hour on the Calendar tab; the title opens the full week.
 */
export function HomeWeek({
  anchor,
  range,
  trips,
  bookings,
  today,
  onAnchor,
  onOpenDay,
  onOpenWeek,
  onTrip,
  onBooking,
  onPickDays,
}: {
  anchor: string;
  range: PlanRange;
  trips: Trip[];
  bookings: Booking[];
  today: string;
  onAnchor: (d: string) => void;
  onOpenDay: (d: string) => void;
  onOpenWeek: () => void;
  onTrip: (id: string) => void;
  onBooking: (id: string) => void;
  onPickDays?: (start: string, end: string) => void;
}) {
  const prev = shiftAnchor("week", anchor, -1);
  const next = shiftAnchor("week", anchor, 1);
  const thisWeek = viewDays("week", anchor).includes(today);
  const canToday = !thisWeek && today >= range.start && today <= range.end;
  return (
    <div className="panel home-week">
      <div className="monthbar">
        <h2>{viewTitle("week", anchor)}</h2>
        <div className="navs">
          {canToday && (
            <button className="btn" onClick={() => onAnchor(today)}>
              Today
            </button>
          )}
          <button className="btn" aria-label="Previous week" disabled={!inPlanRange("week", prev, range)} onClick={() => onAnchor(prev)}>
            ‹
          </button>
          <button className="btn" aria-label="Next week" disabled={!inPlanRange("week", next, range)} onClick={() => onAnchor(next)}>
            ›
          </button>
          <button className="btn" onClick={onOpenWeek}>
            Calendar
          </button>
        </div>
      </div>
      <WeekGrid mini anchor={anchor} trips={trips} bookings={bookings} today={today} onTrip={onTrip} onBooking={onBooking} onOpenDay={onOpenDay} onPickDays={onPickDays} />
    </div>
  );
}

function MonthGrid({
  month,
  trips,
  bookings,
  today,
  onTrip,
  onOpenDay,
  onPickDays,
}: {
  month: string;
  trips: Trip[];
  bookings: Booking[];
  today: string;
  onTrip: (id: string) => void;
  onOpenDay: (day: string) => void;
  onPickDays?: (start: string, end: string) => void;
}) {
  const pick = useDayPick(onOpenDay, onPickDays);
  const peek = useDayPeek();
  const [y, m] = month.split("-").map(Number);
  const first = dayNum(`${month}-01`);
  const weekdayOfFirst = (new Date(first * 864e5).getUTCDay() + 6) % 7; // Monday = 0
  const start = first - weekdayOfFirst;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

  return (
    <div className="scroller">
      <div className="grid" ref={pick.ref as React.RefObject<HTMLDivElement>} {...pick.bind} {...peek.bind}>
        {DOWS.map((d) => (
          <div key={d} className="dow">
            {d}
          </div>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const n = start + i;
          const ds = fromDayNum(n);
          const col = i % 7;
          const here = tripsOn(trips, ds).map((t) => ({ t, a: dayNum(t.start_date!), b: dayNum(tripEnd(t)!) }));
          return (
            <div key={ds} data-day={ds} data-peek={ds} className={`cell ${ds.slice(0, 7) !== month ? "out" : ""} ${ds === today ? "today" : ""} ${inSel(pick.sel, ds) ? "sel" : ""}`}>
              <span className="dnum">{+ds.slice(8)}</span>
              {here.slice(0, 3).map(({ t, a, b }) => {
                const showLabel = n === a || col === 0 || ds.endsWith("-01");
                return (
                  <button
                    key={t.id}
                    className={`bar k-${t.kind} ${t.status === "idea" ? "idea" : ""} ${n === a ? "s" : ""} ${n === b || col === 6 ? "e" : ""}`}
                    title={`${t.title} · ${fmtRange(t.start_date, t.end_date)}`}
                    onClick={() => onTrip(t.id)}
                  >
                    {showLabel ? t.title : " "}
                  </button>
                );
              })}
              {here.length > 3 && <span className="more">+{here.length - 3} more</span>}
            </div>
          );
        })}
      </div>
      {peek.peek && <DayPeek key={peek.peek.day} {...peek.peek} trips={trips} bookings={bookings} />}
    </div>
  );
}

export function TripRail({
  trips,
  bookings,
  loaded,
  today,
  onTrip,
  sharedIn,
}: {
  trips: Trip[];
  bookings: Booking[];
  loaded: boolean;
  today: string;
  onTrip: (id: string) => void;
  /** Trips from a shared (group) plan, by id → that plan's name, labelled so they read as shared. */
  sharedIn?: Record<string, string>;
}) {
  const list = [...trips].sort((a, b) => (a.start_date || "9").localeCompare(b.start_date || "9"));
  return (
    <aside className="panel rail">
      <h3>All trips</h3>
      <ul className="trip-list">
        {!loaded && <li className="empty">Loading your trips…</li>}
        {loaded && list.length === 0 && (
          <li className="empty">
            <strong>No trips yet.</strong> Add your base and weekend trips with <strong>+ Trip</strong>.
          </li>
        )}
        {list.map((t) => {
          const n = bookings.filter((b) => b.trip_id === t.id).length;
          const past = !!tripEnd(t) && tripEnd(t)! < today;
          return (
            <li key={t.id}>
              <button className={`trip-item k-${t.kind} ${past ? "past" : ""}`} onClick={() => onTrip(t.id)}>
                <span className="sw" />
                <span className="t">{t.title}</span>
                <span className={`pill ${t.status}`}>{t.status}</span>
                <span className="d">
                  {sharedIn?.[t.id] && "Shared · "}
                  {t.start_date ? fmtRange(t.start_date, t.end_date) : "No dates yet"}
                  {n > 0 && ` · ${n} booking${n > 1 ? "s" : ""}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
