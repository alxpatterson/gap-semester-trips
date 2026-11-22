"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, MAP_HEIGHT, MAP_WIDTH, projectLonLat } from "@/lib/countries";
import { COUNTRY_PATHS } from "@/lib/world-map";
import type { CountryVisit } from "@/lib/places";

/**
 * The world, drawn once and then panned and zoomed by moving its viewBox around. Everything in
 * here is geometry and gestures; which countries count as visited is worked out in lib/places.ts.
 *
 * This file pulls in the outlines, which are the better part of 64KB, so MapTab loads it on
 * demand rather than it riding along on the way to the calendar.
 */

/** How far in the map goes: the whole world across, down to a country or two. */
const MAX_ZOOM = 14;
/** Smaller than this on the map and a country gets a dot, because its outline can't be tapped. */
const DOT_BELOW = 650;
/** Where the map opens: western Europe out to Istanbul, with the Alps in the middle. */
const EUROPE = { west: -12, east: 42, north: 62, south: 33 };
/** How many square pixels a country has to cover before its name is worth writing across it. */
const LABEL_ABOVE_PX = 2800;
/** A tap that travelled further than this was a drag, and must not open the country under it. */
const TAP_SLOP = 8;

export type WorldMapProps = {
  visits: CountryVisit[];
  selected: string | null;
  onPick: (code: string) => void;
};

type View = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

const zoomedWidth = (w: number) => Math.min(Math.max(w, MAP_WIDTH / MAX_ZOOM), MAP_WIDTH);

/**
 * Keep the view inside the world, no wider than it and no closer than MAX_ZOOM, at the shape of
 * the panel it's drawn in. A tall panel showing the whole world ends up taller than the world,
 * which is fine: it sits in the middle with sea above and below, the way an atlas page does.
 */
function clampView(view: View, aspect: number): View {
  const w = zoomedWidth(view.w);
  const h = w / aspect;
  const place = (v: number, size: number, max: number) => (size >= max ? (max - size) / 2 : Math.min(Math.max(v, 0), max - size));
  return { x: place(view.x, w, MAP_WIDTH), y: place(view.y, h, MAP_HEIGHT), w, h };
}

/** The view that holds a box of the world, grown to the shape of the panel it's drawn in. */
function fitBox(box: View, aspect: number): View {
  const w = Math.max(box.w, box.h * aspect);
  return clampView({ x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - w / aspect / 2, w, h: w / aspect }, aspect);
}

