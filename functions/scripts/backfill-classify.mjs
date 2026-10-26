// Resumable, idempotent classifier migration. Dry-run is the default.
//   npm run build && node scripts/backfill-classify.mjs
//   npm run build && node scripts/backfill-classify.mjs --write
// A live write should follow review of the dry-run distribution.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath, FieldValue } from "firebase-admin/firestore";
import { enrichEvent } from "../lib/ingest/classify.js";
import { venueKey } from "../lib/ingest/normalize.js";

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const write = process.argv.includes("--write");
initializeApp(emulator
  ? { projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" }
  : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();
const progressRef = db.collection("maintenance").doc("backfill-classify-v1");
const batchSize = 200;
const fields = ["categories", "classificationConfidence", "qualityScore", "inferredCost", "ageSuitability", "endInferred"];
const emptyStats = () => ({ processed: 0, alreadyEnriched: 0, changed: 0, reclassified: 0, geocoded: 0,
  belowConfidence: 0, fieldsAdded: Object.fromEntries(fields.map((f) => [f, 0])),
  categoriesBefore: {}, categoriesAfter: {}, unresolvedVenues: 0,
  changedFields: {}, changeExamples: [] });
const increment = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
const identity = (data) => `${String(data.organizer || "").trim().toLowerCase()}|${venueKey(String(data.locationName || ""))}`;

function normalized(doc) {
  const d = doc.data();
  const start = d.date?.toDate?.();
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  return { source: String(d.source || "community"), sourceEventId: String(d.sourceEventId || doc.id),
    areaId: String(d.areaId || "san-jose-ca"), title: String(d.title || ""),
    description: String(d.description || ""), organizer: String(d.organizer || ""), start,
    end: d.endInferred === true ? undefined : d.endDate?.toDate?.(),
    time: String(d.time || ""), locationName: String(d.locationName || ""),
    latitude: typeof d.latitude === "number" ? d.latitude : undefined,
    longitude: typeof d.longitude === "number" ? d.longitude : undefined,
    category: String(d.category || "Social"),
    isFree: typeof d.isFree === "boolean" ? d.isFree : undefined,
    priceMin: typeof d.priceMin === "number" ? d.priceMin : undefined,
    website: typeof d.website === "string" ? d.website : undefined,
    imageURL: typeof d.imageURL === "string" ? d.imageURL : undefined,
    tags: Array.isArray(d.tags) ? d.tags.filter((x) => typeof x === "string") : [],
    eventTypes: Array.isArray(d.eventTypes) ? d.eventTypes.filter((x) => typeof x === "string") : [],
    audiences: Array.isArray(d.audiences) ? d.audiences.filter((x) => typeof x === "string") : [] };
}

// Trust only source coordinates already in the corpus. A shared venue name
// without the same organizer is not a safe geocode, especially for libraries.
const venueCoordinates = new Map();
let scanCursor;
for (;;) {
  const base = db.collection("events").orderBy(FieldPath.documentId());
  const snap = await (scanCursor ? base.startAfter(scanCursor) : base).limit(500).get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (typeof d.latitude === "number" && typeof d.longitude === "number" && venueKey(String(d.locationName || ""))) {
      venueCoordinates.set(identity(d), { lat: d.latitude, lng: d.longitude });
    }
  }
  if (snap.size < 500) break;
  scanCursor = snap.docs.at(-1).id;
}

const saved = write ? (await progressRef.get()).data() : null;
let cursor = saved?.status === "running" ? saved.cursor : undefined;
const stats = saved?.status === "running" && saved.stats ? saved.stats : emptyStats();
stats.alreadyEnriched ??= 0;
stats.changedFields ??= {};
stats.changeExamples ??= [];
for (;;) {
  const base = db.collection("events").orderBy(FieldPath.documentId());
  const snap = await (cursor ? base.startAfter(cursor) : base).limit(batchSize).get();
  if (snap.empty) break;
  const batch = db.batch();
  for (const doc of snap.docs) {
    const original = doc.data();
    const rec = normalized(doc);
    if (!rec) continue;
    const cached = venueCoordinates.get(identity(original));
    const resolved = rec.latitude == null && rec.longitude == null && cached
      ? { ...rec, latitude: cached.lat, longitude: cached.lng } : rec;
    const enriched = enrichEvent(resolved);
    // This is a migration for legacy documents, not a second classifier pass
    // over freshly ingested ones. Recomputing an enriched document from its
    // stored primary category loses the original source category; a merged
    // document can also lose labels contributed by its secondary feed.
    const needsEnrichment = !Array.isArray(original.categories) || original.categories.length === 0 ||
      !Number.isFinite(original.classificationConfidence) || !Number.isFinite(original.qualityScore) ||
      typeof original.inferredCost !== "string" || typeof original.ageSuitability !== "string" ||
      typeof original.endInferred !== "boolean";
    stats.processed++;
    if (!needsEnrichment) stats.alreadyEnriched++;
    increment(stats.categoriesBefore, rec.category);
    for (const label of needsEnrichment ? enriched.categories : original.categories)
      increment(stats.categoriesAfter, label);
    if (needsEnrichment && rec.category !== enriched.category) stats.reclassified++;
    if ((needsEnrichment ? enriched.classificationConfidence : original.classificationConfidence) < 0.65)
      stats.belowConfidence++;
    if (rec.latitude == null && resolved.latitude != null) stats.geocoded++;
    if (resolved.latitude == null) stats.unresolvedVenues++;
    const target = {
      ...(needsEnrichment ? {
        category: enriched.category, categories: enriched.categories,
        classificationConfidence: enriched.classificationConfidence,
        qualityScore: enriched.qualityScore, inferredCost: enriched.inferredCost,
        ageSuitability: enriched.ageSuitability, endInferred: enriched.endInferred,
      } : {}),
      ...(original.endDate === undefined && enriched.end ? { endDate: enriched.end } : {}),
      ...(rec.latitude == null && resolved.latitude != null
        ? { latitude: resolved.latitude, longitude: resolved.longitude } : {}),
    };
    const update = {};
    for (const [key, value] of Object.entries(target)) {
      if (original[key] === undefined) stats.fieldsAdded[key] = (stats.fieldsAdded[key] ?? 0) + 1;
      const before = original[key]?.toMillis?.() ?? original[key];
      const after = value instanceof Date ? value.getTime() : value;
      if (JSON.stringify(before) !== JSON.stringify(after)) update[key] = value;
    }
    if (Object.keys(update).length) {
      stats.changed++;
      for (const field of Object.keys(update)) increment(stats.changedFields, field);
      if (!write && stats.changeExamples.length < 12) {
        stats.changeExamples.push({ id: doc.id, fields: Object.keys(update) });
      }
      if (write) batch.update(doc.ref, update);
    }
  }
  if (write) await batch.commit();
  cursor = snap.docs.at(-1).id;
  if (write) await progressRef.set({ status: "running", cursor, stats, updatedAt: FieldValue.serverTimestamp() });
  if (snap.size < batchSize) break;
}
if (write) await progressRef.set({ status: "complete", cursor: null, stats, updatedAt: FieldValue.serverTimestamp() });
console.log(JSON.stringify({ mode: write ? "write" : "dry-run", emulator, ...stats }, null, 2));
