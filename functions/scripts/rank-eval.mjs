/**
 * rank-eval.mjs — evaluate ranking v1 (lib/ranking.js) and v2 (lib/ranking-v2.js)
 * side by side on the frozen corpus, for 20 profiles.
 *
 * Two sources of relevance labels:
 *
 *   --golden <file>   human labels (John's filled template). The original mode.
 *                     Refuses blank reviewer name / date / IDs and a hash mismatch.
 *
 *   --judge-url <u>   a blind automated judge (W6.1): a local OpenAI-compatible
 *   --judge-model <m> /v1/chat/completions endpoint (Ollama by default, no API key).
 *                     For each profile the top-10 of BOTH versions are pooled,
 *                     deduplicated and shuffled with a seeded RNG; the judge sees
 *                     only the profile text and the listing text (title,
 *                     description, category, venue, date, price, distance) —
 *                     never the version, score or position. Verdicts are cached
 *                     in --cache so re-runs cost nothing.
 *
 * Usage (from functions/ after `npm run build`):
 *   node scripts/rank-eval.mjs <corpus.json> --golden <golden.json>
 *   node scripts/rank-eval.mjs <corpus.json> [--profiles <template.json>]
 *        [--judge-url http://127.0.0.1:11434/v1] [--judge-model llama3.1]
 *        [--seed 20261020] [--batch 1] [--cache <file>] [--out <file>]
 *        [--result-doc <docs/RANKING-RESULT-YYYY-MM-DD.md>] [--seed-file <functions/seed/ranking-config.json>]
 *        [--emulator] [--no-apply] [--date YYYY-MM-DD] [--quiet]
 *
 * Legacy form `node scripts/rank-eval.mjs <corpus> <golden>` still works.
 *
 * Decision rule (judge mode): if v2 mean P@10 >= v1 mean P@10 the chosen version
 * is "v2", else "v1". Unless --no-apply, the chosen version is written to the
 * seed file functions/seed/ranking-config.json, and — only when --emulator is
 * passed AND FIRESTORE_EMULATOR_HOST is set — to config/ranking in the emulator.
 * Production is never written by this script.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { rankEvents, haversineMiles } from "../lib/ranking.js";
import { rankEventsV2, constraintsFromFilters } from "../lib/ranking-v2.js";
import { inferTopicTags, SOURCE_DEFAULT_TOPIC } from "../lib/ingest/annotate.js";

// ── arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    if (["emulator", "no-apply", "quiet", "help"].includes(key)) flags[key] = true;
    else flags[key] = argv[++i];
  } else positional.push(a);
}
if (flags.help || !positional[0]) {
  console.error("Usage: node scripts/rank-eval.mjs <frozen-corpus.json> (--golden <human-golden.json> | --judge-url <url> --judge-model <model>) [options]");
  process.exit(2);
}
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const corpusPath = resolve(positional[0]);
const goldenPath = flags.golden ?? positional[1];
const judgeUrl = (flags["judge-url"] ?? "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
const judgeModel = flags["judge-model"] ?? "llama3.1";
const seed = Number(flags.seed ?? 20261020);
const batchSize = Math.max(1, Number(flags.batch ?? 1));
const date = flags.date ?? new Date().toISOString().slice(0, 10);
const apply = !flags["no-apply"];
const quiet = !!flags.quiet;
const log = (...a) => { if (!quiet) console.error(...a); };
const rel = (p) => String(p).replace(/\\/g, "/").replace(repoRoot.replace(/\\/g, "/"), "");

// ── corpus ──────────────────────────────────────────────────────────────────
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
if (!Array.isArray(corpus.events)) throw new Error("Corpus must have events[].");
if (corpus.corpusHash && corpus.corpusHash !== createHash("sha256").update(JSON.stringify(corpus.events)).digest("hex")) {
  throw new Error("The frozen corpus changed after it was exported.");
}
const nowMs = Number(corpus.snapshotAtMs);
if (!Number.isFinite(nowMs)) throw new Error("Corpus needs a fixed snapshotAtMs.");

/**
 * The frozen preview was exported before topicTags existed (W1/W3), so v2's
 * interest term would see nothing. Derive them offline exactly as ingest does
 * (annotateEvent: title + the source's own labels, description, source default).
 * Pure and deterministic; the corpus file is not modified.
 */
