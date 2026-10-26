// Read-only, reproducible stratified sample for the required human label audit.
// Sources requiring private API keys are reported missing, never fabricated.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SAN_JOSE } from "../lib/ingest/areas.js";
import { seedsOfType } from "../lib/ingest/sources-config.js";
import { enrichEvent } from "../lib/ingest/classify.js";
import { fetchBiblioCommons } from "../lib/ingest/sources/bibliocommons.js";
import { fetchLibCal } from "../lib/ingest/sources/libcal.js";
import { fetchLocalist } from "../lib/ingest/sources/localist.js";
import { fetchLiveWhale } from "../lib/ingest/sources/livewhale.js";
import { fetchMidpen } from "../lib/ingest/sources/midpen.js";
import { fetchLegistar } from "../lib/ingest/sources/legistar.js";

const args = process.argv.slice(2);
const snapshotPath = args.includes("--snapshot") ? args[args.indexOf("--snapshot") + 1] : null;
const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid sampling date");
const outputDir = new URL("../../docs/audits/", import.meta.url);
const groups = [];
async function add(name, call) {
  const records = await call();
  const unique = new Map(records.map((r) => [`${r.source}:${r.sourceEventId}`, r]));
  const sorted = [...unique.values()]
    .filter((r) => r.start.getTime() >= Date.now() - 86_400_000)
    .sort((a, b) => {
      const hash = (r) => createHash("sha256").update(`${date}:${r.source}:${r.sourceEventId}`).digest("hex");
      return hash(a).localeCompare(hash(b));
    });
  if (!sorted.length) throw new Error(`${name} yielded no current records`);
  groups.push({ name, records: sorted, total: sorted.length });
  console.log(`${name}: ${sorted.length} available`);
}

if (snapshotPath) {
  const records = JSON.parse(gunzipSync(readFileSync(snapshotPath)));
  for (const name of [...new Set(records.map((r) => r.feed))]) {
    const events = records.filter((r) => r.feed === name).map(({ event }) => ({ ...event,
      start: new Date(event.start), end: event.end ? new Date(event.end) : undefined }));
    const hash = (r) => createHash("sha256").update(`${date}:${r.source}:${r.sourceEventId}`).digest("hex");
    groups.push({ name, records: events.sort((a, b) => hash(a).localeCompare(hash(b))), total: events.length });
  }
} else {
for (const s of seedsOfType("bibliocommons", SAN_JOSE.id)) await add(s.params.name, () => fetchBiblioCommons(SAN_JOSE, s.params));
for (const s of seedsOfType("libcal", SAN_JOSE.id)) await add(s.params.name, () => fetchLibCal(SAN_JOSE, s.params));
for (const feed of SAN_JOSE.localist) await add(feed.name, () => fetchLocalist(SAN_JOSE, feed.host, feed.name));
for (const feed of SAN_JOSE.livewhale) await add(feed.name, () => fetchLiveWhale(SAN_JOSE, feed.host, feed.name));
for (const feed of SAN_JOSE.midpen) await add(feed.name, () => fetchMidpen(SAN_JOSE, feed));
for (const feed of SAN_JOSE.legistar) await add(feed.name, () => fetchLegistar(SAN_JOSE, feed.client, feed.name));
}

const selected = [];
let round = 0;
while (selected.length < 200 && groups.some((group) => round < group.records.length)) {
  for (const group of groups) {
    const event = group.records[round];
    if (event && selected.length < 200) selected.push({ feed: group.name, event });
  }
  round++;
}
const rows = selected.map(({ feed, event }) => {
  const enriched = enrichEvent(event);
  return {
    feed, source: event.source, sourceEventId: event.sourceEventId,
    sourceURL: event.website ?? "", startUTC: event.start.toISOString(),
    venue: event.locationName, title: event.title, description: event.description,
    tags: event.tags.join(" | "), priorCategory: event.category,
    eventTypes: (event.eventTypes ?? []).join(" | "), audiences: (event.audiences ?? []).join(" | "),
    predictedCategory: enriched.category,
    predictedLabels: enriched.categories.join(" | "),
    confidence: enriched.classificationConfidence,
    inferredCost: enriched.inferredCost, ageSuitability: enriched.ageSuitability,
    reviewerCategory: "", reviewerLabels: "", labelCorrect: "", reviewerNotes: "",
  };
});
const quote = (value) => `"${String(value ?? "").replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;
mkdirSync(outputDir, { recursive: true });
const path = new URL(`classification-sample-${date}.csv`, outputDir);
writeFileSync(path, [Object.keys(rows[0]).map(quote).join(","),
  ...rows.map((row) => Object.values(row).map(quote).join(","))].join("\n") + "\n");
console.log(JSON.stringify({ date, selected: rows.length,
  byFeed: Object.fromEntries(groups.map((group) => [group.name,
    { available: group.total, selected: rows.filter((row) => row.feed === group.name).length }])),
  missingSources: ["ticketmaster (API key unavailable)", "serpapi (quota-capped API key unavailable)"],
  output: path.pathname }, null, 2));
