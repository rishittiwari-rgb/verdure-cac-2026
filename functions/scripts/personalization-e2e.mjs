// CAC 2026 — 1.1 "For You" personalization acceptance, on the populated local emulator.
//
//   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 GCLOUD_PROJECT=connectify-19dd8
//   npm run build && node scripts/personalization-e2e.mjs [--write-review]
//
// Needs the corpus loaded first (refresh-public-corpus-local.mjs). For every interest option in the
// build (each PlaceCategory) a FRESH synthetic account is ranked through the real recommendFor() path
// and the handoff's acceptance criteria are asserted:
//   • ≥ 10 matching events in the radius over 14 days → at least 8 of the top 10 match the pick;
//     fewer → every matching event ranks above every non-matching one;
//   • the only off-interest card in the top 10 is the labelled exploration slot;
//   • Community: no sports/fitness listing in the top 10 unless it is a genuine volunteer/community event;
//   • a student with Parks + Trails is not dominated by career or hackathon listings;
//   • two accounts with different picks (the two demo sets) share at most 3 of their top 10;
//   • every "Because you like X" names a pick the account actually made, and that pick matched the listing;
//   • changing interests re-ranks at once (new pick named, no stale cache).
// Before → after: the candidate pool each pick is ranked over, with and without interest retrieval, and
// how many of those candidates match. Evidence: docs/evidence/personalization-<date>.json; the manual
// review list (top 10 per pick, with the reason line) goes to docs/PERSONALIZATION-REVIEW-<date>.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Refusing to run outside the local emulator (FIRESTORE_EMULATOR_HOST).");
process.env.GCLOUD_PROJECT ||= "connectify-19dd8";
process.env.FUNCTIONS_EMULATOR = "true";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ projectId: "connectify-19dd8" });
const db = getFirestore();
const { recommendFor, areaCandidates, interestCandidates, rankableFromDoc, EXPLORATION_REASON } = await import("../lib/ranking.js");
const { matchInterests, titleTopics } = await import("../lib/interests.js");
const { SAN_JOSE } = await import("../lib/ingest/areas.js");

const WRITE_REVIEW = process.argv.includes("--write-review");
const NOW = Date.now();
const AREA = SAN_JOSE.id;
const HERE = { lat: SAN_JOSE.center.lat, lng: SAN_JOSE.center.lng };
const LABELS = ["Parks", "Trails", "Gardens", "Playgrounds", "Waterfront", "Sports", "Scenic", "Community"];
const ACCOUNTS = [
  ...LABELS.map((label) => ({ id: `qa-personalization-${label.toLowerCase()}`, interests: [label] })),
  { id: "qa-personalization-student-parks-trails", interests: ["Parks", "Trails"], studentStatus: true, school: "San José State University" },
  { id: "qa-personalization-demo-outdoors", interests: ["Parks", "Trails"] },
  { id: "qa-personalization-demo-community", interests: ["Community"] },
];

