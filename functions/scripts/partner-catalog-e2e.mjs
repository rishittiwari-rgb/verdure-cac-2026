// Full-catalogue paging and rules-checked live invalidation; local fixtures only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, onSnapshot, terminate } from "firebase/firestore";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { Timestamp } = await import("firebase-admin/firestore");
const { geocodeFixtureId } = await import("../lib/staff-partners.js");
const suffix = Date.now().toString(36), prefix = `catalog-${suffix}`, password = "local-fixture-password";
const paths = [], listeners = [];
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };
async function account(label, method = "signUp") {
  const email = `${prefix}-${label}@example.test`;
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const result = await response.json(); assert.ok(result.idToken, JSON.stringify(result)); return { ...result, email };
}
async function call(user, name, data = {}) {
  const response = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  return response.json();
}
async function until(predicate) {
  const end = Date.now() + 10000;
  while (!predicate() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(predicate(), "Live status update timed out");
}
async function denied(action) {
  try { await action(); return false; } catch (error) { return error.code === "permission-denied"; }
}
let client;
try {
  let staff = await account("staff"), member = await account("member");
  execFileSync(process.execPath, [fileURLToPath(new URL("staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
    "--grant", "--reason", "Local catalogue invalidation test"], { env: process.env });
  staff = await account("staff", "signInWithPassword");
  const origin = { lat: 35.2, lng: -118.1 }; // Distinct from all other test origins.
  const agreement = { agreedBy: "Fictional fixture owner", agreedAt: Timestamp.now(), reference: "Local fixture; no real business" };
  const writes = [];
  for (let i = 0; i < 501; i++) {
    const id = `${prefix}-${String(i).padStart(4, "0")}`;
    writes.push([`partners/${id}`, { active: true, name: "Fictional distant catalogue fixture", category: "retail",
      latitude: 36.2, longitude: origin.lng, agreement }]);
    writes.push([`partnerPerks/${id}`, { active: true, partnerId: id, title: "Fictional distant perk", pointCost: 500,
      kind: "local-offer", terms: "Local fixture", description: "Local fixture", codePoolCount: 1,
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000) }]);
  }
  for (let start = 0; start < writes.length; start += 400) {
    const batch = db.batch();
    for (const [path, data] of writes.slice(start, start + 400)) { paths.push(path); batch.set(db.doc(path), data); }
    await batch.commit();
  }
  const partnerId = `zz-${prefix}`, perkId = `${partnerId}-perk`, address = `${suffix} Fictional Catalogue Road`;
  paths.push(`qaGeocodes/${geocodeFixtureId(address)}`, `partners/${partnerId}`, `partnerPerks/${perkId}`, `partnerStatus/${partnerId}`, `perkStatus/${perkId}`);
  await db.doc(paths[paths.length - 5]).set({ response: { result: { addressMatches: [{ matchedAddress: address,
    coordinates: { x: origin.lng, y: origin.lat } }] } } });
  const partner = { partnerId, name: "Fictional nearest catalogue fixture", category: "retail", address,
    contactName: "Fictional fixture contact", contactEmail: "private-contact@example.test", active: true,
    agreement: { agreedBy: "Fictional fixture owner", agreedAtMs: Date.now() - 1000, reference: "PRIVATE-FIXTURE-REFERENCE" }, reason: "Local fixture with fictional agreement" };
  check("late partner saves with status", (await call(staff, "savePartner", partner)).result?.active);
  const perk = { perkId, partnerId, title: "Fictional nearest discount", description: "Local only", terms: "Local only", pointCost: 500,
    expiresAtMs: Date.now() + 86400000, codes: [`PRIVATE-CODE-${suffix}`], reason: "Create fictional stocked offer" };
  check("late perk saves with status", (await call(staff, "upsertPartnerPerk", perk)).result?.codesLeft === 1);
  const ids = (await db.collection("partnerPerks").where("active", "==", true).orderBy("__name__").get()).docs.map((d) => d.id);
  check("nearest offer is beyond first 500 IDs", ids.indexOf(perkId) >= 500);
  let map = await call(member, "nearbyPartners", { ...origin, surface: "map" });
  check("map discovers nearest late-page offer", map.result?.offers.some((p) => p.perkId === perkId && p.distanceMeters === 0));
  const near = await call(member, "nearbyPartners", { ...origin, surface: "near_you", sessionId: prefix });
  check("near-you finds late-page offer with no distant substitution", near.result?.offers.length === 1 && near.result.offers[0].perkId === perkId);
  const rewards = await call(member, "listRewardsCatalog");
  check("Rewards returns all 502 eligible fixture perks", rewards.result?.perks.filter((p) => p.id.startsWith(prefix) || p.id === perkId).length === 502);
  const app = initializeApp({ projectId: "connectify-19dd8", apiKey: "local" }, prefix);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  await signInWithEmailAndPassword(auth, member.email, password);
  client = getFirestore(app); connectFirestoreEmulator(client, "127.0.0.1", 8899);
  for (const kind of ["partnerStatus", "perkStatus"]) {
    const ref = doc(client, kind, kind === "partnerStatus" ? partnerId : perkId);
    const status = (await getDoc(ref)).data();
    check(`${kind} exposes only visibility/availability/revision/expiry`, Object.keys(status).sort().join(",") ===
      (kind === "partnerStatus" ? "available,revision" : "available,expiresAtMs,revision,revisionVersion,visible"));
    check(`${kind} cannot be enumerated`, await denied(() => getDocs(collection(client, kind))));
    check(`${kind} cannot be client-forged`, await denied(() => setDoc(ref, { available: true, revision: "forged" })));
  }
  const observed = {};
  for (const [kind, id] of [["partnerStatus", partnerId], ["perkStatus", perkId]]) {
    listeners.push(onSnapshot(doc(client, kind, id), { includeMetadataChanges: true }, (snapshot) => {
      if (!snapshot.metadata.fromCache) observed[kind] = snapshot.data();
    }));
  }
  await until(() => observed.partnerStatus?.available && observed.perkStatus?.available);
  const payload = map.result.offers.find((p) => p.perkId === perkId);
  check("callable revisions match live committed status", payload.partnerRevision === observed.partnerStatus.revision && payload.perkRevision === observed.perkStatus.revision);
  await call(staff, "upsertPartnerPerk", { ...perk, codes: undefined, earlyAccessUntilMs: Date.now() + 60000, reason: "Local early-access eligibility fixture" });
  const freeEarly = (await call(member, "listRewardsCatalog")).result?.perks.find(p => p.id === perkId);
  check("free catalog locks current early-access window", freeEarly?.plusOnlyUntilOpens && !freeEarly.redeemable);
  await db.doc(`users/${member.localId}`).set({ plusExpiresAt: Timestamp.fromMillis(Date.now() + 86400000) }, { merge: true });
  const plusEarly = (await call(member, "listRewardsCatalog")).result?.perks.find(p => p.id === perkId);
  check("Plus catalog exposes early access as unlocked and redeemable", plusEarly?.plusOnlyUntilOpens === false && plusEarly.redeemable);
  await db.doc(`users/${member.localId}`).set({ plusExpiresAt: null }, { merge: true });
  await call(staff, "upsertPartnerPerk", { ...perk, codes: undefined, reason: "Restore fictional ordinary offer" });
  check("perk deactivation succeeds", (await call(staff, "deactivatePartnerOffer", { kind: "perk", targetId: perkId, reason: "Deactivate fictional offer" })).result?.active === false);
  await until(() => observed.perkStatus?.available === false);
  check("connected listener receives immediate perk invalidation", observed.perkStatus.revision !== payload.perkRevision);
  check("fresh map refuses deactivated offer", !(await call(member, "nearbyPartners", { ...origin, surface: "map" })).result?.offers.some((p) => p.perkId === perkId));
  check("reactivation refreshes live stock status", (await call(staff, "upsertPartnerPerk", { ...perk, codes: undefined, reason: "Reactivate fictional offer" })).result?.codesLeft === 1);
  await until(() => observed.perkStatus?.available === true);
  await db.doc(`users/${member.localId}`).set({ pointsBalance: 1000, redeemedRewardIDs: [] });
  check("last code redemption succeeds", (await call(member, "redeemReward", { rewardId: perkId })).result?.redeemed === true);
  await until(() => observed.perkStatus?.available === false);
  check("last code atomically invalidates displayed perk", (await db.doc(`partnerPerks/${perkId}`).get()).data().codePoolCount === 0);
  const soldOut = (await call(member, "listRewardsCatalog")).result?.perks.find((p) => p.id === perkId);
  check("sold-out Rewards remains visible with canonical listener revisions", soldOut?.codesLeft === 0 && !soldOut.redeemable &&
    soldOut.partnerId === partnerId && soldOut.partnerRevision === observed.partnerStatus.revision && soldOut.perkRevision === observed.perkStatus.revision && observed.perkStatus.visible === true);
  const soldOutRevision = observed.perkStatus.revision;
  await call(staff, "deactivatePartnerOffer", { kind: "perk", targetId: perkId, reason: "Withdraw sold-out fictional offer" });
  await until(() => observed.perkStatus?.visible === false);
  check("deactivation of already sold-out perk changes revision", observed.perkStatus.revision !== soldOutRevision);
  check("withdrawn sold-out perk leaves fresh Rewards", !(await call(member, "listRewardsCatalog")).result?.perks.some((p) => p.id === perkId));
  await call(staff, "upsertPartnerPerk", { ...perk, codes: undefined, reason: "Restore fictional sold-out offer" });
  check("code import restores availability", (await call(staff, "importPartnerCodes", { perkId, csv: `code\nNEW-${suffix}`, reason: "Refill fictional code pool" })).result?.codesAdded === 1);
  await until(() => observed.perkStatus?.available === true);
  const oldRevision = observed.partnerStatus.revision;
  check("business edit succeeds", (await call(staff, "savePartner", { ...partner, name: "Fictional revised business" })).result?.active);
  await until(() => observed.partnerStatus?.revision !== oldRevision);
  check("business edit invalidates old label", observed.partnerStatus.available);
  check("partner deactivation succeeds", (await call(staff, "deactivatePartnerOffer", { kind: "partner", targetId: partnerId, reason: "Deactivate fictional business" })).result?.active === false);
  await until(() => observed.partnerStatus?.available === false);
  check("connected listener receives immediate partner invalidation", observed.partnerStatus.available === false);
  for (const listener of listeners.splice(0)) listener();
  await signOut(auth);
  check("anonymous metadata reads are refused", await denied(() => getDoc(doc(client, "partnerStatus", partnerId))));
  console.log(`${checks} catalogue/live-invalidation checks passed`);
} finally {
  for (const listener of listeners) listener();
  if (client) await terminate(client);
  // Remove only fixtures created by this invocation; staff audit stays immutable.
  for (const path of paths.filter((path) => path.startsWith("partnerPerks/"))) {
    const codes = await db.doc(path).collection("codes").get();
    if (!codes.empty) { const batch = db.batch(); codes.docs.forEach((d) => batch.delete(d.ref)); await batch.commit(); }
  }
  for (let start = 0; start < paths.length; start += 400) {
    const batch = db.batch(); paths.slice(start, start + 400).forEach((path) => batch.delete(db.doc(path))); await batch.commit();
  }
}
process.exit(0);
