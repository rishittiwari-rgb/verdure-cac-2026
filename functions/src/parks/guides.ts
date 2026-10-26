import type { Boundary, PlaceFeature, Position, Status } from "./types.js";
import { containsPoint, lines } from "./geometry.js";

export type ParkFlags = { toddler: boolean; dogs: boolean; restrooms: boolean; water: boolean };
export type ParkSummary = { id: string; name: string; status: Status; sourceStatus: string; source: string;
  bounds: PlaceFeature["bounds"]; latitude: number; longitude: number; flags: ParkFlags;
  ages: [number, number][]; address: string; officialURL: string; credit: PlaceFeature["credit"] };
export function confirmedAmenities(features: PlaceFeature[]) {
  return features.flatMap((f) => (f.amenities ?? []).map((a) => ({ ...a, featureId: f.id, name: f.name, source: f.source,
    status: f.status, sourceStatus: f.sourceStatus, accessibility: f.accessibility ?? null, entranceDetails: f.entranceDetails ?? null })));
}
export function availableAmenities(features: PlaceFeature[]) {
  // County POIs confirm presence, but do not publish operational hours/status.
  // City explicitly closed/seasonal/permit/unknown amenities are not availability.
  return confirmedAmenities(features.filter((f) => (f.source === "county-poi" && f.status === "unknown") || f.status === "open"));
}
export function parkSummary(park: PlaceFeature, children: PlaceFeature[]): ParkSummary {
  const amenities = availableAmenities(children), b = park.bounds;
  const middle: Position = [(b.west + b.east) / 2, (b.south + b.north) / 2];
  const point = containsPoint(park.geometry as Boundary, middle) ? middle : lines(park.geometry)[0][0];
  const available = park.status === "open";
  const kinds = new Set(amenities.map((a) => a.kind));
  const ages = [...new Map(amenities.filter((a) => a.ages).map((a) => [a.ages!.join("-"), a.ages!])).values()];
  return { id: park.id, name: park.name, status: park.status, sourceStatus: park.sourceStatus, source: park.source,
    bounds: b, latitude: point[1], longitude: point[0],
    flags: { toddler: available && ages.some(([min, max]) => min <= 2 && max >= 5),
      dogs: available && (kinds.has("dogs") || children.some((f) => f.status === "open" && f.trail?.publicAccess && f.trail.dogs === "on leash")),
      restrooms: available && kinds.has("restrooms"), water: available && kinds.has("water") },
    ages, address: park.address ?? "", officialURL: park.officialURL, credit: park.credit };
}
export function buildParkIndex(features: PlaceFeature[]): ParkSummary[] {
  const byPark = new Map<string, PlaceFeature[]>();
  for (const f of features) if (f.kind !== "park") for (const id of f.parkIds) { const list = byPark.get(id) ?? []; list.push(f); byPark.set(id, list); }
  return features.filter((f) => f.kind === "park").map((p) => parkSummary(p, byPark.get(p.id) ?? [])).sort((a, b) => a.id.localeCompare(b.id));
}
function meters(a: Position, b: Position) {
  const radians = Math.PI / 180, lat = (b[1] - a[1]) * radians, lon = (b[0] - a[0]) * radians;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lon / 2) ** 2)));
}
/** Straight-line distance to the real park footprint, never walking guidance. */
export function boundaryDistanceMeters(g: Boundary, p: Position) {
  if (containsPoint(g, p)) return 0;
  const scale = Math.cos(p[1] * Math.PI / 180);
  let closest = Infinity;
  for (const ring of lines(g)) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], dx = (b[0] - a[0]) * scale, dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * scale * dx + (p[1] - a[1]) * dy) / length)) : 0;
    closest = Math.min(closest, meters(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
  }
  return closest;
}
