// Run against the working LOCAL emulators. Fixtures are fictional and isolated.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, onSnapshot, terminate } from "firebase/firestore";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { getAuth: adminAuth } = await import("firebase-admin/auth");
const { Timestamp } = await import("firebase-admin/firestore");
const { placeCatalogState, loadParkIndex } = await import("../lib/parks/store.js");
const suffix = Date.now().toString(36), prefix = `story-${suffix}`, password = "local-fictional-story-only";
const users = [], paths = [], listeners = [], stories = [];
let checks = 0, client;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };
async function account(label, method = "signUp") {
  const email = `${prefix}-${label}@example.test`;
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const data = await response.json(); assert.ok(data.idToken, JSON.stringify(data));
  if (method === "signUp") { users.push(data.localId); paths.push(`users/${data.localId}`); await db.doc(`users/${data.localId}`).set({ displayName: "Fictional story QA account" }); }
  return { ...data, email };
}
async function call(user, name, data = {}) {
  const response = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${user.idToken}` } : {}) }, body: JSON.stringify({ data }) });
  return response.json();
}
async function until(predicate) {
  const end = Date.now() + 15000;
  while (!predicate() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(predicate(), "Live metadata update timed out");
}
async function denied(work) { try { await work(); return false; } catch (e) { return e.code === "permission-denied"; } }
try {
  let staff = await account("staff");
  const owner = await account("owner"), successor = await account("successor"), reader = await account("reader");
  const reporters = [reader, await account("reporter-two"), await account("reporter-three")];
  execFileSync(process.execPath, [fileURLToPath(new URL("staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
    "--grant", "--reason", "Local place-story staff authorization test"], { env: process.env });
  staff = await account("staff", "signInWithPassword");
  const org = `${prefix}-org`, otherOrg = `${prefix}-other`, pendingOrg = `${prefix}-pending`;
  for (const [id, uid, status] of [[org, owner.localId, "approved"], [otherOrg, successor.localId, "approved"], [pendingOrg, reader.localId, "pending"]]) {
    paths.push(`organizers/${id}`, `organizerStoryStatus/${id}`);
    await db.doc(`organizers/${id}`).set({ ownerUid: uid, displayName: "Fictional place-owning QA organizer", category: "parks",
      status, hidden: false, removed: false, createdAt: Timestamp.now(), manualApprovalCounted: status === "approved" });
  }
  const placeId = `osm-${Date.now()}99`;
  paths.push(`placeStoryOwnership/${placeId}`, `placeStoryStatus/${placeId}`);
  const ownership = { placeId, placeName: "Fictional ownership QA place", officialURL: `https://www.openstreetmap.org/node/${placeId.slice(4)}`,
    organizerId: org, active: true, verificationReference: "PRIVATE fictional written ownership reference", reason: "Verify fictional local-only organizer" };
  for (const name of ["setPlaceStoryOwnership", "listStaffStoryPlaces"]) {
    check(`non-admin denied ${name}`, (await call(owner, name, ownership)).error?.status === "PERMISSION_DENIED");
    check(`guest denied ${name}`, (await call(null, name, ownership)).error?.status === "UNAUTHENTICATED");
  }
  check("written ownership verification required", (await call(staff, "setPlaceStoryOwnership", { ...ownership, verificationReference: "" })).error?.status === "INVALID_ARGUMENT");
  check("staff reason required", (await call(staff, "setPlaceStoryOwnership", { ...ownership, reason: "" })).error?.status === "INVALID_ARGUMENT");
  check("pending organizer cannot be assigned a place", (await call(staff, "setPlaceStoryOwnership", { ...ownership, organizerId: pendingOrg })).error?.status === "FAILED_PRECONDITION");
  check("official listing must match OSM place ID", (await call(staff, "setPlaceStoryOwnership", { ...ownership, officialURL: "https://www.openstreetmap.org/node/1" })).error?.status === "INVALID_ARGUMENT");
  check("staff verifies fictional ownership", (await call(staff, "setPlaceStoryOwnership", ownership)).result?.active);
  check("other approved organizer cannot write owned place", (await call(successor, "savePlaceStory", { placeId, content: "Forged prose", expectedVersion: 0 })).error?.status === "PERMISSION_DENIED");
  check("guest cannot write a place story", (await call(null, "savePlaceStory", { placeId, content: "Forged prose", expectedVersion: 0 })).error?.status === "UNAUTHENTICATED");
  check("401-character story rejected", (await call(owner, "savePlaceStory", { placeId, content: "🌳".repeat(401), expectedVersion: 0 })).error?.status === "INVALID_ARGUMENT");
  const content = "Fictional organizer's own QA text. This is a test fixture, not local history.";
  check("verified approved owner publishes prose", (await call(owner, "savePlaceStory", { placeId, content, expectedVersion: 0, ownerUid: successor.localId, hidden: false })).result?.version === 1);
  let publicStory = (await call(reader, "getPlaceStory", { placeId })).result?.story;
  assert.ok(publicStory); stories.push(publicStory.id);
  check("publisher UID comes from canonical ownership", publicStory.ownerUid === owner.localId && publicStory.content === content);
  check("guest reads free public story without verification details", (await call(null, "getPlaceStory", { placeId })).result?.story?.content === content && !JSON.stringify(publicStory).includes("PRIVATE"));
  const engagement = { placeId, storyId: publicStory.id, version: publicStory.version, stage: "shown", consent: true,
    installID: "12345678-1234-1234-1234-123456789abc", exposureID: "abcdefgh-invalid" };
  check("engagement rejects malformed exposure", (await call(null, "recordStoryEngagement", engagement)).error?.status === "INVALID_ARGUMENT");
  engagement.exposureID = "12345678-1234-1234-1234-123456789def";
  check("engagement rejects absent consent", (await call(null, "recordStoryEngagement", { ...engagement, consent: false })).error?.status === "INVALID_ARGUMENT");
  check("guest shown engagement recorded", (await call(null, "recordStoryEngagement", engagement)).result?.recorded === true);
  check("repeated shown event deduplicated", (await call(null, "recordStoryEngagement", engagement)).result?.recorded === false);
  for (const stage of ["expanded", "read_through"]) check(`guest ${stage} engagement recorded`, (await call(null, "recordStoryEngagement", { ...engagement, stage })).result?.recorded === true);
  const day = new Date().toISOString().slice(0, 10);
  const telemetry = await db.collection(`analytics/${day}/events`).where("params.storyId", "==", publicStory.id).get();
  check("telemetry contains three distinct stages without prose or GPS", telemetry.size === 3 && telemetry.docs.every((d) =>
    Object.keys(d.data().params).sort().join(",") === "placeId,storyId,version" && !JSON.stringify(d.data()).includes("Fictional organizer")));
  for (const row of telemetry.docs) { paths.push(row.ref.path, `storyEngagementKeys/${row.id.slice(6)}`); }
  check("stale story version is not counted", (await call(null, "recordStoryEngagement", { ...engagement, version: 0 })).result?.recorded === false);
  const list = (await call(owner, "myStoryPlaces")).result;
  check("owner receives editable draft with current version", list.places.some((p) => p.placeId === placeId && p.canEdit && p.version === 1));
  check("other organizer cannot list private drafts", !(await call(successor, "myStoryPlaces")).result.places.some((p) => p.placeId === placeId));
  const edits = await Promise.all(["One edit", "Other edit"].map((content) => call(owner, "savePlaceStory", { placeId, content, expectedVersion: 1 })));
  check("concurrent edits admit one and reject stale overwrite", edits.filter((r) => r.result?.version === 2).length === 1 && edits.filter((r) => r.error?.status === "ABORTED").length === 1);
  check("stale editor cannot overwrite newer story", (await call(owner, "savePlaceStory", { placeId, content, expectedVersion: 1 })).error?.status === "ABORTED");
  const app = initializeApp({ projectId: "connectify-19dd8", apiKey: "local" }, prefix), auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  await signInWithEmailAndPassword(auth, owner.email, password);
  client = getFirestore(app); connectFirestoreEmulator(client, "127.0.0.1", 8899);
  check("owner cannot bypass story callable with raw SDK read", await denied(() => getDoc(doc(client, "placeStories", publicStory.id))));
  check("owner cannot self-claim via SDK write", await denied(() => setDoc(doc(client, "placeStoryOwnership", placeId), ownership)));
  const observed = {};
  for (const [collectionName, id, fields] of [["placeStoryStatus", placeId, "revision"], ["organizerStoryStatus", org, "allowed"], ["storyAuthorStatus", owner.localId, "allowed"]]) {
    const ref = doc(client, collectionName, id);
    check(`${collectionName} contains only minimal metadata`, Object.keys((await getDoc(ref)).data()).sort().join(",") === fields);
    check(`${collectionName} cannot be enumerated`, await denied(() => getDocs(collection(client, collectionName))));
    check(`${collectionName} cannot be forged`, await denied(() => setDoc(ref, { allowed: true, revision: "forged" })));
    listeners.push(onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => { if (!snapshot.metadata.fromCache) observed[collectionName] = snapshot.data(); }));
  }
  await until(() => observed.placeStoryStatus?.revision && observed.organizerStoryStatus?.allowed && observed.storyAuthorStatus?.allowed);
  const oldRevision = observed.placeStoryStatus.revision;
  check("owner cannot report own story", (await call(owner, "reportContent", { targetType: "place_story", targetId: publicStory.id, reason: "other" })).error?.status === "FAILED_PRECONDITION");
  let queueId;
  for (const reporter of reporters) {
    const result = await call(reporter, "reportContent", { targetType: "place_story", targetId: publicStory.id, reason: "misinformation" });
    assert.ok(result.result, JSON.stringify(result)); queueId = result.result.queueId;
  }
  paths.push(`moderationQueue/${queueId}`);
  await until(() => observed.placeStoryStatus.revision !== oldRevision);
  check("three reports remove public prose and invalidate known story", (await call(reader, "getPlaceStory", { placeId })).result?.story === null);
  check("moderated owner cannot republish hidden prose", (await call(owner, "savePlaceStory", { placeId, content: "Evade moderation", expectedVersion: 2 })).error?.status === "FAILED_PRECONDITION");
  const queue = (await call(staff, "listModerationQueue", { targetType: "place_story" })).result;
  check("existing moderation queue includes story context and count", queue.items.some((p) => p.queueId === queueId && p.content.placeId === placeId && p.reportCount === 3));
  check("non-admin cannot moderate story", (await call(owner, "moderateContent", { queueId, action: "restore", reason: "Unauthorized restore" })).error?.status === "PERMISSION_DENIED");
  await call(staff, "moderateContent", { queueId, action: "remove", reason: "Remove fictional reported prose" });
  check("removed story prose redacted", (await db.doc(`placeStories/${publicStory.id}`).get()).data().content === "[removed by moderation]");
  await call(staff, "moderateContent", { queueId, action: "restore", reason: "Restore fictional reviewed prose" });
  check("staff restore returns original organizer text", !!(await call(reader, "getPlaceStory", { placeId })).result?.story && (await db.doc(`placeStories/${publicStory.id}`).get()).data().content !== "[removed by moderation]");
  await call(staff, "approveOrganizer", { organizerId: org, action: "suspend", reason: "Suspend fictional story organizer" });
  await until(() => observed.organizerStoryStatus.allowed === false);
  check("organizer suspension gates canonical public story", (await call(null, "getPlaceStory", { placeId })).result?.story === null);
  check("suspended organizer cannot write", (await call(owner, "savePlaceStory", { placeId, content, expectedVersion: 2 })).error?.status === "PERMISSION_DENIED");
  await call(staff, "approveOrganizer", { organizerId: org, action: "reinstate", reason: "Reinstate already-reviewed fictional organizer" });
  await until(() => observed.organizerStoryStatus.allowed === true);
  await db.doc(`users/${owner.localId}`).update({ suspended: true });
  await until(() => observed.storyAuthorStatus.allowed === false);
  check("author suspension gates public story", (await call(reader, "getPlaceStory", { placeId })).result?.story === null);
  await db.doc(`users/${owner.localId}`).update({ suspended: false });
  await until(() => observed.storyAuthorStatus.allowed === true);
  paths.push(`users/${reader.localId}/blocks/${owner.localId}`);
  await db.doc(paths.at(-1)).set({ uid: owner.localId });
  check("viewer block hides organizer story", (await call(reader, "getPlaceStory", { placeId })).result?.story === null);
  await db.doc(paths.at(-1)).delete();
  const beforeRevoke = observed.placeStoryStatus.revision;
  await call(staff, "setPlaceStoryOwnership", { placeId, active: false, reason: "Revoke fictional ownership" });
  await until(() => observed.placeStoryStatus.revision !== beforeRevoke);
  check("withdrawn story engagement is not counted", (await call(null, "recordStoryEngagement", { ...engagement, exposureID: "12345678-1234-1234-1234-123456789ddd" })).result?.recorded === false);
  check("revoked ownership removes prose", (await call(reader, "getPlaceStory", { placeId })).result?.story === null);
  await call(staff, "setPlaceStoryOwnership", { ...ownership, organizerId: otherOrg, reason: "Transfer fictional verified ownership" });
  check("successor does not inherit previous private draft", (await call(successor, "myStoryPlaces")).result.places.find((p) => p.placeId === placeId)?.content === "");
  check("former owner cannot save after transfer", (await call(owner, "savePlaceStory", { placeId, content, expectedVersion: 2 })).error?.status === "PERMISSION_DENIED");
  await call(successor, "savePlaceStory", { placeId, content: "Fictional successor organizer's own text", expectedVersion: 0 });
  const nextStory = (await call(reader, "getPlaceStory", { placeId })).result?.story;
  stories.push(nextStory.id);
  await call(staff, "moderateContent", { queueId, action: "remove", reason: "Old publisher's report must not affect successor" });
  check("old reports cannot remove successor's distinct story", nextStory.id !== publicStory.id && (await call(reader, "getPlaceStory", { placeId })).result?.story?.id === nextStory.id);
  const state = await placeCatalogState(), park = (await loadParkIndex(state.generation))[0];
  const parkOwnership = await db.doc(`placeStoryOwnership/${park.id}`).get();
  assert.equal(parkOwnership.exists, false, "Choose a disposable unowned real catalog park; never replace existing ownership.");
  paths.push(`placeStoryOwnership/${park.id}`, `placeStoryStatus/${park.id}`);
  await call(staff, "setPlaceStoryOwnership", { placeId: park.id, organizerId: otherOrg, active: true, verificationReference: "Fictional local-only QA ownership, not an actual claim", reason: "Test official park guide story integration" });
  await call(successor, "savePlaceStory", { placeId: park.id, content: "Fictional local park-guide story fixture; no history claim.", expectedVersion: 0 });
  const parkStory = (await call(null, "parkGuide", { parkId: park.id })).result?.story;
  assert.ok(parkStory); stories.push(parkStory.id);
  check("free official park guide includes canonical organizer story", parkStory.placeId === park.id && parkStory.placeName === park.name);
  await db.doc(`users/${reader.localId}`).update({ plus: true, plusExpiresAt: Timestamp.fromMillis(Date.now() + 86400000), birthYear: 2000 });
  const packPreview = (await call(reader, "offlinePack", { action: "preview", selection: { kind: "parks", parkIds: [park.id] } })).result;
  assert.ok(packPreview, "Local story pack preview must succeed");
  const packParts = [];
  for (let index = 0; index < packPreview.parts; index++) {
    const part = (await call(reader, "offlinePack", { action: "chunk", packId: packPreview.packId, index })).result;
    assert.ok(part); packParts.push(Buffer.from(part.data, "base64"));
  }
  const pack = JSON.parse(Buffer.concat(packParts).toString());
  check("downloaded pack includes canonical organizer story", pack.guides[0].story.id === parkStory.id && pack.guides[0].story.content === parkStory.content);
  await call(reader, "offlinePack", { action: "cancel", packId: packPreview.packId });
  const auditRows = await db.collection("staffAudit").where("target", "==", `placeStoryOwnership/${placeId}`).get();
  check("every ownership mutation has immutable accountability", auditRows.size === 3 && auditRows.docs.every((d) => d.data().actor === staff.localId && d.data().action && d.data().target && d.data().time && d.data().after && d.data().reason));
  check("staff can page ownership records", (await call(staff, "listStaffStoryPlaces", { limit: 1 })).result?.places.length === 1);
  const deleted = await call(owner, "deleteAccount");
  check("account deletion removes old authored story", deleted.result?.deleted && !(await db.doc(`placeStories/${publicStory.id}`).get()).exists);
  check("deleting former owner preserves successor ownership", (await call(reader, "getPlaceStory", { placeId })).result?.story?.id === nextStory.id);
  const deletedQueue = (await db.doc(`moderationQueue/${queueId}`).get()).data();
  check("account deletion removes queue prose and author identity", deletedQueue.authorUid === "deleted-account" && !deletedQueue.originalContent && deletedQueue.snapshot === "[deleted by author]");
  console.log(`${checks} place-story callable/rules/live metadata checks passed`);
} finally {
  listeners.forEach((stop) => stop()); if (client) await terminate(client);
  for (const id of stories) await db.doc(`placeStories/${id}`).delete();
  for (const path of paths.reverse()) await db.doc(path).delete();
  for (const uid of users) { await db.recursiveDelete(db.doc(`users/${uid}`)); await db.doc(`storyAuthorStatus/${uid}`).delete(); await adminAuth().deleteUser(uid).catch(() => {}); }
  // Reports/rate limits name only fictional disposable accounts; staff audits
  // remain intact as accountability evidence. Never reset the public corpus.
  for (const id of stories) {
    const reports = await db.collection("reports").where("targetId", "==", id).get();
    for (const report of reports.docs) await report.ref.delete();
  }
}
