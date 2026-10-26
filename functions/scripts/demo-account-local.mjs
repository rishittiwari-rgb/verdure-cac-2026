/**
 * Local demo account for the recorded walkthrough and DemoWalkthroughUITests.
 * Emulator only: creates one adult Auth user and its /users profile, nothing else
 * (no events, points or fixtures), so every card on screen is a real ingested event.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node scripts/demo-account-local.mjs          # --clean removes it
 */
import assert from "node:assert/strict";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899", "emulator only");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099", "emulator only");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { getAuth } = await import("firebase-admin/auth");

const uid = "demo-judge", email = "demo-judge@example.test", password = "local-demo-walkthrough";
let existing;
try { existing = await getAuth().getUser(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
await db.recursiveDelete(db.doc(`users/${uid}`));
if (process.argv.includes("--clean")) {
  if (existing) await getAuth().deleteUser(uid);
  console.log("Removed the local demo account");
} else {
  if (!existing) await getAuth().createUser({ uid, email, password, displayName: "Demo Judge" });
  await db.doc(`users/${uid}`).set({
    displayName: "Demo Judge", birthYear: 1998, ageBand: "adult",
    interests: ["Parks", "Trails", "Community"], pointsBalance: 0,
  });
  await db.doc(`rateLimits/${uid}_recommendedEvents`).delete();
  console.log(`Local demo account ready: ${email} / ${password}`);
}
