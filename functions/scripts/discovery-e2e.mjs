// W4 E2E on the Firestore emulator: automatic discovery, decision, removal, self-healing.
//
//   cd <repo root>
//   npx firebase-tools@13 emulators:exec --only firestore --project connectify-19dd8 "node functions/scripts/discovery-e2e.mjs"
//   … --record     ONE live run per milestone: every HTTP response is written to test-fixtures/discovery/<label>/
//                  and the run's report to docs/evidence/. Everything else replays those fixtures with no network.
//
// Proves: (1) one full discovery cycle seeded by the corpus and OpenStreetMap (plus the model URL list as a
// separately reported origin) activates at least one host Verdure did not ingest today with no human action, and
// every rejected candidate carries its reasons; (2) an audit query finds no active source failing any rule;
// (3) the rule evidence on the named real pages (CDM rejects, ACTIVE rejects, SJSU Localist passes, a
// BiblioCommons feed passes); (4) removal: a small host is removed immediately, a host with > 100 active events
// needs its published token, removed hosts' events are hidden on the next cycle and the host is never rediscovered,
// requests are rate-limited and logged; (5) self-healing: three consecutive failures pause a source, its events are
// kept, a passing re-inspection resumes it; (6) a 304 to a conditional request is a successful run with no writes.
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) throw new Error("Refusing to run outside the local emulator.");
initializeApp({ projectId: "connectify-19dd8" });
const db = getFirestore();
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const RECORD = args.includes("--record");
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const { SAN_JOSE } = await import("../lib/ingest/areas.js");
const { runSource } = await import("../lib/ingest/index.js");
const { fetchSourcesIsolated, conditionalFetchFor, NotModified } = await import("../lib/ingest/index.js");
const { seedSourcesFromConfig, loadActiveSources, loadSourcesByStatus, setSourceStatus, recordSourceRun, shouldPause, FAILURE_STREAK_TO_PAUSE } = await import("../lib/ingest/sources-registry.js");
const { loadAreaIndex } = await import("../lib/ingest/store.js");
const { HostThrottle, recordingFetch, replayFetch, recordedUrls } = await import("../lib/discovery/http.js");
const { runDiscovery, recheckSources, auditActiveSources, hostsFromCorpus, enqueueCandidates, recordSourceSubmission, DISCOVERY_LIMITS } = await import("../lib/discovery/discover.js");
const { inspectSource } = await import("../lib/discovery/inspect.js");
const { decideSource, isPublicInstitution } = await import("../lib/discovery/decide.js");
const { processRemoval, applyRemovals, removalTokenFor, isRemovedHost, activeEventsOf, LARGE_SOURCE_EVENTS } = await import("../lib/discovery/removal.js");
const { loadRecordedCorpus, recordsFor } = await import("./corpus-fixture.mjs");

let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.error(`  ❌ ${name} ${extra}`); } };
const area = SAN_JOSE;

// ── Fixtures: record once, replay always ────────────────────────────────────
const FIX_ROOT = join(here, "..", "test-fixtures", "discovery");
const manifestPath = join(FIX_ROOT, "MANIFEST.json");
const label = RECORD ? `live-${new Date().toISOString().slice(0, 10)}` : (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).label : null);
if (!label) throw new Error("No recorded discovery fixtures. Run once with --record (network) first.");
const dir = join(FIX_ROOT, label);
const manifest = RECORD ? { label, recordedAt: new Date().toISOString(), now: new Date().toISOString(), maxInspections: Number(flag("max", 120)) }
  : JSON.parse(readFileSync(manifestPath, "utf8"));
