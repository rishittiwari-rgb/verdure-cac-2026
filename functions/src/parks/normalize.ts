import { bounds, boundsOverlap, containsPoint, intersectsBoundary, normalizeGeometry } from "./geometry.js";
import { SOURCE_SPECS } from "./sources.js";
import { TRAIL_NOTICE } from "./types.js";
import type { AmenityKind, Boundary, GeoFeature, PlaceFeature, Position, SourceId, Status } from "./types.js";

function text(v: unknown, max = 400) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function number(v: unknown) { return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null; }
function yes(v: unknown): boolean | null { const s = text(v).toLowerCase(); return s === "yes" || v === 1 ? true : s === "no" || v === 0 ? false : null; }
export function sourceStatus(v: unknown): Status {
  const s = text(v).toLowerCase();
  if (s === "open") return "open";
  if (["closed", "temporarily closed", "closed/land bank", "withdrawn"].includes(s)) return "closed";
  if (["future park", "future park (unsecured)", "design", "identified"].includes(s)) return "future";
  if (s === "construction") return "construction";
  if (s === "seasonal" || s === "seas") return "seasonal";
  if (s === "permit") return "permit";
  if (["easement", "restricted", "no public access", "limited private access"].includes(s)) return "restricted";
  return "unknown";
}
export function officialURL(v: unknown, source: SourceId) {
  try { const u = new URL(text(v, 2000)); if (u.protocol === "https:" && !u.username && !u.password &&
    (u.hostname === "www.sanjoseca.gov" || u.hostname === "parks.santaclaracounty.gov")) return u.href; } catch { /* no supplied official URL */ }
  return source.startsWith("county") ? "https://parks.santaclaracounty.gov/plan-your-visit" : "https://www.sanjoseca.gov/your-government/departments-offices/parks-recreation-neighborhood-services/outdoor-activities";
}
const sports = new Set(["BASE", "BBALL", "BOCC", "FOOTB", "FUTSAL", "FRISB", "HAND", "HORSE", "MULTI", "PICKLE", "POOL", "RINK", "SKATE", "SOCC", "SOFT", "TEE", "TEN", "TETHR", "TRACK", "VOLL", "PNGPNG", "LAWNBOWL"]);
function amenity(kind: AmenityKind, label: string, ages: [number, number] | null = null) { return { kind, label, ages }; }
export function normalizeFeature(source: SourceId, f: GeoFeature): PlaceFeature | null {
  // Null source geometry is counted and shown in health; it cannot be joined.
  if (f.geometry === null) return null;
  const p = f.properties, { geometry, notes } = normalizeGeometry(f.geometry), spec = SOURCE_SPECS.find((s) => s.id === source)!;
  const park = source === "city-parks" || source === "county-boundaries";
  if (park && geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") throw new Error("Park boundary must be polygonal");
  if (source === "county-trails" && geometry.type !== "LineString" && geometry.type !== "MultiLineString") throw new Error("Trail must be a line");
  const rawStatus = text(source === "city-parks" ? p.CURRENTSTATUS : source === "city-amenities" ? p.AMENITYSTATUS : p.status);
  const record: PlaceFeature = { id: `${source}_${p.OBJECTID}`, source, sourceId: p.OBJECTID as number,
    kind: park ? "park" : source === "county-trails" ? "trail" : "amenity", name: text(p.NAME ?? p.trail_name ?? p.name ?? p.park_name) || (park ? "Unnamed park" : source === "county-trails" ? "Unnamed trail segment" : "Park feature"),
    geometry, bounds: bounds(geometry), status: sourceStatus(rawStatus), sourceStatus: rawStatus, parkIds: [], credit: spec.credit,
    officialURL: officialURL(p.HYPERLINK, source), sourceUpdatedAtMs: number(p.LASTUPDATE ?? p.last_edited_date), geometryNotes: notes };
  if (park) {
    Object.assign(record, { address: text(p.ADDRESS ?? p.address), parkType: text(p.PARKTYPE ?? p.suffix), acres: number(p.ALLACRES ?? p.acres) });
  } else if (source === "city-amenities") {
    const a = text(p.AMENITYTYPE), amenities: NonNullable<PlaceFeature["amenities"]> = [];
    if (a === "PLAYTOT") amenities.push(amenity("playground", "Playground for ages 2–5", [2, 5]));
    if (a === "PLAYYOUTH") amenities.push(amenity("playground", "Playground for ages 5–12", [5, 12]));
    if (a === "PLAYCOMB") amenities.push(amenity("playground", "Playground for all ages"));
    if (a === "DOG") amenities.push(amenity("dogs", "Dog area"));
    if (a === "PICNIC" || a === "Table" || a === "BBQ") amenities.push(amenity("picnic", "Picnic area"));
    if (a === "DRINKF") amenities.push(amenity("water", "Drinking fountain"));
    if (sports.has(a)) amenities.push(amenity("sports", `Sports facility (${a})`));
    if (a === "PARKING") amenities.push(amenity("parking", "Parking area"));
    // RESTROOMACCESS is a 0/1 source attribute; blank is not confirmation.
    if (yes(p.RESTROOMACCESS) === true) amenities.push(amenity("restrooms", "Restroom access"));
    record.amenities = amenities;
    record.accessibility = yes(p.ALLINCLUSIVE) === true ? "Source marks this amenity all-inclusive" : null;
  } else if (source === "county-poi") {
    const t = text(p.type), amenities: NonNullable<PlaceFeature["amenities"]> = [];
    if (["RESTROOM", "RESTROOM WITH SHOWER", "PORTABLE RESTROOM"].includes(t) || yes(p.restroom) === true) amenities.push(amenity("restrooms", t || "Restroom"));
    if (yes(p.drinking_water) === true) amenities.push(amenity("water", "Drinking water"));
    if (t === "PLAY AREA") amenities.push(amenity("playground", "Play area; ages not provided"));
    if (t === "DOG PARK") amenities.push(amenity("dogs", "Dog park"));
    if (["PICNIC AREA", "RESERVABLE GROUP PICNIC SITE"].includes(t)) amenities.push(amenity("picnic", t));
    if (t === "PARKING AREA") amenities.push(amenity("parking", "Parking area"));
    if (["PARK ENTRANCE - PRIMARY", "PARK ENTRANCE - SECONDARY"].includes(t)) amenities.push(amenity("entrance", t));
    record.amenities = amenities; record.entranceDetails = t.startsWith("PARK ENTRANCE") ? text(p.description, 1000) || null : null;
    record.address = text(p.address);
  } else {
    const use = text(p.public_use), publicAccess = ["hiking", "hiking/bicycling", "hiking/equestrian", "hiking/equestrian/bicycling"].includes(use);
    if (!publicAccess) record.status = "restricted";
    record.trail = { lengthMiles: number(p.miles), width: number(p.width), widthUnit: null,
      widthClass: text(p.width_class) === "narrow" ? "5 ft or less" : text(p.width_class) === "wide" ? "6 ft or more" : null,
      recreationType: use || null, routeType: text(p.route_type) || null, surface: text(p.surface) || null,
      dogs: p.dog_use === "on leash" ? "on leash" : p.dog_use === "no access" ? "not allowed" : "unknown",
      hikingAllowed: yes(p.hiking_use), bicyclingAllowed: yes(p.bicycling_use), equestrianAllowed: yes(p.equestrian_use),
      elevation: null, publicAccess, notice: TRAIL_NOTICE };
  }
  return record;
}
/** Source names and park_name never participate in joins. */
export function joinParkGeometry(features: PlaceFeature[]) {
  const parks = features.filter((f) => f.kind === "park");
  for (const f of features) {
    if (f.kind === "park") { f.parkIds = [f.id]; continue; }
    f.parkIds = parks.filter((p) => boundsOverlap(f.bounds, p.bounds) && intersectsBoundary(f.geometry, p.geometry as Boundary)).map((p) => p.id);
  }
  return features;
}
/** Existing OSM places and events join through their actual coordinates. */
export function parkIdsAt(features: PlaceFeature[], p: Position): string[] {
  return features.filter((f) => f.kind === "park" && p[0] >= f.bounds.west && p[0] <= f.bounds.east && p[1] >= f.bounds.south && p[1] <= f.bounds.north &&
    containsPoint(f.geometry as Boundary, p)).map((f) => f.id);
}
