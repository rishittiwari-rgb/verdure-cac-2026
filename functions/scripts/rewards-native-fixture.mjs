// Disposable credentials/geocoder for actual native staff-callable tests.
// Claims use the existing CLI; offers are created by the native SDK test itself.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { getAuth } = await import("firebase-admin/auth");
const { geocodeFixtureId } = await import("../lib/staff-partners.js");
const uid = "qa-rewards-native-staff", email = `${uid}@example.test`;
const partnerId = "qa-rewards-native-partner";
const address = "42 Fictional Native Rewards Road";
let user;
try { user = await getAuth().getUser(uid); }
catch (error) { if (error.code !== "auth/user-not-found") throw error; }
if (user) assert.equal(user.email, email, "Refuse to overwrite an unrelated account");
// RewardsLiveCatalogTests suffixes its offer ids per run (it reruns without a reseed), so every
// fixture-prefixed offer goes, not only the fixed ids (the loop still refuses another partner's).
const offerIds = new Set(["qa-rewards-native-stocked", "qa-rewards-native-soldout", "qa-rewards-native-window", "qa-rewards-native-ui", "qa-rewards-native-map-ui"]);
for (const ref of await db.collection("partnerPerks").listDocuments()) if (ref.id.startsWith("qa-rewards-native-")) offerIds.add(ref.id);
for (const id of offerIds) {
  const perk = await db.doc(`partnerPerks/${id}`).get();
  if (perk.exists) assert.equal(perk.data().partnerId, partnerId, "Refuse to remove an unrelated offer");
  await db.recursiveDelete(perk.ref);
  await db.doc(`perkStatus/${id}`).delete();
}
await db.doc(`partners/${partnerId}`).delete();
await db.doc(`partnerStatus/${partnerId}`).delete();
await db.doc(`qaGeocodes/${geocodeFixtureId(address)}`).delete();
await db.recursiveDelete(db.doc(`users/${uid}`));
await db.doc(`rateLimits/${uid}_redeemReward`).delete();
if (process.argv.includes("--clean")) {
  if (user) await getAuth().deleteUser(uid);
  console.log("Removed local native Rewards fixture; immutable staff audits retained");
} else {
  if (!user) await getAuth().createUser({ uid, email, password: "local-rewards-native-only" });
  await db.doc(`users/${uid}`).set({ displayName: "Fictional Rewards Tester", birthYear: 2000,
    ageBand: "adult", pointsBalance: 3000, lifetimePoints: 3000, redeemedRewardIDs: [] });
  await db.doc(`qaGeocodes/${geocodeFixtureId(address)}`).set({ response: { result: { addressMatches: [
    { matchedAddress: address, coordinates: { x: -114.1, y: 33.2 } }
  ] } } });
  execFileSync(process.execPath, [fileURLToPath(new URL("staff-admin.mjs", import.meta.url)),
    "--uid", uid, "--grant", "--reason", "Local fictional native Rewards integration fixture"], { env: process.env, stdio: "inherit" });
  console.log("Seeded local native Rewards credentials and fictional geocoder");
}
