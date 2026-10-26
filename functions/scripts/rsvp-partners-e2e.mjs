// Fresh-build A5 proof against local services, including retries/concurrency.
import assert from "node:assert/strict";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FUNCTIONS_EMULATOR = "true";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { Timestamp } = await import("firebase-admin/firestore");
const { runRsvpPartnerAlerts, rsvpAlertRef } = await import("../lib/rsvp-partners.js");
const { claimPushSlot, weekKey } = await import("../lib/notifications.js");
const suffix = Date.now().toString(36), origin = { latitude: 37.3382, longitude: -121.8863 };
// Next local noon, so test quiet-hours behavior does not depend on run time.
const startOfToday = new Date(); startOfToday.setUTCHours(19, 0, 0, 0);
const now = startOfToday.getTime() + 86_400_000;
const partnerId = `rsvp-fixture-${suffix}`, perkId = `${partnerId}-perk`;
await db.doc(`partners/${partnerId}`).set({ name: "Fictional RSVP Test Shop", category: "retail", active: true,
  ...origin, agreement: { agreedBy: "Fictional fixture owner", agreedAt: Timestamp.now(), reference: "Local RSVP test fixture only" } });
await db.doc(`partnerPerks/${perkId}`).set({ partnerId, title: "Fixture discount", pointCost: 500, active: true,
  codePoolCount: 20, expiresAt: Timestamp.fromMillis(now + 86_400_000), hours: [] });
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function member(label) {
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: "local-fixture-password", returnSecureToken: true }) });
  const account = await res.json(); assert.ok(account.idToken);
  await db.doc(`users/${account.localId}`).set({ pointsBalance: 0, notificationPrefs: {
    rsvpPartnerOffers: true, quietStart: 0, quietEnd: 0, timeZone: "America/Los_Angeles" } });
  return account;
}
async function call(account, name, data) {
  const res = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${account.idToken}` },
    body: JSON.stringify({ data }) });
  const body = await res.json(); assert.ok(!body.error, `${name}: ${JSON.stringify(body)}`); return body.result;
}
async function rsvp(account, label, coordinates = origin) {
  const eventId = `${partnerId}-${label}`;
  await db.doc(`events/${eventId}`).set({ title: "Fictional outdoor fixture", date: Timestamp.fromMillis(now + 30 * 60_000),
    active: true, hidden: false, broadcast: true, creatorID: "system:ingest", ...coordinates });
  await call(account, "rsvpToEvent", { eventId, going: true });
  const ref = rsvpAlertRef(account.localId, eventId);
  check(`${label}: RSVP atomically queues one alert`, (await ref.get()).data()?.status === "queued");
  await ref.update({ dueAt: Timestamp.fromMillis(now - 1) });
  return { eventId, ref };
}
const first = await member("rsvp-consent");
const job = await rsvp(first, "concurrent");
await call(first, "rsvpToEvent", { eventId: job.eventId, going: true });
await Promise.all([runRsvpPartnerAlerts(now), runRsvpPartnerAlerts(now)]);
let notes = await db.collection(`users/${first.localId}/notifications`).where("kind", "==", "rsvp-partner").get();
check("overlapping workers create exactly one alert", notes.size === 1 && notes.docs[0].id === job.ref.id);
check("alert is sponsored, venue-based, and before the event", notes.docs[0].data().sponsored === true &&
  notes.docs[0].data().eventId === job.eventId && (await job.ref.get()).data().sentAt.toMillis() < now + 30 * 60_000);
check("alert spends one shared weekly slot", (await db.doc(`users/${first.localId}`).get()).data().notifyBudget.sent === 1);
await runRsvpPartnerAlerts(now + 60_000);
notes = await db.collection(`users/${first.localId}/notifications`).where("kind", "==", "rsvp-partner").get();
check("retry cannot send again", notes.size === 1);
await call(first, "rsvpToEvent", { eventId: job.eventId, going: false });
await call(first, "rsvpToEvent", { eventId: job.eventId, going: true });
check("cancel and re-RSVP do not resurrect a sent alert", (await job.ref.get()).data().status === "sent");
check("another notification can spend the remaining shared slot", await claimPushSlot(first.localId, now));
const capped = await rsvp(first, "capped");
await runRsvpPartnerAlerts(now);
check("RSVP offer never exceeds the shared cap", (await capped.ref.get()).data().status === "queued" &&
  (await db.doc(`users/${first.localId}`).get()).data().notifyBudget.sent === 2);
const quiet = await member("rsvp-quiet"); const quietJob = await rsvp(quiet, "quiet");
const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
await call(quiet, "setNotificationPrefs", { quietStart: hour, quietEnd: (hour + 1) % 24 });
await runRsvpPartnerAlerts(now);
check("quiet hours defer without spending a slot", (await quietJob.ref.get()).data().status === "queued" &&
  !(await db.doc(`users/${quiet.localId}`).get()).data().notifyBudget);
const off = await member("rsvp-off"); const offJob = await rsvp(off, "off");
await call(off, "setNotificationPrefs", { rsvpPartnerOffers: false });
check("server persists separate opt-out", (await call(off, "getNotificationPrefs", {})).rsvpPartnerOffers === false);
await runRsvpPartnerAlerts(now);
check("opt-out prevents alerts and budget spend", (await offJob.ref.get()).data().status === "queued" &&
  !(await db.doc(`users/${off.localId}`).get()).data().notifyBudget);
const cancelled = await member("rsvp-cancel"); const cancelJob = await rsvp(cancelled, "cancel");
await call(cancelled, "rsvpToEvent", { eventId: cancelJob.eventId, going: false });
await runRsvpPartnerAlerts(now);
check("cancelled RSVP cannot notify", (await cancelJob.ref.get()).data().status === "cancelled");
const far = await member("rsvp-far"); const farJob = await rsvp(far, "far", { latitude: 37.9, longitude: -122.5 });
await runRsvpPartnerAlerts(now);
check("no nearby venue perk means silence", (await farJob.ref.get()).data().status === "queued" &&
  !(await db.doc(`users/${far.localId}`).get()).data().notifyBudget);
await runRsvpPartnerAlerts(now + 31 * 60_000);
check("event start expires unsent alerts", (await farJob.ref.get()).data().status === "expired");
console.log(`${checks} RSVP partner emulator checks passed; push delivery intentionally untested`);
process.exit(0);
