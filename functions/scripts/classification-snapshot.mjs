// D1: capture public feed responses once, then replay identical inputs offline.
// No Firebase credentials or database writes. Snapshot contains public data only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { SAN_JOSE } from "../lib/ingest/areas.js";
import { seedsOfType } from "../lib/ingest/sources-config.js";
import { enrichEvent } from "../lib/ingest/classify.js";
import { fetchBiblioCommons } from "../lib/ingest/sources/bibliocommons.js";
import { fetchLibCal } from "../lib/ingest/sources/libcal.js";
import { fetchLocalist } from "../lib/ingest/sources/localist.js";
import { fetchLiveWhale } from "../lib/ingest/sources/livewhale.js";
import { fetchMidpen } from "../lib/ingest/sources/midpen.js";
import { fetchLegistar } from "../lib/ingest/sources/legistar.js";

const [mode, path, reportPath] = process.argv.slice(2);
if (!["capture", "replay"].includes(mode) || !path || !reportPath) {
  throw new Error("Usage: classification-snapshot.mjs capture|replay snapshot.json.gz report.json");
}
const snapshot = mode === "replay" ? JSON.parse(gunzipSync(readFileSync(path)))
  : { capturedAt: new Date().toISOString(), responses: {} };
const capturedAt = new Date(snapshot.capturedAt);
// Replay the date window as captured, even after that date has passed.
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [snapshot.capturedAt])); }
  static now() { return capturedAt.getTime(); }
};
const realFetch = globalThis.fetch;
async function snapshotFetch(url, options) {
  const key = String(url);
  if (mode === "capture") {
    const response = await realFetch(url, options);
    const body = await response.text();
    snapshot.responses[key] = { status: response.status, body };
    return new Response(body, { status: response.status });
  }
  const saved = snapshot.responses[key];
  if (!saved) throw new Error(`Snapshot has no response for ${key}`);
  return new Response(saved.body, { status: saved.status });
}
// Midpen's listing/detail helpers use global fetch as well as injected fetch.
globalThis.fetch = snapshotFetch;
const groups = [];
async function add(feed, call) {
  const raw = await call();
  const events = [...new Map(raw.map((e) => [`${e.source}:${e.sourceEventId}`, e])).values()]
    .filter((e) => e.start >= capturedAt);
  if (!events.length) throw new Error(`${feed}: no upcoming records`);
  groups.push({ feed, events });
  console.error(`${feed}: ${events.length} upcoming`);
}
for (const s of seedsOfType("bibliocommons", SAN_JOSE.id)) await add(s.params.name, () => fetchBiblioCommons(SAN_JOSE, s.params, snapshotFetch));
for (const s of seedsOfType("libcal", SAN_JOSE.id)) await add(s.params.name, () => fetchLibCal(SAN_JOSE, s.params, snapshotFetch));
for (const f of SAN_JOSE.localist) await add(f.name, () => fetchLocalist(SAN_JOSE, f.host, f.name, snapshotFetch));
for (const f of SAN_JOSE.livewhale) await add(f.name, () => fetchLiveWhale(SAN_JOSE, f.host, f.name, snapshotFetch, capturedAt));
for (const f of SAN_JOSE.midpen) await add(f.name, () => fetchMidpen(SAN_JOSE, f, snapshotFetch));
for (const f of SAN_JOSE.legistar) await add(f.name, () => fetchLegistar(SAN_JOSE, f.client, f.name, snapshotFetch));
const records = groups.flatMap(({ feed, events }) => events.map((event) => ({ feed, event,
  prediction: enrichEvent(event) })));
const stats = (rows) => {
  const low = rows.filter((r) => r.prediction.classificationConfidence < 0.65);
  const reasons = {};
  const tags = {};
  for (const { event } of low) {
    const reason = event.tags.length ? "unmapped-activity-metadata" : "missing-activity-metadata";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    for (const tag of event.eventTypes ?? event.tags) tags[tag] = (tags[tag] ?? 0) + 1;
  }
  return { total: rows.length, low: low.length, share: low.length / rows.length,
    reasons, unmappedTags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 25),
    examples: low.slice(0, 20).map(({ event }) => ({ title: event.title, tags: event.tags })) };
};
const report = { capturedAt: snapshot.capturedAt,
  sourceSnapshotSHA256: createHash("sha256").update(JSON.stringify(snapshot.responses)).digest("hex"),
  missingSources: ["ticketmaster (private API key)", "serpapi (private API key/quota)"],
  overall: stats(records),
  bySource: Object.fromEntries([...new Set(records.map((r) => r.event.source))]
    .map((source) => [source, stats(records.filter((r) => r.event.source === source))])),
  byFeed: Object.fromEntries(groups.map(({ feed }) => [feed, stats(records.filter((r) => r.feed === feed))])),
  records };
mkdirSync(new URL("../../docs/audits/", import.meta.url), { recursive: true });
if (mode === "capture") writeFileSync(path, gzipSync(JSON.stringify(snapshot)));
writeFileSync(reportPath.replace(/\.json$/, "-records.json.gz"), gzipSync(JSON.stringify(records)));
writeFileSync(reportPath, JSON.stringify({ ...report, records: undefined }, null, 2) + "\n");
console.log(JSON.stringify({ ...report, records: undefined }, null, 2));
