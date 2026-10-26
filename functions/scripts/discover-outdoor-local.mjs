/**
 * Outdoor/nature source discovery on the LOCAL emulator, through the existing pipeline only.
 *
 * Takes the OpenStreetMap organisations the discovery origin already queries (parks,
 * nature reserves, gardens, plus organisations whose names say park / open space /
 * preserve / trail / nature / garden / land trust / conservancy / creek / watershed /
 * audubon / farm), queues them with enqueueCandidates, and lets runDiscovery inspect them
 * with its own robots.txt, terms, machine-readability and real-events rules, per-host
 * throttle and daily budget. Sources it activates are ingested with the existing adapters
 * (runSource). Nothing is written anywhere but the emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/discover-outdoor-local.mjs [report.json]
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899", "emulator only");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { SAN_JOSE } = await import("../lib/ingest/areas.js");
const D = await import("../lib/discovery/discover.js");
const { runSource } = await import("../lib/ingest/index.js");
const { db } = await import("../lib/common.js");

const OUTDOOR_KINDS = new Set(["leisure=park", "leisure=nature_reserve", "leisure=garden"]);
const OUTDOOR_NAME = /\b(parks?|open space|preserves?|trails?|nature|gardens?|land trust|conservancy|creek|watershed|audubon|wildlife|botanic(al)?|arboretum|farm|ranch|outdoors?|hiking|environmental)\b/i;

const report = { startedAt: new Date().toISOString() };
const { orgs, cached, fetchedAt } = await D.osmOrganizations(SAN_JOSE, {});
report.osm = { orgs: orgs.length, cached, fetchedAt };
const outdoorOrgs = orgs.filter((o) => OUTDOOR_KINDS.has(o.kind) || OUTDOOR_NAME.test(o.name));
const candidates = D.hostsFromOsm(outdoorOrgs, SAN_JOSE);
report.outdoorOrgs = outdoorOrgs.length;
report.queued = await D.enqueueCandidates(candidates);
console.log(JSON.stringify({ osm: report.osm, outdoorOrgs: report.outdoorOrgs, candidates: candidates.length, queued: report.queued }));

const discovery = await D.runDiscovery(SAN_JOSE, { origins: [] });
report.discovery = { inspected: discovery.inspected, activated: discovery.activated, rejected: discovery.rejected.length,
  unknown: discovery.unknown.length, skipped: discovery.skipped.length, budget: discovery.budget };
console.log(JSON.stringify(report.discovery));

// Ingest what discovery activated, with the adapters it chose.
const types = new Set();
for (const id of discovery.activated) {
  const s = (await db.collection("sources").doc(id).get()).data();
  if (s?.type) types.add(s.type);
}
report.ingest = [];
for (const type of types) {
  const r = await runSource(type, SAN_JOSE, {});
  report.ingest.push(r);
  console.log(JSON.stringify({ type, fetched: r.fetched, written: r.written, errors: r.errors?.length }));
}
report.rejectedHosts = discovery.rejected.map((r) => ({ host: r.host, failed: r.failed }));
report.finishedAt = new Date().toISOString();
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
process.exit(0);
