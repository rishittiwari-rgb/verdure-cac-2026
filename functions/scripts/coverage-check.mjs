/**
 * F2 — what share of our event corpus is NOT in Google?
 *
 * This is the differentiation question, and it is the one number that says
 * whether the ingestion work was worth doing. If most of what Verdure lists is
 * also the first page of a Google search, the app is a worse interface to
 * something people already have.
 *
 * HOW IT IS MEASURED. Every ingested event records which feeds produced it in
 * `sources[]`. SerpApi IS Google Events — that is literally what the provider
 * wraps. So an event whose `sources` does not include "serpapi" is one Google's
 * event index did not surface for this area during the same window. That is a
 * proxy, not a proof, and the report says so rather than implying certainty.
 *
 * REPORT THE NUMBER REGARDLESS OF WHAT IT IS. A low number is not a reason to
 * quietly reword the metric; it is the finding. This script has no pass/fail
 * threshold and exits 0 on any result, precisely so nobody is tempted to tune
 * the threshold instead of the corpus.
 */

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

initializeApp(EMU
  ? { projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" }
  : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();

const areaId = process.argv[2] || "san-jose-ca";
const now = Date.now();

const query = db.collection("events")
  .where("areaId", "==", areaId)
  .where("active", "==", true);

const upcoming = [];
let cursor;
for (;;) {
  const snap = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
  for (const d of snap.docs) {
    const data = d.data();
    if ((data.date?.toMillis?.() ?? 0) >= now) upcoming.push(data);
  }
  if (snap.size < 500) break;
  cursor = snap.docs[snap.docs.length - 1];
}

if (upcoming.length === 0) {
  console.log(`\nNo upcoming active events for "${areaId}".`);
  console.log(EMU
    ? "Running against the EMULATOR, which starts empty — seed or ingest first."
    : "This is the live project. An empty corpus here is itself the finding.");
  process.exit(0);
}

const sourcesOf = (d) => {
  const primary = String(d.source ?? "community");
  const all = Array.isArray(d.sources) ? d.sources.map((s) => String(s.source ?? s)) : [primary];
  return new Set(all.length ? all : [primary]);
};

let notInGoogle = 0;
const bySource = new Map();           // primary source -> { total, notInGoogle }

for (const d of upcoming) {
  const srcs = sourcesOf(d);
  const absent = !srcs.has("serpapi");
  if (absent) notInGoogle++;
  const primary = String(d.source ?? "community");
  const row = bySource.get(primary) ?? { total: 0, notInGoogle: 0 };
  row.total++;
  if (absent) row.notInGoogle++;
  bySource.set(primary, row);
}

const pct = (n, d) => d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`.padStart(6);

console.log(`\n╔═ Corpus coverage — ${areaId} ${EMU ? "(EMULATOR)" : "(LIVE)"}`);
console.log(`║  measured ${new Date(now).toISOString()}`);
console.log("╠" + "═".repeat(58));
console.log(`║  upcoming active events            ${String(upcoming.length).padStart(6)}`);
console.log(`║  NOT found via Google (SerpApi)    ${String(notInGoogle).padStart(6)}   ${pct(notInGoogle, upcoming.length)}`);
console.log("╠" + "═".repeat(58));
console.log("║  by primary source");

const rows = [...bySource.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [source, row] of rows) {
  console.log(`║    ${source.padEnd(16)} ${String(row.total).padStart(5)} events   ` +
              `${String(row.notInGoogle).padStart(5)} absent   ${pct(row.notInGoogle, row.total)}`);
}
console.log("╚" + "═".repeat(58));

console.log(`
The headline number is the share of our corpus Google Events did not return
for this area in the same window: ${pct(notInGoogle, upcoming.length).trim()}.

Caveats, stated rather than buried:
  • SerpApi is a proxy for Google Events, not for all of Google. An event with
    a web page Google has indexed can still be "absent" here.
  • SerpApi is quota-capped and runs as a gap-filler, so its coverage of our
    area is itself incomplete — which biases this number UPWARD.
  • Events ingested before SerpApi last ran may be absent for timing reasons
    rather than genuine uniqueness.
Treat it as a directional measure of differentiation, not a guarantee.`);

// No threshold, no non-zero exit. See the header.
process.exit(0);
