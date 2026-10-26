/**
 * Seed the App Store review account.
 *
 * A reviewer opening a fresh Verdure account sees zero points, no saved
 * events and no redeemable rewards — so the flows most likely to be questioned
 * (redemption, perk codes, member benefits) cannot be exercised at all. That is
 * a 2.1 rejection waiting to happen, and "just make an account" in the review
 * notes does not solve it because points are server-authoritative: a client
 * cannot mint them, which is the whole point of the economy design.
 *
 *   node functions/scripts/seed-review-account.mjs <uid>
 *
 * Against the LIVE project this needs Admin credentials
 * (GOOGLE_APPLICATION_CREDENTIALS). Against the emulator it needs
 * FIRESTORE_EMULATOR_HOST, which is how it should be rehearsed first.
 *
 * Idempotent: running it twice leaves the same state, not double the points.
 */

const uid = process.argv[2];
if (!uid) {
  console.error("Usage: node scripts/seed-review-account.mjs <uid>");
  console.error("The uid comes from registering appreview@verdure-app.com in the app first.");
  process.exit(1);
}

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

initializeApp(EMU
  ? { projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" }
  : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();

// Enough to redeem the $10 tier (10 * 7000) twice over and still have a
// balance visible on the profile — see POINTS_PER_DOLLAR in economy.ts.
const REVIEW_BALANCE = 150_000;

const userRef = db.collection("users").doc(uid);
const existing = (await userRef.get()).data();
if (!existing) {
  console.error(`No users/${uid} document. Register the account in the app first.`);
  process.exit(1);
}

// SET, not increment — that is what makes re-running safe.
await userRef.set({
  displayName: existing.displayName || "App Review",
  pointsBalance: REVIEW_BALANCE,
  lifetimePoints: Math.max(REVIEW_BALANCE, Number(existing.lifetimePoints) || 0),
  interests: ["outdoors", "community", "food"],
  isReviewAccount: true,
  lastUpdated: FieldValue.serverTimestamp(),
}, { merge: true });

// A claimed perk code, so My Codes is not an empty state for the reviewer.
await db.doc(`users/${uid}/perkCodes/review-sample`).set({
  perkId: "review-sample",
  title: "Sample partner offer",
  partner: "Demo Partner",
  code: "REVIEW-SAMPLE-0001",
  redeemedAt: Timestamp.now(),
  terms: "Demonstration code for App Review. Not redeemable in store.",
}, { merge: true });

console.log(`Seeded review account ${uid}:`);
console.log(`  pointsBalance = ${REVIEW_BALANCE.toLocaleString()} (enough to redeem the $10 tier)`);
console.log("  interests set, one perk code under My Codes");
console.log(EMU ? "  [emulator]" : "  [LIVE PROJECT]");
console.log("\nStill to do by hand: save/RSVP a couple of events from the device,");
console.log("since RSVPs go through the callable and should exercise the real path.");