export function withDerivedTopicTags(events) {
  let derived = 0;
  const out = events.map((e) => {
    if (Array.isArray(e.topicTags) && e.topicTags.length) return e;
    derived++;
    const labels = (e.tags ?? []).filter((t) => !/^(library|google-events)$/i.test(t)).join(" ");
    const topicTags = inferTopicTags(`${e.title ?? ""} ${labels}`, e.description ?? "", SOURCE_DEFAULT_TOPIC[e.source]);
    const isFree = e.isFree ?? ((e.tags ?? []).some((t) => /^free$/i.test(t)) ? true : undefined);
    return { ...e, topicTags, ...(isFree === undefined ? {} : { isFree }) };
  });
  return { events: out, derived };
}
const { events, derived: derivedTopicTags } = withDerivedTopicTags(corpus.events);
const byId = new Map(events.map((e) => [e.id, e]));

// ── profiles ────────────────────────────────────────────────────────────────
let profilesFile, profiles, golden = null;
if (goldenPath) {
  golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  if (!Array.isArray(golden.profiles) || golden.profiles.length !== 20) throw new Error("Golden set must have exactly 20 profiles[].");
  if (!golden.reviewerName?.trim() || !golden.reviewedAt?.trim()) throw new Error("Golden set needs a named human reviewer and review date.");
  if (corpus.corpusHash && golden.corpusHash !== corpus.corpusHash) throw new Error("Golden labels were made for a different frozen corpus.");
  for (const row of golden.profiles) {
    if (!row.id || !Array.isArray(row.relevantEventIDs) || !row.relevantEventIDs.length) throw new Error(`Profile ${row.id ?? "?"} needs human relevantEventIDs.`);
    for (const id of row.relevantEventIDs) if (!byId.has(id)) throw new Error(`Golden relevant ID ${id} is absent from the frozen corpus.`);
  }
  profilesFile = goldenPath; profiles = golden.profiles;
} else {
  profilesFile = flags.profiles ?? resolve(repoRoot, "docs/audits/rank-golden-template-2026-09-27.json");
  const tpl = JSON.parse(readFileSync(profilesFile, "utf8"));
  if (!Array.isArray(tpl.profiles) || tpl.profiles.length !== 20) throw new Error("Profile template must have exactly 20 profiles[].");
  if (corpus.corpusHash && tpl.corpusHash && tpl.corpusHash !== corpus.corpusHash) throw new Error("Profile template was made for a different frozen corpus.");
  profiles = tpl.profiles;
}

// ── ranking both versions ───────────────────────────────────────────────────
/** v1 reads the raw profile context; v2 reads the same context plus constraints mapped the way loadContext maps them. */
export function contextsFor(row) {
  const base = { interests: [], attendedCategories: {}, friendsGoing: {}, recentOrganizers: {}, nowMs, ...(row.context ?? {}) };
  const radius = base.radiusMiles ?? (base.distancePreset === "close" ? 3 : base.distancePreset === "drive" ? 25 : base.transportMode === "walk" ? 2 : undefined);
  const household = base.householdYoungestAge !== undefined ? { householdChildAges: [base.householdYoungestAge] } : {};
  const constraints = constraintsFromFilters(undefined, household, nowMs, radius);
  return { v1: base, v2: { ...base, constraints } };
}
export function rankBoth(row) {
  const ctx = contextsFor(row);
  return { v1: rankEvents(events, ctx.v1).map((e) => e.id), v2: rankEventsV2(events, ctx.v2).map((e) => e.id) };
}

