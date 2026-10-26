// Sprint baseline — one script, run three times (start, halfway, end).
//
//   cd <repo root>
//   npx firebase-tools@13 emulators:exec --only firestore --project connectify-19dd8 \
//     "node functions/scripts/baseline.mjs --label start"
//
// Every improvement claimed in a sprint report is the difference between two
// runs of THIS command on the SAME recorded corpus (test-fixtures/corpus, made
// once by record-corpus.mjs). It measures, against a disposable local emulator:
//
//   • active in-radius events, in total and per source / per feed; active sources
//   • duplicate rate under John's similarity rule (dedupe.py), report-only
//   • Firestore writes for one ingestion run in which nothing changed
//   • reads per feed open for the live ranking version (method: READ-BUDGET.md,
//     measured by counting every document the Admin SDK actually returns)
//   • share of events with coordinates, a category, an image, a price or "free"
//
// It refuses to run against anything but a local emulator and never touches
// the network. Output: docs/BASELINE-<date>-<label>.json.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Query, DocumentReference, Firestore, Transaction, AggregateQuery } from "firebase-admin/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Refusing to run: FIRESTORE_EMULATOR_HOST must be a local emulator.");

// ── Read meter: count what the Admin SDK really returns ─────────────────────
// Firestore bills per document returned (one minimum per query), so the meter
// counts returned documents plus one for every empty query. It is installed
// before any lib module runs so every read on the shared `db` is seen.
const meter = { queries: 0, queryDocs: 0, emptyQueries: 0, docGets: 0, getAll: 0, aggregates: 0 };
const origQueryGet = Query.prototype.get;
Query.prototype.get = async function (...args) {
  const snap = await origQueryGet.apply(this, args);
  meter.queries++; meter.queryDocs += snap.size; if (!snap.size) meter.emptyQueries++;
  return snap;
};
const origDocGet = DocumentReference.prototype.get;
DocumentReference.prototype.get = async function (...args) { meter.docGets++; return origDocGet.apply(this, args); };
const origGetAll = Firestore.prototype.getAll;
Firestore.prototype.getAll = async function (...refs) { meter.getAll += refs.filter((r) => r instanceof DocumentReference).length; return origGetAll.apply(this, refs); };
const origTxGet = Transaction.prototype.get;
Transaction.prototype.get = async function (ref, ...args) {
  const result = await origTxGet.call(this, ref, ...args);
  if (ref instanceof DocumentReference) meter.docGets++;
  else if (typeof result?.size === "number") { meter.queries++; meter.queryDocs += result.size; if (!result.size) meter.emptyQueries++; }
  else meter.aggregates++;
  return result;
};
const origAggGet = AggregateQuery?.prototype?.get;
if (origAggGet) AggregateQuery.prototype.get = async function (...args) { meter.aggregates++; return origAggGet.apply(this, args); };
const chargedReads = (m) => m.queryDocs + m.emptyQueries + m.docGets + m.getAll + m.aggregates;
const snapshotMeter = () => ({ ...meter, chargedReads: chargedReads(meter) });
const resetMeter = () => { for (const k of Object.keys(meter)) meter[k] = 0; };
const diffMeter = (before) => { const after = snapshotMeter(); const out = {}; for (const k of Object.keys(after)) out[k] = after[k] - (before[k] ?? 0); return out; };

const { SAN_JOSE, isInsideArea } = await import("../lib/ingest/areas.js");
const { runSource, SOURCES } = await import("../lib/ingest/index.js");
const { db } = await import("../lib/common.js");
const { loadAreaIndex, auditSuspectedDuplicates, auditFuzzyDuplicates } = await import("../lib/ingest/store.js");
const { recommendFor } = await import("../lib/ranking.js");
const { loadRecordedCorpus, corpusSources, recordsFor } = await import("./corpus-fixture.mjs");
const { seedSourcesFromConfig } = await import("../lib/ingest/sources-registry.js");
// W4.1: the registry exists from the halfway run on; the start run predates it (sourceDocuments reads null there).
await seedSourcesFromConfig();

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const label = flag("label", "run");
if (!/^[a-z0-9-]{1,24}$/.test(label)) throw new Error("--label must be a short lowercase slug");
const area = SAN_JOSE;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const startedAt = new Date();
const day = startedAt.toISOString().slice(0, 10);
const out = flag("out", join(root, "docs", `BASELINE-${day}-${label}.json`));
let gitHead = "unknown";
try { gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}

const corpus = loadRecordedCorpus();
const sources = corpusSources(corpus, SOURCES);
console.log(`baseline[${label}] corpus ${corpus.path} recorded ${corpus.recordedAt}; sources: ${sources.join(", ")}`);

