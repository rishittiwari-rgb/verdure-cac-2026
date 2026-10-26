// Read public feeds into a disposable Firestore emulator and exercise the
// actual ingest/dedupe/ranking path. Refuses to run against production.
// Run from functions/: npm run corpus:local
import { SAN_JOSE } from "../lib/ingest/areas.js";
import { runSource } from "../lib/ingest/index.js";
import { db } from "../lib/common.js";
import { recommendFor } from "../lib/ranking.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  throw new Error("Refusing to ingest: FIRESTORE_EMULATOR_HOST must be local.");
}

const { seedSourcesFromConfig } = await import("../lib/ingest/sources-registry.js");
await seedSourcesFromConfig();   // W4.1: ingestion reads /sources; a disposable emulator starts empty
const sources = ["libcal", "bibliocommons", "localist", "livewhale", "legistar", "midpen", "ics"];
const results = [];
for (const source of sources) {
  const result = await runSource(source, SAN_JOSE, {});
  results.push(result);
  console.log(JSON.stringify({ source, fetched: result.fetched, created: result.created,
    updated: result.updated, merged: result.merged, skipped: result.skipped,
    suspectedDuplicateRate: result.suspectedDuplicateRate, errors: result.errors }));
}
if (results.some((r) => r.errors.length || r.fetched === 0)) {
  throw new Error("At least one public feed failed; the corpus gate is incomplete.");
}

const now = Date.now();
const events = await db.collection("events").where("areaId", "==", SAN_JOSE.id)
  .where("active", "==", true).get();
const upcoming = events.docs.filter((d) => d.data().date?.toMillis?.() >= now);
const byCategory = {};
let geocoded = 0;
for (const doc of upcoming) {
  const ev = doc.data();
  byCategory[ev.category] = (byCategory[ev.category] ?? 0) + 1;
  if (typeof ev.latitude === "number" && typeof ev.longitude === "number") geocoded++;
}

const profiles = [
  { name: "cold", interests: [] },
  { name: "outdoors", interests: ["outdoors", "hiking"] },
  { name: "family", interests: ["family"], householdChildAges: [7] },
  { name: "student", interests: ["tech", "learning"], studentStatus: true },
];
const topTen = {};
for (const profile of profiles) {
  const uid = `local-corpus-${profile.name}`;
  await db.collection("users").doc(uid).set(profile);
  const ranked = await recommendFor(uid, SAN_JOSE.id, SAN_JOSE.center.lat,
    SAN_JOSE.center.lng, 10, now);
  topTen[profile.name] = ranked.map((r) => r.id);
}
const cache = (await db.collection("feedCaches").doc(SAN_JOSE.id).get()).data();
const treasury = (await db.collection("treasury")
  .doc(new Date().toISOString().slice(0, 7)).get()).data();
const finalAudit = results.at(-1);
const backfill = JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("./backfill-classify.mjs", import.meta.url))],
  { encoding: "utf8", maxBuffer: 2_000_000 }));
const report = {
  emulator: host, checkedAt: new Date(now).toISOString(),
  sourceRuns: results.map(({ source, fetched, created, merged, skipped, suspectedDuplicates,
    suspectedDuplicateRate }) => ({ source, fetched, created, merged, skipped,
      suspectedDuplicates, suspectedDuplicateRate })),
  activeUpcoming: upcoming.length, geocoded, byCategory,
  suspectedDuplicateRate: finalAudit.suspectedDuplicateRate,
  cachedCandidates: cache?.events?.length ?? 0,
  candidateDocumentsReadOnFirstRefresh: treasury?.readTelemetry?.candidateDocuments ?? null,
  candidateRefreshes: treasury?.readTelemetry?.candidateRefreshes ?? null,
  backfillDryRun: { processed: backfill.processed, changed: backfill.changed,
    reclassified: backfill.reclassified, belowConfidence: backfill.belowConfidence,
    changedFields: backfill.changedFields, changeExamples: backfill.changeExamples },
  topTen,
};
console.log(`LOCAL_CORPUS_GATE_REPORT=${JSON.stringify(report)}`);
if (upcoming.length < 100 || Object.values(topTen).some((ids) => ids.length < 10) ||
    finalAudit.suspectedDuplicateRate >= 0.05 ||
    backfill.processed < upcoming.length || backfill.changed !== 0) {
  throw new Error("Local corpus gate failed its volume, ranking, or duplicate threshold.");
}
