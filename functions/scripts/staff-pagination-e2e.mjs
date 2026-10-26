// Real callables: queues past page 100, equal timestamps and >500 reporters.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { Timestamp } = await import("firebase-admin/firestore");
const suffix = Date.now().toString(36), ids = [], reportIds = [];
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function account(label, method = "signUp") {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${label}-${suffix}@example.test`,
      password: "local-fixture-password", returnSecureToken: true }) });
  const data = await r.json(); assert.ok(data.idToken); return data;
}
async function call(user, name, data = {}) {
  const r = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  return r.json();
}
let staff = await account("paging-staff");
const outsider = await account("paging-outsider");
execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local bounded queue regression"], { env: process.env });
staff = await account("paging-staff", "signInWithPassword");
const postId = `paging-post-${suffix}`, queueId = `paging-volume-${suffix}`;
try {
  const batch = db.batch();
  for (let i = 0; i < 105; i++) {
    const id = `paging-${suffix}-${String(i).padStart(3, "0")}`; ids.push(id);
    batch.create(db.doc(`organizers/${id}`), { status: "rejected", displayName: `Fictional paging group ${i}`, createdAt: Timestamp.fromMillis(1000) });
    batch.create(db.doc(`moderationQueue/${id}`), { status: "warned", targetType: "organizer", targetId: id, reportCount: 1,
      reasons: ["spam"], firstReportedAt: Timestamp.fromMillis(1000) });
  }
  await batch.commit();
  for (const [name, collection, filters, field, order] of [
    ["listModerationQueue", "moderationQueue", { status: "warned", targetType: "organizer" }, "items", "firstReportedAt"],
    ["listOrganizerApplications", "organizers", { status: "rejected" }, "organizers", "createdAt"],
  ]) {
    check(`${name} refuses non-admin pagination`, (await call(outsider, name, { ...filters, afterId: ids[0] })).error?.status === "PERMISSION_DENIED");
    let query = db.collection(collection).where("status", "==", filters.status);
    if (filters.targetType) query = query.where("targetType", "==", filters.targetType);
    const expected = (await query.orderBy(order).get()).docs.map((d) => d.id);
    const seen = []; let cursor, pages = 0;
    do {
      const response = await call(staff, name, { ...filters, ...(cursor ? { afterId: cursor } : {}) });
      assert.ok(response.result, JSON.stringify(response));
      seen.push(...response.result[field].map((x) => x.queueId ?? x.id));
      cursor = response.result.nextCursor; pages++; assert.ok(pages < 100);
    } while (cursor);
    check(`${name} reaches every row past 100 without duplicates at equal timestamps`, pages >= 2 && JSON.stringify(seen) === JSON.stringify(expected));
    check(`${name} rejects deleted cursor`, (await call(staff, name, { ...filters, afterId: `missing-${suffix}` })).error?.status === "FAILED_PRECONDITION");
    check(`${name} rejects excessive page size`, (await call(staff, name, { ...filters, limit: 101 })).error?.status === "INVALID_ARGUMENT");
  }
  await db.doc(`posts/${postId}`).create({ authorID: outsider.localId, content: "Fictional high-volume reported post", hidden: false });
  await db.doc(`moderationQueue/${queueId}`).create({ targetType: "post", targetId: postId, authorUid: outsider.localId, status: "open",
    firstReportedAt: Timestamp.now(), reportCount: 601 });
  for (let offset = 0; offset < 601; offset += 200) {
    const batch = db.batch();
    for (let i = offset; i < Math.min(offset + 200, 601); i++) {
      const id = `paging-report-${suffix}-${i}`; reportIds.push(id);
      batch.create(db.doc(`reports/${id}`), { queueId, status: "open", reason: "spam", createdAt: Timestamp.now() });
    }
    await batch.commit();
  }
  for (const [action, queueStatus, reportStatus] of [["remove", "removed", "actioned"], ["restore", "dismissed", "dismissed"]]) {
    const response = await call(staff, "moderateContent", { queueId, action, reason: `Fictional 601-reporter ${action} regression` });
    check(`${action} succeeds with more than 500 reports`, response.result?.status === queueStatus);
    const rows = await db.collection("reports").where("queueId", "==", queueId).get();
    check(`${action} reconciles all 601 reports in bounded batches`, rows.size === 601 && rows.docs.every((d) => d.data().status === reportStatus));
  }
  const audits = await db.collection("staffAudit").where("target", "==", `moderationQueue/${queueId}`).get();
  check("every derived-report batch is audited", audits.size === 8 && audits.docs.every((d) => d.data().before.length <= 200 && d.data().after.length <= 200));
  const readAudits = await db.collection("staffAudit").where("actor", "==", staff.localId).get();
  check("queue/application reads record actor filters IDs time", ["moderation:list", "organizer:list"].every((action) =>
    readAudits.docs.some((d) => d.data().action === action && d.data().after.ids.length && d.data().time.toMillis() > 0)));
  console.log(`${checks} staff pagination/volume checks passed`);
} finally {
  const refs = [...ids.flatMap((id) => [db.doc(`organizers/${id}`), db.doc(`moderationQueue/${id}`)]),
    ...reportIds.map((id) => db.doc(`reports/${id}`)), db.doc(`posts/${postId}`), db.doc(`moderationQueue/${queueId}`)];
  for (let offset = 0; offset < refs.length; offset += 200) {
    const batch = db.batch(); for (const ref of refs.slice(offset, offset + 200)) batch.delete(ref); await batch.commit();
  }
}
process.exit(0);