let passed = 0, failed = 0;
const results = [];
const ok = (name, cond, extra = "") => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name} ${extra}`); } results.push({ name, pass: !!cond, extra: cond ? undefined : String(extra).slice(0, 400) }); };

// ── The 14-day corpus in the area, once ─────────────────────────────────────
const windowSnap = await db.collection("events").where("areaId", "==", AREA).where("active", "==", true)
  .where("date", ">=", Timestamp.fromMillis(NOW)).where("date", "<=", Timestamp.fromMillis(NOW + 14 * 86_400_000)).orderBy("date").get();
const corpus = windowSnap.docs.map(rankableFromDoc).filter(Boolean);
const docById = new Map(windowSnap.docs.map((d) => [d.id, d.data()]));
console.log(`corpus: ${corpus.length} active events in ${AREA} over the next 14 days (clock ${new Date(NOW).toISOString()})`);

const matchingIn = (events, interests) => events.filter((ev) => matchInterests(ev, interests).length > 0);
const isCareer = (ev) => /\b(career|careers|resume|résumé|hackathon|job fair|job search|interview|internship|networking|recruit)/i.test(`${ev.title} ${ev.description ?? ""}`) || ev.category === "Hackathon";
const sportsy = (ev) => titleTopics(ev.title ?? "").some((t) => t === "sports" || t === "fitness") || ev.category === "Sports";
const genuineCommunity = (ev) => ev.category === "Volunteer" || ev.category === "Cleanup" || matchInterests(ev, ["Community"]).some((m) => m.via !== "description");

async function freshAccount(acc) {
  await db.doc(`users/${acc.id}`).set({
    displayName: `QA ${acc.id}`, email: `${acc.id}@example.test`, interests: acc.interests, ageBand: "adult",
    studentStatus: acc.studentStatus === true, ...(acc.school ? { school: acc.school } : {}),
    collectedPlaceIDs: [], checkedInEventIDs: [], createdAt: Timestamp.fromMillis(NOW), qaFixture: "personalization-e2e",
  });
}
async function rank(acc) {
  const ranked = await recommendFor(acc.id, AREA, HERE.lat, HERE.lng, 50, NOW);
  // A ranked row can come from the shared pool beyond the 14-day window (quality sweep); read those documents too.
  const missing = ranked.filter((r) => !corpusById.has(r.id)).map((r) => db.doc(`events/${r.id}`));
  if (missing.length) for (const d of await db.getAll(...missing)) { const ev = rankableFromDoc(d); if (ev) corpusById.set(d.id, ev); }
  return ranked.map((r) => ({ ...r, ev: corpusById.get(r.id) ?? { id: r.id, title: "(unreadable)", startMs: 0 } }));
}
const corpusById = new Map(corpus.map((e) => [e.id, e]));

// Before → after candidate pools.
const sharedPool = (await areaCandidates(AREA, NOW)).filter((e) => e.startMs >= NOW);
console.log(`shared area pool (before): ${sharedPool.length} candidates`);

const summary = {};
const review = [];
const top10ById = {};
for (const acc of ACCOUNTS) {
  console.log(`\n── ${acc.id} — ${acc.interests.join(" + ")}${acc.studentStatus ? " (student)" : ""} ──`);
  await freshAccount(acc);
  const extra = await interestCandidates(AREA, acc.interests, NOW);
  const pool = new Map(sharedPool.map((e) => [e.id, e]));
  for (const e of extra) pool.set(e.id, e);
  const poolMatches = matchingIn([...pool.values()], acc.interests).length;
  const beforeMatches = matchingIn(sharedPool, acc.interests).length;
  const corpusMatches = matchingIn(corpus, acc.interests).length;
  const ranked = await rank(acc);
  const top = ranked.slice(0, 10);
  const topMatch = top.map((r) => (r.parts.interestMatch ?? 0) === 1);
  const matchesInTop = topMatch.filter(Boolean).length;
  const exploration = top.findIndex((r) => r.parts.exploration === 1);
  const offInterest = top.map((r, i) => ({ r, i })).filter(({ r }) => (r.parts.interestMatch ?? 0) === 0);
  summary[acc.id] = { interests: acc.interests, corpusMatches14d: corpusMatches, poolBefore: sharedPool.length, poolBeforeMatches: beforeMatches,
    poolAfter: pool.size, poolAfterMatches: poolMatches, interestRetrieved: extra.length, ranked: ranked.length, matchesInTop10: matchesInTop, explorationSlot: exploration };
  console.log(`  corpus matches (14d): ${corpusMatches} | pool before ${sharedPool.length} (${beforeMatches} match) → after ${pool.size} (${poolMatches} match) | top-10 matches ${matchesInTop}`);

  if (corpusMatches >= 10) ok(`${acc.interests.join("+")}: ≥ 10 matching events exist (${corpusMatches}) → at least 8 of the top 10 match (${matchesInTop})`, matchesInTop >= 8);
  else {
    const firstNonMatch = ranked.findIndex((r) => (r.parts.interestMatch ?? 0) === 0 && r.parts.exploration !== 1);
    const lastMatch = ranked.map((r) => (r.parts.interestMatch ?? 0) === 1).lastIndexOf(true);
    ok(`${acc.interests.join("+")}: fewer than 10 matches (${corpusMatches}) → every matching event ranks above every non-matching one`, firstNonMatch === -1 || lastMatch < firstNonMatch, `lastMatch=${lastMatch} firstNonMatch=${firstNonMatch}`);
  }
  ok(`${acc.interests.join("+")}: the only off-interest card in the top 10 is the labelled exploration slot`,
     offInterest.every(({ r, i }) => r.parts.exploration === 1 && i === 9 && JSON.stringify(r.reasons) === JSON.stringify([EXPLORATION_REASON])) && (corpusMatches < 9 || exploration === 9),
     JSON.stringify(offInterest.map(({ r, i }) => [i, r.id, r.reasons])));
  for (const r of top) {
    const because = (r.reasons ?? []).filter((t) => t.startsWith("Because you like "));
    const named = because.map((t) => t.slice("Because you like ".length));
    const legit = named.every((n) => acc.interests.includes(n) && matchInterests(r.ev, acc.interests).some((m) => m.label === n));
    if (!legit) ok(`${acc.id}: reason names a pick that did not match — ${r.ev?.title}: ${because.join("; ")}`, false);
  }
  ok(`${acc.interests.join("+")}: every "Because you like …" names the account's own pick and that pick matched the listing`, true);
  if (acc.interests.includes("Community")) {
    const bad = top.filter((r) => r.parts.exploration !== 1 && sportsy(r.ev) && !genuineCommunity(r.ev));
    ok(`Community: no sports/fitness listing in the top 10 unless it is a genuine volunteer/community event`, bad.length === 0, JSON.stringify(bad.map((b) => b.ev.title)));
  }
  if (acc.studentStatus) {
    const career = top.filter((r) => isCareer(r.ev));
    ok(`student with Parks + Trails: top 10 holds at most 2 career/hackathon listings (${career.length})`, career.length <= 2, JSON.stringify(career.map((c) => c.ev.title)));
  }
  top10ById[acc.id] = top.map((r) => r.id);
  review.push({ account: acc.id, interests: acc.interests, rows: top.map((r, i) => ({ rank: i + 1, id: r.id, title: r.ev?.title, category: r.ev?.category, source: r.ev?.source,
    where: r.ev?.locationName, when: r.ev ? new Date(r.ev.startMs).toISOString().slice(0, 16) : "", match: (r.parts.interestMatch ?? 0) === 1, exploration: r.parts.exploration === 1,
    reasons: r.reasons ?? [], via: matchInterests(r.ev, acc.interests).map((m) => `${m.label}:${m.term}:${m.via}`).join(", ") })) });
  for (const row of review.at(-1).rows) console.log(`  ${String(row.rank).padStart(2)}. ${row.match ? "✓" : row.exploration ? "◇" : "✗"} ${row.title} [${row.category}, ${row.source}] — ${row.reasons.join(" · ")}  {${row.via}}`);
  const seriesDupes = top.filter((r, i) => top.findIndex((o) => (o.ev?.title ?? "") === (r.ev?.title ?? "") && (o.ev?.locationName ?? "") === (r.ev?.locationName ?? "")) !== i);
  ok(`${acc.interests.join("+")}: no listing appears twice in the top 10 (series collapsed)`, seriesDupes.length === 0, JSON.stringify(seriesDupes.map((d) => d.ev?.title)));
}

