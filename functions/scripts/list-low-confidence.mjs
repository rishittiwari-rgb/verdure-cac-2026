// Review queue for events the deterministic classifier could not label well.
// Read-only; use FIRESTORE_EMULATOR_HOST to inspect local fixtures.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const snapshotIndex = args.indexOf("--snapshot");
if (snapshotIndex >= 0) {
  const rows = JSON.parse(gunzipSync(readFileSync(args[snapshotIndex + 1])))
    .filter((r) => r.prediction.classificationConfidence < 0.65);
  const counts = {};
  for (const { event } of rows) {
    const reason = (event.eventTypes?.length || event.tags.length) ? "unmapped-activity-metadata" : "missing-activity-metadata";
    const key = `${event.source}:${reason}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log("source\tconfidence\tcategory\ttitle\tactivityTypes");
  for (const { event: e, prediction: p } of (args.includes("--all") ? rows : rows.slice(0, 200))) {
    console.log([e.source, p.classificationConfidence, p.category, e.title, (e.eventTypes ?? e.tags).join(" | ")]
      .map((v) => String(v).replace(/[\t\r\n]/g, " ")).join("\t"));
  }
  console.error(JSON.stringify({ lowConfidence: rows.length, bySourceAndReason: counts }));
  process.exit(0);
}

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp(emulator
  ? { projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" }
  : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();
const threshold = 0.65;
const docs = [];
let cursor;
for (;;) {
  const query = db.collection("events").where("classificationConfidence", "<", threshold)
    .orderBy("classificationConfidence").orderBy(FieldPath.documentId()).limit(500);
  const snap = await (cursor ? query.startAfter(cursor) : query).get();
  docs.push(...snap.docs);
  if (snap.size < 500) break;
  cursor = snap.docs.at(-1);
}
console.log("id\tsource\tconfidence\tcategory\ttitle");
const bySource = {};
for (const doc of docs) bySource[doc.data().source] = (bySource[doc.data().source] ?? 0) + 1;
for (const doc of (args.includes("--all") ? docs : docs.slice(0, 200))) {
  const d = doc.data();
  const safe = (value) => String(value ?? "").replace(/[\t\r\n]/g, " ");
  console.log([doc.id, safe(d.source), Number(d.classificationConfidence).toFixed(2),
    safe(d.category), safe(d.title)].join("\t"));
}
console.error(JSON.stringify({ lowConfidence: docs.length, bySource, displayed: args.includes("--all") ? docs.length : Math.min(200, docs.length) }));
