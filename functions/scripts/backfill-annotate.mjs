// Backfill adultOnly, topicTags and contentHash across an existing corpus.
//   npm run build && node scripts/backfill-annotate.mjs            # dry run (default)
//   npm run build && node scripts/backfill-annotate.mjs --write    # apply
//
// Idempotent (re-running proposes zero changes): documents that already carry all three fields are
// left alone, so a second pass proposes zero changes. Reports counts per source
// and the adultOnly / topicTag distribution, which is the evidence W1 asks for.
// Refuses production unless FIRESTORE_EMULATOR_HOST is unset AND --live is passed.

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath, FieldValue } from "firebase-admin/firestore";
import { enrichEvent } from "../lib/ingest/classify.js";
import { annotateEvent } from "../lib/ingest/annotate.js";
import { contentHash } from "../lib/ingest/store.js";

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const write = process.argv.includes("--write");
if (!emulator && !process.argv.includes("--live")) throw new Error("Refusing a non-emulator run without --live.");
if (!getApps().length) initializeApp(emulator
  ? { projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" }
  : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();
const progressRef = db.collection("maintenance").doc("backfill-annotate-v1");
const batchSize = 200;

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
    audiences: Array.isArray(d.audiences) ? d.audiences.filter((x) => typeof x === "string") : [],
    minimumAge: typeof d.minimumAge === "number" ? d.minimumAge : undefined };
}

const stats = { processed: 0, alreadyAnnotated: 0, changed: 0, perSource: {}, adultOnlyTrue: 0, adultOnlyBySource: {}, adultOnlyByReason: {}, topicTagCounts: {}, examplesAdultOnly: [] };
const bump = (map, key, n = 1) => { map[key] = (map[key] ?? 0) + n; };
let cursor;
for (;;) {
  const base = db.collection("events").orderBy(FieldPath.documentId());
  const snap = await (cursor ? base.startAfter(cursor) : base).limit(batchSize).get();
  if (snap.empty) break;
  const batch = db.batch();
  for (const doc of snap.docs) {
    const original = doc.data();
    const rec = normalized(doc);
    if (!rec) continue;
    stats.processed++;
    const source = rec.source;
    bump(stats.perSource, source);
    const complete = typeof original.adultOnly === "boolean" && Array.isArray(original.topicTags) && typeof original.contentHash === "string";
    if (complete) {
      stats.alreadyAnnotated++;
      if (original.adultOnly) { stats.adultOnlyTrue++; bump(stats.adultOnlyBySource, source); }
      for (const t of original.topicTags) bump(stats.topicTagCounts, t);
      continue;
    }
    // Annotation reads the frozen classifier's output. The stored primary
    // category and labels are kept where present: this is not a re-classification.
    const enriched = enrichEvent(rec);
    const withStored = { ...enriched,
      category: typeof original.category === "string" ? original.category : enriched.category,
      categories: Array.isArray(original.categories) && original.categories.length ? original.categories : enriched.categories };
    const annotated = annotateEvent(withStored);
    const finalDoc = { ...annotated,
      adultOnlyReason: typeof original.adultOnly === "boolean" ? (original.adultOnlyReason ?? null) : annotated.adultOnlyReason,
      adultOnly: typeof original.adultOnly === "boolean" ? original.adultOnly : annotated.adultOnly,
      topicTags: Array.isArray(original.topicTags) ? original.topicTags : annotated.topicTags };
    const update = {
      ...(typeof original.adultOnly === "boolean" ? {} : { adultOnly: finalDoc.adultOnly, adultOnlyReason: finalDoc.adultOnlyReason }),
      ...(Array.isArray(original.topicTags) ? {} : { topicTags: finalDoc.topicTags }),
      ...(typeof original.contentHash === "string" ? {} : { contentHash: contentHash(finalDoc) }),
    };
    const adultOnly = original.adultOnly ?? annotated.adultOnly;
    if (adultOnly) { stats.adultOnlyTrue++; bump(stats.adultOnlyBySource, source); bump(stats.adultOnlyByReason, finalDoc.adultOnlyReason ?? "unknown"); if (stats.examplesAdultOnly.length < 15) stats.examplesAdultOnly.push({ id: doc.id, title: rec.title }); }
    for (const t of original.topicTags ?? annotated.topicTags) bump(stats.topicTagCounts, t);
    stats.changed++;
    if (write) batch.update(doc.ref, update);
  }
  if (write) await batch.commit();
  cursor = snap.docs.at(-1).id;
  if (write) await progressRef.set({ status: "running", cursor, stats, updatedAt: FieldValue.serverTimestamp() });
  if (snap.size < batchSize) break;
}
if (write) await progressRef.set({ status: "complete", cursor: null, stats, updatedAt: FieldValue.serverTimestamp() });
console.log(JSON.stringify({ mode: write ? "write" : "dry-run", emulator, ...stats }, null, 2));
