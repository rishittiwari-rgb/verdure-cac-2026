// B5: actual source orchestration failure, full-corpus metrics, access and audit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db, utcMonthKey } = await import("../lib/common.js");
const { runSource } = await import("../lib/ingest/index.js");
const { LAUNCH_AREAS } = await import("../lib/ingest/areas.js");
const { loadSourceHealth, recordSourceHealth, sourceHealthId } = await import("../lib/ingest/health.js");
const { Timestamp } = await import("firebase-admin/firestore");
const suffix = Date.now().toString(36), area = LAUNCH_AREAS[0], started = Date.now();
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function account(label, method = "signUp") {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${label}-${suffix}@example.test`,
      password: "local-fixture-password", returnSecureToken: true }) });
  const data = await r.json(); assert.ok(data.idToken); return data;
}
async function call(user, data = {}) {
  const r = await fetch("http://127.0.0.1:5002/connectify-19dd8/us-central1/staffOperations", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  return r.json();
}
let staff = await account("operations-staff"); const normal = await account("operations-user");
execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local operations proof"], { env: process.env });
staff = await account("operations-staff", "signInWithPassword");
const healthRef = db.doc(`sourceHealth/${sourceHealthId("ticketmaster", area.id)}`), treasuryRef = db.doc(`treasury/${utcMonthKey()}`);
const beforeHealth = await healthRef.get(), beforeTreasury = await treasuryRef.get();
const legacySource = `legacy-fixture-${suffix}`, legacyIds = [`legacy-good-${suffix}`, `legacy-bad-${suffix}`];
const own = [db.doc(`events/operations-${suffix}-1`), db.doc(`events/operations-${suffix}-2`),
  db.doc(`moderationQueue/operations-${suffix}`), db.doc(`organizers/operations-${suffix}`)];
try {
  check("non-admin cannot read operations", (await call(normal)).error?.status === "PERMISSION_DENIED");
  check("unknown launch area is refused", (await call(staff, { areaId: "unknown" })).error?.status === "INVALID_ARGUMENT");
  const baseline = (await call(staff)).result; assert.ok(baseline);
  const event = { areaId: area.id, active: true, hidden: false, removed: false, source: "organizer", title: `Unique fictional duplicate ${suffix}`,
    date: Timestamp.fromMillis(Date.now() + 2 * 86_400_000), locationName: "Fictional duplicate venue", latitude: 37.335, longitude: -121.89 };
  const batch = db.batch(); batch.create(own[0], event); batch.create(own[1], event);
  batch.create(own[2], { status: "open", firstReportedAt: Timestamp.fromMillis(Date.now() - 23 * 3_600_000) });
  batch.create(own[3], { status: "pending", createdAt: Timestamp.now() }); await batch.commit();
  await treasuryRef.set({ dollarsCommitted: 75, dollarsFulfilled: 40, plannerCostCents: 112, plannerCostUsd: 0, plannerCalls: 56,
    eventPlannerSessions: 4, serpApiCalls: 17, serpApiCostCents: 0, serpApiCostUsd: 0 }, { merge: true });
  const good = await runSource("ticketmaster", area, {}, []);
  check("successful empty response is persisted as zero returned", good.errors.length === 0 && good.fetched === 0);
  const failed = await runSource("ticketmaster", area, {}); // Missing key throws before ANY vendor/network call.
  check("actual throwing adapter produces a persisted failure", failed.errors[0] === "TICKETMASTER_KEY not configured");
  const snapshot = (await call(staff)).result; assert.ok(snapshot);
  const source = snapshot.sources.find((s) => s.source === "ticketmaster");
  check("overview exposes latest source error and preceding successful run", source.lastOutcome === "failed" && source.currentErrors.includes("TICKETMASTER_KEY not configured") &&
    source.lastSuccessfulRunAtMs >= started && source.lastSuccessfulEvents === 0);
  check("current counts include newly added visible upcoming events", snapshot.activeEvents.total === baseline.activeEvents.total + 2 &&
    snapshot.activeEvents.bySource.organizer === baseline.activeEvents.bySource.organizer + 2);
  check("duplicate metric uses venue title time and records denominator", snapshot.duplicates.suspected === baseline.duplicates.suspected + 1 &&
    snapshot.duplicates.active === baseline.duplicates.active + 2 && snapshot.duplicates.rate === snapshot.duplicates.suspected / snapshot.duplicates.active);
  check("pending queue counts and oldest age come from current state", snapshot.queues.pendingReports === baseline.queues.pendingReports + 1 &&
    snapshot.queues.oldestReportHours >= 23 && snapshot.queues.pendingOrganizers === baseline.queues.pendingOrganizers + 1);
  check("reward commitments/fulfilled spend are distinct against 200 cap", snapshot.spend.rewardCommittedUsd === 75 && snapshot.spend.rewardFulfilledUsd === 40 && snapshot.spend.rewardCapUsd === 200);
  check("planner cents convert to dollars and all call types show", snapshot.spend.plannerEstimatedUsd === 1.12 && snapshot.spend.adventurePlannerCalls === 56 && snapshot.spend.eventPlannerCalls === 4);
  check("SerpApi free-quota cost/call cap are explicit", snapshot.spend.serpApiEstimatedUsd === 0 && snapshot.spend.serpApiCalls === 17 && snapshot.spend.serpApiCap === 90 && snapshot.spend.note.includes("not a vendor invoice"));
  await recordSourceHealth(good, Timestamp.fromMillis(started - 86_400_000));
  check("an older concurrent success cannot erase a newer failure", (await loadSourceHealth("ticketmaster", area.id)).lastOutcome === "failed");
  await db.doc(`ingestRuns/${legacyIds[0]}`).create({ source: legacySource, areaId: area.id, runAt: Timestamp.fromMillis(started - 10_000), errors: [], fetched: 8 });
  await db.doc(`ingestRuns/${legacyIds[1]}`).create({ source: legacySource, areaId: area.id, runAt: Timestamp.fromMillis(started), errors: ["Fictional legacy outage"], fetched: 0 });
  const legacy = await loadSourceHealth(legacySource, area.id);
  check("pre-summary history still exposes last success and latest failure", legacy.lastSuccessfulEvents === 8 && legacy.lastSuccessfulRunAtMs === started - 10_000 && legacy.currentErrors[0] === "Fictional legacy outage");
  const audits = await db.collection("staffAudit").where("actor", "==", staff.localId).get();
  check("operations reads are immutable actor/time/context audits", audits.docs.filter((d) => d.data().action === "operations:view").length === 2 &&
    audits.docs.filter((d) => d.data().action === "operations:view").every((d) => d.data().after.activeEvents >= 2 && d.data().time.toMillis() > 0));
  console.log(`${checks} operations emulator checks passed`);
} finally {
  for (const ref of own) await ref.delete();
  for (const id of legacyIds) await db.doc(`ingestRuns/${id}`).delete();
  const runs = await db.collection("ingestRuns").where("source", "==", "ticketmaster").where("runAt", ">=", Timestamp.fromMillis(started)).get();
  for (const d of runs.docs) await d.ref.delete();
  if (beforeHealth.exists) await healthRef.set(beforeHealth.data()); else await healthRef.delete();
  if (beforeTreasury.exists) await treasuryRef.set(beforeTreasury.data()); else await treasuryRef.delete();
}
process.exit(0);
