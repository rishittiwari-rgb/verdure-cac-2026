/**
 * Local investor-demo state on the emulators. Emulator only, refuses otherwise.
 *
 * Builds on demo-account-local.mjs (the Demo Judge account) and gives it a lived-in
 * account the way a real user would get one: three demo friends are added through
 * sendFriendRequest / respondToFriendRequest, everyone RSVPs to REAL upcoming
 * ingested events through rsvpToEvent, and places from the bundled OpenStreetMap
 * snapshot are collected through collectPlace. Only the starting points balance is
 * written directly, which is the same thing seed-review-account.mjs does for App
 * Review (points are server-authoritative; a client cannot mint them).
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node scripts/demo-investor-local.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899", "emulator only");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099", "emulator only");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { db } = await import("../lib/common.js");
const { getAuth } = await import("firebase-admin/auth");
const { Timestamp } = await import("firebase-admin/firestore");

const FUNCTIONS = "http://127.0.0.1:5002/connectify-19dd8/us-central1";
const DEMO = { uid: "demo-judge", email: "demo-judge@example.test", password: "local-demo-walkthrough" };
const FRIENDS = [
  { uid: "demo-friend-maya", name: "Maya Ortiz", birthYear: 1997 },
  { uid: "demo-friend-jordan", name: "Jordan Lee", birthYear: 2000 },
  { uid: "demo-friend-priya", name: "Priya Shah", birthYear: 1995 },
].map((f) => ({ ...f, email: `${f.uid}@example.test`, password: "local-demo-friend" }));
// A few weeks of real use: enough to redeem a partner perk (500–1,500 points) live,
// with the first gift card (35,000) shown as progress rather than reached.
const STARTING_BALANCE = 2_400;

const run = (script, ...args) => execFileSync(process.execPath, [here(script), ...args], { env: process.env, stdio: "inherit" });

async function token({ email, password }) {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await r.json();
  assert.ok(body.idToken, `sign-in failed for ${email}: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

async function call(idToken, name, data) {
  const r = await fetch(`${FUNCTIONS}/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await r.json();
  if (body.error) throw new Error(`${name}: ${body.error.status} ${body.error.message}`);
  return body.result;
}

// 0. Undo earlier demo RSVPs so attendee counts stay real across reruns.
const { FieldValue } = await import("firebase-admin/firestore");
for (const uid of [DEMO.uid, ...FRIENDS.map((f) => f.uid)]) {
  for (const a of (await db.collectionGroup("attendees").where("uid", "==", uid).get()).docs) {
    await a.ref.delete();
    await a.ref.parent.parent.set({ attendeeCount: FieldValue.increment(-1) }, { merge: true });
  }
}

// 1. The Demo Judge account, recreated clean, plus its starting balance.
run("demo-account-local.mjs");
await db.doc(`users/${DEMO.uid}`).set({ pointsBalance: STARTING_BALANCE, lifetimePoints: STARTING_BALANCE }, { merge: true });

// 2. Demo friends: recreated clean each run so the script is idempotent.
for (const f of FRIENDS) {
  try { await getAuth().deleteUser(f.uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  await db.recursiveDelete(db.doc(`users/${f.uid}`));
  await getAuth().createUser({ uid: f.uid, email: f.email, password: f.password, displayName: f.name });
  await db.doc(`users/${f.uid}`).set({ displayName: f.name, birthYear: f.birthYear, ageBand: "adult",
    interests: ["Parks", "Trails", "Community"], pointsBalance: 0 });
}
const demoToken = await token(DEMO);
const friendTokens = Object.fromEntries(await Promise.all(FRIENDS.map(async (f) => [f.uid, await token(f)])));
for (const f of FRIENDS) {
  await call(friendTokens[f.uid], "sendFriendRequest", { targetUid: DEMO.uid });
  await call(demoToken, "respondToFriendRequest", { fromUid: f.uid, accept: true });
}
console.log(`Friends: ${FRIENDS.map((f) => f.name).join(", ")}`);

// 3. RSVPs to real upcoming events near San José (next 10 days, open to everyone).
const now = Date.now();
const upcoming = (await db.collection("events").where("areaId", "==", "san-jose-ca").where("active", "==", true)
  .where("adultOnly", "==", false)
  .where("date", ">=", Timestamp.fromMillis(now + 2 * 3600_000))
  .where("date", "<=", Timestamp.fromMillis(now + 10 * 86400_000)).orderBy("date").limit(400).get()).docs
  .filter((d) => d.data().latitude != null && d.data().hidden !== true && d.data().virtual !== true);
// Outdoor and volunteer events first, one listing per title (a vote centre has many).
const priority = (d) => { const t = d.data().topicTags ?? [];
  return t.includes("outdoors") || t.includes("nature") ? 0 : t.includes("volunteering") ? 1 : t.includes("community") ? 2 : 3; };
const seen = new Set();
const picks = upcoming.filter((d) => /election|vote center/i.test(d.data().title) === false)
  .sort((a, b) => priority(a) - priority(b))
  .filter((d) => !seen.has(d.data().title) && seen.add(d.data().title)).slice(0, 6);
assert.ok(picks.length >= 3, `only ${picks.length} upcoming events to RSVP to; run the corpus refresh first`);
const rsvp = async (idToken, doc) => call(idToken, "rsvpToEvent", { eventId: doc.id, going: true });
await rsvp(demoToken, picks[0]); await rsvp(demoToken, picks[1]);
for (const [i, f] of FRIENDS.entries()) {
  for (const doc of [picks[0], picks[2 + i], picks[(3 + i) % picks.length]]) await rsvp(friendTokens[f.uid], doc);
}
console.log(`RSVPs: ${picks.map((d) => d.data().title).join(" | ")}`);

// 4. Collect real places from the bundled OpenStreetMap snapshot (the same ids the app shows).
const snapshot = JSON.parse(readFileSync(here("../../Verdure/Verdure/Resources/osm-snapshot-san-jose.json"), "utf8"));
const at = (e) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon });
const sjsu = { lat: 37.3352, lng: -121.8811 };
const places = snapshot.elements
  .filter((e) => /\b(park|garden|trail)\b/i.test(e.tags?.name ?? "") && at(e).lat != null)
  .sort((a, b) => Math.hypot(at(a).lat - sjsu.lat, at(a).lng - sjsu.lng) - Math.hypot(at(b).lat - sjsu.lat, at(b).lng - sjsu.lng))
  .slice(0, 8);
const collect = (idToken, e, points) => call(idToken, "collectPlace", { placeId: `osm-${e.id}`, claimedPoints: points, ...at(e) });
for (const e of places.slice(0, 5)) await collect(demoToken, e, 10);
for (const [i, f] of FRIENDS.entries()) for (const e of places.slice(i, i + 3 + i)) await collect(friendTokens[f.uid], e, 10);
console.log(`Collected: ${places.slice(0, 5).map((e) => e.tags.name).join(", ")}`);

// 5. Placeholder partner perks (emulator only; no agreements exist).
run("seed-partners.mjs");
console.log(`Investor demo ready: sign in as ${DEMO.email} / ${DEMO.password}`);
