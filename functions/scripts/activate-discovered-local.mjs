// CAC 2026 (1.1 cause 5) — add the sources the recorded discovery cycle activated to the LOCAL data emulator.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/activate-discovered-local.mjs [report.json]
//
// Replays the recorded discovery fixtures (test-fixtures/discovery/<MANIFEST label>) through the real
// pipeline on the running emulator: the same candidates (corpus links, OpenStreetMap organisations,
// the model URL list), the same six rules, the same adapters. Whatever is activated is then ingested
// from the recorded feed answers. No network. Refuses anything but a loopback emulator.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):\d+$/, "emulator only");
process.env.GCLOUD_PROJECT ||= "connectify-19dd8";
process.env.FUNCTIONS_EMULATOR = "true";
const here = dirname(fileURLToPath(import.meta.url));
const FIX_ROOT = join(here, "..", "test-fixtures", "discovery");
const manifest = JSON.parse(readFileSync(join(FIX_ROOT, "MANIFEST.json"), "utf8"));
const dir = join(FIX_ROOT, manifest.label);
assert.ok(existsSync(dir), `recorded fixtures missing: ${dir}`);

const { SAN_JOSE } = await import("../lib/ingest/areas.js");
const { HostThrottle, replayFetch } = await import("../lib/discovery/http.js");
const { runDiscovery, hostsFromCorpus, enqueueCandidates } = await import("../lib/discovery/discover.js");
const { runSource, fetchSourcesIsolated } = await import("../lib/ingest/index.js");
const { seedSourcesFromConfig, loadActiveSources } = await import("../lib/ingest/sources-registry.js");
const { loadAreaIndex } = await import("../lib/ingest/store.js");
const { db } = await import("../lib/common.js");

const now = new Date(manifest.now);
const fetchImpl = replayFetch(dir, () => new Response("", { status: 404 }));
const throttle = new HostThrottle(0);
await seedSourcesFromConfig();
const before = (await loadActiveSources(SAN_JOSE.id)).map((s) => s.id);
const corpusHosts = hostsFromCorpus(await loadAreaIndex(SAN_JOSE, now), SAN_JOSE.id, SAN_JOSE);
await enqueueCandidates(corpusHosts);
const report = await runDiscovery(SAN_JOSE, { fetchImpl, throttle, now, maxInspections: manifest.maxInspections, concurrency: 32 });
console.log(JSON.stringify({ inspected: report.inspected, activated: report.activated, rejected: report.rejected.length, unknown: report.unknown, osmError: report.osmError ?? null }));
const ingest = [];
const types = new Set();
for (const id of report.activated) types.add((await db.doc(`sources/${id}`).get()).data()?.type);
for (const type of types) {
  if (!type) continue;
  const out = await fetchSourcesIsolated(type, SAN_JOSE, { ticketmaster: "", nps: "", serpapi: "" }, undefined, fetchImpl);
  const r = await runSource(type, SAN_JOSE, { ticketmaster: "", nps: "", serpapi: "" }, out.records);
  ingest.push({ type, fetched: out.records.length, created: r.created, updated: r.updated, rejected: r.rejected, failures: out.failures });
  console.log(JSON.stringify(ingest.at(-1)));
}
const after = (await loadActiveSources(SAN_JOSE.id)).map((s) => s.id);
const out = { ranAt: new Date().toISOString(), fixtures: manifest.label, activeSourcesBefore: before.length, activeSourcesAfter: after.length, newSources: after.filter((id) => !before.includes(id)), discovery: { inspected: report.inspected, activated: report.activated, rejected: report.rejected.map((r) => ({ host: r.host, failed: r.failed })), unknown: report.unknown }, ingest };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + "\n");
console.log(`active sources ${before.length} → ${after.length}; new: ${out.newSources.join(", ") || "none"}`);
process.exit(0);
