// W4.1 E2E on the Firestore emulator: sources are data.
//   cd <repo root>
//   npx firebase-tools@13 emulators:exec --only firestore --project connectify-19dd8 "node functions/scripts/sources-e2e.mjs"
//
// Proves: (1) the migration seeds /sources from today's config idempotently; (2) ingesting the recorded corpus
// through sources read from /sources produces EXACTLY the same event count per source and per feed as ingesting
// through the same seeds supplied directly (same code, no network) — the "unchanged counts" gate; (3) ingestion
// reads only active sources and picks up a newly active one with no code change; (4) the deny-list cannot be
// overridden by a document; (5) staff-readable, client-unwritable is a rules matter covered in e2e-backend.
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) throw new Error("Refusing to run outside the local emulator.");
initializeApp({ projectId: "connectify-19dd8" });
const db = getFirestore();
const { SAN_JOSE } = await import("../lib/ingest/areas.js");
const { SOURCE_SEEDS, seedsOfType } = await import("../lib/ingest/sources-config.js");
const { seedSourcesFromConfig, loadActiveSources, sourceDocFromSeed, isDeniedHost, DENIED_DOMAINS, setSourceStatus } = await import("../lib/ingest/sources-registry.js");
const { fetchSource, runSource } = await import("../lib/ingest/index.js");
const { loadRecordedCorpus, recordsFor } = await import("./corpus-fixture.mjs");

let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.error(`  ❌ ${name} ${extra}`); } };
const area = SAN_JOSE;

console.log("── W4.1: sources become data ──");
const first = await seedSourcesFromConfig();
ok("migration seeds one /sources document per configured feed", first.created.length === SOURCE_SEEDS.length && first.denied.length === 0, JSON.stringify(first));
const second = await seedSourcesFromConfig();
ok("migration is idempotent (second run creates nothing)", second.created.length === 0 && second.existing.length === SOURCE_SEEDS.length);
const activeDocs = await loadActiveSources(area.id);
ok("every seeded source is active and readable by type", activeDocs.length === SOURCE_SEEDS.length && (await loadActiveSources(area.id, "bibliocommons")).length === seedsOfType("bibliocommons", area.id).length);
const stored = (await db.doc("sources/san-jose-ca_bibliocommons_sjpl").get()).data();
ok("a source document carries type, host, url, params, status, origin, decision and inspection fields",
   stored.type === "bibliocommons" && stored.host === "sjpl.bibliocommons.com" && stored.url?.includes("gateway.bibliocommons.com") && stored.params.library === "sjpl" &&
   stored.status === "active" && stored.origin === "config" && "decision" in stored && "inspection" in stored && "etag" in stored && "lastModified" in stored, JSON.stringify(Object.keys(stored)));

