// W7 sprint acceptance — one run, recorded fixtures only, no network, on a disposable Firestore emulator.
//
//   cd functions && npm run acceptance
//   (= npm run build && cd .. && npx firebase-tools@13 emulators:exec --only firestore --project connectify-19dd8
//        "node functions/scripts/sprint-acceptance.mjs")
//   … --dry-run   loads every module it needs and exits 0 without touching Firestore (syntax / import check)
//
// Runs the sprint's pipeline in order and asserts each step on the same emulator:
//   discover  → one runDiscovery cycle seeded by the recorded corpus + the OpenStreetMap fixture activates ≥ 1 host
//   decide    → every active source passes all six rules (audit query empty); the rejected table is printed with reasons
//   ingest    → the recorded corpus through /sources' active sources, plus every newly activated host through the
//               replay fixtures, lands in /events with no adapter errors
//   dedupe    → John's duplicate rule (dedupe.py, store.ts auditFuzzyDuplicates) reports a rate under 5 %
//   rank      → recommendEligibleFor (the program-feed code path) for a synthetic adult and a synthetic 15-year-old,
//               v1 and v2: non-empty, deterministic, no partner content
//   reasons   → every ranked row carries 1–3 reasons and each reason is backed by a component above its threshold
//   minors    → the minor's v1 and v2 feeds contain zero adultOnly events; the adult's contains ≥ 1 when the corpus has
//               any; the planner's candidate rule and the notification digest's eligibility rule hide them too
// Exit code is non-zero on any failure. Evidence: docs/evidence/acceptance-<date>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!DRY_RUN && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) throw new Error("Refusing to run outside the local emulator (FIRESTORE_EMULATOR_HOST).");
if (DRY_RUN) process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:1";   // keeps the Admin SDK from looking for credentials

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ projectId: "connectify-19dd8" });
const db = getFirestore();

// ── Modules under test (dynamic so --dry-run reports a broken build as a failed import, not a crash) ──
const { SAN_JOSE } = await import("../lib/ingest/areas.js");
const { runSource, fetchSourcesIsolated, SOURCES } = await import("../lib/ingest/index.js");
const { seedSourcesFromConfig, loadActiveSources } = await import("../lib/ingest/sources-registry.js");
const { loadAreaIndex, auditFuzzyDuplicates } = await import("../lib/ingest/store.js");
const { HostThrottle, replayFetch } = await import("../lib/discovery/http.js");
const { runDiscovery, recheckSources, auditActiveSources, hostsFromCorpus } = await import("../lib/discovery/discover.js");
const { RULE_NAMES, failingRules } = await import("../lib/discovery/decide.js");
const { recommendEligibleFor } = await import("../lib/program-feed.js");
const { loadContext, rankableFromDoc, EXPLORATION_REASON } = await import("../lib/ranking.js");
const { reasonsForV1, V1_REASON_RULES, NOTIFY_V2 } = await import("../lib/ranking-v2.js");
const { selectPlanCandidates } = await import("../lib/eventPlanner.js");
const { decideDigest, readPrefs, MIN_QUALIFYING_EVENTS, SUGGESTION_HORIZON_DAYS } = await import("../lib/notifications.js");
const { loadRecordedCorpus, corpusSources, recordsFor, latestCorpusPath } = await import("./corpus-fixture.mjs");

const FIX_ROOT = join(here, "..", "test-fixtures", "discovery");
const manifestPath = join(FIX_ROOT, "MANIFEST.json");
if (DRY_RUN) {
  console.log(`sprint-acceptance --dry-run: modules loaded; corpus ${latestCorpusPath() ?? "MISSING"}; discovery fixtures ${existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).label : "MISSING (recorded by discovery-e2e --record)"}`);
  process.exit(0);
}