function fitRegion(region: typeof EUROPE, aspect: number): View {
  const a = projectLonLat(region.west, region.north);
  const b = projectLonLat(region.east, region.south);
  return fitBox({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, aspect);
}

/** Everywhere there's a trip, with room around it. Falls back to Europe when there's nothing yet. */
function fitVisits(visits: CountryVisit[], aspect: number): View {
  const points = visits.map((v) => COUNTRIES.find((c) => c.code === v.code)).filter((c) => !!c);
  if (!points.length) return fitRegion(EUROPE, aspect);
  const pad = MAP_WIDTH / 22;
  const xs = points.map((c) => c.x);
  const ys = points.map((c) => c.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return fitBox({ x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }, aspect);
}

export default function WorldMap({ visits, selected, onPick }: WorldMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(() => fitRegion(EUROPE, 3 / 2));
  // Until someone drags or zooms, the view keeps re-fitting as the panel settles into its size.
  const touched = useRef(false);

  const aspect = size.w && size.h ? size.w / size.h : 3 / 2;
  // Gestures run from callbacks that outlive the render they were made in, so they read the shape
  // of the panel from here rather than closing over it.
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!touched.current && size.w > 0) setView(fitRegion(EUROPE, size.w / size.h));
  }, [size]);

  /**
   * Every move goes through here, and always as "from where we are, go there". Two wheel notches
   * in one frame then compound properly instead of the second undoing the first.
   */
  const move = useCallback((next: View | ((from: View) => View)) => {
    touched.current = true;
    setView((from) => clampView(typeof next === "function" ? next(from) : next, aspectRef.current));
  }, []);

  // ---------- Pan and pinch ----------
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point } | null>(null);
  // How far the fingers travelled, so a drag that ends on a country doesn't count as tapping it.
  const travelled = useRef(0);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    travelled.current = 0;
    pinch.current = pointers.current.size === 2 ? spread() : null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const was = pointers.current.get(e.pointerId);
    if (!was || !boxRef.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    travelled.current += Math.hypot(e.clientX - was.x, e.clientY - was.y);
    const rect = boxRef.current.getBoundingClientRect();

    if (pointers.current.size === 1) {
      const dx = (e.clientX - was.x) / rect.width;
      const dy = (e.clientY - was.y) / rect.height;
      move((v) => ({ ...v, x: v.x - dx * v.w, y: v.y - dy * v.h }));
      return;
    }
    if (pointers.current.size !== 2 || !pinch.current) return;
    // Two fingers do both jobs at once: the gap between them zooms, the midpoint pans.
    const now = spread();
    const before = pinch.current;
    if (now.dist < 1 || before.dist < 1) return;
    pinch.current = now;
    const at = (p: Point) => ({ fx: (p.x - rect.left) / rect.width, fy: (p.y - rect.top) / rect.height });
    const from = at(before.mid);
    const to = at(now.mid);
    move((v) => {
      const w = zoomedWidth(v.w * (before.dist / now.dist));
      const h = w / aspectRef.current;
      // Whatever was under the old midpoint ends up under the new one.
      return { x: v.x + from.fx * v.w - to.fx * w, y: v.y + from.fy * v.h - to.fy * h, w, h };
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = pointers.current.size === 2 ? spread() : null;
  };

  // Wheel has to be bound by hand: React's onWheel is passive, and a passive listener can't stop
  // the page scrolling out from under the map.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      move((v) => {
        const w = zoomedWidth(v.w * Math.exp(e.deltaY * 0.0015));
        const h = w / aspectRef.current;
        return { x: v.x + fx * (v.w - w), y: v.y + fy * (v.h - h), w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [move]);

  /** The buttons and the arrow keys work from the middle of whatever is on screen. */
  const zoomBy = (factor: number) =>
    move((v) => ({ x: v.x + (v.w * (1 - factor)) / 2, y: v.y + (v.h * (1 - factor)) / 2, w: v.w * factor, h: v.h * factor }));

  const NUDGE: Record<string, Point> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = NUDGE[e.key];
    if (step) {
      e.preventDefault();
      move((v) => ({ ...v, x: v.x + (step.x * v.w) / 8, y: v.y + (step.y * v.h) / 8 }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1 / 1.6);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomBy(1.6);
    }
  };

  // ---------- Drawing ----------
  const statuses = useMemo(() => new Map(visits.map((v) => [v.code, v.status] as const)), [visits]);

  // Held in a ref so that 234 outlines aren't rebuilt every time the parent re-renders.
  const pick = useRef(onPick);
  pick.current = onPick;
  const tap = useCallback((code: string) => {
    if (travelled.current < TAP_SLOP) pick.current(code);
  }, []);

  // The outlines don't change while the map is moved, and keeping the same elements means React
  // walks past them on every pan frame. Everything that does move with the zoom is drawn after.
  const outlines = useMemo(
    () => (
      <g>
        {COUNTRIES.map((c) => {
          const d = COUNTRY_PATHS[c.code];
          if (!d) return null;
          const status = statuses.get(c.code);
          return (
            <path
              key={c.code}
              d={d}
              className={`wm-country${status ? ` v-${status}` : ""}${selected === c.code ? " on" : ""}`}
              onClick={() => tap(c.code)}
              aria-hidden="true"
            >
              <title>{c.name}</title>
            </path>
          );
        })}
      </g>
    ),
    [statuses, selected, tap],
  );

  const perPx = size.w ? view.w / size.w : 1;
  const dotR = perPx * 7;
  const stripe = view.w / 55;
  const zoomedIn = view.w < MAP_WIDTH / 3.5;

  return (
    <div className="wm" ref={boxRef}>
      <svg
        className="wm-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="group"
        aria-label="Map of the countries on this trip. Drag to move it, pinch or scroll to zoom."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <defs>
          {/* Ideas are hatched here exactly as they are on the calendar. */}
          <pattern id="wm-idea" width={stripe} height={stripe} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={stripe} height={stripe} className="wm-idea-bg" />
            <rect width={stripe / 2} height={stripe} className="wm-idea-fg" />
          </pattern>
        </defs>
        {outlines}
        <g>
          {visits.map((v) => {
            const c = COUNTRIES.find((x) => x.code === v.code);
            if (!c) return null;
            const dot = c.area < DOT_BELOW || !COUNTRY_PATHS[c.code];
            const onScreen = (c.area * size.w * size.w) / (view.w * view.w);
            return (
              <g key={v.code}>
                {dot && (
                  <circle cx={c.x} cy={c.y} r={dotR} className={`wm-dot v-${v.status}${selected === v.code ? " on" : ""}`} onClick={() => tap(v.code)}>
                    <title>{c.name}</title>
                  </circle>
                )}
                {(onScreen > LABEL_ABOVE_PX || (dot && zoomedIn)) && (
                  <text x={c.x} y={c.y + (dot ? dotR * 2.4 : perPx * 4)} className="wm-label" style={{ fontSize: perPx * 11 }}>
                    {c.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="wm-tools">
        <button className="btn small" onClick={() => move(fitRegion(EUROPE, aspect))} title="Back to Europe">
          Europe
        </button>
        <button className="btn small" onClick={() => move(fitVisits(visits, aspect))} disabled={!visits.length} title="Fit every country with a trip on it">
          My trips
        </button>
        <button className="btn small" onClick={() => move({ x: 0, y: 0, w: MAP_WIDTH, h: MAP_WIDTH / aspect })} title="The whole world">
          World
        </button>
        <span className="wm-zoom">
          <button className="btn small" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom in">
            +
          </button>
          <button className="btn small" onClick={() => zoomBy(1.6)} aria-label="Zoom out">
            −
          </button>
        </span>
      </div>
    </div>
  );
}