// (2) The unchanged-count gate: replay the recorded corpus through a fake fetch for both paths.
// The adapters themselves are frozen and network-bound, so the comparison runs the SAME upsert code on the
// SAME records with the source list coming once from the seeds and once from /sources documents.
const corpus = loadRecordedCorpus();
const countBy = (snap, key) => { const m = {}; for (const d of snap.docs) { const k = String(d.data()[key] ?? "?"); m[k] = (m[k] ?? 0) + 1; } return m; };
async function ingestAll(label, sourcesFor) {
  for (const type of ["libcal", "bibliocommons", "localist", "livewhale", "legistar", "midpen"]) {
    const records = recordsFor(corpus, type);
    const sources = await sourcesFor(type);
    // Payload mode carries the records; the source list is what must agree between the two paths.
    const result = await runSource(type, area, {}, records, sources);
    if (result.errors.length) throw new Error(`${label} ${type}: ${result.errors.join("; ")}`);
  }
  const snap = await db.collection("events").where("areaId", "==", area.id).where("active", "==", true).get();
  return { total: snap.size, bySource: countBy(snap, "source"), byFeed: countBy(snap, "organizer") };
}
const viaSeeds = await ingestAll("seeds", async (type) => seedsOfType(type, area.id).map(sourceDocFromSeed));
// Wipe events and re-ingest through the registry.
let wiped = 0;
for (;;) { const page = await db.collection("events").limit(400).get(); if (page.empty) break; const b = db.batch(); page.docs.forEach((d) => b.delete(d.ref)); await b.commit(); wiped += page.size; }
for (;;) { const page = await db.collection("rejectedListings").limit(400).get(); if (page.empty) break; const b = db.batch(); page.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
const viaRegistry = await ingestAll("registry", async (type) => loadActiveSources(area.id, type));
ok(`unchanged counts: total active events identical through config and through /sources (${viaSeeds.total})`, viaSeeds.total === viaRegistry.total && wiped === viaSeeds.total, `${viaSeeds.total} vs ${viaRegistry.total}`);
ok("unchanged counts: per source identical", JSON.stringify(viaSeeds.bySource) === JSON.stringify(viaRegistry.bySource), JSON.stringify([viaSeeds.bySource, viaRegistry.bySource]));
ok("unchanged counts: per feed identical", JSON.stringify(viaSeeds.byFeed) === JSON.stringify(viaRegistry.byFeed), JSON.stringify([viaSeeds.byFeed, viaRegistry.byFeed]));
console.log("    per-source counts:", JSON.stringify(viaRegistry.bySource));

// (3) Only active sources are read; a newly active one is picked up automatically.
await setSourceStatus("san-jose-ca_localist_events.stanford.edu", "paused", "e2e: pause");
ok("a paused source is no longer read", !(await loadActiveSources(area.id, "localist")).some((s) => s.id === "san-jose-ca_localist_events.stanford.edu"));
await db.doc("sources/san-jose-ca_ics_newtown").set({ type: "ics", areaId: area.id, name: "Newtown Library", host: "newtown.example.org",
  url: "https://newtown.example.org/events.ics", params: { name: "Newtown Library", url: "https://newtown.example.org/events.ics", tags: ["library"] },
  status: "active", origin: "probe", decision: null, inspection: null, etag: null, lastModified: null, failureStreak: 0, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
const icsSources = await loadActiveSources(area.id, "ics");
ok("a newly active source appears to the next ingest run with no code change", icsSources.some((s) => s.id === "san-jose-ca_ics_newtown"));
let fetchErr = null;
try { await fetchSource("ics", area, {}, icsSources.map((s) => ({ ...s, params: { ...s.params, url: "https://127.0.0.1:1/never.ics" } }))); } catch (e) { fetchErr = String(e.message); }
ok("the adapter is actually invoked for the new source (its fetch fails loudly against an unreachable URL)", fetchErr !== null, String(fetchErr));

// (4) The deny-list is absolute.
await db.doc("sources/san-jose-ca_ics_meetup").set({ type: "ics", areaId: area.id, name: "Meetup", host: "www.meetup.com", url: "https://www.meetup.com/x/events/ical/",
  params: { name: "Meetup", url: "https://www.meetup.com/x/events/ical/" }, status: "active", origin: "manual", createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
ok("an 'active' deny-listed document is never loaded", !(await loadActiveSources(area.id, "ics")).some((s) => s.id === "san-jose-ca_ics_meetup"));
ok("the deny-list covers Google Maps/Places, Meetup, Facebook, Instagram, Eventbrite and ACTIVE Network, including subdomains and URLs",
   ["maps.google.com", "https://www.google.com/maps/place/x", "places.googleapis.com", "www.meetup.com", "https://meetup.com/sjse", "facebook.com", "m.facebook.com", "instagram.com",
    "www.eventbrite.com", "https://www.eventbriteapi.com/v3/", "active.com", "apps.active.com", "campscui.active.com"].every(isDeniedHost) &&
   ["events.sjsu.edu", "sjpl.bibliocommons.com", "www.openspace.org", "google.com", "activekids.org", "faceboom.com"].every((h) => !isDeniedHost(h)) && DENIED_DOMAINS.length >= 10);
const denySeed = await seedSourcesFromConfig([{ id: "bad", areaId: area.id, type: "ics", host: "www.eventbrite.com", params: { name: "EB", url: "https://www.eventbrite.com/x.ics" }, verified: "" }]);
ok("a denied seed is reported and never written", denySeed.denied.length === 1 && !(await db.doc("sources/bad").get()).exists);


// (5) The fetch mapping itself, offline. Payload mode above proves the write path; this proves that fetchSource
// hands every /sources document to its adapter with the document's own parameters: the HTTP requests the adapters
// issue are recorded (global fetch is stubbed, nothing leaves the machine) and must be identical whether the source
// list comes from the seeds or from /sources, and must cover every seed host of the type exactly once.
const realFetch = globalThis.fetch;
const requested = [];
globalThis.fetch = async (input) => { requested.push(String(input instanceof Request ? input.url : input)); return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };
// One document at a time: an adapter that rejects the stub's empty body throws, and fetchSource keeps the
// pre-W4.1 all-or-nothing semantics per type (a failing feed aborts its type), so the loop would stop early.
const firstRequestsFor = async (type, sources) => {
  requested.length = 0;
  for (const one of sources) {
    try { await fetchSource(type, area, { ticketmaster: "test-key", nps: "test-key", serpapi: "test-key" }, [one]); } catch { /* an empty body is not a valid feed for some adapters; only the requests matter */ }
  }
  return [...new Set(requested.map((u) => { const x = new URL(u); return x.host + x.pathname; }))].sort();
};
await setSourceStatus("san-jose-ca_localist_events.stanford.edu", "active", "e2e: restore");
await db.doc("sources/san-jose-ca_ics_newtown").delete();
await db.doc("sources/san-jose-ca_ics_meetup").delete();
const expectedHostFor = { ticketmaster: () => "app.ticketmaster.com", libcal: (p) => new URL(p.rssUrl).host, bibliocommons: (p) => `gateway.bibliocommons.com/v2/libraries/${p.library}/`,
  localist: (p) => `${p.host}/api/2/events`, livewhale: (p) => `${p.host}/live/json/v2/events`, legistar: (p) => `webapi.legistar.com/v1/${p.client}/events`, midpen: () => "www.openspace.org/events" };
for (const type of ["ticketmaster", "libcal", "bibliocommons", "localist", "livewhale", "legistar", "midpen"]) {
  const viaSeedDocs = await firstRequestsFor(type, seedsOfType(type, area.id).map(sourceDocFromSeed));
  const viaRegistryDocs = await firstRequestsFor(type, await loadActiveSources(area.id, type));
  const seeds = seedsOfType(type, area.id);
  ok(`fetch mapping (${type}): identical requests through the seeds and through /sources (${viaRegistryDocs.length} request path(s))`, viaSeedDocs.length > 0 && JSON.stringify(viaSeedDocs) === JSON.stringify(viaRegistryDocs), JSON.stringify([viaSeedDocs, viaRegistryDocs]));
  ok(`fetch mapping (${type}): every configured feed of the type is requested with its own parameters`,
     seeds.every((sd) => viaRegistryDocs.some((r) => r.startsWith(expectedHostFor[type](sd.params)))), JSON.stringify({ seeds: seeds.map((x) => expectedHostFor[type](x.params)), viaRegistryDocs }));
}
ok("fetch mapping (nps): a source with no park codes issues no request", (await firstRequestsFor("nps", await loadActiveSources(area.id, "nps"))).length === 0);
ok("fetch mapping: a paused source is not requested", await (async () => { await setSourceStatus("san-jose-ca_localist_events.stanford.edu", "paused", "e2e"); const r = await firstRequestsFor("localist", await loadActiveSources(area.id, "localist")); await setSourceStatus("san-jose-ca_localist_events.stanford.edu", "active", "e2e"); return r.length === 1 && r[0].startsWith("events.sjsu.edu/"); })());
ok("fetch mapping: a document of another type or area handed to fetchSource is ignored", (await firstRequestsFor("localist", [{ ...sourceDocFromSeed(seedsOfType("livewhale", area.id)[0]) }, { ...sourceDocFromSeed(seedsOfType("localist", area.id)[0]), areaId: "elsewhere" }])).length === 0);
globalThis.fetch = realFetch;

console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed ? 1 : 0);
