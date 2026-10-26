import { createHash } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { blockedSetFor, db, enforceRateLimit, safeText } from "../common.js";
import { containsPoint } from "./geometry.js";
import { boundaryDistanceMeters, confirmedAmenities, type ParkSummary } from "./guides.js";
import { loadParkIndex, placeCatalogState, readPlaceFeatures } from "./store.js";
import type { Boundary, PlaceFeature, Position } from "./types.js";
import { readPlaceStory } from "../place-stories.js";

const OPTIONS = { timeoutSeconds: 120 as const, memory: "512MiB" as const, maxInstances: 5 };
const guestLimits = new Map<string, { start: number; count: number }>();
async function browseBudget(req: CallableRequest) {
  if (req.auth) return enforceRateLimit(req.auth.uid, "parkBrowse");
  // Public guides are available to signed-out guests too. Bound abuse without
  // persisting guest network addresses or creating an account on their behalf.
  const key = createHash("sha256").update(req.rawRequest.ip ?? "unknown").digest("hex"), now = Date.now();
  if (guestLimits.size >= 10_000) for (const [k, v] of guestLimits) if (now - v.start >= 3_600_000) guestLimits.delete(k);
  const old = guestLimits.get(key), row = old && now - old.start < 3_600_000 ? old : { start: now, count: 0 };
  if (row.count >= 240 || (!old && guestLimits.size >= 10_000)) throw new HttpsError("resource-exhausted", "Too many park requests. Try again later.");
  row.count++; guestLimits.set(key, row);
}
let cachedIndex: { generation: string; value: Promise<ParkSummary[]> } | undefined;
const featureCache = new Map<string, Promise<PlaceFeature>>();
export async function catalog() {
  const state = await placeCatalogState();
  if (!state.generation) throw new HttpsError("unavailable", "Official park data is unavailable. Try again after the next data update.");
  if (!cachedIndex || cachedIndex.generation !== state.generation) {
    featureCache.clear(); cachedIndex = { generation: state.generation, value: loadParkIndex(state.generation) };
  }
  const entry = cachedIndex;
  try { return { state, index: await entry.value }; }
  catch (error) { if (cachedIndex === entry) cachedIndex = undefined; throw new HttpsError("unavailable", "Official park data could not be loaded. Try again shortly."); }
}
export async function parkFeature(generation: string, id: string) {
  const key = `${generation}:${id}`;
  if (!featureCache.has(key)) {
    if (featureCache.size >= 1000) featureCache.delete(featureCache.keys().next().value!);
    featureCache.set(key, readPlaceFeatures(generation, [id]).then((f) => f[0]));
  }
  try { return await featureCache.get(key)!; } catch (e) { featureCache.delete(key); throw e; }
}
export function coordinateInput(data: any): Position {
  if (typeof data?.latitude !== "number" || typeof data.longitude !== "number" || !Number.isFinite(data.latitude) ||
    !Number.isFinite(data.longitude) || Math.abs(data.latitude) > 90 || Math.abs(data.longitude) > 180)
    throw new HttpsError("invalid-argument", "A valid latitude and longitude are required.");
  return [data.longitude, data.latitude];
}
export function validParkId(value: unknown) {
  if (typeof value !== "string" || !/^(city-parks|county-boundaries)_\d{1,12}$/.test(value)) throw new HttpsError("invalid-argument", "Choose a known park.");
  return value;
}
export function publicState(state: Awaited<ReturnType<typeof placeCatalogState>>) {
  return { generation: state.generation, publishedAtMs: state.publishedAtMs, refreshDelayed: state.latestOutcome === "failed" };
}
export const nearbyParkGuides = onCall(OPTIONS, async (req) => {
  const point = coordinateInput(req.data), radius = req.data?.radiusMiles ?? 10;
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 1 || radius > 50) throw new HttpsError("invalid-argument", "Choose a radius from 1 to 50 miles.");
  await browseBudget(req);
  const { state, index } = await catalog();
  let after = "";
  if (req.data?.cursor != null) {
    if (typeof req.data.cursor !== "string" || req.data.cursor.length > 300) throw new HttpsError("invalid-argument", "Invalid park page.");
    try { const cursor = JSON.parse(req.data.cursor); if (cursor.generation !== state.generation) throw new HttpsError("failed-precondition", "Park data changed. Refresh your park list."); after = validParkId(cursor.after); }
    catch (e) { if (e instanceof HttpsError) throw e; throw new HttpsError("invalid-argument", "Invalid park page."); }
  }
  const latitudePad = radius * 1609.344 / 110_000, longitudePad = latitudePad / Math.max(0.05, Math.cos(point[1] * Math.PI / 180));
  const candidates = index.filter((p) => p.id.localeCompare(after) > 0 && p.bounds.west <= point[0] + longitudePad && p.bounds.east >= point[0] - longitudePad &&
    p.bounds.south <= point[1] + latitudePad && p.bounds.north >= point[1] - latitudePad);
  const parks: (ParkSummary & { geometry: Boundary; distanceMiles: number })[] = [];
  for (const p of candidates) {
    const f = await parkFeature(state.generation, p.id), distance = boundaryDistanceMeters(f.geometry as Boundary, point);
    if (distance <= radius * 1609.344) parks.push({ ...p, geometry: f.geometry as Boundary, distanceMiles: distance / 1609.344 });
    if (parks.length === 101) break;
  }
  const page = parks.slice(0, 100);
  return { ...publicState(state), parks: page, nextCursor: parks.length > 100 ? JSON.stringify({ generation: state.generation, after: page.at(-1)!.id }) : null };
});