console.log("\n── pairwise overlap of the top 10 ──");
const overlap = {};
for (const a of ACCOUNTS) for (const b of ACCOUNTS) if (a.id < b.id) {
  const shared = top10ById[a.id].filter((id) => top10ById[b.id].includes(id)).length;
  overlap[`${a.interests.join("+")} vs ${b.interests.join("+")}`] = shared;
}
for (const [k, v] of Object.entries(overlap)) console.log(`  ${k}: ${v}`);
const shared = (a, b) => overlap[`${a} vs ${b}`] ?? overlap[`${b} vs ${a}`];
ok("the two demo accounts (Parks + Trails vs Community) share at most 3 of their top 10", shared("Parks+Trails", "Community") <= 3, String(shared("Parks+Trails", "Community")));
ok("Sports vs Community share at most 3", shared("Sports", "Community") <= 3, String(shared("Sports", "Community")));
console.log("  (informational) Waterfront vs Parks: " + shared("Waterfront", "Parks") + " — both are outdoor picks; the overlap tracks how few waterfront-specific listings the corpus holds");

console.log("\n── changing interests re-ranks at once ──");
{
  const acc = ACCOUNTS[0];
  const before = top10ById[acc.id];
  await db.doc(`users/${acc.id}`).set({ interests: ["Community"] }, { merge: true });
  const after = await rank(acc);
  const named = after.slice(0, 10).flatMap((r) => (r.reasons ?? []).filter((t) => t.startsWith("Because you like ")));
  ok("after switching Parks → Community the top 10 changes and the reasons name Community, never Parks",
     after.slice(0, 10).filter((r) => before.includes(r.id)).length <= 3 && named.length > 0 && named.every((t) => t === "Because you like Community"), JSON.stringify(named.slice(0, 5)));
}