// ── seeded shuffle ──────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function seedFor(base, label) {
  const h = createHash("sha256").update(`${base}:${label}`).digest();
  return h.readUInt32LE(0);
}
export function seededShuffle(items, s) {
  const rnd = mulberry32(s);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
/** Pool both top-10s, dedupe (sorted so the input order carries no version signal), shuffle with the profile's seed. */
export function pooled(ranked, profileId) {
  const ids = [...new Set([...ranked.v1.slice(0, 10), ...ranked.v2.slice(0, 10)])].sort();
  return seededShuffle(ids, seedFor(seed, profileId));
}

// ── blind text the judge sees ───────────────────────────────────────────────
const CITY = [["San José", 37.3382, -121.8863], ["Palo Alto", 37.4419, -122.143], ["Mountain View", 37.3861, -122.0839], ["Santa Clara", 37.3541, -121.9552]];
function placeName(lat, lng) {
  if (lat === undefined || lng === undefined) return "unknown";
  let best = null;
  for (const [name, la, ln] of CITY) { const d = haversineMiles(lat, lng, la, ln); if (!best || d < best.d) best = { name, d }; }
  return best.d < 3 ? best.name : `near ${best.name}`;
}
export function profileText(row) {
  const c = row.context ?? {};
  const lines = [
    `Home: ${placeName(c.lat, c.lng)}`,
    `Interests: ${c.interests?.length ? c.interests.join(", ") : "none stated"}`,
  ];
  if (c.householdYoungestAge !== undefined) lines.push(`Household: youngest child is ${c.householdYoungestAge} years old`);
  if (c.studentStatus) lines.push(`Student at: ${c.school ?? "a local college"}`);
  if (c.distancePreset === "close") lines.push("Travel: prefers things very close to home (about 3 miles)");
  if (c.distancePreset === "drive") lines.push("Travel: happy to drive up to about 25 miles for the right thing");
  if (c.transportMode === "walk") lines.push("Travel: walks everywhere, no car (about 2 miles)");
  if (c.transportMode === "transit") lines.push("Travel: public transit");
  if (c.accessibilityNeeds?.length) lines.push(`Accessibility needs: ${c.accessibilityNeeds.join(", ")}`);
  return lines.join("\n");
}
export function listingText(ev, row) {
  const c = row.context ?? {};
  const distance = (c.lat !== undefined && ev.latitude !== undefined) ? `${haversineMiles(c.lat, c.lng, ev.latitude, ev.longitude).toFixed(1)} miles from home` : "unknown";
  const price = ev.isFree === true || (ev.tags ?? []).some((t) => /^free$/i.test(t)) ? "Free" : ev.priceMin !== undefined ? `from $${ev.priceMin}` : "not stated";
  const when = new Date(ev.startMs).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const desc = String(ev.description ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  return [
    `Title: ${ev.title ?? ""}`,
    `Category: ${ev.category ?? "unknown"}`,
    `Venue: ${ev.locationName ?? "unknown"}`,
    `Date: ${when}`,
    `Price: ${price}`,
    `Distance: ${distance}`,
    `Description: ${desc}`,
  ].join("\n");
}
const SYSTEM = "You judge whether an event listing is a good match for a person. Consider the person's interests, household, travel preference and the listing's content, date and distance. Reply with strict JSON only.";
function singlePrompt(person, listing) {
  return `PERSON:\n${person}\n\nLISTING:\n${listing}\n\nAnswer with exactly {"relevant": true} or {"relevant": false}.`;
}
function batchPrompt(person, listings) {
  const blocks = listings.map((l, i) => `LISTING ${i + 1}:\n${l}`).join("\n\n");
  return `PERSON:\n${person}\n\n${blocks}\n\nAnswer with exactly {"verdicts":[{"index":1,"relevant":true|false}, ...]} covering every listing number once.`;
}

// ── judge client with cache + retries ───────────────────────────────────────
const cachePath = flags.cache ?? resolve(repoRoot, `docs/audits/rank-judge-cache-${judgeModel.replace(/[^a-z0-9.-]+/gi, "_")}.json`);
let cache = {};
if (!goldenPath && existsSync(cachePath)) { try { cache = JSON.parse(readFileSync(cachePath, "utf8")); } catch { cache = {}; } }
const cacheKey = (person, listing) => createHash("sha256").update(`${judgeModel}\n${person}\n---\n${listing}`).digest("hex");
let judgeCalls = 0, cacheHits = 0;

async function chat(prompt) {
  const body = JSON.stringify({ model: judgeModel, temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] });
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${judgeUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("judge returned no message content");
      judgeCalls++;
      return content;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw new Error(`judge failed after retries: ${lastErr?.message ?? lastErr}`);
}
function parseJson(content) {
  const m = /\{[\s\S]*\}/.exec(content);
  if (!m) throw new Error(`judge did not answer JSON: ${content.slice(0, 120)}`);
  return JSON.parse(m[0]);
}
async function judgeOne(person, listing) {
  const key = cacheKey(person, listing);
  if (key in cache) { cacheHits++; return cache[key]; }
  let verdict;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { const v = parseJson(await chat(singlePrompt(person, listing))).relevant; if (typeof v === "boolean") { verdict = v; break; } }
    catch (err) { if (attempt === 3) throw err; }
  }
  if (verdict === undefined) throw new Error("judge never gave a boolean verdict");
  cache[key] = verdict;
  return verdict;
}
async function judgeBatch(person, listings) {
  const out = new Array(listings.length);
  const pending = [];
  listings.forEach((l, i) => { const k = cacheKey(person, l); if (k in cache) { cacheHits++; out[i] = cache[k]; } else pending.push(i); });
  for (let start = 0; start < pending.length; start += batchSize) {
    const slice = pending.slice(start, start + batchSize);
    if (slice.length === 1) { out[slice[0]] = await judgeOne(person, listings[slice[0]]); continue; }
    let verdicts;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const parsed = parseJson(await chat(batchPrompt(person, slice.map((i) => listings[i]))));
        const map = new Map((parsed.verdicts ?? []).map((v) => [Number(v.index), v.relevant]));
        if (slice.every((_, j) => typeof map.get(j + 1) === "boolean")) { verdicts = slice.map((_, j) => map.get(j + 1)); break; }
        throw new Error("incomplete batch verdicts");
      } catch (err) { if (attempt === 3) throw err; }
    }
    slice.forEach((i, j) => { out[i] = verdicts[j]; cache[cacheKey(person, listings[i])] = verdicts[j]; });
  }
  return out;
}

