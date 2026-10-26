// Ingest write-path E2E — runs the REAL upsertBatch/markStale against a
// disposable Firestore emulator, with no network and no functions emulator.
//
//   cd functions && npm run e2e:ingest
//
// Proves W1 end to end: annotation on every stored event, John's blocking
// listing checks writing /rejectedListings, the fuzzy second-pass merge, and
// write-only-what-changed — including the one property the whole sprint must
// not break: a cancelled event still goes inactive on schedule (STALE_CYCLES).

import { EMULATORS } from "./local-emulator-targets.mjs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, WriteBatch, DocumentReference } from "firebase-admin/firestore";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) throw new Error("Refusing to run outside the local emulator.");
void EMULATORS;
initializeApp({ projectId: "connectify-19dd8" });
const db = getFirestore();
const { SAN_JOSE } = await import("../lib/ingest/areas.js");
const { runSource } = await import("../lib/ingest/index.js");
const { STALE_CYCLES } = await import("../lib/ingest/store.js");

let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.error(`  ❌ ${name} ${extra}`); } };
const area = SAN_JOSE;
const DAY = 86_400_000;
const soon = (days, hours = 18) => new Date(Date.UTC(2026, 9, 25 + days, hours, 0, 0));
const branch = { locationName: "Biblioteca Latinoamericana Branch Library", latitude: 37.3284, longitude: -121.8862 };
const rec = (over) => ({ source: "bibliocommons", sourceEventId: "x", areaId: area.id, title: "Teen Chess Club", description: "Drop in and play.",
  organizer: "San José Public Library", start: soon(7), time: "11:00 AM", category: "Social", isFree: true, tags: ["library"], audiences: ["Teens, ages 12-18"], ...branch, ...over });
const docOf = async (id) => (await db.doc(`events/${id}`).get()).data();
const writesOf = (r) => r.writes;
// Real writes, counted at the SDK boundary per collection, so IngestResult.writes is cross-checked rather than trusted.
const realWrites = {};
const countWrite = (ref) => { const col = String(ref?.path ?? "").split("/")[0] || "?"; realWrites[col] = (realWrites[col] ?? 0) + 1; };
for (const name of ["set", "update", "delete", "create"]) {
  const b = WriteBatch.prototype[name]; WriteBatch.prototype[name] = function (ref, ...rest) { countWrite(ref); return b.call(this, ref, ...rest); };
  const d = DocumentReference.prototype[name]; DocumentReference.prototype[name] = function (...rest) { countWrite(this); return d.apply(this, rest); };
}
const eventWrites = () => (realWrites.events ?? 0) + (realWrites.rejectedListings ?? 0);
const resetWrites = () => { for (const k of Object.keys(realWrites)) delete realWrites[k]; };

console.log("── W1: write path on the emulator ──");
// Freeze the ingest clock so "within 24 hours" and staleness are deterministic across runs.
let clock = Date.parse("2026-10-20T15:00:00Z");
const realNow = Date.now;
Date.now = () => clock;

const records = [
  rec({ sourceEventId: "chess-1" }),
  rec({ sourceEventId: "story-1", title: "Toddler Storytime", description: "Songs and stories for ages 1-3.", audiences: ["Young Children, ages 0-5"], start: soon(3, 17) }),
  rec({ sourceEventId: "adult-1", title: "Crochet & Knitting Club", description: "Bring yarn.", audiences: ["Adults, ages 18+"], start: soon(4) }),
  rec({ sourceEventId: "beer-1", title: "Research & Brew", description: "A showcase of research (and beer!).", audiences: [], start: soon(5) }),
  rec({ sourceEventId: "cancel-1", title: "CANCELED -- Let's Create", start: soon(6) }),            // blocking: cancelled
  rec({ sourceEventId: "past-1", title: "Yesterday's Program", start: new Date(clock - 2 * DAY) }),  // blocking: already_ended
  rec({ sourceEventId: "far-1", title: "Sacramento Reading", latitude: 38.58, longitude: -121.49, start: soon(8) }), // blocking: outside_region
  rec({ sourceEventId: "noloc-1", title: "Mystery Location", locationName: "Location TBA", latitude: undefined, longitude: undefined, start: soon(9) }), // blocking: missing_location_in_person
];
resetWrites();
const runA = await runSource("bibliocommons", area, {}, records);
ok("run A: the self-reported write count equals the real /events + /rejectedListings writes at the SDK boundary", eventWrites() === writesOf(runA) && eventWrites() === 8, JSON.stringify(realWrites));
ok("run A creates the four valid listings", runA.created === 4, JSON.stringify(runA));
ok("run A rejects four listings with John's blocking reasons", runA.rejected === 4 &&
   runA.rejectedByReason.cancelled === 1 && runA.rejectedByReason.already_ended === 1 && runA.rejectedByReason.outside_region === 1 && runA.rejectedByReason.missing_location_in_person === 1, JSON.stringify(runA.rejectedByReason));