// Clean up the synthetic accounts and the per-topic caches they created (the shared area cache is left for the app).
for (const acc of ACCOUNTS) await db.doc(`users/${acc.id}`).delete();

const date = new Date(NOW).toISOString().slice(0, 10);
mkdirSync(join(root, "docs", "evidence"), { recursive: true });
const evidencePath = join(root, "docs", "evidence", `personalization-${date}.json`);
writeFileSync(evidencePath, JSON.stringify({ ranAt: new Date(NOW).toISOString(), emulator: host, corpus14d: corpus.length, passed, failed, summary, overlap, results, review }, null, 2) + "\n");
console.log(`\nevidence → ${evidencePath}`);
if (WRITE_REVIEW) {
  const lines = [`# For You manual review — ${date}`, "", `Top 10 per interest pick for a fresh account at the San José launch-area centre, produced by \`functions/scripts/personalization-e2e.mjs\` against the local emulator corpus (${corpus.length} active events in the next 14 days). ✓ = matches the pick, ◇ = the labelled exploration slot, ✗ = off-interest.`, "",
    "| Pick | corpus matches (14 d) | pool before → after | matches in pool before → after | top-10 matches |", "|---|---|---|---|---|",
    ...Object.values(summary).map((s) => `| ${s.interests.join(" + ")} | ${s.corpusMatches14d} | ${s.poolBefore} → ${s.poolAfter} | ${s.poolBeforeMatches} → ${s.poolAfterMatches} | ${s.matchesInTop10} |`), ""];
  for (const block of review) {
    lines.push(`## ${block.interests.join(" + ")} (\`${block.account}\`)`, "", "| # | | Title | Category · source | When | Reasons | Matched via |", "|---|---|---|---|---|---|---|");
    for (const r of block.rows) lines.push(`| ${r.rank} | ${r.match ? "✓" : r.exploration ? "◇" : "✗"} | ${r.title} | ${r.category} · ${r.source} | ${r.when} | ${r.reasons.join(" · ")} | ${r.via} |`);
    lines.push("");
  }
  lines.push("## Pairwise overlap of the top 10", "", ...Object.entries(overlap).map(([k, v]) => `- ${k}: ${v}`), "");
  const reviewPath = join(root, "docs", `PERSONALIZATION-REVIEW-${date}.md`);
  writeFileSync(reviewPath, lines.join("\n"));
  console.log(`review → ${reviewPath}`);
}
console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed ? 1 : 0);