// ── Harness ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const steps = [];
let current = null;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; current.passed++; console.log(`  ✅ ${name}`); }
  else { failed++; current.failed++; current.failures.push(`${name}${extra ? ` — ${String(extra).slice(0, 400)}` : ""}`); console.error(`  ❌ ${name} ${extra}`); }
};
async function step(name, fn) {
  current = { name, passed: 0, failed: 0, failures: [], detail: {} };
  steps.push(current);
  console.log(`\n── ${name} ──`);
  try { await fn(current.detail); }
  catch (e) { failed++; current.failed++; current.failures.push(`threw: ${e?.stack ?? e}`); console.error(`  ❌ ${name} threw: ${e?.stack ?? e}`); }
}
const area = SAN_JOSE;
const DAY = 86_400_000;
const isPartnerShaped = (x) => !x || x.partnerId !== undefined || x.sponsored !== undefined || x.perkId !== undefined || x.kind === "perk" || x.pointCost !== undefined;

// ── Fixtures: the recorded corpus and the recorded discovery responses ──────
if (!existsSync(manifestPath)) throw new Error(`No recorded discovery fixtures at ${manifestPath}. Record them once with "node functions/scripts/discovery-e2e.mjs --record" (network), then re-run.`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fixDir = join(FIX_ROOT, manifest.label);
if (!existsSync(fixDir)) throw new Error(`Discovery fixture directory missing: ${fixDir}`);
const NOW = new Date(manifest.now);
const nowMs = NOW.getTime();
const fetchImpl = replayFetch(fixDir, (url) => /\/\.well-known\/verdure-remove\.txt$/.test(url) ? new Response("", { status: 404 }) : undefined);
const throttle = new HostThrottle(0);
const corpus = loadRecordedCorpus();
const corpusSourceIds = corpusSources(corpus, SOURCES);
console.log(`sprint-acceptance fixtures=${manifest.label} now=${NOW.toISOString()} corpus=${corpus.path} (${corpusSourceIds.join(", ")})`);

// Active, visible, upcoming events of the area, read through the store's own (inventoried) area index query.
const activeUpcoming = async () => (await loadAreaIndex(area, NOW)).all
  .filter(({ data }) => data.active === true && data.hidden !== true && (data.date?.toMillis?.() ?? 0) >= nowMs);

// ── 0. Seed: today's /sources registry and the recorded corpus (discovery's first origin is the corpus' links) ──
const seedRuns = {};
await step("seed: /sources registry + recorded corpus through the real write path", async (detail) => {
  const seeded = await seedSourcesFromConfig();
  ok("the configured sources are registered in /sources", seeded.created.length + seeded.existing.length > 0, JSON.stringify(seeded));
  for (const id of corpusSourceIds) {
    const r = await runSource(id, area, {}, recordsFor(corpus, id));
    seedRuns[id] = { fetched: r.fetched, created: r.created, updated: r.updated, merged: r.merged, rejected: r.rejected ?? null, errors: r.errors };
    ok(`${id}: ${r.fetched} recorded listings ingested without adapter errors (${r.created} created, ${r.merged} merged, ${r.rejected ?? 0} rejected)`, r.errors.length === 0, r.errors.join("; "));
  }
  detail.runs = seedRuns;
  detail.activeUpcoming = (await activeUpcoming()).length;
  ok("the corpus produced active upcoming events", detail.activeUpcoming > 0, String(detail.activeUpcoming));
});

// ── 1. Discover ─────────────────────────────────────────────────────────────
let report = null;
await step("discover: one runDiscovery cycle (corpus links + OpenStreetMap fixture + model list)", async (detail) => {
  const corpusHosts = hostsFromCorpus(await loadAreaIndex(area, NOW), area.id, area);
  ok("the corpus links external hosts (origin 1)", corpusHosts.length > 0, String(corpusHosts.length));
  report = await runDiscovery(area, { fetchImpl, throttle, now: NOW, maxInspections: manifest.maxInspections ?? 120, concurrency: 32 });
  detail.origins = report.origins; detail.queued = report.queued; detail.inspected = report.inspected; detail.activated = report.activated;
  detail.unknown = report.unknown; detail.skipped = report.skipped.length; detail.osm = report.osm; detail.osmError = report.osmError ?? null; detail.budget = report.budget;
  console.log(`  origins ${JSON.stringify(report.origins)} queued ${JSON.stringify(report.queued)} inspected ${report.inspected} activated ${report.activated.length} rejected ${report.rejected.length} unknown ${report.unknown.length} skipped ${report.skipped.length}`);
  ok("OpenStreetMap listed organisations inside the radius from the recorded Overpass response (origin 2)", report.osm && report.osm.count > 0 && !report.osmError, JSON.stringify(report.osm ?? report.osmError));
  ok("the daily inspection budget is enforced (≤ 300)", report.budget.usedToday <= 300 && report.inspected <= 300, JSON.stringify(report.budget));
  ok("at least one host Verdure did not ingest today was activated with no human action", report.activated.length >= 1, JSON.stringify(report.activated));
  ok("no fixture was missing: every inspected candidate reached a verdict (no 'unknown' caused by an unrecorded response)", report.unknown.length === 0, JSON.stringify(report.unknown.slice(0, 5)));
});

// ── 2. Decide ───────────────────────────────────────────────────────────────
await step("decide: every active source passes all six rules", async (detail) => {
  // Config-seeded sources get their decision from the weekly re-check (the same six rules); run it on the fixtures first.
  const recheck = await recheckSources(area, { fetchImpl, throttle, now: NOW });
  detail.recheck = { checked: recheck.checked, paused: recheck.paused, resumed: recheck.resumed, errors: recheck.errors };
  ok("the weekly re-check pauses nothing and hits no missing fixture", recheck.paused.length === 0 && recheck.errors.length === 0, JSON.stringify(detail.recheck));
  const active = await loadActiveSources(area.id);
  const table = [];
  let allPass = true;
  for (const s of active) {
    const failing = failingRules(s.decision);
    const rules = RULE_NAMES.map((r) => `${r}=${s.decision?.rules?.[r]?.pass === true ? "pass" : s.decision?.rules?.[r]?.pass === false ? "FAIL" : "?"}`).join(" ");
    table.push({ id: s.id, type: s.type, host: s.host, origin: s.origin, verdict: s.decision?.verdict ?? null, failing });
    if (failing.length) { allPass = false; console.error(`  ✗ ${s.id} (${s.origin}) ${rules}`); }
  }
  detail.activeSources = table;
  ok(`every one of the ${active.length} active sources passes all six rules (${RULE_NAMES.join(", ")})`, active.length > 0 && allPass, JSON.stringify(table.filter((t) => t.failing.length)));
  const audit = await auditActiveSources(area.id);
  ok("the audit query finds no active source failing any rule", audit.length === 0, JSON.stringify(audit));
  const rejected = report?.rejected ?? [];
  detail.rejected = rejected.map((r) => ({ host: r.host, failed: r.failed, evidence: Object.fromEntries(r.failed.map((f) => [f, String(r.evidence[f] ?? "").slice(0, 160)])) }));
  console.log(`  rejected (${rejected.length}):`);
  console.log(`  ${"host".padEnd(36)} ${"failed rules".padEnd(34)} evidence`);
  for (const r of rejected) console.log(`  ${r.host.padEnd(36)} ${r.failed.join(",").padEnd(34)} ${String(r.evidence[r.failed[0]] ?? "").replace(/\s+/g, " ").slice(0, 90)}`);
  ok("every rejected candidate records which rules failed and the evidence for each", rejected.every((r) => r.failed.length > 0 && r.failed.every((f) => typeof r.evidence[f] === "string" && r.evidence[f].length > 0)), JSON.stringify(rejected.filter((r) => !r.failed.length).slice(0, 3)));
});

// ── 3. Ingest ───────────────────────────────────────────────────────────────
await step("ingest: active sources + newly activated hosts through the ordinary path (replay fixtures)", async (detail) => {
  const before = (await activeUpcoming()).length;
  // The configured sources again: nothing changed, so this proves the registry-driven path is idempotent on the corpus.
  const again = {};
  for (const id of corpusSourceIds) {
    const r = await runSource(id, area, {}, recordsFor(corpus, id));
    again[id] = { unchanged: r.unchanged ?? null, updated: r.updated, created: r.created, errors: r.errors };
  }
  detail.unchangedRun = again;
  ok("replaying the identical corpus creates nothing and reports no errors", Object.values(again).every((r) => r.created === 0 && r.errors.length === 0), JSON.stringify(Object.entries(again).filter(([, r]) => r.created || r.errors.length)));
  let created = 0;
  const newSources = [];
  for (const id of report?.activated ?? []) {
    const d = (await db.doc(`sources/${id}`).get()).data();
    if (!d) { ok(`${id}: source document exists`, false); continue; }
    const out = await fetchSourcesIsolated(d.type, area, {}, [{ ...d, id }], fetchImpl);
    const r = await runSource(d.type, area, {}, out.records);
    created += r.created;
    newSources.push({ id, type: d.type, host: d.host, fetched: out.records.length, created: r.created, rejected: r.rejected ?? 0, failures: out.failures });
    ok(`${id}: fetched ${out.records.length} through the ${d.type} adapter, created ${r.created}, rejected ${r.rejected ?? 0}, no failures`, out.failures.length === 0 && r.errors.length === 0, JSON.stringify(out.failures.concat(r.errors)));
  }
  const after = (await activeUpcoming()).length;
  detail.newSources = newSources; detail.activeBefore = before; detail.activeAfter = after; detail.createdByNewSources = created;
  ok("at least one newly activated source added events (more than zero new events from one cycle)", created > 0 && after > before, `${before} → ${after}`);
});

// ── 4. Dedupe ───────────────────────────────────────────────────────────────
await step("dedupe: duplicate rate under John's rule is below 5 %", async (detail) => {
  const index = await loadAreaIndex(area, NOW);
  const fuzzy = auditFuzzyDuplicates(index, nowMs);
  detail.method = "store.ts auditFuzzyDuplicates = dedupe.py is_duplicate(): title-token Jaccard ≥ 0.7 after stop-words, start within 30 min, same venue (token Jaccard ≥ 0.5) or within 0.25 mi";
  detail.active = fuzzy.active; detail.duplicates = fuzzy.duplicates; detail.rate = Number(fuzzy.rate.toFixed(4)); detail.sample = fuzzy.sample.slice(0, 10);
  console.log(`  active ${fuzzy.active}, suspected duplicates ${fuzzy.duplicates}, rate ${(fuzzy.rate * 100).toFixed(2)}%`);
  ok("the audit saw the ingested corpus", fuzzy.active > 0);
  ok(`duplicate rate ${(fuzzy.rate * 100).toFixed(2)}% < 5%`, fuzzy.rate < 0.05, JSON.stringify(fuzzy.sample.slice(0, 5)));
});

// ── 5. Rank v2 (and v1) through the program-feed code path ──────────────────
const ADULT = "acceptance-adult", MINOR = "acceptance-minor";
const feeds = {};                      // feeds[uid][version] = ranked rows
const docCache = new Map();
const eventDoc = async (id) => { if (!docCache.has(id)) docCache.set(id, (await db.doc(`events/${id}`).get()).data() ?? null); return docCache.get(id); };
await step("rank: v1 and v2 for a synthetic adult and a synthetic 15-year-old (recommendEligibleFor)", async (detail) => {
  const profile = { interests: ["outdoors", "family", "arts"], areaId: area.id, lastLat: area.center.lat, lastLng: area.center.lng, eventSuggestions: true, fcmTokens: ["acceptance-token"] };
  await db.doc(`users/${ADULT}`).set({ ...profile, ageBand: "adult", birthYear: NOW.getUTCFullYear() - 32 });
  await db.doc(`users/${MINOR}`).set({ ...profile, ageBand: "minor", birthYear: NOW.getUTCFullYear() - 15 });
  // A perk-shaped row in /events: partners are never organic, so no ranking may return it.
  await db.doc("events/acceptance-perk").set({ title: "Free coffee for members", organizer: "Acceptance Cafe", category: "Social", areaId: area.id, active: true, broadcast: true, hidden: false,
    date: Timestamp.fromMillis(nowMs + DAY), partnerId: "acceptance-partner", sponsored: true, pointCost: 500, qualityScore: 1, latitude: area.center.lat, longitude: area.center.lng, adultOnly: false, topicTags: ["food"] });
  await db.doc(`feedCaches/${area.id}`).delete().catch(() => {});
  for (const uid of [ADULT, MINOR]) {
    feeds[uid] = {};
    for (const version of ["v1", "v2"]) {
      const a = await recommendEligibleFor(uid, area.id, area.center.lat, area.center.lng, 100, nowMs, { version });
      const b = await recommendEligibleFor(uid, area.id, area.center.lat, area.center.lng, 100, nowMs, { version });
      feeds[uid][version] = a;
      const label = `${uid === ADULT ? "adult" : "minor"}/${version}`;
      ok(`${label}: non-empty`, a.length > 0, String(a.length));
      ok(`${label}: every row reports version ${version}`, a.every((r) => r.version === version), JSON.stringify([...new Set(a.map((r) => r.version))]));
      ok(`${label}: deterministic (two calls, same order and scores)`, a.length === b.length && a.every((r, i) => r.id === b[i].id && Math.abs(r.score - b[i].score) < 1e-9), `${a.slice(0, 5).map((r) => r.id)} vs ${b.slice(0, 5).map((r) => r.id)}`);
      let partner = 0;
      for (const r of a) if (r.id === "acceptance-perk" || isPartnerShaped(await eventDoc(r.id))) partner++;
      ok(`${label}: no partner content (perk-shaped documents never ranked)`, partner === 0, String(partner));
      detail[label] = { ranked: a.length, topFive: a.slice(0, 5).map((r) => ({ id: r.id, score: Number(r.score.toFixed(4)), reasons: r.reasons })) };
    }
  }
});

// ── 6. Reasons ──────────────────────────────────────────────────────────────
// v2: the check from ranking-v2-unit.mjs (each reason text ↔ a component above its threshold; parts carry the components).
const v2ReasonBacked = (r) => r.reasons.every((text) => {
  const c = r.parts;
  if (text.startsWith("Matches your interest") || text.startsWith("Because you like")) return c.interest === 1;
  if (text.startsWith("Close by") || text.startsWith("Near your selected area")) return c.distance > 0.5;
  if (text.startsWith("Online")) return c.distance === 0.7;
  if (text === "Happening today" || text === "This weekend") return c.soonness > 0;
  if (text === "Free") return true;
  if (text === "New for you") return c.novelty === 1;
  if (text.startsWith("Similar to events")) return c.learnedAffinity >= 0.625;
  if (text.endsWith("is going") || text.endsWith("friends are going")) return c.social > 0;
  if (text === "Fits your child's age" || text.startsWith("Repeats") || text === "You saved this") return true;
  return false;
});
// v1: each reason must be producible by a V1_REASON_RULES entry whose component is at or above the rule's threshold.
const V1_PREFIXES = [
  { part: "social", test: (t) => t === "A friend is going" || t.endsWith("friends are going") },
  // CAC 2026: the interest reason names the user's pick ("Because you like Parks") and is emitted only on a direct match (interestMatch 1).
  { part: "interest", test: (t) => t.startsWith("Because you like ") || t === "Matches what you've attended" },
  { part: "distance", test: (t) => t.startsWith("Close by") },
  { part: "timing", test: (t) => t === "Happening today or tomorrow" || t === "Coming up this week" },
  { part: "feedback", test: (t) => t.startsWith("Similar to events") },
  { part: "quality", test: (t) => t === "Free" || t === "Complete listing" },
  { part: "novelty", test: (t) => t.startsWith("Something new from") || t === "New for you" },
];
const v1ReasonBacked = (r) => r.reasons.every((text) => {
  // The labelled exploration slot and the series note are backed by their own fields, not a scored component.
  if (text === EXPLORATION_REASON) return r.parts.exploration === 1 && r.parts.interestMatch === 0;
  if (/^Repeats — \d+ more date/.test(text)) return Array.isArray(r.moreDates) && r.moreDates.length >= 1;
  const p = V1_PREFIXES.find((x) => x.test(text));
  if (!p) return false;
  const rule = V1_REASON_RULES.find((x) => x.part === p.part);
  if (!(typeof r.parts[p.part] === "number" && r.parts[p.part] >= rule.min)) return false;
  // "Because you like …" additionally requires the DIRECT match flag, so a floor or behaviour can never produce it.
  return p.part !== "interest" || !text.startsWith("Because you like") || r.parts.interestMatch === 1;
});
/** What recommendFor ships for a v1 row: the exploration label alone, or reasonsForV1 plus the series note, at most three. */
const expectedV1Reasons = (ev, ctx, r) => {
  if (r.parts.exploration === 1) return [EXPLORATION_REASON];
  const more = Array.isArray(r.moreDates) ? r.moreDates.length : 0;
  return [...reasonsForV1(ev, ctx, r.parts), ...(more ? [`Repeats — ${more} more date${more > 1 ? "s" : ""}`] : [])].slice(0, 3);
};
await step("reasons: every ranked event has 1–3 reasons, each backed by a component above threshold", async (detail) => {
  for (const uid of [ADULT, MINOR]) {
    const who = uid === ADULT ? "adult" : "minor";
    const ctx = await loadContext(uid, area.center.lat, area.center.lng, nowMs);
    for (const version of ["v1", "v2"]) {
      const rows = feeds[uid]?.[version] ?? [];
      const counts = rows.map((r) => (r.reasons ?? []).length);
      ok(`${who}/${version}: every row has 1–3 reasons`, rows.length > 0 && counts.every((n) => n >= 1 && n <= 3), `counts ${JSON.stringify(counts.filter((n) => n < 1 || n > 3).slice(0, 5))} of ${rows.length}`);
      const unbacked = rows.filter((r) => !(version === "v2" ? v2ReasonBacked(r) : v1ReasonBacked(r)));
      ok(`${who}/${version}: each reason corresponds to a component above its threshold`, unbacked.length === 0, JSON.stringify(unbacked.slice(0, 3).map((r) => ({ id: r.id, reasons: r.reasons, parts: r.parts }))));
      if (version === "v1") {
        // Exact: the reasons shipped are the ones reasonsForV1 derives from the row's own parts and the viewer's context.
        let mismatch = 0;
        for (const r of rows) {
          const snap = await db.doc(`events/${r.id}`).get();
          const ev = rankableFromDoc(snap);
          if (!ev || JSON.stringify(expectedV1Reasons(ev, ctx, r)) !== JSON.stringify(r.reasons)) mismatch++;
        }
        ok(`${who}/v1: shipped reasons equal reasonsForV1(event, context, parts) (+ the series note, or the exploration label alone) for every row`, mismatch === 0, String(mismatch));
        const explorations = rows.map((r, i) => [i, r]).filter(([, r]) => r.parts.exploration === 1);
        ok(`${who}/v1: the exploration slot, when present, is the tenth card, is off-interest and is the only off-interest card in the top ten`,
           explorations.every(([i]) => i === 9) && rows.slice(0, 10).every((r, i) => r.parts.interestMatch === 1 || r.parts.exploration === 1 || i >= 9 && explorations.length === 0 && rows.slice(0, 9).every((x) => x.parts.interestMatch === 1) === false),
           JSON.stringify(rows.slice(0, 10).map((r, i) => [i, r.parts.interestMatch, r.parts.exploration ?? 0])));
      }
      detail[`${who}/${version}`] = { rows: rows.length, reasonCounts: counts.reduce((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {}), sample: rows.slice(0, 3).map((r) => r.reasons) };
    }
  }
});

// ── 7. Minor safety on every server surface ─────────────────────────────────
await step("minors: zero adultOnly events reach the 15-year-old on any server surface", async (detail) => {
  const all = await activeUpcoming();
  const adultOnlyCount = all.filter(({ data }) => data.adultOnly === true).length;
  detail.corpusAdultOnly = adultOnlyCount; detail.corpusActiveUpcoming = all.length;
  console.log(`  corpus: ${adultOnlyCount} of ${all.length} active upcoming events are adultOnly`);
  for (const version of ["v1", "v2"]) {
    const minorRows = feeds[MINOR]?.[version] ?? [];
    let adultInMinor = 0, missingFlag = 0;
    for (const r of minorRows) { const d = await eventDoc(r.id); if (d?.adultOnly === true) adultInMinor++; if (typeof d?.adultOnly !== "boolean") missingFlag++; }
    ok(`minor/${version}: zero adultOnly events in ${minorRows.length} ranked`, minorRows.length > 0 && adultInMinor === 0, String(adultInMinor));
    ok(`minor/${version}: every ranked event carries an explicit adultOnly flag (fail-closed documents are never served)`, missingFlag === 0, String(missingFlag));
    const adultRows = feeds[ADULT]?.[version] ?? [];
    let adultInAdult = 0;
    for (const r of adultRows) if ((await eventDoc(r.id))?.adultOnly === true) adultInAdult++;
    if (adultOnlyCount > 0) ok(`adult/${version}: the adult's feed contains at least one adultOnly event (${adultInAdult} of ${adultRows.length})`, adultInAdult >= 1);
    else ok(`adult/${version}: corpus has no adultOnly events, nothing to assert (${adultRows.length} ranked)`, true);
    detail[version] = { minorRanked: minorRows.length, adultOnlyInMinor: adultInMinor, adultRanked: adultRows.length, adultOnlyInAdult: adultInAdult };
  }
  // Planner: the same candidate rule planEvents applies (recommendFor → re-read → adultOnly hidden from a non-adult), then selectPlanCandidates.
  const plannerRows = async (uid, viewerIsAdult) => {
    const ranked = feeds[uid]?.v1 ?? [];
    const rows = [];
    for (const r of ranked.slice(0, 50)) {
      const x = await eventDoc(r.id);
      if (!x || x.hidden === true || x.active !== true || x.broadcast !== true || x.category === "Program" || x.opportunitySubtype === "program") continue;
      if (x.adultOnly === true && !viewerIsAdult) continue;
      rows.push({ id: r.id, title: x.title ?? "", category: x.category ?? "", organizer: x.organizer ?? "", startMs: x.date?.toMillis?.() ?? 0, locationName: x.locationName ?? "", isFree: x.isFree === true,
        priceMin: typeof x.priceMin === "number" ? x.priceMin : undefined, latitude: x.latitude, longitude: x.longitude, ageSuitability: x.ageSuitability ?? "", social: r.parts?.social ?? 0, description: x.description ?? "", adultOnly: x.adultOnly });
    }
    return selectPlanCandidates(rows, { when: "Any time", who: "Anyone", distance: "Anywhere nearby", budget: "Any", note: "", nowMs, lat: area.center.lat, lng: area.center.lng });
  };
  const minorPlan = await plannerRows(MINOR, false);
  ok(`planner candidates for the minor: ${minorPlan.length} candidates, zero adultOnly`, minorPlan.length > 0 && minorPlan.every((c) => c.adultOnly !== true), JSON.stringify(minorPlan.filter((c) => c.adultOnly === true).map((c) => c.id).slice(0, 5)));
  detail.plannerMinor = minorPlan.length;
  // Notifications: the digest's eligibility loop (v2 notify flag, adultOnly vs ageBand, horizon) as runSuggestionDigest applies it, without sending.
  const digestQualifying = async (uid, ageBand) => {
    const rows = feeds[uid]?.v2 ?? [];
    const horizonMs = nowMs + SUGGESTION_HORIZON_DAYS * DAY;
    const out = [];
    for (const r of rows) {
      if (r.version === "v2" && r.notify !== true) continue;
      const x = await eventDoc(r.id);
      if (!x || x.category === "Program" || x.opportunitySubtype === "program") continue;
      if (x.adultOnly === true && ageBand !== "adult") continue;
      const startMs = x.date?.toMillis?.() ?? 0;
      if (startMs < nowMs || startMs > horizonMs) continue;
      out.push({ id: r.id, adultOnly: x.adultOnly === true });
    }
    return out;
  };
  const minorQ = await digestQualifying(MINOR, "minor");
  const adultQ = await digestQualifying(ADULT, "adult");
  ok("notification eligibility for the minor never includes an adultOnly event", minorQ.every((q) => !q.adultOnly), JSON.stringify(minorQ.filter((q) => q.adultOnly).slice(0, 5)));
  ok(`v2 notify flags follow John's rule (score ≥ ${NOTIFY_V2.threshold} within ${NOTIFY_V2.withinDays} days) on both feeds`,
    [...(feeds[ADULT]?.v2 ?? []), ...(feeds[MINOR]?.v2 ?? [])].every((r) => typeof r.notify === "boolean" && (!r.notify || r.score >= NOTIFY_V2.threshold - 1e-9)));
  const prefs = readPrefs((await db.doc(`users/${MINOR}`).get()).data());
  const decision = decideDigest({ prefs, atMs: Date.UTC(2026, 9, 20, 20, 0, 0), qualifying: minorQ.map((q) => q.id), budgetAvailable: true });
  ok(`decideDigest for the minor sends only from the adult-free qualifying set (${minorQ.length} qualifying, floor ${MIN_QUALIFYING_EVENTS}): ${decision.reason}`,
    decision.send ? decision.eventIds.every((id) => minorQ.some((q) => q.id === id && !q.adultOnly)) : decision.reason === "below_floor" || decision.reason === "quiet_hours", JSON.stringify(decision));
  detail.digest = { minorQualifying: minorQ.length, adultQualifying: adultQ.length, minorDecision: decision };
});

// ── Summary + evidence ──────────────────────────────────────────────────────
console.log("\n══ summary ══");
console.log(`  ${"step".padEnd(12)} ${"pass".padStart(5)} ${"fail".padStart(5)}  result`);
for (const s of steps) console.log(`  ${s.name.split(":")[0].padEnd(12)} ${String(s.passed).padStart(5)} ${String(s.failed).padStart(5)}  ${s.failed ? "FAIL" : "ok"}`);
const date = new Date().toISOString().slice(0, 10);
const evidenceDir = join(root, "docs", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = join(evidenceDir, `acceptance-${date}.json`);
writeFileSync(evidencePath, JSON.stringify({
  ranAt: new Date().toISOString(), emulator: emulatorHost, fixtures: { discovery: manifest.label, now: manifest.now, corpus: corpus.path.replace(/\\/g, "/").split("/functions/")[1] ?? corpus.path, corpusSha256: corpus.sha256, corpusRecordedAt: corpus.recordedAt },
  passed, failed, steps: steps.map((s) => ({ name: s.name, passed: s.passed, failed: s.failed, failures: s.failures, detail: s.detail })),
}, null, 2) + "\n");
console.log(`  evidence → ${evidencePath}`);
console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed ? 1 : 0);