ok("run A writes = 4 events + 4 rejected rows", writesOf(runA) === 8, String(writesOf(runA)));
const chess = await docOf("bibliocommons-chess-1");
ok("every stored event carries adultOnly (boolean), adultOnlyReason, topicTags and contentHash",
   chess?.adultOnly === false && chess.adultOnlyReason === null && Array.isArray(chess.topicTags) && typeof chess.contentHash === "string", JSON.stringify({ a: chess?.adultOnly, t: chess?.topicTags }));
ok("structured 'Adults, ages 18+' is adultOnly with the structured reason", (await docOf("bibliocommons-adult-1"))?.adultOnly === true && (await docOf("bibliocommons-adult-1"))?.adultOnlyReason === "structured-age-limit");
ok("'(and beer!)' is adultOnly for alcohol; a toddler storytime is not",
   (await docOf("bibliocommons-beer-1"))?.adultOnly === true && (await docOf("bibliocommons-beer-1"))?.adultOnlyReason === "alcohol" && (await docOf("bibliocommons-story-1"))?.adultOnly === false);
ok("topicTags: the storytime is tagged kids; the chess club (no keyword hit) carries exactly the library default ['community']",
   (await docOf("bibliocommons-story-1"))?.topicTags.includes("kids") && (await docOf("bibliocommons-chess-1"))?.topicTags.includes("sports") === false);
const rejectedRows = await db.collection("rejectedListings").get();
ok("rejected listings land in /rejectedListings with reasons, source and a 30-day expiry", rejectedRows.size === 4 &&
   rejectedRows.docs.every((d) => Array.isArray(d.data().reasons) && d.data().source === "bibliocommons" && d.data().expiresAt.toMillis() - clock > 29 * DAY));
ok("rejected listings never reach /events", !(await db.doc("events/bibliocommons-cancel-1").get()).exists && !(await db.doc("events/bibliocommons-far-1").get()).exists);

// Run B: identical records, two hours later → no event writes, no rejected rewrites.
clock += 2 * 3_600_000;
resetWrites();
const runB = await runSource("bibliocommons", area, {}, records);
ok("run B (nothing changed) rewrites nothing: 4 unchanged, 0 updated", runB.unchanged === 4 && runB.updated === 0 && runB.created === 0, JSON.stringify(runB));
ok("run B issues zero document writes (rejections were already recorded)", writesOf(runB) === 0, String(writesOf(runB)));
ok("run B: zero REAL writes to /events and /rejectedListings at the SDK boundary (only per-source bookkeeping documents were written)", eventWrites() === 0, JSON.stringify(realWrites));
ok("run B marks nothing stale: unchanged sightings still count as seen", runB.markedStale === 0 && (await docOf("bibliocommons-chess-1"))?.missedCycles === 0);

// Run C: one description changes → exactly one write.
clock += 3_600_000;
const changed = records.map((r) => r.sourceEventId === "chess-1" ? { ...r, description: "Drop in and play. Boards provided." } : r);
const runC = await runSource("bibliocommons", area, {}, changed);
ok("a changed description is written once and the hash moves", runC.updated === 1 && runC.unchanged === 3 && writesOf(runC) === 1 &&
   (await docOf("bibliocommons-chess-1"))?.contentHash !== chess.contentHash && (await docOf("bibliocommons-chess-1"))?.description.includes("Boards"), JSON.stringify(runC));

