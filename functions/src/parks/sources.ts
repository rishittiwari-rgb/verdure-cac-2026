import type { GeoFeature, SourceCredit, SourceId } from "./types.js";

const city = "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer";
const county = "https://services1.arcgis.com/4QPaqCJqF1UIaPbN/arcgis/rest/services";
export const TERMS_REVIEW = "docs/PARK-SOURCE-LICENSES-2026-10-04.md@28d2ca3";
// County policy pages reject our automated HTTP requests. An explicit, recorded
// human-readable policy review supplies permission; public item metadata is
// rechecked every run. Expiry makes a missed terms review a visible failure.
export const TERMS_REVIEW_EXPIRES_MS = Date.UTC(2026, 10, 3);
type Spec = { id: SourceId; name: string; layerURL: string; metadataURL: string; where: string;
  fields: string[]; credit: SourceCredit; countyItem?: string };
const cityCredit = (slug: string): SourceCredit => ({ publisher: "City of San José", attribution: "Park data: City of San José, CC BY",
  datasetURL: `https://data.sanjoseca.gov/dataset/${slug}`, licenseURL: "http://www.opendefinition.org/licenses/cc-by", termsReview: TERMS_REVIEW });
const countyCredit = (item: string): SourceCredit => ({ publisher: "Santa Clara County Parks and Recreation",
  attribution: "Park and trail data: Santa Clara County Parks and Recreation", datasetURL: `https://gisdata-sccparks.hub.arcgis.com/maps/${item}`,
  licenseURL: "https://www.santaclaracounty.gov/county-santa-clara-acceptable-use-policy", termsReview: TERMS_REVIEW });
function countySpec(id: SourceId, name: string, item: string, service: string, layer: number, fields: string[], where = "1=1"): Spec {
  return { id, name, layerURL: `${county}/${service}/FeatureServer/${layer}`,
    metadataURL: `https://www.arcgis.com/sharing/rest/content/items/${item}?f=json`, countyItem: item, where, fields, credit: countyCredit(item) };
}
export const SOURCE_SPECS: readonly Spec[] = [
  { id: "city-parks", name: "San José parks", layerURL: `${city}/188`, metadataURL: "https://data.sanjoseca.gov/api/3/action/package_show?id=park", where: "1=1",
    fields: ["NAME", "CURRENTSTATUS", "HYPERLINK"], credit: cityCredit("park") },
  { id: "city-amenities", name: "San José park amenities", layerURL: `${city}/554`, metadataURL: "https://data.sanjoseca.gov/api/3/action/package_show?id=park-amenities-and-sports-fields", where: "1=1",
    fields: ["AMENITYTYPE", "AMENITYSTATUS", "RESTROOMACCESS"], credit: cityCredit("park-amenities-and-sports-fields") },
  countySpec("county-boundaries", "County park boundaries", "96102dcf9b9448578801737170b451da", "SCCPRD_Park_Boundaries_view", 0, ["park_name", "status", "address"]),
  countySpec("county-trails", "County trails", "442bf544f0ca40248ec1e43ee5bdf963", "Santa_Clara_County_Parks_Trails", 1,
    ["trail_name", "status", "distribution", "public_use", "dog_use", "miles", "width"], "distribution = 'Public'"),
  countySpec("county-poi", "County park points of interest", "733bce6fc1c644f1adb9dd2a8b6efd97", "Point_of_Interests", 0,
    ["name", "type", "distribution", "drinking_water", "restroom"], "distribution = 'Public'"),
];
export type RequestJSON = (url: string) => Promise<Record<string, any>>;
const ALLOWED_HOSTS = new Set(["geo.sanjoseca.gov", "data.sanjoseca.gov", "www.arcgis.com", "services1.arcgis.com"]);
export async function requestJSON(url: string): Promise<Record<string, any>> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname) || target.username || target.password) throw new Error("Unapproved park source host");
  const response = await fetch(url, { signal: AbortSignal.timeout(40_000), redirect: "error" });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const limit = 24 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Source response exceeds size limit");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty source response");
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length;
      if (bytes > limit) throw new Error("Source response exceeds size limit"); parts.push(value); }
  } finally { await reader.cancel(); }
  const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid source JSON");
  if (data.error) throw new Error(`Source API error: ${String(data.error.message ?? "unknown").slice(0, 300)}`);
  return data;
}
export function verifyPermission(spec: Spec, metadata: Record<string, any>, now: number) {
  if (now >= TERMS_REVIEW_EXPIRES_MS) throw new Error("Recorded park terms review expired; review publisher policies before renewing permission.");
  if (spec.countyItem) {
    if (metadata.id !== spec.countyItem || metadata.owner !== "sccprk" || metadata.access !== "public" ||
      (metadata.licenseInfo ?? "") !== "" || metadata.url !== spec.layerURL.replace(/\/\d+$/, ""))
      throw new Error("County publisher, service or license changed; staff must review permission before ingestion.");
  } else {
    const m = metadata.result;
    if (metadata.success !== true || m?.license_id !== "cc-by" || m.license_url !== spec.credit.licenseURL ||
      !Array.isArray(m.resources) || !m.resources.some((r: any) => r.url === spec.layerURL))
      throw new Error("City source or CC BY license changed; staff must review permission before ingestion.");
  }
}
/** Snapshot IDs first, then fetch exact bounded sets. Offset drift cannot lose
 * a page silently. Every ID must come back once; truncation is a failed run. */
export async function fetchSource(id: SourceId, request: RequestJSON = requestJSON, now = Date.now()) {
  const spec = SOURCE_SPECS.find((s) => s.id === id); if (!spec) throw new Error("Unknown park source");
  const metadata = await request(spec.metadataURL); verifyPermission(spec, metadata, now);
  const layer = await request(`${spec.layerURL}?f=json`);
  if (!Array.isArray(layer.fields) || !["OBJECTID", ...spec.fields].every((name) => layer.fields.some((f: any) => f.name === name))) throw new Error("Required source fields changed");
  const query = (values: Record<string, string>) => `${spec.layerURL}/query?${new URLSearchParams(values)}`;
  const idsResponse = await request(query({ f: "json", where: spec.where, returnIdsOnly: "true" }));
  const ids: unknown = idsResponse.objectIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20_000 || ids.some((x) => !Number.isSafeInteger(x) || x < 0) || new Set(ids).size !== ids.length)
    throw new Error("Invalid, empty or oversized source ID snapshot");
  const features: GeoFeature[] = [], seen = new Set<number>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const pageIds = ids.slice(offset, offset + 100), expected = new Set<number>(pageIds);
    const page = await request(query({ f: "geojson", objectIds: pageIds.join(","), outFields: "*", outSR: "4326", returnGeometry: "true" }));
    if (page.type !== "FeatureCollection" || !Array.isArray(page.features) || page.features.length !== pageIds.length || page.exceededTransferLimit === true)
      throw new Error(`Incomplete source page at ${offset}`);
    for (const feature of page.features) {
      const featureId = feature?.properties?.OBJECTID;
      if (feature.type !== "Feature" || !expected.has(featureId) || seen.has(featureId)) throw new Error("Missing, duplicate or unexpected feature ID");
      if (spec.where !== "1=1" && (typeof feature.properties.distribution !== "string" || feature.properties.distribution.trim().toLowerCase() !== "public"))
        throw new Error("Non-public feature in public response");
      seen.add(featureId); features.push(feature);
    }
  }
  return { spec, metadata, features };
}
