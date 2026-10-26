// GeoJSON is longitude, latitude. Never infer a missing attribute from a name.
export type Position = [number, number];
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };
export type Boundary = Extract<Geometry, { type: "Polygon" | "MultiPolygon" }>;
export type Bounds = { west: number; south: number; east: number; north: number };
export type SourceId = "city-parks" | "city-amenities" | "county-boundaries" | "county-trails" | "county-poi";
export type Status = "open" | "closed" | "future" | "construction" | "seasonal" | "permit" | "restricted" | "unknown";
export type AmenityKind = "playground" | "restrooms" | "water" | "picnic" | "sports" | "dogs" | "entrance" | "parking";
export type SourceCredit = { publisher: string; attribution: string; datasetURL: string; licenseURL: string; termsReview: string };
export type GeoFeature = { type: "Feature"; id?: string | number; properties: Record<string, unknown>; geometry: unknown };
export type PlaceFeature = {
  id: string; source: SourceId; sourceId: number; kind: "park" | "trail" | "amenity";
  name: string; geometry: Geometry; bounds: Bounds; status: Status; sourceStatus: string;
  parkIds: string[]; credit: SourceCredit; officialURL: string; sourceUpdatedAtMs: number | null;
  geometryNotes?: string[];
  address?: string; parkType?: string; acres?: number | null;
  amenities?: { kind: AmenityKind; label: string; ages: [number, number] | null }[];
  accessibility?: string | null; entranceDetails?: string | null;
  trail?: { lengthMiles: number | null; width: number | null; widthUnit: string | null; widthClass: string | null;
    recreationType: string | null; routeType: string | null; surface: string | null; dogs: "on leash" | "not allowed" | "unknown";
    hikingAllowed: boolean | null; bicyclingAllowed: boolean | null; equestrianAllowed: boolean | null;
    elevation: number | null; publicAccess: boolean; notice: string };
};
export const TRAIL_NOTICE = "Trail information comes from official sources and may be out of date. Follow posted signs and check the park's official site for closures.";