// ── 1. Ingest the recorded corpus twice through the real write path ──────────
// Run A populates the store; run B replays identical records, so every write
// it performs is a write for "nothing changed".
const ingestWrites = (r) => (typeof r.writes === "number" ? r.writes : r.created + r.updated + r.merged + r.markedStale);
const BOOKKEEPING_WRITES_PER_SOURCE = 3; // ingestRuns doc, sourceHealth transaction, treasury telemetry
async function ingestAll(tag) {
  const perSource = {};
  let total = 0;
  for (const source of sources) {
    const records = recordsFor(corpus, source);
    const started = Date.now();
    const result = await runSource(source, area, {}, records);
    const writes = ingestWrites(result);
    perSource[source] = { fetched: result.fetched, created: result.created, updated: result.updated, merged: result.merged,
      skipped: result.skipped, markedStale: result.markedStale, deactivated: result.deactivated, rejected: result.rejected ?? null,
      unchanged: result.unchanged ?? null, writes, bookkeepingWrites: BOOKKEEPING_WRITES_PER_SOURCE,
      errors: result.errors, seconds: (Date.now() - started) / 1000 };
    total += writes + BOOKKEEPING_WRITES_PER_SOURCE;
    console.log(`  ${tag} ${source.padEnd(14)} fetched ${result.fetched} created ${result.created} updated ${result.updated} merged ${result.merged} skipped ${result.skipped} writes ${writes}${result.errors.length ? ` ERRORS ${result.errors.join("; ")}` : ""}`);
  }
  return { perSource, totalWrites: total };
}
console.log("ingest run A (populate)");
const runA = await ingestAll("A");
console.log("ingest run B (nothing changed)");
const runB = await ingestAll("B");