// Run D: 25 hours later, unchanged → lastSeenAt refresh writes (once a day), not hourly.
clock += 25 * 3_600_000;
const runD = await runSource("bibliocommons", area, {}, changed);
ok("after 24 h an unchanged event is refreshed once (lastSeenAt stays fresh to the day)", runD.updated === 4 && runD.unchanged === 0, JSON.stringify(runD));

// Staleness must behave exactly as before: drop chess-1 from the feed and run STALE_CYCLES times.
const without = changed.filter((r) => r.sourceEventId !== "chess-1");
const staleRuns = [];
for (let i = 1; i <= STALE_CYCLES; i++) {
  clock += 3_600_000;
  const run = await runSource("bibliocommons", area, {}, without);
  staleRuns.push(run);
  const d = await docOf("bibliocommons-chess-1");
  if (i < STALE_CYCLES) ok(`cancelled event missed ${i}x: missedCycles ${i}, still active`, run.markedStale === 1 && d.missedCycles === i && d.active === true, JSON.stringify({ run, d: { m: d.missedCycles, a: d.active } }));
  else ok(`cancelled event goes inactive on the ${STALE_CYCLES}rd missed cycle, on schedule`, run.deactivated === 1 && d.active === false && d.missedCycles === STALE_CYCLES && d.inactiveAt, JSON.stringify({ run }));
}
ok("the other unchanged events were not rewritten during the staleness runs (hash, lastSeenAt and contentHash untouched; only the stale one was written)",
   (await docOf("bibliocommons-story-1"))?.missedCycles === 0 && staleRuns.every((r) => writesOf(r) === 1 && r.updated === 0 && r.unchanged === 3), JSON.stringify(staleRuns.map(writesOf)));

// Reinstated event reattaches to its document and is written (active again).
clock += 3_600_000;
const runE = await runSource("bibliocommons", area, {}, changed);
ok("a reinstated event reattaches and is reactivated with one write", runE.updated >= 1 && (await docOf("bibliocommons-chess-1"))?.active === true && (await docOf("bibliocommons-chess-1"))?.missedCycles === 0);

// Fuzzy second pass: a second feed lists the storytime as "Storytime: Toddlers" ten minutes later at the same branch.
clock += 3_600_000;
const fuzzy = await runSource("libcal", area, {}, [rec({ source: "libcal", sourceEventId: "mv-story-9", title: "Storytime: Toddlers", organizer: "Mountain View Public Library",
  description: "Stories for toddlers.", audiences: [], start: new Date(soon(3, 17).getTime() + 10 * 60_000) })]);
const storyDoc = await docOf("bibliocommons-story-1");
ok("fuzzy pass merges 'Storytime: Toddlers' into 'Toddler Storytime' (one document, two sources)", fuzzy.merged === 1 && fuzzy.fuzzyMerged === 1 && fuzzy.created === 0 &&
   storyDoc.sourceKeys.includes("libcal:mv-story-9") && storyDoc.sources.length === 2, JSON.stringify({ fuzzy, keys: storyDoc?.sourceKeys }));
ok("a merged listing keeps the richer primary title and stays non-adult", storyDoc.title === "Toddler Storytime" && storyDoc.adultOnly === false);
ok("the merged secondary is 'seen' next run without a write", (await runSource("libcal", area, {}, [rec({ source: "libcal", sourceEventId: "mv-story-9", title: "Storytime: Toddlers",
  organizer: "Mountain View Public Library", description: "Stories for toddlers.", audiences: [], start: new Date(soon(3, 17).getTime() + 10 * 60_000) })])).unchanged === 1);
ok("a different event in the same hour is NOT merged (Jaccard below 0.7)", (await runSource("libcal", area, {}, [rec({ source: "libcal", sourceEventId: "mv-chess-2", title: "Adult Chess Night",
  organizer: "Mountain View Public Library", audiences: [], start: soon(7) })])).created === 1);

