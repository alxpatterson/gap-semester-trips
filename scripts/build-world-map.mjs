// Regenerates the two files behind the Map tab:
//   lib/countries.ts   every country's code, name, label point and size, plus the projection
//   lib/world-map.ts   the outlines themselves, which are bulky and load only with the map
//
//   node scripts/build-world-map.mjs
//
// Nothing in the app depends on this script at build or run time: it is run by hand when the
// outlines need changing, and its output is committed. It pulls its source data from the npm
// registry rather than keeping a 750KB fixture in the repo:
//   world-atlas@2        Natural Earth 1:50m country polygons as TopoJSON (public domain)
//   i18n-iso-countries   ISO 3166-1 numeric → alpha-3 codes and English names
//
// What it does, in order: decode the TopoJSON, drop Antarctica, project to Web Mercator clipped
// to the inhabited band, simplify each ring hard enough to stay small on a phone, drop islands
// too small to see, and write out one SVG path per country plus a label point and an area.
//
// The split in two is deliberate. The outlines are around 60KB and only the Map tab wants them;
// everything else — placing a trip, naming a country — needs the small file, so the big one can
// be fetched the first time someone opens the map and never on the way to the calendar.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- The viewBox everything is projected into ----------
// 4000 units across the world means one unit is a quarter of a pixel at the widest the map is ever
// drawn, so every coordinate can be a whole number and the paths encode as small relative deltas.
export const WIDTH = Number(process.env.WORLD_WIDTH ?? 4000);
const NORTH = 84; // Mercator runs away past this; 84° keeps Svalbard and northern Greenland
const SOUTH = -58; // the southern tip of South America, with Antarctica left off
// How much detail survives, in viewBox units. Around a pixel at the width the map is drawn.
const TOLERANCE = Number(process.env.WORLD_TOLERANCE ?? 2);
// Islands smaller than this many square units are dropped, unless they are all a country has.
const MIN_RING_AREA = Number(process.env.WORLD_MIN_AREA ?? 1.5);

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const Y_TOP = mercY(NORTH);
const Y_BOTTOM = mercY(SOUTH);
const SCALE = WIDTH / 360;
export const HEIGHT = Math.round((Y_TOP - Y_BOTTOM) * (WIDTH / (2 * Math.PI)) * 100) / 100;

/** Longitude/latitude to a point in the viewBox. Latitude is clamped into the band above. */
function project(lon, lat) {
  const y = mercY(Math.max(SOUTH, Math.min(NORTH, lat)));
  return [(lon + 180) * SCALE, (Y_TOP - y) * (WIDTH / (2 * Math.PI))];
}

// ---------- Source data ----------
function fetchPackage(spec, file) {
  const dir = mkdtempSync(join(tmpdir(), "world-map-"));
  const tgz = execFileSync("npm", ["pack", spec, "--silent", "--pack-destination", dir], { encoding: "utf8" }).trim();
  execFileSync("tar", ["xzf", join(dir, tgz), "-C", dir]);
  return JSON.parse(readFileSync(join(dir, "package", file), "utf8"));
}

// ---------- TopoJSON ----------
/** Quantized delta-encoded arcs back to absolute longitude/latitude pairs. */
function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

/** One topology ring (a list of arc indices, negatives meaning "walk it backwards"). */
function ringOf(arcs, indices) {
  const out = [];
  for (const i of indices) {
    const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    // Consecutive arcs share an endpoint, so drop the duplicate.
    for (let k = out.length ? 1 : 0; k < arc.length; k++) out.push(arc[k]);
  }
  return out;
}

const ringsOf = (geom, arcs) => {
  if (geom.type === "Polygon") return geom.arcs.flatMap((r) => splitAtSeam(ringOf(arcs, r)));
  if (geom.type === "MultiPolygon") return geom.arcs.flatMap((p) => p.flatMap((r) => splitAtSeam(ringOf(arcs, r))));
  return [];
};

/**
 * Natural Earth stitches Russia and Fiji into single rings that step straight across the 180th
 * meridian. Projected as they are, those steps draw a streak the width of the map, so each ring is
 * cut wherever it jumps more than half the world in longitude.
 *
 * The cut has to respect that a ring is a loop. Cutting a Russia that happens to start in the
 * middle of Siberia leaves the body of the country in two halves, each closed by a chord slicing
 * across it — which is exactly the streak we were trying to avoid. So the ring is first turned
 * round to begin at a crossing: every piece then runs from one seam to the next, and the chord
 * that closes it lies along the left or right edge of the map, where nobody sees it.
 */
function splitAtSeam(ring) {
  const n = ring.length;
  const crosses = (i) => Math.abs(ring[i][0] - ring[(i + n - 1) % n][0]) > 180;
  let start = -1;
  for (let i = 0; i < n && start < 0; i++) if (crosses(i)) start = i;
  if (start < 0) return [ring];
  const turned = Array.from({ length: n }, (_, k) => ring[(start + k) % n]);
  const parts = [[]];
  for (let i = 0; i < n; i++) {
    if (i > 0 && Math.abs(turned[i][0] - turned[i - 1][0]) > 180) parts.push([]);
    parts[parts.length - 1].push(turned[i]);
  }
  return parts.filter((p) => p.length >= 3);
}

