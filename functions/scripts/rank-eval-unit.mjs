/**
 * rank-eval-unit.mjs — end-to-end test of the blind automated judge (W6.1).
 * No emulator, no network beyond 127.0.0.1: starts rank-judge-mock.mjs on a free
 * port and drives rank-eval.mjs against it. All output goes to a temp directory.
 *
 * Asserts: both versions ranked; blinding (request bodies carry no version or
 * position); pooling/shuffle determinism under a seed; the decision rule in
 * both directions (a mock that makes v2 win and one that makes v1 win); the
 * output file shape; the cache making re-runs free; retries; golden mode.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankEvents } from "../lib/ranking.js";
import { rankEventsV2, constraintsFromFilters } from "../lib/ranking-v2.js";
import { inferTopicTags, SOURCE_DEFAULT_TOPIC } from "../lib/ingest/annotate.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const scripts = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const corpusPath = join(repoRoot, "docs/audits/rank-corpus-preview-2026-09-27.json");
const templatePath = join(repoRoot, "docs/audits/rank-golden-template-2026-09-27.json");
const tmp = mkdtempSync(join(tmpdir(), "rank-eval-unit-"));

async function startMock(args = []) {
  const child = spawn(process.execPath, [join(scripts, "rank-judge-mock.mjs"), "--port", "0", ...args], { stdio: ["ignore", "pipe", "inherit"] });
  const url = await new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => { buf += d; const m = /listening (http:\/\/127\.0\.0\.1:\d+)/.exec(buf); if (m) resolve(m[1]); });
    child.on("exit", (code) => reject(new Error(`mock exited ${code}`)));
    setTimeout(() => reject(new Error("mock did not start")), 10_000);
  });
  return { child, url: `${url}/v1`, stop: () => child.kill() };
}
function runEval(label, judgeUrl, extra = []) {
  const out = join(tmp, `${label}.json`), doc = join(tmp, `${label}.md`), seedFile = join(tmp, `${label}-seed.json`), cache = join(tmp, `${label}-cache.json`);
  const r = spawnSync(process.execPath, [join(scripts, "rank-eval.mjs"), corpusPath, "--judge-url", judgeUrl, "--judge-model", `mock-${label}`,
    "--cache", cache, "--out", out, "--result-doc", doc, "--seed-file", seedFile, "--date", "2026-10-20", "--quiet", ...extra], { encoding: "utf8", cwd: scripts });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, out, doc, seedFile, cache, json: r.status === 0 && existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null };
}

// Offline reference ranking (same derivation the script uses) so the "titles" mocks can target one version.
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const template = JSON.parse(readFileSync(templatePath, "utf8"));
const events = corpus.events.map((e) => ({ ...e, topicTags: inferTopicTags(`${e.title} ${(e.tags ?? []).join(" ")}`, e.description ?? "", SOURCE_DEFAULT_TOPIC[e.source]) }));
const nowMs = corpus.snapshotAtMs;
const byId = new Map(events.map((e) => [e.id, e]));
function tops(row) {
  const base = { interests: [], attendedCategories: {}, friendsGoing: {}, recentOrganizers: {}, nowMs, ...(row.context ?? {}) };
  const radius = base.radiusMiles ?? (base.distancePreset === "close" ? 3 : base.distancePreset === "drive" ? 25 : base.transportMode === "walk" ? 2 : undefined);
  const household = base.householdYoungestAge !== undefined ? { householdChildAges: [base.householdYoungestAge] } : {};
  const v2ctx = { ...base, constraints: constraintsFromFilters(undefined, household, nowMs, radius) };
  return { v1: rankEvents(events, base).slice(0, 10).map((e) => e.id), v2: rankEventsV2(events, v2ctx).slice(0, 10).map((e) => e.id) };
}
const onlyV1 = new Set(), onlyV2 = new Set();
for (const row of template.profiles) {
  const t = tops(row);
  for (const id of t.v1) if (!t.v2.includes(id)) onlyV1.add(byId.get(id).title);
  for (const id of t.v2) if (!t.v1.includes(id)) onlyV2.add(byId.get(id).title);
}
const v1Titles = join(tmp, "v1-titles.json"), v2Titles = join(tmp, "v2-titles.json");
writeFileSync(v1Titles, JSON.stringify([...onlyV1]));
writeFileSync(v2Titles, JSON.stringify([...onlyV2]));

try {
  console.log("── keyword mock: end to end ──");
  const log = join(tmp, "requests.jsonl");
  const mock = await startMock(["--mode", "keyword", "--log", log]);
  const a = runEval("keyword", mock.url, ["--seed", "7"]);
  ok("eval exits 0 against the mock judge", a.status === 0, a.stderr.slice(-400));
  const j = a.json;
  ok("output has 20 profiles", j?.profiles?.length === 20);
  ok("both versions ranked for every profile (non-empty top10 each)", j && j.profiles.every((p) => p.v1.top10.length > 0 && p.v2.top10.length > 0));
  ok("v1 and v2 produce different orderings somewhere (they are really two engines)", j && j.profiles.some((p) => p.v1.top10.join() !== p.v2.top10.join()));
  ok("per-profile metrics: precisionAt10, firstRelevantPosition, distinctCategoriesTop10, empty, for both versions",
     j && j.profiles.every((p) => ["v1", "v2"].every((v) => typeof p[v].precisionAt10 === "number" && "firstRelevantPosition" in p[v] && typeof p[v].distinctCategoriesTop10 === "number" && typeof p[v].empty === "boolean")));
  ok("summary has mean P@10, mean first position, no-relevant count, mean categories, empty feeds for both",
     j && ["v1", "v2"].every((v) => ["meanPrecisionAt10", "meanFirstRelevantPosition", "profilesWithNoRelevantResult", "meanDistinctCategoriesTop10", "emptyFeeds"].every((k) => k in j.summary[v])));
  ok("topicTags were derived offline for all 233 events", j?.derivedTopicTags === 233);
  ok("pool is the deduplicated union of both top-10s", j && j.profiles.every((p) => { const u = new Set([...p.v1.top10, ...p.v2.top10]); return p.pooledOrder.length === u.size && p.pooledOrder.every((id) => u.has(id)); }));
  ok("every pooled event received a boolean verdict", j && j.profiles.every((p) => p.pooledOrder.every((id) => typeof p.judged[id] === "boolean")));
  ok("judge section names url, model, seed, call count", j?.judge?.url === mock.url && j.judge.model === "mock-keyword" && j.judge.seed === 7 && j.judge.calls > 0);
  ok("decision rule evaluated and recorded", j && ["v1", "v2"].includes(j.decision.version) && j.decision.version === (j.summary.v2.meanPrecisionAt10 >= j.summary.v1.meanPrecisionAt10 ? "v2" : "v1"));
  ok("result document written and names the judge model and the stand-in caveat", existsSync(a.doc) && readFileSync(a.doc, "utf8").includes("mock-keyword") && readFileSync(a.doc, "utf8").includes("stand-in until real users exist"));

  console.log("\n── blinding ──");
  const bodies = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  ok("one request per (profile, event) pooled pair", bodies.length === j.profiles.reduce((n, p) => n + p.pooledOrder.length, 0), String(bodies.length));
  const text = bodies.map((b) => JSON.stringify(b.messages)).join("\n");
  ok("request bodies never mention v1 / v2 / version", !/\bv1\b|\bv2\b|\bversion\b/i.test(text));
  ok("request bodies never mention position, rank or score", !/\bposition\b|\brank(?:ed|ing|s)?\b|\bscore\b/i.test(text));
  ok("request bodies never carry event ids or source names", !/bibliocommons-|localist-|sourceURL|"id"/i.test(text));
  ok("request bodies carry only the profile text and listing fields", bodies.every((b) => { const u = b.messages.find((m) => m.role === "user").content; return /^PERSON:\n/.test(u) && /\nLISTING:\nTitle: /.test(u) && /Category: .*\nVenue: .*\nDate: .*\nPrice: .*\nDistance: .*\nDescription: /s.test(u); }));
  ok("no api key header is sent", bodies.every((b) => !("api_key" in b) && !("authorization" in b)));

  console.log("\n── cache ──");
  const linesBefore = bodies.length;
  const a2 = runEval("keyword", mock.url, ["--seed", "7"]);
  const linesAfter = readFileSync(log, "utf8").trim().split("\n").length;
  ok("re-run with the cache makes zero judge calls", a2.status === 0 && linesAfter === linesBefore && a2.json.judge.calls === 0 && a2.json.judge.cacheHits === linesBefore, `${linesBefore} -> ${linesAfter}`);
  ok("re-run gives identical metrics", JSON.stringify(a2.json.summary) === JSON.stringify(j.summary));

  console.log("\n── seeded pooling / shuffle ──");
  const b1 = runEval("seedA", mock.url, ["--seed", "123"]);
  const b2 = runEval("seedB", mock.url, ["--seed", "123"]);
  const b3 = runEval("seedC", mock.url, ["--seed", "124"]);
  const orders = (r) => r.json.profiles.map((p) => p.pooledOrder.join(","));
  ok("same seed -> identical pooled order for every profile", b1.status === 0 && b2.status === 0 && JSON.stringify(orders(b1)) === JSON.stringify(orders(b2)));
  ok("different seed -> a different order for at least one profile, same membership", b3.status === 0 && JSON.stringify(orders(b3)) !== JSON.stringify(orders(b1)) &&
     b3.json.profiles.every((p, i) => p.pooledOrder.slice().sort().join() === b1.json.profiles[i].pooledOrder.slice().sort().join()));
  ok("shuffle is not the concatenation order (v1 top-10 then v2)", b1.json.profiles.some((p) => p.pooledOrder.slice(0, 10).join() !== p.v1.top10.join()));

  console.log("\n── batched judging ──");
  const batchLog = join(tmp, "batch.jsonl");
  const mockB = await startMock(["--mode", "keyword", "--log", batchLog]);
  const c = runEval("batch", mockB.url, ["--seed", "7", "--batch", "5"]);
  ok("batched mode exits 0 with identical metrics to single mode", c.status === 0 && JSON.stringify(c.json.summary) === JSON.stringify(j.summary), c.stderr.slice(-300));
  const batchBodies = readFileSync(batchLog, "utf8").trim().split("\n");
  ok("batched mode makes fewer calls", batchBodies.length < linesBefore, `${batchBodies.length} vs ${linesBefore}`);
  ok("batched requests are blind too", !/\bv1\b|\bv2\b|\bposition\b|\brank/i.test(batchBodies.join("\n")));
  mockB.stop();

  console.log("\n── retries ──");
  const mockF = await startMock(["--mode", "keyword", "--fail-first", "3"]);
  const d = runEval("flaky", mockF.url, ["--seed", "7"]);
  ok("three injected HTTP 500s are retried and the run completes", d.status === 0 && JSON.stringify(d.json.summary) === JSON.stringify(j.summary), d.stderr.slice(-300));
  mockF.stop();

  console.log("\n── decision rule, both directions ──");
  const mockV2 = await startMock(["--mode", "titles", "--titles", v2Titles]);
  const w2 = runEval("v2wins", mockV2.url);
  mockV2.stop();
  ok("mock that only likes v2-exclusive titles: v2 mean P@10 > v1", w2.status === 0 && w2.json.summary.v2.meanPrecisionAt10 > w2.json.summary.v1.meanPrecisionAt10,
     w2.json ? `${w2.json.summary.v1.meanPrecisionAt10} vs ${w2.json.summary.v2.meanPrecisionAt10}` : w2.stderr.slice(-300));
  ok("-> decision v2, seed file written with version v2", w2.json?.decision.version === "v2" && w2.json.decision.applied && JSON.parse(readFileSync(w2.seedFile, "utf8")).version === "v2");
  ok("-> result doc says outcome v2 and applied", readFileSync(w2.doc, "utf8").includes("Outcome: **v2**") && readFileSync(w2.doc, "utf8").includes("Applied: seed file"));
  ok("without --emulator the run never claims an emulator or production write", w2.json.decision.emulator === false && !readFileSync(w2.doc, "utf8").includes("set in the Firestore emulator"));

  const mockV1 = await startMock(["--mode", "titles", "--titles", v1Titles]);
  const w1 = runEval("v1wins", mockV1.url);
  mockV1.stop();
  ok("mock that only likes v1-exclusive titles: v1 mean P@10 > v2", w1.status === 0 && w1.json.summary.v1.meanPrecisionAt10 > w1.json.summary.v2.meanPrecisionAt10,
     w1.json ? `${w1.json.summary.v1.meanPrecisionAt10} vs ${w1.json.summary.v2.meanPrecisionAt10}` : w1.stderr.slice(-300));
  ok("-> decision v1, seed file written with version v1", w1.json?.decision.version === "v1" && JSON.parse(readFileSync(w1.seedFile, "utf8")).version === "v1");

  const mockAll = await startMock(["--mode", "all"]);
  const tie = runEval("tie", mockAll.url);
  mockAll.stop();
  ok("tie (everything relevant, both 1.0) -> v2 by the >= rule", tie.status === 0 && tie.json.summary.v1.meanPrecisionAt10 === tie.json.summary.v2.meanPrecisionAt10 && tie.json.decision.version === "v2");

  const mockNone = await startMock(["--mode", "none"]);
  const none = runEval("none", mockNone.url, ["--no-apply"]);
  mockNone.stop();
  ok("--no-apply: decision recorded but no seed file written", none.status === 0 && none.json.decision.applied === false && !existsSync(none.seedFile) && readFileSync(none.doc, "utf8").includes("Applied: **no**"));
  ok("nothing relevant: every profile has firstRelevantPosition null and P@10 0, no crash", none.json.profiles.every((p) => p.v1.firstRelevantPosition === null && p.v2.precisionAt10 === 0) && none.json.summary.v1.profilesWithNoRelevantResult === 20);

  console.log("\n── --emulator guard ──");
  const guard = spawnSync(process.execPath, [join(scripts, "rank-eval.mjs"), corpusPath, "--judge-url", mock.url, "--judge-model", "mock-keyword", "--cache", join(tmp, "keyword-cache.json"),
    "--result-doc", "none", "--seed-file", join(tmp, "guard-seed.json"), "--emulator", "--quiet"], { encoding: "utf8", cwd: scripts, env: { ...process.env, FIRESTORE_EMULATOR_HOST: "" } });
  ok("--emulator without FIRESTORE_EMULATOR_HOST refuses (never production)", guard.status !== 0 && /never writes production/.test(guard.stderr));

  console.log("\n── human golden mode still works ──");
  const golden = { corpusHash: corpus.corpusHash, reviewerName: "Unit Test Reviewer", reviewedAt: "2026-10-20",
    profiles: template.profiles.map((p) => ({ ...p, relevantEventIDs: [tops(p).v1[0], tops(p).v2[0]] })) };
  const goldenPath = join(tmp, "golden.json");
  writeFileSync(goldenPath, JSON.stringify(golden));
  const g = spawnSync(process.execPath, [join(scripts, "rank-eval.mjs"), corpusPath, "--golden", goldenPath, "--result-doc", join(tmp, "golden.md"), "--out", join(tmp, "golden-out.json"), "--date", "2026-10-20"], { encoding: "utf8", cwd: scripts });
  const gj = g.status === 0 ? JSON.parse(readFileSync(join(tmp, "golden-out.json"), "utf8")) : null;
  ok("golden mode exits 0 and reports both versions", g.status === 0 && gj.mode === "golden" && gj.profiles.length === 20 && gj.profiles.every((p) => p.v1.firstRelevantPosition === 1 && p.v2.firstRelevantPosition === 1), g.stderr.slice(-300));
  ok("golden mode names the human reviewer, makes no judge call and never applies the decision", gj && gj.judge.reviewerName === "Unit Test Reviewer" && gj.decision.applied === false);
  const legacy = spawnSync(process.execPath, [join(scripts, "rank-eval.mjs"), corpusPath, goldenPath, "--result-doc", "none"], { encoding: "utf8", cwd: scripts });
  ok("legacy positional form <corpus> <golden> still works", legacy.status === 0 && JSON.parse(legacy.stdout).mode === "golden");
  const blank = spawnSync(process.execPath, [join(scripts, "rank-eval.mjs"), corpusPath, "--golden", templatePath, "--result-doc", "none"], { encoding: "utf8", cwd: scripts });
  ok("the unfilled template is still rejected in golden mode", blank.status !== 0 && /reviewer/.test(blank.stderr));
  const wrongHash = join(tmp, "wrong-hash.json");
  writeFileSync(wrongHash, JSON.stringify({ ...golden, corpusHash: "0".repeat(64) }));
  const wh = spawnSync(process.execPath, [join(scripts, "rank-eval.mjs"), corpusPath, "--golden", wrongHash, "--result-doc", "none"], { encoding: "utf8", cwd: scripts });
  ok("a golden file for a different corpus hash is rejected", wh.status !== 0 && /different frozen corpus/.test(wh.stderr));

  mock.stop();
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
}

console.log(`\nrank-eval unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
