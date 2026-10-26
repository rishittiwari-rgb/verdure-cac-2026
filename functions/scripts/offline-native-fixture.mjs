// Disposable accounts for actual native SDK / sign-in UI tests. Loopback only.
// Plus here is an Admin-set entitlement fixture, not an Apple purchase result.
import assert from "node:assert/strict";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { getAuth } = await import("firebase-admin/auth");
const { Timestamp } = await import("firebase-admin/firestore");
const event = db.doc("events/offline-native-park-event");
if (process.argv.includes("--clean")) await event.delete();
else {
  const { catalog } = await import("../lib/parks/api.js");
  const { index } = await catalog();
  const park = index.find(p => p.id === "county-boundaries_20");
  assert.ok(park, "Populate the permission-checked real park catalog first");
  await event.set({ title: "Fictional offline park event", description: "Disposable local UI fixture, not a real park event.",
    organizer: "Fictional QA Organizer", creatorID: "offline-native-plus", category: "Workshop", locationName: park.name,
    latitude: park.latitude, longitude: park.longitude, date: Timestamp.fromMillis(Date.now() + 86400000),
    endDate: Timestamp.fromMillis(Date.now() + 93600000), active: true, hidden: false, broadcast: true,
    minimumAge: 13, isFree: true, source: "Local offline fixture", imageURL: "https://unapproved.example.test/not-fetched" });
}
for (const kind of ["plus", "free"]) {
  const uid = `offline-native-${kind}`, email = `${uid}@example.test`;
  let user;
  try { user = await getAuth().getUser(uid); }
  catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  if (user) assert.equal(user.email, email, "Refuse to overwrite an unrelated account");
  if (process.argv.includes("--clean")) {
    await db.recursiveDelete(db.doc(`users/${uid}`));
    if (user) await getAuth().deleteUser(uid);
  } else {
    if (!user) await getAuth().createUser({ uid, email, password: "local-offline-native-only", displayName: "Fictional Offline Member" });
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.doc(`users/${uid}`).set({ displayName: "Fictional Offline Member", birthYear: 2000, ageBand: "adult",
      pointsBalance: 3000, lifetimePoints: 3000, savedEventIDs: [],
      plusExpiresAt: kind === "plus" ? Timestamp.fromMillis(Date.now() + 86400000) : null });
  }
  for (const action of ["offlinePackGenerate", "offlinePackRead", "offlinePackControl"]) await db.doc(`rateLimits/${uid}_${action}`).delete();
  console.log(`${process.argv.includes("--clean") ? "Removed" : "Seeded"} ${uid} [local entitlement fixture]`);
}