// Same-source duplicate: the second record merges in and must NOT take over the document's title on later runs.
clock += 3_600_000;
const sameSource = [rec({ sourceEventId: "chess-1", description: "Drop in and play. Boards provided." }), rec({ sourceEventId: "chess-dup", title: "Chess Club for Teens", start: new Date(soon(7).getTime() + 5 * 60_000) })];
const dupRun = await runSource("bibliocommons", area, {}, sameSource);
const chessAfterDup = await docOf("bibliocommons-chess-1");
ok("a same-source near-duplicate merges into the existing document (two source keys, one document)", dupRun.merged === 1 && chessAfterDup.sourceKeys.includes("bibliocommons:chess-dup") && !(await db.doc("events/bibliocommons-chess-dup").get()).exists, JSON.stringify(dupRun));
clock += 3_600_000;
const dupRun2 = await runSource("bibliocommons", area, {}, sameSource);
ok("on the next run the merged duplicate is secondary: the title does not flip and nothing is rewritten", dupRun2.unchanged === 2 && dupRun2.updated === 0 && (await docOf("bibliocommons-chess-1")).title === "Teen Chess Club", JSON.stringify(dupRun2));

// A secondary feed's adultOnly=true must survive the primary's 24-hour refresh.
clock += 3_600_000;
await runSource("libcal", area, {}, [rec({ source: "libcal", sourceEventId: "mv-chess-adult", title: "Teen Chess Club", organizer: "Mountain View Public Library", description: "Adults 21 and over only tonight.", audiences: [], start: soon(7) })]);
ok("a secondary feed that says 21+ flags the merged document", (await docOf("bibliocommons-chess-1")).adultOnly === true);
clock += 25 * 3_600_000;
const primaryRefresh = await runSource("bibliocommons", area, {}, sameSource);
ok("the primary's daily refresh keeps the merged adultOnly=true and its reason", primaryRefresh.updated >= 1 && (await docOf("bibliocommons-chess-1")).adultOnly === true && (await docOf("bibliocommons-chess-1")).adultOnlyReason === "age-limit");

// Backfill: a legacy document without the new fields gains them; a second pass proposes nothing.
await db.doc("events/legacy-1").set({ title: "Wine Tasting Evening", description: "Local wines.", organizer: "Legacy Org", date: soon(10), time: "6 PM", locationName: "Hall",
  attendeeCount: 0, category: "Social", imagePlaceholder: "cup.and.saucer.fill", pointValue: 100, creatorID: "system:ingest", hidden: false, broadcast: true, active: true,
  source: "ics", sourceEventId: "legacy-1", sourceKeys: ["ics:legacy-1"], sources: [{ source: "ics", sourceEventId: "legacy-1" }], areaId: area.id, tags: [], categories: ["Social"],
  classificationConfidence: 0.6, qualityScore: 0.5, inferredCost: "unknown", ageSuitability: "unknown", endInferred: true, ingestedAt: new Date(clock), lastSeenAt: new Date(clock), missedCycles: 0 });
Date.now = realNow;
const backfill = (args) => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./backfill-annotate.mjs", import.meta.url)), ...args], { encoding: "utf8", env: process.env, maxBuffer: 8_000_000 });
  const out = run.stdout ?? "";
  const json = out.slice(out.indexOf("{"));
  if (run.status !== 0 || !json.trim()) throw new Error(`backfill-annotate failed (${run.status}): ${(run.stderr ?? "").slice(0, 1500)}`);
  return JSON.parse(json);
};
const dry = backfill([]);
ok("backfill dry run finds exactly the legacy document", dry.changed === 1 && dry.processed >= 6, JSON.stringify({ changed: dry.changed, processed: dry.processed }));
const applied = backfill(["--write"]);
const legacy = await docOf("legacy-1");
ok("backfill writes adultOnly (wine → true), topicTags and contentHash onto the legacy document",
   applied.changed === 1 && legacy.adultOnly === true && legacy.adultOnlyReason === "alcohol" && Array.isArray(legacy.topicTags) && typeof legacy.contentHash === "string", JSON.stringify(legacy));
ok("backfill reports counts per source and by reason", applied.perSource.ics === 1 && applied.adultOnlyBySource.ics === 1 && applied.adultOnlyByReason.alcohol >= 1);
ok("a second backfill pass proposes zero changes", backfill([]).changed === 0);

console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed ? 1 : 0);
