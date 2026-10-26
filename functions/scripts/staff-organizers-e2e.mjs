// B2 callable proof. Run alone: the final-slot scenario temporarily replaces
// the LOCAL approval counter and restores it after deleting its own fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const suffix = Date.now().toString(36), password = "local-fixture-password";
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function account(label, method = "signUp") {
  const email = `${label}-${suffix}@example.test`;
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const data = await res.json(); assert.ok(data.idToken); return data;
}
async function call(user, name, data = {}) {
  const res = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  return res.json();
}
let staff = await account("organizer-staff");
execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local organizer workflow test"], { env: process.env });
staff = await account("organizer-staff", "signInWithPassword");
const applicants = await Promise.all(["one", "two", "three"].map((x) => account(`organizer-${x}`)));
const orgs = [], events = [], counter = db.doc("staffCounters/manualOrganizerApprovals"), beforeCounter = await counter.get();
try {
  for (const [i, user] of applicants.entries()) {
    const result = await call(user, "createOrganizer", { displayName: `Fictional Community Group ${i} ${suffix}`, category: "community-org" });
    assert.ok(result.result?.organizerId, JSON.stringify(result)); orgs.push(result.result.organizerId);
  }
  const event = await call(applicants[0], "createEvent", { title: "Fictional approval visibility event", description: "Local fixture",
    locationName: "Fixture venue", startMs: Date.now() + 86_400_000, latitude: 37.335, longitude: -121.89 });
  assert.ok(event.result?.eventId, JSON.stringify(event)); events.push(event.result.eventId);
  check("pending organizer publishes follower-only", event.result.broadcast === false);
  const queue = await call(staff, "listOrganizerApplications", { status: "pending" });
  check("pending applications include context and review cap", queue.result?.organizers.some((x) => x.id === orgs[0]) &&
    Number.isInteger(queue.result.approvalCap.used) && queue.result.approvalCap.limit === 50);
  check("unknown application filter is refused", (await call(staff, "listOrganizerApplications", { status: "bogus" })).error?.status === "INVALID_ARGUMENT");
  for (const action of ["approve", "reject", "suspend", "reinstate"]) {
    check(`non-admin cannot ${action} organizer`, (await call(applicants[0], "approveOrganizer", {
      organizerId: orgs[0], action, reason: "Fixture unauthorized decision" })).error?.status === "PERMISSION_DENIED");
    check(`${action} organizer requires reason`, (await call(staff, "approveOrganizer", { organizerId: orgs[0], action })).error?.status === "INVALID_ARGUMENT");
  }
  await counter.set({ used: 49, limit: 50 });
  const raced = await Promise.all(orgs.slice(0, 2).map((organizerId) => call(staff, "approveOrganizer", {
    organizerId, action: "approve", reason: "Review fictional final-slot applicant" })));
  check("concurrent final-slot approvals admit exactly one", raced.filter((x) => x.result?.status === "approved").length === 1 &&
    raced.filter((x) => x.error?.status === "RESOURCE_EXHAUSTED").length === 1 && (await counter.get()).data().used === 50);
  const winner = orgs[raced.findIndex((x) => x.result?.status === "approved")];
  const again = await call(staff, "approveOrganizer", { organizerId: winner, action: "approve", reason: "Repeat fictional approval" });
  check("repeat decision does not consume another slot", again.result?.approvalCap.used === 50 && again.result.approvalCap.remaining === 0);
  let decision = await call(staff, "approveOrganizer", { organizerId: winner, action: "reject", reason: "Reject fictional previously approved group" });
  check("rejection retains reason and does not release manual slot", decision.result?.status === "rejected" &&
    (await counter.get()).data().used === 50 && (await db.doc(`organizers/${winner}`).get()).data().reviewReason.startsWith("Reject"));
  decision = await call(staff, "approveOrganizer", { organizerId: winner, action: "reinstate", reason: "Reinstate already reviewed fixture" });
  check("reinstatement of reviewed organizer is allowed at cap", decision.result?.status === "approved" && decision.result.approvalCap.used === 50);
  check("new applicant remains refused at cap", (await call(staff, "approveOrganizer", {
    organizerId: orgs[2], action: "approve", reason: "Attempt fifty-first fixture approval" })).error?.status === "RESOURCE_EXHAUSTED");
  const audits = await db.collection("staffAudit").where("target", "==", `organizers/${winner}`).get();
  check("organizer decisions retain actor before after time and reason", audits.docs.filter((x) => x.data().action !== "organizer:event-visibility").length === 4 &&
    audits.docs.every((x) => x.data().actor === staff.localId && x.data().before && x.data().after && x.data().reason && x.data().time.toMillis() > 0));
  // Independently test visibility even when the other applicant won the race.
  await counter.set({ used: 48, limit: 50 });
  await call(staff, "approveOrganizer", { organizerId: orgs[0], action: "approve", reason: "Approve fixture for visibility proof" });
  check("approval broadcasts existing organizer event", (await db.doc(`events/${events[0]}`).get()).data().broadcast === true);
  await call(staff, "approveOrganizer", { organizerId: orgs[0], action: "suspend", reason: "Suspend fixture for visibility proof" });
  check("suspension removes existing event from organic broadcast", (await db.doc(`events/${events[0]}`).get()).data().broadcast === false);
  const visibility = await db.collection("staffAudit").where("target", "==", `organizers/${orgs[0]}`).get();
  check("event visibility changes are audited", visibility.docs.some((x) => x.data().action === "organizer:event-visibility" &&
    x.data().after.some((e) => e.eventId === events[0] && e.broadcast === false)));
  console.log(`${checks} organizer server emulator checks passed; browser proof is in staff-console-e2e.mjs`);
} finally {
  for (const id of events) await db.doc(`events/${id}`).delete();
  for (const id of orgs) await db.doc(`organizers/${id}`).delete();
  if (beforeCounter.exists) await counter.set(beforeCounter.data()); else await counter.delete();
}
process.exit(0);