export const parksAtCoordinate = onCall(OPTIONS, async (req) => {
  const point = coordinateInput(req.data); await browseBudget(req);
  const { state, index } = await catalog(), matches: ParkSummary[] = [];
  for (const p of index) if (p.bounds.west <= point[0] && p.bounds.east >= point[0] && p.bounds.south <= point[1] && p.bounds.north >= point[1]) {
    if (containsPoint((await parkFeature(state.generation, p.id)).geometry as Boundary, point)) matches.push(p);
  }
  return { ...publicState(state), parks: matches };
});

export function visibleParkEvent(data: FirebaseFirestore.DocumentData, profile: FirebaseFirestore.DocumentData, blocked: Set<string>, now: number) {
  if (data.category === "Program" || data.opportunitySubtype === "program") return false;
  if (data.active !== true || data.hidden !== false || data.broadcast !== true || data.removed === true || data.virtual === true ||
    blocked.has(data.creatorID) || blocked.has(data.organizerId)) return false;
  // Participant ages on general activities remain discoverable by parents.
  if (typeof data.minimumAge === "number" && data.minimumAge >= 18 && profile.ageBand !== "adult") return false;
  // Adult-only listings (alcohol, age limits — W1 annotation) reach recorded adults only.
  if (data.adultOnly === true && profile.ageBand !== "adult") return false;
  if (data.applicationDeadline?.toMillis && data.applicationDeadline.toMillis() <= now) return false;
  return true;
}
export function eventDTO(id: string, d: FirebaseFirestore.DocumentData) {
  const url = safeText(d.website ?? d.url ?? d.sourceUrl, 2000);
  return { id, title: safeText(d.title, 200), description: safeText(d.description, 4000), organizer: safeText(d.organizer, 200),
    category: safeText(d.category, 40), locationName: safeText(d.locationName, 200), startMs: d.date.toMillis(), endMs: d.endDate?.toMillis?.() ?? null,
    latitude: d.latitude, longitude: d.longitude, website: /^https?:\/\//i.test(url) ? url : null, imageURL: typeof d.imageURL === "string" ? d.imageURL : null,
    source: safeText(d.source, 40), deadlineMs: d.applicationDeadline?.toMillis?.() ?? null, virtual: typeof d.virtual === "boolean" ? d.virtual : null, priceMin: typeof d.priceMin === "number" ? d.priceMin : null, minimumAge: d.minimumAge ?? null, maximumAge: d.maximumAge ?? null, isFree: typeof d.isFree === "boolean" ? d.isFree : null };
}
export async function weekEvents(uid?: string, now = Date.now()) {
  const end = now + 7 * 86_400_000;
  const [profile, blocked] = uid ? await Promise.all([db.doc(`users/${uid}`).get().then((s) => s.data() ?? {}), blockedSetFor(uid)]) : [{}, new Set<string>()];
  const query = db.collection("events").where("hidden", "==", false).where("active", "==", true).where("broadcast", "==", true)
    .where("date", ">=", Timestamp.fromMillis(now)).where("date", "<", Timestamp.fromMillis(end)).orderBy("date");
  const events: ReturnType<typeof eventDTO>[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined, scanned = 0;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(500).get(); scanned += page.size;
    if (scanned > 50_000) throw new HttpsError("resource-exhausted", "This week's park events exceed the current query bound.");
    for (const doc of page.docs) { const d = doc.data(); if (visibleParkEvent(d, profile, blocked, now) && typeof d.latitude === "number" && typeof d.longitude === "number" &&
      Number.isFinite(d.latitude) && Number.isFinite(d.longitude) && Math.abs(d.latitude) <= 90 && Math.abs(d.longitude) <= 180) events.push(eventDTO(doc.id, d)); }
    if (page.size < 500) break; cursor = page.docs.at(-1);
  }
  return events;
}
export async function buildParkGuide(state: Awaited<ReturnType<typeof placeCatalogState>>, index: ParkSummary[], id: string,
  week: Awaited<ReturnType<typeof weekEvents>>, viewerUid?: string) {
  const summary = index.find((p) => p.id === id);
  if (!summary) throw new HttpsError("not-found", "This park is not in the current catalog.");
  const related = await db.collection(`parkGenerations/${state.generation}/features`).where("parkIds", "array-contains", id).get();
  const features = await readPlaceFeatures(state.generation, related.docs.map((d) => d.id));
  const park = features.find((f) => f.id === id)!;
  if (!park) throw new HttpsError("unavailable", "The park guide could not be loaded.");
  const events = week.filter((e) => containsPoint(park.geometry as Boundary, [e.longitude, e.latitude]));
  const credits = [...new Map(features.map((f) => [f.credit.datasetURL, f.credit])).values()];
  const amenities = confirmedAmenities(features);
  const result = { ...publicState(state), park: { ...summary, geometry: park.geometry, geometryNotes: park.geometryNotes ?? [] }, amenities,
    trails: features.filter((f) => f.kind === "trail").map((f) => ({ id: f.id, name: f.name, geometry: f.geometry, status: f.status,
      sourceStatus: f.sourceStatus, officialURL: summary.officialURL, ...f.trail })),
    hours: null, accessibility: [...new Set(amenities.map((a) => a.accessibility).filter(Boolean))],
    entrances: amenities.filter((a) => a.kind === "entrance"), events, credits, story: await readPlaceStory(id, viewerUid) };
  if (Buffer.byteLength(JSON.stringify(result)) > 24 * 1024 * 1024) throw new HttpsError("resource-exhausted", "This guide exceeds the current download bound.");
  return result;
}
export const parkGuide = onCall(OPTIONS, async (req) => {
  const id = validParkId(req.data?.parkId); await browseBudget(req);
  const { state, index } = await catalog();
  return buildParkGuide(state, index, id, await weekEvents(req.auth?.uid), req.auth?.uid);
});
