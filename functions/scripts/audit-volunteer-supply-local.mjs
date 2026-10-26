// Read the real persisted, deduplicated public corpus; never writes Firestore.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { db, distanceMeters } from "../lib/common.js";
import { SAN_JOSE } from "../lib/ingest/areas.js";
import { titleKey } from "../lib/ingest/normalize.js";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899");
assert.equal(process.env.GCLOUD_PROJECT, "connectify-19dd8");
const output = process.argv[2];
assert.ok(output, "Supply a local JSON report path");
const now = Date.now(), radiusMeters = SAN_JOSE.radiusMiles * 1609.344;
const docs = (await db.collection("events").where("category", "==", "Volunteer").get()).docs;
const rows = docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(d =>
  d.active === true && d.hidden === false && d.broadcast === true && d.removed !== true &&
  d.date?.toMillis?.() > now && (!d.applicationDeadline?.toMillis || d.applicationDeadline.toMillis() > now) &&
  Array.isArray(d.sourceKeys) && d.sourceKeys.length > 0 &&
  typeof d.latitude === "number" && Number.isFinite(d.latitude) &&
  typeof d.longitude === "number" && Number.isFinite(d.longitude) &&
  distanceMeters(SAN_JOSE.center.lat, SAN_JOSE.center.lng, d.latitude, d.longitude) <= radiusMeters)
  .sort((a, b) => a.date.toMillis() - b.date.toMillis() || a.id.localeCompare(b.id));
const unique = [], duplicates = [];
for (const row of rows) {
  const match = unique.find(previous => titleKey(row.title) === titleKey(previous.title) &&
    Math.abs(row.date.toMillis() - previous.date.toMillis()) <= 120 * 60000 &&
    distanceMeters(row.latitude, row.longitude, previous.latitude, previous.longitude) <= 300);
  if (match) duplicates.push({ id: row.id, retainedId: match.id });
  else unique.push(row);
}
const bySource = {};
for (const row of unique) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
const report = { checkedAt: new Date(now).toISOString(), emulator: process.env.FIRESTORE_EMULATOR_HOST,
  areaId: SAN_JOSE.id, center: SAN_JOSE.center, radiusMiles: SAN_JOSE.radiusMiles,
  totalVolunteerDocuments: docs.length, currentPublicInRadiusBeforeAuditDedupe: rows.length,
  currentPublicInRadius: unique.length, withinNext30Days: unique.filter(d => d.date.toMillis() <= now + 30 * 86400000).length,
  threshold: 30, thresholdMet: unique.length >= 30, bySource, duplicates,
  dedupeRule: "Same normalized title; starts within 120 minutes; locations within 300 metres. Different dated occurrences remain separate listings.",
  rows: unique.map(d => ({ id: d.id, title: d.title, description: d.description, source: d.source,
    start: d.date.toDate().toISOString(), locationName: d.locationName, latitude: d.latitude, longitude: d.longitude,
    website: d.website, minimumAge: d.minimumAge ?? null, maximumAge: d.maximumAge ?? null, sourceKeys: d.sourceKeys })) };
if (process.argv[3]) {
  const review = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const confirmed = report.rows.filter(row => review.confirmedRows.some(previous => previous.id === row.id &&
    previous.title === row.title && previous.start === row.start && previous.website === row.website &&
    previous.descriptionSHA256 === createHash("sha256").update(row.description ?? "").digest("hex")));
  report.invitationReview = { path: process.argv[3], confirmedCurrentInRadius: confirmed.length,
    confirmedWithin30Days: confirmed.filter(d => new Date(d.start).getTime() <= now + 30 * 86400000).length,
    confirmedIds: confirmed.map(d => d.id), thresholdMet: confirmed.length >= 30 };
}
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (!(report.invitationReview?.thresholdMet ?? report.thresholdMet)) throw new Error("Fewer than 30 current public Volunteer invitations in radius; do not mark D2 complete.");
