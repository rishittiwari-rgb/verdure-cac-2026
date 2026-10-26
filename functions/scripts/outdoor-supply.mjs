/**
 * Outdoor supply on the local emulator: genuinely outdoor/nature events within a radius
 * of SJSU over the next N days. One fixed definition, so before → after counts compare:
 * a Midpen listing, a Cleanup event, or a non-library listing whose title names a hike,
 * trail, walk, preserve, birding, cleanup, restoration and so on. Library programmes are
 * excluded because branch names ("Educational Park", "Rose Garden") are not outdoor events.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/outdoor-supply.mjs [miles=15] [days=14]
 */
import assert from "node:assert/strict";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899", "emulator only");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { Timestamp } = await import("firebase-admin/firestore");

export const OUTDOOR_TITLE = /\b(hike|hikes|hiking|trail|trails|nature walk|walk|ramble|preserve|birding|bird walk|wildflower|creek|open space|outdoor|outdoors|ranger|docent|cleanup|clean-up|restoration|tree planting|garden workday|nature)\b/i;
export const LIBRARY_SOURCES = new Set(["bibliocommons", "libcal"]);
export const isOutdoor = (x) => x.source === "midpen" || x.category === "Cleanup"
  || (OUTDOOR_TITLE.test(x.title ?? "") && !LIBRARY_SOURCES.has(x.source));

const SJSU = { lat: 37.3352, lng: -121.8811 };
const miles = Number(process.argv[2] ?? 15), days = Number(process.argv[3] ?? 14);
const mi = (a, b, c, d) => { const r = (x) => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h)); };
const now = Date.now();
const snap = await db.collection("events").where("areaId", "==", "san-jose-ca").where("active", "==", true)
  .where("date", ">=", Timestamp.fromMillis(now)).where("date", "<=", Timestamp.fromMillis(now + days * 86_400_000)).get();
const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  .filter((x) => typeof x.latitude === "number" && mi(SJSU.lat, SJSU.lng, x.latitude, x.longitude) <= miles);
const outdoor = rows.filter(isOutdoor);
const bySource = {};
for (const x of outdoor) bySource[x.source] = (bySource[x.source] ?? 0) + 1;
console.log(JSON.stringify({ at: new Date(now).toISOString(), miles, days, events: rows.length, outdoor: outdoor.length, bySource }));
for (const x of outdoor.sort((a, b) => a.date.toMillis() - b.date.toMillis())) {
  console.log(`  ${x.date.toDate().toISOString().slice(0, 16)}  ${mi(SJSU.lat, SJSU.lng, x.latitude, x.longitude).toFixed(1)} mi  ${x.source}  ${x.title.slice(0, 60)}`);
}
process.exit(0);
