// Exercise the legacy classifier migration and its second-pass idempotence.
// Run only inside an empty disposable Firestore emulator.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw new Error("Refusing to test against a non-local Firestore instance.");
}
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();
const date = new Date(Date.now() + 2 * 86_400_000);
const endDate = new Date(date.getTime() + 2 * 3_600_000);
await db.collection("events").doc("legacy").set({
  source: "bibliocommons", sourceEventId: "legacy", areaId: "san-jose-ca",
  title: "Community Trail Cleanup", description: "Join us to remove litter from the trail.",
  organizer: "Parks", date: Timestamp.fromDate(date), time: "10 AM",
  locationName: "Test park", latitude: 37.3382, longitude: -121.8863,
  category: "Social", tags: ["volunteer"], isFree: true, website: "https://example.org",
});
await db.collection("events").doc("already-enriched").set({
  source: "bibliocommons", sourceEventId: "already-enriched", areaId: "san-jose-ca",
  title: "Neighborhood gathering", description: "Meet neighbors at the park.",
  organizer: "Community", date: Timestamp.fromDate(date), endDate: Timestamp.fromDate(endDate),
  time: "10 AM", locationName: "Test park", latitude: 37.3382, longitude: -121.8863,
  category: "Social", categories: ["Social", "Volunteer"], classificationConfidence: 0.8,
  qualityScore: 0.8, inferredCost: "free", ageSuitability: "all", endInferred: false,
  tags: [], isFree: true,
});

const script = fileURLToPath(new URL("./backfill-classify.mjs", import.meta.url));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args],
  { encoding: "utf8", maxBuffer: 2_000_000 }));
const written = run("--write");
assert.equal(written.processed, 2);
assert.equal(written.changed, 1);
assert.equal(written.reclassified, 1);
const legacy = (await db.collection("events").doc("legacy").get()).data();
assert.equal(legacy.category, "Cleanup");
assert.ok(legacy.categories.includes("Cleanup"));
const complete = (await db.collection("events").doc("already-enriched").get()).data();
assert.deepEqual(complete.categories, ["Social", "Volunteer"]);
assert.equal(complete.classificationConfidence, 0.8);
const second = run();
assert.equal(second.processed, 2);
assert.equal(second.changed, 0);
console.log(JSON.stringify({ legacyMigrated: true, existingMergedLabelsPreserved: true,
  secondPassChanges: second.changed }));