// ---------- Simplification ----------
/** Douglas–Peucker: keep the points that carry the shape, at `tol` viewBox units. */
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstAt = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      // Distance to the segment, or to the shared endpoint when the segment is a point.
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > tol) {
      keep[worstAt] = 1;
      stack.push([a, worstAt], [worstAt, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const area = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
};

/**
 * Where to put a country's dot or label: the midpoint of a wide run of inside-the-shape space,
 * found by sweeping horizontal lines down the ring. A plain centroid is no good here — it falls
 * in the sea for anything crescent-shaped, like Croatia or Vietnam — and a scanline midpoint is
 * inside the outline by construction.
 *
 * Widest alone isn't right either. Sweden is widest across Lapland and Chile across the Atacama,
 * so the plain version labels both countries in a corner nobody looks at, and pans them off the
 * screen the moment the map is zoomed into the part that matters. So a chord is scored on width
 * but loses up to two thirds of it for sitting at the top or bottom of the country, which brings
 * the label back towards the middle without ever putting it outside the shape.
 */
function labelPoint(ring) {
  const ys = ring.map((p) => p[1]);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (bottom === top) return ring[0];
  const middle = (top + bottom) / 2;
  const reach = (bottom - top) / 2;
  let best = [ring[0], -1];
  const lines = 48;
  for (let k = 1; k < lines; k++) {
    const y = top + ((bottom - top) * k) / lines;
    // Where the scanline crosses the outline, left to right.
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      if (ay === by || y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    const central = 1 - (0.66 * Math.abs(y - middle)) / reach;
    // Pairs of crossings bound the inside; keep the best-scoring one found anywhere on the shape.
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const score = (xs[i + 1] - xs[i]) * central;
      if (score > best[1]) best = [[(xs[i] + xs[i + 1]) / 2, y], score];
    }
  }
  return best[0];
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * One SVG path for a country, as small as it will go: whole-number coordinates, one absolute
 * move per ring and relative line deltas after it, with the `l` command left implicit and the
 * separator dropped wherever a minus sign already separates two numbers.
 */
function pathOf(rings) {
  let out = "";
  for (const ring of rings) {
    const pts = [];
    for (const [fx, fy] of ring) {
      const x = Math.round(fx);
      const y = Math.round(fy);
      // Rounding can land two points on top of each other; one of them is enough.
      if (!pts.length || pts[pts.length - 1][0] !== x || pts[pts.length - 1][1] !== y) pts.push([x, y]);
    }
    if (pts.length < 3) continue;
    let d = `M${pts[0][0]} ${pts[0][1]}l`;
    let [px, py] = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - px;
      const dy = pts[i][1] - py;
      [px, py] = pts[i];
      if (i > 1 && dx >= 0) d += " ";
      d += dx;
      d += dy < 0 ? "" : " ";
      d += dy;
    }
    out += `${d}Z`;
  }
  return out;
}

// ---------- Build ----------
const topo = fetchPackage("world-atlas@2", "countries-50m.json");
const codes = fetchPackage("i18n-iso-countries@7", "codes.json");
const names = fetchPackage("i18n-iso-countries@7", "langs/en.json").countries;

const alpha3 = new Map(codes.map(([, a3, numeric]) => [String(Number(numeric)), a3]));

// ISO's own English names are the formal ones, and "Lao People's Democratic Republic" is not what
// anybody calls Laos. These are the ones worth saying plainly; the rest of ISO's list reads fine.
const PLAIN_NAMES = {
  BRN: "Brunei",
  CHN: "China",
  COD: "DR Congo",
  COG: "Congo-Brazzaville",
  FLK: "Falkland Islands",
  FSM: "Micronesia",
  GMB: "The Gambia",
  IRN: "Iran",
  LAO: "Laos",
  MAF: "Saint Martin",
  MDA: "Moldova",
  MKD: "North Macedonia",
  PSE: "Palestine",
  RUS: "Russia",
  SXM: "Sint Maarten",
  SYR: "Syria",
  TWN: "Taiwan",
  TZA: "Tanzania",
  USA: "United States",
  VAT: "Vatican City",
  VGB: "British Virgin Islands",
  VIR: "U.S. Virgin Islands",
};

const nameOf = new Map(
  codes.map(([a2, a3]) => [a3, PLAIN_NAMES[a3] ?? (Array.isArray(names[a2]) ? names[a2][0] : names[a2])]),
);

const arcs = decodeArcs(topo);
const dropped = [];
// Natural Earth splits a few countries over several geometries — Australia carries its island
// territories separately, France its overseas departments — so rings are gathered by ISO code
// first and each country is drawn once, from everything that belongs to it.
const byCode = new Map();

for (const geom of topo.objects.countries.geometries) {
  const label = geom.properties.name;
  if (label === "Antarctica") continue;
  const code = alpha3.get(String(Number(geom.id)));
  if (!code) {
    // Natural Earth carries a few areas with no ISO code of their own (Kosovo, N. Cyprus,
    // Somaliland and the like). They are left out rather than drawn under a neighbour's name.
    dropped.push(label);
    continue;
  }
  const rings = byCode.get(code) ?? { name: nameOf.get(code) || label, rings: [] };
  for (const ring of ringsOf(geom, arcs)) {
    const projected = ring.map(([lon, lat]) => project(lon, lat));
    rings.rings.push({ ring: projected, a: area(projected) });
  }
  byCode.set(code, rings);
}

const out = [];
for (const [code, { name, rings }] of byCode) {
  if (!rings.length) continue;
  // Measure and place the country on the full-detail outlines, so that Monaco and Singapore still
  // get a label point and an honest area after simplification has thrown their polygons away.
  rings.sort((x, y) => y.a - x.a);
  const [cx, cy] = labelPoint(rings[0].ring);
  const total = rings.reduce((s, r) => s + r.a, 0);
  const kept = rings
    .filter((r, i) => i === 0 || r.a >= MIN_RING_AREA)
    .map((r) => simplify(r.ring, TOLERANCE))
    .filter((ring) => ring.length >= 4);
  // An empty path is not a mistake: a country too small to draw at this scale is drawn as a dot.
  out.push({ code, name, d: pathOf(kept), x: r1(cx), y: r1(cy), area: Math.round(total) });
}

out.sort((a, b) => a.code.localeCompare(b.code));

const name = (c) => c.name.replace(/"/g, '\\"');

const countries = `// Generated by scripts/build-world-map.mjs — do not edit by hand.
//
// Every country the map knows: ISO 3166-1 alpha-3, its English name, the point to hang a label or
// a dot on, and how big it comes out on the map. Countries are drawn from lib/world-map.ts, which
// is much the larger file and is loaded only when the map itself is.
//
// Source: Natural Earth 1:50m country polygons (public domain, via world-atlas). Antarctica and
// the areas with no ISO 3166-1 code of their own are left out.

/** The viewBox the whole world is projected into: ${NORTH}°N to ${Math.abs(SOUTH)}°S, 180°W to 180°E. */
export const MAP_WIDTH = ${WIDTH};
export const MAP_HEIGHT = ${HEIGHT};

export type Country = {
  code: string;
  name: string;
  /** Where to put the country's dot or label — a point inside its largest piece. */
  x: number;
  y: number;
  /** Projected area. Anything small enough gets a dot, because its outline is untappable. */
  area: number;
};

const ROWS: [code: string, name: string, x: number, y: number, area: number][] = [
${out.map((c) => `  ["${c.code}", "${name(c)}", ${c.x}, ${c.y}, ${c.area}],`).join("\n")}
];

export const COUNTRIES: Country[] = ROWS.map(([code, name, x, y, area]) => ({ code, name, x, y, area }));

/** Longitude and latitude to a point in the viewBox, the same maths the outlines were built with. */
export function projectLonLat(lon: number, lat: number): { x: number; y: number } {
  const clamped = Math.max(${SOUTH}, Math.min(${NORTH}, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return { x: ((lon + 180) * MAP_WIDTH) / 360, y: (${Y_TOP} - y) * (MAP_WIDTH / (2 * Math.PI)) };
}
`;

const paths = `// Generated by scripts/build-world-map.mjs — do not edit by hand.
//
// One SVG path per country, in the viewBox lib/countries.ts describes. Simplified to ${TOLERANCE} viewBox
// units with islands under ${MIN_RING_AREA} square units dropped, which is as coarse as it can go and still
// hold up when the map is zoomed in on Europe.
//
// This file is big. Import it only from the map itself, so that opening the app does not pay for
// a tab nobody may visit. A country too small to draw at this scale is absent and drawn as a dot.

export const COUNTRY_PATHS: Record<string, string> = {
${out.filter((c) => c.d).map((c) => `  ${c.code}: "${c.d}",`).join("\n")}
};
`;

writeFileSync(new URL("../lib/countries.ts", import.meta.url), countries);
writeFileSync(new URL("../lib/world-map.ts", import.meta.url), paths);
const dots = out.filter((c) => !c.d).map((c) => c.code);
console.log(`${out.length} countries, viewBox ${WIDTH}x${HEIGHT}`);
console.log(`lib/countries.ts ${(countries.length / 1024).toFixed(1)}KB, lib/world-map.ts ${(paths.length / 1024).toFixed(1)}KB`);
console.log(`drawn as a dot (outline too small at this scale): ${dots.join(", ")}`);
console.log(`no ISO code, left out: ${dropped.join(", ")}`);