// ── metrics ─────────────────────────────────────────────────────────────────
export function metrics(rankedIds, relevant) {
  const top = rankedIds.slice(0, 10);
  const first = rankedIds.findIndex((id) => relevant.has(id));
  const hits = top.filter((id) => relevant.has(id)).length;
  return {
    precisionAt10: top.length ? Number((hits / Math.min(10, top.length)).toFixed(3)) : 0,
    firstRelevantPosition: first < 0 ? null : first + 1,
    distinctCategoriesTop10: new Set(top.map((id) => byId.get(id)?.category ?? "")).size,
    resultCount: rankedIds.length,
    empty: rankedIds.length === 0,
    top10: top,
  };
}
function mean(rows, pick) {
  const vals = rows.map(pick).filter((v) => typeof v === "number");
  return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)) : null;
}
function summarize(rows, v) {
  return {
    meanPrecisionAt10: mean(rows, (r) => r[v].precisionAt10) ?? 0,
    meanFirstRelevantPosition: mean(rows, (r) => r[v].firstRelevantPosition),
    profilesWithNoRelevantResult: rows.filter((r) => r[v].firstRelevantPosition === null).length,
    meanDistinctCategoriesTop10: mean(rows, (r) => r[v].distinctCategoriesTop10),
    emptyFeeds: rows.filter((r) => r[v].empty).length,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────
const results = [];
for (const row of profiles) {
  const ranked = rankBoth(row);
  let relevant, pool = null, judged = null;
  if (golden) {
    relevant = new Set(row.relevantEventIDs);
  } else {
    pool = pooled(ranked, row.id);
    const person = profileText(row);
    const verdicts = await judgeBatch(person, pool.map((id) => listingText(byId.get(id), row)));
    judged = Object.fromEntries(pool.map((id, i) => [id, verdicts[i]]));
    relevant = new Set(pool.filter((_, i) => verdicts[i]));
    log(`${row.id}: pooled ${pool.length}, relevant ${relevant.size}`);
  }
  results.push({ id: row.id, v1: metrics(ranked.v1, relevant), v2: metrics(ranked.v2, relevant),
    ...(pool ? { pooledOrder: pool, judged, relevantCount: relevant.size } : { relevantCount: relevant.size }) });
}
if (!golden) { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache, null, 1)); }

const summary = { v1: summarize(results, "v1"), v2: summarize(results, "v2") };
const chosen = summary.v2.meanPrecisionAt10 >= summary.v1.meanPrecisionAt10 ? "v2" : "v1";
const output = {
  mode: golden ? "golden" : "judge",
  date, corpus: corpusPath, corpusHash: corpus.corpusHash ?? null, profilesFile, derivedTopicTags,
  judge: golden ? { reviewerName: golden.reviewerName, reviewedAt: golden.reviewedAt } : { url: judgeUrl, model: judgeModel, seed, batchSize, cache: rel(cachePath), calls: judgeCalls, cacheHits },
  profiles: results,
  summary,
  decision: { rule: "v2 if v2 mean P@10 >= v1 mean P@10", version: chosen, applied: false, seedFile: null, emulator: false },
};