// ── 2. Corpus measures ───────────────────────────────────────────────────────
const now = Date.now();
const query = db.collection("events").where("areaId", "==", area.id).where("active", "==", true);
const active = [];
let cursor;
for (;;) {
  const snap = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
  for (const d of snap.docs) { const data = d.data(); if ((data.date?.toMillis?.() ?? 0) >= now) active.push({ id: d.id, data }); }
  if (snap.size < 500) break;
  cursor = snap.docs[snap.docs.length - 1];
}
const hasCoords = (d) => typeof d.latitude === "number" && typeof d.longitude === "number";
const inRadius = active.filter(({ data }) => hasCoords(data) && isInsideArea(area, data.latitude, data.longitude, 0));
const noCoords = active.filter(({ data }) => !hasCoords(data));
const countBy = (rows, key) => { const m = {}; for (const { data } of rows) { const k = String(key(data) ?? "unknown"); m[k] = (m[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(m).sort()); };
const share = (rows, pred) => rows.length ? Number((rows.filter(({ data }) => pred(data)).length / rows.length).toFixed(4)) : 0;
const KNOWN_CATEGORIES = new Set(["Cleanup", "Sports", "Social", "Workshop", "Market", "Festival", "Hackathon", "Meetup", "Volunteer", "Program"]);
const fields = {
  withCoordinates: share(active, hasCoords),
  withCategory: share(active, (d) => KNOWN_CATEGORIES.has(String(d.category))),
  withImage: share(active, (d) => typeof d.imageURL === "string" && d.imageURL.length > 0),
  withPriceOrFree: share(active, (d) => d.isFree === true || typeof d.priceMin === "number" || (d.isFree === false && d.priceMin !== undefined)),
  withAdultOnlyFlag: share(active, (d) => typeof d.adultOnly === "boolean"),
  withTopicTags: share(active, (d) => Array.isArray(d.topicTags)),
  withContentHash: share(active, (d) => typeof d.contentHash === "string"),
};
const index = await loadAreaIndex(area);
const fuzzy = auditFuzzyDuplicates(index, now);
const legacy = auditSuspectedDuplicates(index);
let rejectedListings = null, rejectedBySource = null;
try {
  rejectedListings = (await db.collection("rejectedListings").count().get()).data().count;
  const rejectedRows = await db.collection("rejectedListings").limit(5000).get();
  rejectedBySource = countBy(rejectedRows.docs.map((d) => ({ id: d.id, data: d.data() })), (d) => d.source);
} catch { rejectedListings = null; }
let sourceDocs = { active: null, total: null, byStatus: null };
try {
  const all = await db.collection("sources").limit(2000).get();
  sourceDocs = { total: all.size, byStatus: countBy(all.docs.map((d) => ({ id: d.id, data: d.data() })), (d) => d.status) };
  sourceDocs.active = sourceDocs.byStatus.active ?? 0;
} catch { /* collection absent before W4.1 */ }
const configuredFeeds = corpus.feeds.filter((f) => !f.error).length;

// ── 3. Reads per feed open ───────────────────────────────────────────────────
const versionDoc = await db.doc("config/ranking").get();
const rankingVersion = versionDoc.data()?.version ?? "v1";
const profiles = {
  cold: {},
  family: { interests: ["family", "outdoors"], householdChildAges: [6] },
  student: { interests: ["tech", "learning"], studentStatus: true, school: "San José State University" },
};
const reads = {};
for (const [name, profile] of Object.entries(profiles)) {
  const uid = `baseline-${name}`;
  await db.doc(`users/${uid}`).set(profile);
}
await db.doc(`feedCaches/${area.id}`).delete().catch(() => {});
for (const [name] of Object.entries(profiles)) {
  const uid = `baseline-${name}`;
  const before = snapshotMeter();
  const ranked = await recommendFor(uid, area.id, area.center.lat, area.center.lng, 50, now);
  const cold = diffMeter(before);
  const before2 = snapshotMeter();
  const rankedWarm = await recommendFor(uid, area.id, area.center.lat, area.center.lng, 50, now);
  const warm = diffMeter(before2);
  reads[name] = { version: ranked[0]?.version ?? rankingVersion, coldCache: cold, warmCache: warm, ranked: ranked.length, rankedWarm: rankedWarm.length, topFive: ranked.slice(0, 5).map((r) => r.id) };
  // Both versions are callable for the same request (W3.2); measure each on the warm cache.
  for (const version of ["v1", "v2"]) {
    try {
      const b = snapshotMeter();
      const out = await recommendFor(uid, area.id, area.center.lat, area.center.lng, 50, now, { version });
      reads[name][`warm_${version}`] = { ...diffMeter(b), ranked: out.length, topFive: out.slice(0, 5).map((r) => r.id), reasonsSample: out.slice(0, 3).map((r) => r.reasons ?? []) };
    } catch (e) { reads[name][`warm_${version}`] = { error: String(e?.message ?? e) }; }
  }
  console.log(`  reads/${name}: cold ${cold.chargedReads} warm ${warm.chargedReads} (ranked ${ranked.length}; v1 warm ${reads[name].warm_v1?.chargedReads ?? "n/a"}, v2 warm ${reads[name].warm_v2?.chargedReads ?? "n/a"})`);
}
const cache = (await db.doc(`feedCaches/${area.id}`).get()).data();

const report = {
  label, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), gitHead, emulator: host,
  corpus: { path: corpus.path.replace(/\\/g, "/").split("/functions/")[1] ?? corpus.path, recordedAt: corpus.recordedAt, sha256: corpus.sha256,
    records: Object.fromEntries(sources.map((s) => [s, recordsFor(corpus, s).length])), skipped: corpus.skipped },
  events: {
    activeUpcoming: active.length, activeInRadius: inRadius.length, activeWithoutCoordinates: noCoords.length,
    perSource: countBy(inRadius, (d) => d.source), perSourceAll: countBy(active, (d) => d.source),
    perFeed: countBy(inRadius, (d) => d.organizer), perCategory: countBy(inRadius, (d) => d.category),
    fieldShares: fields,
  },
  sources: { configuredFeeds, feedsRecorded: corpus.feeds.map((f) => ({ source: f.source, name: f.name, records: f.records, error: f.error ?? null })),
    sourceDocuments: sourceDocs },
  duplicates: { johnRule: { method: "dedupe.py is_duplicate(): title-token Jaccard ≥ 0.7 after stop-words, start within 30 min, same venue (token Jaccard ≥ 0.5) or within 0.25 mi; richest listing kept; report-only",
      active: fuzzy.active, duplicates: fuzzy.duplicates, rate: Number(fuzzy.rate.toFixed(4)), sample: fuzzy.sample },
    legacyHeuristic: { method: "store.ts auditSuspectedDuplicates (title overlap ≥ 0.8, 2 h, same venue key or 300 m)", active: legacy.active, suspected: legacy.suspected, rate: Number(legacy.rate.toFixed(4)) } },
  rejectedListings: { count: rejectedListings, bySource: rejectedBySource },
  ingest: { runA, runB, unchangedRunWrites: runB.totalWrites, populateRunWrites: runA.totalWrites,
    note: "writes = document sets issued by upsertBatch + markStale (IngestResult.writes when present) plus 3 bookkeeping writes per source" },
  reads: { rankingVersion, method: "Every document the Admin SDK returned while recommendFor ran, plus one minimum read per empty query (READ-BUDGET.md method). Client-side constant from READ-BUDGET: up to 80 feed + 10 ranked-by-id + 40 Everything page reads per open.",
    clientConstantPerOpen: { feed: 80, rankedById: 10, everythingPage: 40 }, cachedCandidates: cache?.events?.length ?? null, perProfile: reads },
};
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(`\nBASELINE[${label}] active in-radius ${inRadius.length} (of ${active.length} active upcoming); feeds ${configuredFeeds}; John-rule duplicate rate ${(fuzzy.rate * 100).toFixed(2)}%; unchanged-run writes ${runB.totalWrites}; reads/open cold ${reads.cold.coldCache.chargedReads} warm ${reads.cold.warmCache.chargedReads}; coords ${(fields.withCoordinates * 100).toFixed(1)}% image ${(fields.withImage * 100).toFixed(1)}% price/free ${(fields.withPriceOrFree * 100).toFixed(1)}%`);
console.log(`written ${out}`);