const NOW = new Date(manifest.now);
// Evidence hosts the unit suite and this file name explicitly (inspected even when no origin lists them).
// www.sccgov.org answers 403 to everything including robots.txt (docs/FEED-SURVEY-SAN-JOSE.md): the "403 on
// robots.txt rejects, never retried another way" proof.
const EVIDENCE_HOSTS = ["www.cdm.org", "developer.active.com", "events.sjsu.edu", "sjpl.bibliocommons.com", "careercenter.sjsu.edu", "www.openspace.org", "www.sccgov.org"];
// Recording keeps whole bodies up to 8 MB: the Overpass answer for a 25-mile radius is several MB of JSON and a
// truncated recording would replay as a parse failure.
const RECORD_BODY_CAP = 8_000_000;
let replayMisses = 0;
const fetchImpl = RECORD ? recordingFetch(dir, fetch, RECORD_BODY_CAP) : replayFetch(dir, (url) => {
  // Removal token checks against hosts that never published one, and anything a later code change
  // requests that the live run did not: answer 404 rather than reaching the internet.
  replayMisses++;
  if (/\/\.well-known\/verdure-remove\.txt$/.test(url)) return new Response("", { status: 404 });
  return undefined;
});
// NO NETWORK ON REPLAY. Every module under test takes `fetchImpl` and defaults to the global fetch; a code path
// that forgot to thread it through would reach the live internet silently. Replace the global so it throws instead.
let realFetchCalls = 0;
if (!RECORD) globalThis.fetch = async (input) => { realFetchCalls++; throw new Error(`replay must not reach the network: ${typeof input === "string" ? input : input?.url ?? input}`); };
if (RECORD) { mkdirSync(dir, { recursive: true }); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n"); }   // written first: a partial live run still replays
// The live job's spacing is honoured when recording (that IS the limit); replay has no reason to wait.
const throttle = new HostThrottle(RECORD ? DISCOVERY_LIMITS.hostIntervalMs ?? 10_000 : 0);
console.log(`discovery-e2e ${RECORD ? "RECORD" : "replay"} fixtures=${label} now=${NOW.toISOString()}`);

// ── 0. Seed: today's sources and the recorded corpus ─────────────────────────
await seedSourcesFromConfig();
const corpus = loadRecordedCorpus();
for (const type of ["libcal", "bibliocommons", "localist", "livewhale", "legistar", "midpen"]) {
  const r = await runSource(type, area, {}, recordsFor(corpus, type));
  if (r.errors.length) throw new Error(`seed ${type}: ${r.errors.join("; ")}`);
}
const sourcesBefore = await loadActiveSources(area.id);
const eventsBefore = (await db.collection("events").where("areaId", "==", area.id).where("active", "==", true).count().get()).data().count;
console.log(`  seeded ${sourcesBefore.length} active sources, ${eventsBefore} active events`);

// ── 1. One full discovery cycle ─────────────────────────────────────────────
console.log("── W4.4: discovery cycle (corpus + OpenStreetMap + model URL list) ──");
const corpusHosts = hostsFromCorpus(await loadAreaIndex(area, NOW), area.id, area);
ok("origin 1: the corpus links external hosts", corpusHosts.length > 0, String(corpusHosts.length));
const report = await runDiscovery(area, { fetchImpl, throttle, now: NOW, maxInspections: manifest.maxInspections, concurrency: RECORD ? 16 : 32 });
console.log(`  origins ${JSON.stringify(report.origins)} queued ${JSON.stringify(report.queued)} inspected ${report.inspected} activated ${report.activated.length} rejected ${report.rejected.length} unknown ${report.unknown.length} skipped ${report.skipped.length}${report.osmError ? ` OSM ERROR ${report.osmError}` : ""}`);
ok("origin 2: OpenStreetMap listed organisations with websites inside the radius (one Overpass query, cached a week)", report.osm && report.osm.count > 0, JSON.stringify(report.osm));
ok("origin 5: the model URL list is an origin of URLs to inspect", (report.origins["model-url"] ?? 0) >= 1);
ok("the daily inspection budget is enforced (≤ 300/day) and recorded", report.budget.usedToday <= 300 && (await db.doc(`discoveryRuns/${NOW.toISOString().slice(0, 10)}`).get()).data()?.inspections <= 300);
ok("at least one host Verdure did not ingest today was ACTIVATED with no human action", report.activated.length >= 1, JSON.stringify(report.activated));
const activatedNoModel = [];
for (const id of report.activated) { const d = (await db.doc(`sources/${id}`).get()).data(); if (d.origin !== "model-url") activatedNoModel.push(id); }
ok("…and at least one of them came from the corpus or OpenStreetMap alone (not the model list)", activatedNoModel.length >= 1, JSON.stringify(activatedNoModel));
const cc = (await db.doc(`sources/${area.id}_rss-ics_careercenter.sjsu.edu`).get()).data();
ok("careercenter.sjsu.edu (the expected example) is active through the RSS + per-event iCal adapter", cc?.status === "active" && cc.type === "rss-ics", JSON.stringify(cc?.decision?.failed ?? cc));
ok("every rejected candidate carries the failed rules and their evidence", report.rejected.every((r) => r.failed.length > 0 && r.failed.every((f) => typeof r.evidence[f] === "string" && r.evidence[f].length > 0)), JSON.stringify(report.rejected.slice(0, 2)));
const robots403 = report.rejected.filter((r) => r.failed.includes("robotsAllow") && /403/.test(r.evidence.robotsAllow));
ok(`a 403 on robots.txt rejects on robotsAllow with the 403 as the evidence, never retried another way (${robots403.map((r) => r.host).join(", ") || "none in this cycle"})`, robots403.length >= 1 && robots403.every((r) => /not a licence to try harder/.test(r.evidence.robotsAllow)), JSON.stringify(robots403.slice(0, 2)));
ok("a rejected source stores the matched terms sentence when terms failed", report.rejected.filter((r) => r.failed.includes("termsAllow")).every((r) => /"/.test(r.evidence.termsAllow)), JSON.stringify(report.rejected.filter((r) => r.failed.includes("termsAllow")).map((r) => r.host)));
for (const id of report.activated) {
  const d = (await db.doc(`sources/${id}`).get()).data();
  ok(`activated ${id}: every rule passed and the decision + inspection are stored`, d.status === "active" && d.decision?.verdict === "active" && d.decision.failed.length === 0 && d.inspection?.sample?.count > 0 && typeof d.decision.rules.termsAllow.evidence === "string");
}
// The new sources ingest through the ordinary path (replayed through the same fixtures).
let newEvents = 0;
const createdBySource = {};
// Ingestion itself is unthrottled (as in production); the recording run spaces its requests 2 s apart to be polite.
const ingestFetch = RECORD ? (() => { const t = new HostThrottle(2_000); return async (input, init) => { await t.wait(new URL(String(input instanceof Request ? input.url : input)).hostname); return fetchImpl(input, init); }; })() : fetchImpl;
for (const id of report.activated) {
  const d = (await db.doc(`sources/${id}`).get()).data();
  const out = await fetchSourcesIsolated(d.type, area, {}, [{ ...d, id }], ingestFetch);
  const r = await runSource(d.type, area, {}, out.records);
  newEvents += r.created;
  createdBySource[id] = r.created;
  ok(`activated ${id}: ingests through the ordinary path (${out.records.length} fetched, ${r.created} created, ${r.rejected} rejected, failures ${out.failures.length})`, out.failures.length === 0 && r.errors.length === 0, JSON.stringify(out.failures));
}
const eventsAfter = (await db.collection("events").where("areaId", "==", area.id).where("active", "==", true).count().get()).data().count;
const sourcesAfter = await loadActiveSources(area.id);
console.log(`  sources ${sourcesBefore.length} → ${sourcesAfter.length}; active events ${eventsBefore} → ${eventsAfter} (+${newEvents} created by new sources)`);
ok("new sources and events from one cycle: more than zero", sourcesAfter.length > sourcesBefore.length && eventsAfter > eventsBefore);

// ── 2. Weekly re-check of today's sources + the audit query ─────────────────
console.log("── W4.3: weekly re-check and audit ──");
const recheck = await recheckSources(area, { fetchImpl, throttle, now: NOW });
console.log(`  rechecked ${recheck.checked} paused ${JSON.stringify(recheck.paused)} errors ${JSON.stringify(recheck.errors)}`);
ok("the weekly re-check pauses nothing that is active today (no source tightened)", recheck.paused.length === 0 && recheck.errors.length === 0, JSON.stringify(recheck));
const audit = await auditActiveSources(area.id);
ok("AUDIT: no active source fails any rule", audit.length === 0, JSON.stringify(await Promise.all(audit.map(async (a) => {
  const rules = (await db.doc(`sources/${a.id}`).get()).data()?.decision?.rules ?? {};
  return { ...a, evidence: Object.fromEntries(a.failing.map((r) => [r, String(rules[r]?.evidence ?? "").slice(0, 300)])) };
}))));
const sjpl = (await db.doc("sources/san-jose-ca_bibliocommons_sjpl").get()).data();
ok("a BiblioCommons feed passes (public institution; the platform clause is recorded as evidence)", sjpl?.decision?.verdict === "active" && sjpl.decision.rules.termsAllow.pass === true, JSON.stringify(sjpl?.decision?.rules?.termsAllow));
const sjsu = (await db.doc("sources/san-jose-ca_localist_events.sjsu.edu").get()).data();
ok("SJSU's Localist feed passes (public institution)", sjsu?.decision?.verdict === "active", JSON.stringify(sjsu?.decision?.rules?.termsAllow));

// ── 3. Named real pages ─────────────────────────────────────────────────────
console.log("── W4.3: rule evidence on real recorded pages ──");
const inspections = {};
for (const host of EVIDENCE_HOSTS) {
  const ins = await inspectSource(host, { area, fetchImpl, throttle, now: NOW });
  const dec = await decideSource(ins, { area, fetchImpl, throttle, now: NOW, originInArea: true, originNote: "evidence host" });
  inspections[host] = { platform: ins.platform, adapter: ins.adapter, verdict: dec.verdict, failed: dec.failed, terms: dec.rules.termsAllow, robots: dec.rules.robotsAllow, sample: ins.sample && { count: ins.sample.count, upcoming: ins.sample.upcoming, inRadius: ins.sample.inRadius } };
}
// The museum is never activated. When its terms page is readable the commercial clause rejects it; from a Node client its
// WAF answers 403 to every page (2026-10-21 and 2026-10-25 recordings, while curl gets 200), and then the 403s reject it instead.
// The hand-fetched terms page is still checked in discovery-unit (terms/cdm-org-terms.html).
ok("Children's Discovery Museum: never active — rejected by the commercial clause when its terms page is readable, else by the 403s its WAF gives a Node client",
   inspections["www.cdm.org"].verdict === "rejected" && ((inspections["www.cdm.org"].terms.pass === false && /commercial/i.test(inspections["www.cdm.org"].terms.evidence)) || inspections["www.cdm.org"].failed.includes("machineReadable")),
   JSON.stringify({ verdict: inspections["www.cdm.org"].verdict, failed: inspections["www.cdm.org"].failed, terms: inspections["www.cdm.org"].terms.evidence }));
ok("ACTIVE Network: on the deny-list AND its API terms reject (24-hour storage)", inspections["developer.active.com"].failed.includes("notDenied") && inspections["developer.active.com"].terms.pass === false, JSON.stringify(inspections["developer.active.com"]));
ok("SJSU Localist: every rule passes", inspections["events.sjsu.edu"].verdict === "active", JSON.stringify(inspections["events.sjsu.edu"]));
ok("SJPL BiblioCommons: every rule passes", inspections["sjpl.bibliocommons.com"].verdict === "active", JSON.stringify(inspections["sjpl.bibliocommons.com"]));
ok("Midpen (openspace.org): no restrictive clause on its terms page", inspections["www.openspace.org"].terms.pass === true && !isPublicInstitution("www.openspace.org"), inspections["www.openspace.org"].terms.evidence);
ok("careercenter.sjsu.edu: RSS + per-event iCal, every rule passes", inspections["careercenter.sjsu.edu"].adapter === "rss-ics" && inspections["careercenter.sjsu.edu"].verdict === "active", JSON.stringify(inspections["careercenter.sjsu.edu"]));
// sccgov.org answered 403 to everything in the 2026-09 survey; the 2026-10-21 recording shows its WAF now drops the
// connection instead (status 0). Either way robots.txt cannot be read, so the host is never activated and the recorded
// evidence says exactly what happened. The 403 → reject (no retry) path itself is pinned by discovery-unit.mjs.
const scc = inspections["www.sccgov.org"];
ok(`Santa Clara County (sccgov.org): robots.txt unreadable (${scc.robots.evidence}) → never active, nothing else is tried, evidence recorded`, scc.robots.pass !== true && scc.verdict !== "active" && /403|unavailable|forbidden/.test(scc.robots.evidence) && scc.adapter === null, JSON.stringify(scc));

// ── 4. Removal on request ───────────────────────────────────────────────────
console.log("── W4.6: automatic removal ──");
// A newly activated host that actually stored events (so "its events are hidden" is a real check) and is small (≤ 100).
const smallId = report.activated.find((id) => id !== `${area.id}_rss-ics_careercenter.sjsu.edu` && (createdBySource[id] ?? 0) >= 1 && (createdBySource[id] ?? 0) <= LARGE_SOURCE_EVENTS)
  ?? report.activated.find((id) => (createdBySource[id] ?? 0) >= 1) ?? report.activated[0];
const small = (await db.doc(`sources/${smallId}`).get()).data();
const r1 = await processRemoval(small.host, "e2e-requester-1", { contact: "owner@example.org", reason: "please remove" }, fetchImpl);
ok(`a host with ≤ ${LARGE_SOURCE_EVENTS} active events is removed immediately (${small.host})`, r1.removed === true && r1.requiresToken === false, JSON.stringify(r1));
ok("…its /sources document is 'removed' and the host is on the never-discover list", (await db.doc(`sources/${smallId}`).get()).data().status === "removed" && await isRemovedHost(small.host));
ok("…every removal is logged", !(await db.collection("removalRequests").where("host", "==", small.host).limit(1).get()).empty);
const sweep = await applyRemovals(area, NOW);
ok("…its events are hidden on the next cycle", sweep.sources === 1 && sweep.hidden >= 1 && (await db.collection("events").where("areaId", "==", area.id).where("active", "==", true).count().get()).data().count === eventsAfter - sweep.hidden, JSON.stringify(sweep));
// Make the host due again (as a later OSM run would) and prove discovery refuses it without a single request.
await enqueueCandidates([{ host: small.host, areaId: area.id, origin: "osm", note: "again", inArea: true }], NOW);
// Due first: the queue still holds dozens of pending OSM hosts and the run inspects at most 50.
await db.doc(`sourceCandidates/${area.id}_${small.host}`).set({ status: "pending", nextInspectAt: Timestamp.fromMillis(0) }, { merge: true });
// Other queued hosts may be attempted in the same run (all offline here); the removed one must get zero requests.
let removedHostRequests = 0;
const again = await runDiscovery(area, { fetchImpl: async (input) => { if (String(input instanceof Request ? input.url : input).includes(small.host)) removedHostRequests++; throw new Error("offline: no live requests in this check"); }, throttle, now: NOW, maxInspections: 50, origins: [] });
ok("…and a removed host is never rediscovered", again.skipped.some((s) => s === `${small.host}: removed on request`) && removedHostRequests === 0 && (await db.doc(`sources/${smallId}`).get()).data().status === "removed", JSON.stringify({ skipped: again.skipped, inspected: again.inspected, budget: again.budget, cand: (await db.doc(`sourceCandidates/${area.id}_${small.host}`).get()).data() }).slice(0, 600));
const bigHost = "sjpl.bibliocommons.com";
const r2 = await processRemoval(bigHost, "e2e-requester-2", {}, fetchImpl);
ok(`a host with > ${LARGE_SOURCE_EVENTS} active events is NOT removed without its published token`, r2.removed === false && r2.requiresToken === true && r2.token === removalTokenFor(bigHost) && (await db.doc("sources/san-jose-ca_bibliocommons_sjpl").get()).data().status === "active", JSON.stringify(r2));
const tokenFetch = async (input) => { const url = String(input instanceof Request ? input.url : input); return url.endsWith("/.well-known/verdure-remove.txt") ? new Response(removalTokenFor(bigHost), { status: 200, headers: { "content-type": "text/plain" } }) : fetchImpl(input); };
const r3 = await processRemoval(bigHost, "e2e-requester-2", {}, tokenFetch);
ok("…and IS removed, automatically, once the token is published at /.well-known/verdure-remove.txt", r3.removed === true && r3.tokenVerified === true, JSON.stringify(r3));
const r4 = await processRemoval("never-a-source.example.org", "e2e-requester-3", {}, fetchImpl);
ok("a host that was never a source still lands on the never-discover list", r4.removed === true && r4.sources === 0 && await isRemovedHost("never-a-source.example.org"));
let badHost = null; try { await processRemoval("not a host", "x", {}, fetchImpl); } catch (e) { badHost = e.message; }
ok("an invalid host is refused", badHost !== null);
// Restore SJPL for the remaining checks.
await setSourceStatus("san-jose-ca_bibliocommons_sjpl", "active", "e2e restore");
await db.doc(`removedHosts/${bigHost}`).delete();

// ── 5. Self-healing ─────────────────────────────────────────────────────────
console.log("── W4.7: self-healing ──");
// Two synthetic iCal sources on example.org hosts, served by a stub so this section never touches the fixtures or the
// network: a healthy feed and a victim whose feed starts failing after one good run.
const CAL = (uid) => `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nDTSTART:${new Date(NOW.getTime() + 5 * 86_400_000).toISOString().replace(/[-:]|\.\d{3}/g, "")}\nSUMMARY:Community Night ${uid}\nLOCATION:Town Hall, 1 Main St\nEND:VEVENT\nEND:VCALENDAR`;
let victimDown = false;
const stub = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/victim\.example\.org\/events\.ics/.test(url)) { if (victimDown) throw new Error("ECONNRESET (simulated outage)"); return new Response(CAL("v1"), { status: 200, headers: { "content-type": "text/calendar" } }); }
  if (/healthy\.example\.org\/events\.ics/.test(url)) return new Response(CAL("h1"), { status: 200, headers: { "content-type": "text/calendar" } });
  if (/example\.org\/robots\.txt$/.test(url)) return new Response("", { status: 404 });
  if (/example\.org\/?$/.test(url)) return new Response("<html><head><title>Example Civic Centre</title></head><body><h1>Events</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  if (/example\.org\//.test(url)) return new Response("", { status: 404 });
  return fetchImpl(input, init);
};
const mkIcs = (id, host) => ({ id, type: "ics", areaId: area.id, name: `${host} calendar`, host, url: `https://${host}/events.ics`, params: { name: `${host} calendar`, url: `https://${host}/events.ics` }, status: "active", origin: "config", decision: null, inspection: null, etag: null, lastModified: null, failureStreak: 0, lastEventCount: null, verified: "e2e synthetic" });
const victimId = "e2e_ics_victim", healthyId = "e2e_ics_healthy";
for (const d of [mkIcs(victimId, "victim.example.org"), mkIcs(healthyId, "healthy.example.org")]) await db.doc(`sources/${d.id}`).set({ ...d, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
const good = await fetchSourcesIsolated("ics", area, {}, await loadActiveSources(area.id, "ics"), stub);
await runSource("ics", area, {}, good.records);
const victimEvents = async () => (await db.collection("events").where("areaId", "==", area.id).where("active", "==", true).where("organizer", "==", "victim.example.org calendar").count().get()).data().count;
ok("a healthy run records lastEventCount on both synthetic sources and stores their events", good.failures.length === 0 && (await db.doc(`sources/${victimId}`).get()).data().lastEventCount === 1 && await victimEvents() === 1);
// Other real "ics" sources activated earlier in this run are also read; count only the healthy synthetic feed.
const healthyRecords = (out) => out.records.filter((r) => /healthy\.example\.org/.test(JSON.stringify([r.organizer, r.sourceUrl, r.url, r.website, r.sourceName]))).length;
victimDown = true;
for (let i = 1; i <= FAILURE_STREAK_TO_PAUSE; i++) {
  const out = await fetchSourcesIsolated("ics", area, {}, await loadActiveSources(area.id, "ics"), stub);
  const doc = (await db.doc(`sources/${victimId}`).get()).data();
  if (i < FAILURE_STREAK_TO_PAUSE) ok(`failure ${i}: the source stays active (streak ${doc.failureStreak}) and the OTHER feed of the type still ingested (${healthyRecords(out)} record)`, doc.status === "active" && doc.failureStreak === i && healthyRecords(out) === 1 && out.failures.length === 1 && out.failures[0].paused === false, JSON.stringify(out.failures));
  else ok(`failure ${i}: the source is PAUSED automatically`, doc.status === "paused" && doc.pausedBy === "self-healing" && out.failures[0].paused === true, JSON.stringify(doc.statusReason));
}
ok("…its events are kept (normal staleness removes them later)", await victimEvents() === 1);
ok("…and a paused source is not read by ingestion", !(await loadActiveSources(area.id, "ics")).some((s) => s.id === victimId));
ok("a sudden drop to zero from a source that usually has events pauses it", shouldPause({ ok: true, eventCount: 0 }, { failureStreak: 0, lastEventCount: 120 }) !== null && shouldPause({ ok: true, eventCount: 0 }, { failureStreak: 0, lastEventCount: 2 }) === null && shouldPause({ ok: true, eventCount: 50 }, { failureStreak: 2, lastEventCount: 60 }) === null);
victimDown = false;
const resume = await recheckSources(area, { fetchImpl: stub, throttle, now: new Date(NOW.getTime() + 7 * 86_400_000) });
ok("…the weekly re-inspection RESUMES it once it passes every rule again", resume.resumed.includes(victimId) && (await db.doc(`sources/${victimId}`).get()).data().status === "active" && (await db.doc(`sources/${victimId}`).get()).data().failureStreak === 0, JSON.stringify(resume));
ok("…and the weekly re-check of every active source still pauses nothing", resume.paused.length === 0 && resume.errors.length === 0, JSON.stringify(resume));

// ── 6. Conditional requests ─────────────────────────────────────────────────
console.log("── W4.4: conditional requests ──");
const etagFetch = async (input, init) => {
  const h = new Headers(init?.headers ?? {});
  if (h.get("if-none-match") === "\"v1\"") return new Response(null, { status: 304 });
  return new Response("BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:x1\nDTSTART:20991231T120000Z\nSUMMARY:Future\nLOCATION:Hall\nEND:VEVENT\nEND:VCALENDAR", { status: 200, headers: { etag: "\"v1\"", "content-type": "text/calendar" } });
};
const icsDoc = { id: "e2e_ics", type: "ics", areaId: area.id, name: "Cond", host: "cond.example.org", url: "https://cond.example.org/events.ics", params: { name: "Cond", url: "https://cond.example.org/events.ics" }, status: "active", origin: "probe", etag: null, lastModified: null, failureStreak: 0, lastEventCount: null };
await db.doc("sources/e2e_ics").set({ ...icsDoc, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
const first = await fetchSourcesIsolated("ics", area, {}, [icsDoc], etagFetch);
const stored = (await db.doc("sources/e2e_ics").get()).data();
ok("the first fetch stores the feed's validators on the source", first.records.length === 1 && stored.etag === "\"v1\"" && stored.lastEventCount === 1, JSON.stringify(stored));
const second = await fetchSourcesIsolated("ics", area, {}, [{ ...icsDoc, etag: stored.etag }], etagFetch);
const stored2 = (await db.doc("sources/e2e_ics").get()).data();
ok("a 304 to the conditional request is a successful run: no parsing, no event writes, no failure streak", second.notModified === 1 && second.succeeded === 1 && second.records.length === 0 && stored2.failureStreak === 0 && stored2.lastEventCount === 1,
  JSON.stringify({ notModified: second.notModified, succeeded: second.succeeded, records: second.records.length, failures: second.failures, streak: stored2.failureStreak, last: stored2.lastEventCount }));
let nm = false; try { await conditionalFetchFor({ etag: "\"v1\"", lastModified: null }, etagFetch).fetchImpl("https://cond.example.org/events.ics"); } catch (e) { nm = e instanceof NotModified; }
ok("conditionalFetchFor signals NotModified instead of handing the adapter an empty body", nm);
// runSource carries the 304 out, so a caller can tell "every feed answered, nothing new" from "nothing
// ran" (refresh-public-corpus-local.mjs read fetched 0 as a failure and aborted every second reload).
const realFetch = globalThis.fetch; globalThis.fetch = etagFetch;
let viaRun; try { viaRun = await runSource("ics", area, {}, undefined, [{ ...icsDoc, etag: stored.etag }]); } finally { globalThis.fetch = realFetch; }
ok("runSource reports the 304 as notModified with no error, so an unchanged feed is not read as a failed one",
  viaRun.notModified === 1 && viaRun.fetched === 0 && viaRun.errors.length === 0, JSON.stringify({ notModified: viaRun.notModified, fetched: viaRun.fetched, errors: viaRun.errors }));

// ── 7. Intake ───────────────────────────────────────────────────────────────
console.log("── W4.4: intake ──");
ok("a submitted calendar URL becomes a candidate (a URL to inspect, never an event)", (await recordSourceSubmission("https://library.example.org/events.ics", "organizer", "ip:test", area.id)).accepted === true && (await db.doc(`sourceSubmissions/${area.id}_library.example.org`).get()).exists);
ok("a deny-listed URL is refused at intake", (await recordSourceSubmission("https://www.eventbrite.com/o/x", "organizer", "ip:test", area.id)).accepted === false);
ok("a Google Maps URL is refused at intake even though google.com itself is not denied (the path-qualified entry; red-team gap fixed 2026-10-25)",
   (await recordSourceSubmission("https://www.google.com/maps/place/some-venue", "organizer", "ip:test", area.id)).accepted === false &&
   (await recordSourceSubmission("https://maps.google.com/?q=x", "organizer", "ip:test", area.id)).accepted === false);
ok("a removed host is refused at intake", (await recordSourceSubmission("https://never-a-source.example.org/cal", "organizer", "ip:test", area.id)).accepted === false);

// ── Evidence ────────────────────────────────────────────────────────────────
if (!RECORD) ok("replay never called the real fetch (the global was replaced and would have thrown)", realFetchCalls === 0, `${realFetchCalls} calls, ${replayMisses} fixture misses answered 404`);
const urls = recordedUrls(dir);
mkdirSync(join(root, "docs", "evidence"), { recursive: true });
const evidence = { label, mode: RECORD ? "record" : "replay", recordedAt: manifest.recordedAt, now: manifest.now, requestsRecorded: urls.length, hostsRequested: [...new Set(urls.map((u) => new URL(u.url).hostname))].length,
  sourcesBefore: sourcesBefore.length, sourcesAfter: sourcesAfter.length, eventsBefore, eventsAfter, discovery: report, recheck, audit, evidenceHosts: inspections, passed, failed };
if (RECORD) {
  writeFileSync(join(root, "docs", "evidence", `discovery-${label}.json`), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`  recorded ${urls.length} responses from ${evidence.hostsRequested} hosts → ${dir}`);
}
// The human-readable cycle report: before/after sources + events, every rejected candidate with its reason.
{
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const perSourceEvents = (index, s) => activeEventsOf(index, [s]).length;
  const indexNow = await loadAreaIndex(area, NOW);
  const lines = [];
  lines.push(`# Discovery cycle — ${label.replace(/^live-/, "")}`, "", `Mode: ${RECORD ? "live recording" : "replay of recorded fixtures (no network)"}. Fixture label \`${label}\`, recorded ${manifest.recordedAt}, clock ${manifest.now}. ${urls.length} recorded responses from ${evidence.hostsRequested} hosts. Script: \`functions/scripts/discovery-e2e.mjs\` (${passed} passed, ${failed} failed).`, "");
  lines.push("## Before / after", "", "| Measure | Before | After |", "| --- | ---: | ---: |", `| Active sources | ${sourcesBefore.length} | ${sourcesAfter.length} |`, `| Active events | ${eventsBefore} | ${eventsAfter} |`, "");
  lines.push(`Origins: ${Object.entries(report.origins).map(([k, v]) => `${k} ${v}`).join(", ")}; queued ${JSON.stringify(report.queued)}; inspected ${report.inspected} (budget ${report.budget.usedToday}/${report.budget.perDay}); OSM ${report.osm ? `${report.osm.count} organisations (${report.osm.cached ? "cached" : "fetched"})` : `unavailable: ${report.osmError}`}.`, "");
  lines.push("### Sources after the cycle", "", "| Source | Type | Origin | Status | Active events | Terms basis |", "| --- | --- | --- | --- | ---: | --- |");
  for (const s of sourcesAfter) lines.push(`| ${s.id} | ${s.type} | ${s.origin} | ${s.status}${sourcesBefore.some((b) => b.id === s.id) ? "" : " (NEW)"} | ${perSourceEvents(indexNow, s)} | ${esc(s.decision?.terms?.basis ?? "")} |`);
  lines.push("", "### Activated with no human action", "", ...(report.activated.length ? report.activated.map((id) => `- \`${id}\``) : ["- none"]), "");
  lines.push("## Every rejected candidate and why", "", "| Host | Failed rules | Evidence |", "| --- | --- | --- |");
  for (const r of report.rejected) lines.push(`| ${r.host} | ${r.failed.join(", ")} | ${r.failed.map((f) => `${f}: ${esc(r.evidence[f]).slice(0, 220)}`).join("<br>")} |`);
  if (report.unknown.length) lines.push("", "Undetermined (re-inspected weekly, never activated): " + report.unknown.map(esc).join("; "));
  if (report.skipped.length) lines.push("", "Skipped (already a source or removed): " + report.skipped.map(esc).join("; "));
  lines.push("", "## Audit: active sources failing any rule", "", audit.length ? audit.map((a) => `- ${a.id}: ${a.failing.join(", ")}`).join("\n") : "none (the audit query returned an empty set)", "");
  lines.push("## Named evidence hosts", "", "| Host | Platform / adapter | Verdict | Failed | Robots | Terms |", "| --- | --- | --- | --- | --- | --- |");
  for (const [h, i] of Object.entries(inspections)) lines.push(`| ${h} | ${i.platform} / ${i.adapter ?? "none"} | ${i.verdict} | ${i.failed.join(", ") || "—"} | ${esc(i.robots.evidence).slice(0, 120)} | ${esc(i.terms.evidence).slice(0, 220)} |`);
  lines.push("", `Weekly re-check: ${recheck.checked} checked, paused ${JSON.stringify(recheck.paused)}, errors ${JSON.stringify(recheck.errors)}.`, "");
  writeFileSync(join(root, "docs", "evidence", `discovery-cycle-${label.replace(/^live-/, "")}.md`), lines.join("\n") + "\n");
}
console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed ? 1 : 0);