// ── decision (judge mode only) ──────────────────────────────────────────────
if (!golden && apply) {
  const seedFile = flags["seed-file"] ?? resolve(repoRoot, "functions/seed/ranking-config.json");
  const config = { version: chosen, interleave: { enabled: false, minSessions: 300, nudge: 0.05 }, updatedAtMs: nowMs,
    setBy: `rank-eval judge ${judgeModel} ${date}`, evidence: { v1MeanPrecisionAt10: summary.v1.meanPrecisionAt10, v2MeanPrecisionAt10: summary.v2.meanPrecisionAt10, corpusHash: corpus.corpusHash ?? null } };
  mkdirSync(dirname(seedFile), { recursive: true });
  writeFileSync(seedFile, JSON.stringify(config, null, 2) + "\n");
  output.decision.applied = true; output.decision.seedFile = seedFile;
  if (flags.emulator) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("--emulator requires FIRESTORE_EMULATOR_HOST; this script never writes production.");
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "connectify-19dd8" });
    await getFirestore().doc("config/ranking").set({ version: config.version, interleave: config.interleave, updatedAtMs: config.updatedAtMs, setBy: config.setBy });
    output.decision.emulator = true;
  }
}

// ── result document ─────────────────────────────────────────────────────────
function resultDoc() {
  const fmt = (v) => v === null || v === undefined ? "—" : String(v);
  const rows = results.map((r) => `| ${r.id} | ${r.relevantCount} | ${r.v1.precisionAt10} | ${r.v2.precisionAt10} | ${fmt(r.v1.firstRelevantPosition)} | ${fmt(r.v2.firstRelevantPosition)} | ${r.v1.distinctCategoriesTop10} | ${r.v2.distinctCategoriesTop10} | ${r.v1.empty ? "yes" : "no"} | ${r.v2.empty ? "yes" : "no"} |`).join("\n");
  const judgeLine = golden
    ? `Relevance labels: human golden set by ${golden.reviewerName}, reviewed ${golden.reviewedAt}.`
    : `Judge model: \`${judgeModel}\` at \`${judgeUrl}\` (blind: pooled top-10 of both versions, deduplicated, shuffled with seed ${seed}; the judge saw profile and listing text only, never the version or position). ${judgeCalls} judge calls, ${cacheHits} cache hits (\`${rel(cachePath)}\`).`;
  return `# Ranking evaluation result — ${date}

${judgeLine}

Corpus: \`${rel(corpusPath)}\` (${events.length} events, hash \`${(corpus.corpusHash ?? "none").slice(0, 12)}…\`, snapshot ${new Date(nowMs).toISOString()}); topicTags derived offline for ${derivedTopicTags} events with \`inferTopicTags\`.
Profiles: \`${rel(profilesFile)}\` (${results.length}).

${golden ? "" : "**A model judge is a stand-in until real users exist.** Its verdicts measure agreement with one model's reading of the listing text, not what San José residents will actually attend. Interleaving telemetry (W3.2) and John's human golden set replace it as soon as either exists.\n"}
## Means

| Metric | v1 | v2 |
|---|---|---|
| Mean precision at 10 | ${summary.v1.meanPrecisionAt10} | ${summary.v2.meanPrecisionAt10} |
| Mean position of first relevant | ${fmt(summary.v1.meanFirstRelevantPosition)} | ${fmt(summary.v2.meanFirstRelevantPosition)} |
| Profiles with no relevant result | ${summary.v1.profilesWithNoRelevantResult} | ${summary.v2.profilesWithNoRelevantResult} |
| Mean distinct categories in top 10 | ${fmt(summary.v1.meanDistinctCategoriesTop10)} | ${fmt(summary.v2.meanDistinctCategoriesTop10)} |
| Empty feeds | ${summary.v1.emptyFeeds} | ${summary.v2.emptyFeeds} |

## Per profile

| Profile | Relevant | P@10 v1 | P@10 v2 | First v1 | First v2 | Categories v1 | Categories v2 | Empty v1 | Empty v2 |
|---|---|---|---|---|---|---|---|---|---|
${rows}

## Decision

Rule: choose v2 when v2 mean P@10 >= v1 mean P@10. Outcome: **${chosen}**.
${output.decision.applied ? `Applied: seed file \`${rel(output.decision.seedFile)}\` written${output.decision.emulator ? " and config/ranking set in the Firestore emulator" : ""}. Production config/ranking is never written by this script.` : "Applied: **no** (run with --no-apply, or golden mode). config/ranking is unchanged."}
`;
}
const resultDocPath = flags["result-doc"] ?? resolve(repoRoot, `docs/RANKING-RESULT-${date}.md`);
if (resultDocPath !== "none") { mkdirSync(dirname(resultDocPath), { recursive: true }); writeFileSync(resultDocPath, resultDoc()); output.resultDoc = resultDocPath; }
if (flags.out) { mkdirSync(dirname(flags.out), { recursive: true }); writeFileSync(flags.out, JSON.stringify(output, null, 2)); }
console.log(JSON.stringify(output, null, 2));
