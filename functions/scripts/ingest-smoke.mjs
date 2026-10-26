// Live smoke test for the ingestion fetchers — READ-ONLY, no Firestore writes.
//
//   TICKETMASTER_KEY=... NPS_API_KEY=... node scripts/ingest-smoke.mjs
//
// Proves each source that remains in the tree actually returns real data for
// the launch area today (Part 2 §1 "done when": every provider remaining can be
// demonstrated returning real data). SerpApi is deliberately NOT called here —
// every call spends monthly quota — its mapper is covered by unit tests.
//
// Prints one line per source: count, a sample title, and how many records
// carry coordinates. Exit code 1 if any configured source returns zero.

import { SAN_JOSE, isInsideArea } from "../lib/ingest/areas.js";
import { enrichEvent } from "../lib/ingest/classify.js";
import { fetchTicketmaster } from "../lib/ingest/sources/ticketmaster.js";
import { fetchIcsFeed } from "../lib/ingest/sources/icsfeed.js";
import { fetchLibCal } from "../lib/ingest/sources/libcal.js";
import { fetchBiblioCommons } from "../lib/ingest/sources/bibliocommons.js";
import { fetchMidpen } from "../lib/ingest/sources/midpen.js";
import { fetchLocalist } from "../lib/ingest/sources/localist.js";
import { fetchLiveWhale } from "../lib/ingest/sources/livewhale.js";
import { fetchLegistar } from "../lib/ingest/sources/legistar.js";
import { fetchNps } from "../lib/ingest/sources/nps.js";
import { seedsOfType } from "../lib/ingest/sources-config.js";

const area = SAN_JOSE;
let failures = 0;

function report(name, records) {
  const withCoords = records.filter((r) => typeof r.latitude === "number").length;
  const free = records.filter((r) => r.isFree).length;
  const sample = records[0] ? `"${records[0].title}" @ ${records[0].locationName} (${records[0].start.toISOString().slice(0, 16)})` : "—";
  const cats = {};
  for (const r of records) cats[r.category] = (cats[r.category] ?? 0) + 1;
  console.log(`${records.length ? "✅" : "❌"} ${name}: ${records.length} events, ${withCoords} with coords, ${free} free · ${sample}`);
  console.log(`     categories: ${JSON.stringify(cats)}`);
  const now = Date.now();
  const next30Days = now + 30 * 86_400_000;
  const inRadius = records.filter((r) => r.latitude != null && r.longitude != null &&
    isInsideArea(area, r.latitude, r.longitude, 0) &&
    r.start.getTime() >= now && r.start.getTime() < next30Days);
  const volunteerCandidates = inRadius.filter((r) => enrichEvent(r).category === "Volunteer");
  console.log(`     preview only: ${inRadius.length} dated, geocoded records within ${area.radiusMiles} mi in 30 days; ` +
    `${volunteerCandidates.length} classified Volunteer before dedupe/human review`);
  if (!records.length) failures++;
}

async function run(name, fn) {
  try { report(name, await fn()); }
  catch (e) { failures++; console.log(`❌ ${name}: ${e.message}`); }
}

console.log(`── Live ingest smoke — ${area.name} (${area.radiusMiles} mi) ──`);
if (process.env.TICKETMASTER_KEY) {
  await run("ticketmaster", () => fetchTicketmaster(area, process.env.TICKETMASTER_KEY));
} else console.log("⏭  ticketmaster: TICKETMASTER_KEY not set");
for (const s of seedsOfType("libcal", area.id)) await run(`libcal · ${s.params.name}`, () => fetchLibCal(area, s.params));
for (const s of seedsOfType("bibliocommons", area.id)) await run(`bibliocommons · ${s.params.name}`, () => fetchBiblioCommons(area, s.params));
for (const s of seedsOfType("localist", area.id)) await run(`localist · ${s.params.name}`, () => fetchLocalist(area, s.params.host, s.params.name));
for (const s of seedsOfType("livewhale", area.id)) await run(`livewhale · ${s.params.name}`, () => fetchLiveWhale(area, s.params.host, s.params.name));
for (const s of seedsOfType("legistar", area.id)) await run(`legistar · ${s.params.name}`, () => fetchLegistar(area, s.params.client, s.params.name));
if (process.env.NPS_API_KEY && seedsOfType("nps", area.id).some((s) => s.params.parkCodes.length)) {
  await run("nps", () => fetchNps({ ...area, nps: { parkCodes: seedsOfType("nps", area.id).flatMap((s) => s.params.parkCodes) } }, process.env.NPS_API_KEY));
} else console.log("⏭  nps: NPS_API_KEY not set or no park codes in range");
for (const s of seedsOfType("midpen", area.id)) await run(`midpen · ${s.params.name}`, () => fetchMidpen(area, s.params));
for (const s of seedsOfType("ics", area.id)) await run(`ics · ${s.params.name}`, () => fetchIcsFeed(area, s.params, "ics"));

console.log(failures ? `\n${failures} source(s) returned nothing or failed` : "\nall configured sources returned real data");
process.exit(failures ? 1 : 0);
