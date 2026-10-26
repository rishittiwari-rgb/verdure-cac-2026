// Read-only public-feed snapshot for a human ranking review. This is a
// preproduction review aid, never a substitute for the live Firestore corpus.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { SAN_JOSE, isInsideArea } from "../lib/ingest/areas.js";
import { enrichEvent } from "../lib/ingest/classify.js";
import { eventDocId, titleKey, venueKey } from "../lib/ingest/normalize.js";
import { fetchBiblioCommons } from "../lib/ingest/sources/bibliocommons.js";
import { fetchLibCal } from "../lib/ingest/sources/libcal.js";
import { fetchLocalist } from "../lib/ingest/sources/localist.js";
import { fetchLiveWhale } from "../lib/ingest/sources/livewhale.js";
import { fetchMidpen } from "../lib/ingest/sources/midpen.js";
import { fetchLegistar } from "../lib/ingest/sources/legistar.js";
import { fetchIcsFeed } from "../lib/ingest/sources/icsfeed.js";
import { seedsOfType } from "../lib/ingest/sources-config.js";

const area = SAN_JOSE;
const snapshotAtMs = Date.now();
const date = new Date(snapshotAtMs).toISOString().slice(0, 10);
const endMs = snapshotAtMs + 30 * 86_400_000;
const groups = [];
async function add(name, fetcher) {
  const records = await fetcher();
  if (!records.length) throw new Error(`${name} returned no events`);
  groups.push({ name, records });
  console.log(`${name}: ${records.length} raw`);
}
for (const s of seedsOfType("bibliocommons", area.id)) await add(s.params.name, () => fetchBiblioCommons(area, s.params));
for (const s of seedsOfType("libcal", area.id)) await add(s.params.name, () => fetchLibCal(area, s.params));
for (const s of seedsOfType("localist", area.id)) await add(s.params.name, () => fetchLocalist(area, s.params.host, s.params.name));
for (const s of seedsOfType("livewhale", area.id)) await add(s.params.name, () => fetchLiveWhale(area, s.params.host, s.params.name));
for (const s of seedsOfType("midpen", area.id)) await add(s.params.name, () => fetchMidpen(area, s.params));
for (const s of seedsOfType("legistar", area.id)) await add(s.params.name, () => fetchLegistar(area, s.params.client, s.params.name));
for (const s of seedsOfType("ics", area.id)) await add(s.params.name, () => fetchIcsFeed(area, s.params, "ics"));

const bySourceId = new Map();
for (const group of groups) for (const rec of group.records) {
  const startMs = rec.start.getTime();
  if (startMs < snapshotAtMs || startMs >= endMs || rec.latitude == null || rec.longitude == null ||
      !isInsideArea(area, rec.latitude, rec.longitude, 0) || !rec.website) continue;
  bySourceId.set(`${rec.source}:${rec.sourceEventId}`, rec);
}

// Round-hour/title/venue duplicates are withheld from this REVIEW packet only.
// The production duplicate-rate gate still needs a real ingest-cycle audit.
const byOccurrence = new Map();
for (const rec of bySourceId.values()) {
  const key = `${titleKey(rec.title)}|${Math.floor(rec.start.getTime() / 3_600_000)}|` +
    `${venueKey(rec.locationName) || `${rec.latitude.toFixed(3)},${rec.longitude.toFixed(3)}`}`;
  if (!byOccurrence.has(key)) byOccurrence.set(key, rec);
}

const byCategory = new Map();
for (const rec of byOccurrence.values()) {
  const enriched = enrichEvent(rec);
  const list = byCategory.get(enriched.category) ?? [];
  list.push(enriched);
  byCategory.set(enriched.category, list);
}
const selected = [];
for (const [category, records] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
  const stable = records.sort((a, b) => {
    const hash = (rec) => createHash("sha256").update(`${date}:${rec.source}:${rec.sourceEventId}`).digest("hex");
    return hash(a).localeCompare(hash(b));
  });
  selected.push(...stable.slice(0, 35));
  console.log(`${category}: ${records.length} available, ${Math.min(35, records.length)} selected`);
}
const events = selected.map((rec) => ({
  id: eventDocId(rec.source, rec.sourceEventId),
  source: rec.source, sourceEventId: rec.sourceEventId, sourceURL: rec.website,
  title: rec.title, description: rec.description, locationName: rec.locationName,
  category: rec.category, organizer: rec.organizer,
  latitude: rec.latitude, longitude: rec.longitude,
  startMs: rec.start.getTime(), endMs: rec.end?.getTime(),
  tags: rec.categories, qualityScore: rec.qualityScore,
  ageSuitability: rec.ageSuitability,
}));
const corpusHash = createHash("sha256").update(JSON.stringify(events)).digest("hex");
const corpus = {
  kind: "public-source-review-preview", areaId: area.id, snapshotAtMs,
  windowDays: 30, radiusMiles: area.radiusMiles, corpusHash,
  missingSources: ["Ticketmaster (key unavailable)", "SerpApi (quota-capped; excluded)"],
  raw: groups.reduce((n, group) => n + group.records.length, 0),
  inRadius: bySourceId.size, uniqueOccurrencePreview: byOccurrence.size,
  events,
};
const outDir = new URL("../../docs/audits/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const out = new URL(`rank-corpus-preview-${date}.json`, outDir);
writeFileSync(out, JSON.stringify(corpus, null, 2) + "\n");
console.log(JSON.stringify({ output: out.pathname, raw: corpus.raw,
  inRadius: corpus.inRadius, uniqueOccurrencePreview: corpus.uniqueOccurrencePreview,
  selected: events.length, corpusHash }, null, 2));
