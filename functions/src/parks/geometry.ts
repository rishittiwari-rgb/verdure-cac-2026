import type { Boundary, Bounds, Geometry, Position } from "./types.js";

/** Reject projected/invalid coordinates, unsupported shapes and unbounded data. */
export function parseGeometry(value: unknown): Geometry {
  if (!value || typeof value !== "object") throw new Error("Missing geometry");
  const { type, coordinates } = value as Record<string, unknown>;
  let count = 0;
  function position(p: unknown): Position {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" ||
      !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error("Invalid WGS84 coordinate");
    if (++count > 250_000) throw new Error("Geometry exceeds vertex limit");
    return [p[0], p[1]];
  }
  function line(v: unknown, ring = false): Position[] {
    if (!Array.isArray(v) || v.length < (ring ? 4 : 2)) throw new Error("Invalid line or polygon ring");
    const result = v.map(position);
    if (ring && (result[0][0] !== result.at(-1)![0] || result[0][1] !== result.at(-1)![1])) throw new Error("Unclosed polygon ring");
    return result;
  }
  function polygon(v: unknown): Position[][] {
    if (!Array.isArray(v) || !v.length) throw new Error("Empty polygon");
    return v.map((ring) => line(ring, true));
  }
  switch (type) {
    case "Point": return { type, coordinates: position(coordinates) };
    case "LineString": return { type, coordinates: line(coordinates) };
    case "Polygon": return { type, coordinates: polygon(coordinates) };
    case "MultiLineString":
      if (!Array.isArray(coordinates) || !coordinates.length) throw new Error("Empty multiline");
      return { type, coordinates: coordinates.map((x) => line(x)) };
    case "MultiPolygon":
      if (!Array.isArray(coordinates) || !coordinates.length) throw new Error("Empty multipolygon");
      return { type, coordinates: coordinates.map(polygon) };
    default: throw new Error("Unsupported geometry type");
  }
}
/** ArcGIS can emit an a-b-a zero-area exterior in a multipolygon alongside
 * its real area. Omit ONLY this mathematically empty component, record it,
 * and still reject all malformed/nonfinite/unclosed remaining geometry. */
export function normalizeGeometry(value: unknown): { geometry: Geometry; notes: string[] } {
  const notes: string[] = [];
  let cleaned = value;
  if (value && typeof value === "object" && (value as any).type === "MultiPolygon" && Array.isArray((value as any).coordinates)) {
    const coordinates = (value as any).coordinates.filter((polygon: unknown) => {
      if (!Array.isArray(polygon) || polygon.length !== 1 || !Array.isArray(polygon[0]) || polygon[0].length !== 3) return true;
      const ring = polygon[0];
      // Validate every source coordinate before deciding an area is empty.
      const p = ring.map((x: unknown) => parseGeometry({ type: "Point", coordinates: x }) as Extract<Geometry, { type: "Point" }>);
      if (p[0].coordinates[0] !== p[2].coordinates[0] || p[0].coordinates[1] !== p[2].coordinates[1]) return true;
      notes.push("Omitted a closed a-b-a polygon component with zero area; all non-empty components are retained.");
      return false;
    });
    cleaned = { type: "MultiPolygon", coordinates };
  }
  return { geometry: parseGeometry(cleaned), notes };
}
export function lines(g: Geometry): Position[][] {
  switch (g.type) {
    case "Point": return [[g.coordinates]];
    case "LineString": return [g.coordinates];
    case "MultiLineString": case "Polygon": return g.coordinates;
    case "MultiPolygon": return g.coordinates.flat();
  }
}
export function bounds(g: Geometry): Bounds {
  const b: Bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const l of lines(g)) for (const [x, y] of l) { b.west = Math.min(b.west, x); b.east = Math.max(b.east, x); b.south = Math.min(b.south, y); b.north = Math.max(b.north, y); }
  return b;
}
export function boundsOverlap(a: Bounds, b: Bounds) { return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south; }
function cross(a: Position, b: Position, p: Position) { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); }
function onSegment(a: Position, b: Position, p: Position) {
  return Math.abs(cross(a, b, p)) < 1e-12 && p[0] >= Math.min(a[0], b[0]) - 1e-10 && p[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-10 && p[1] <= Math.max(a[1], b[1]) + 1e-10;
}
// Boundary = 0, interior = 1, exterior = -1. A hole interior is excluded.
function inRing(p: Position, ring: Position[]) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if (onSegment(a, b, p)) return 0;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}
export function containsPoint(g: Boundary, p: Position): boolean {
  return (g.type === "Polygon" ? [g.coordinates] : g.coordinates).some((polygon) => {
    const outer = inRing(p, polygon[0]);
    if (outer < 0) return false;
    if (outer === 0) return true;
    for (const hole of polygon.slice(1)) { const h = inRing(p, hole); if (h === 0) return true; if (h === 1) return false; }
    return true;
  });
}
function segmentsIntersect(a: Position, b: Position, c: Position, d: Position) {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  return ((ac > 0 && ad < 0 || ac < 0 && ad > 0) && (ca > 0 && cb < 0 || ca < 0 && cb > 0)) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
/** Bounding boxes only prune candidates; exact geometry decides the join. */
export function intersectsBoundary(g: Geometry, park: Boundary): boolean {
  if (!boundsOverlap(bounds(g), bounds(park))) return false;
  const gl = lines(g), pl = lines(park);
  for (const l of gl) for (const p of l) if (containsPoint(park, p)) return true;
  if (g.type === "Polygon" || g.type === "MultiPolygon") for (const l of pl) for (const p of l) if (containsPoint(g, p)) return true;
  for (const l of gl) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    for (const r of pl) for (let j = 1; j < r.length; j++) if (segmentsIntersect(a, b, r[j - 1], r[j])) return true;
  }
  return false;
}
