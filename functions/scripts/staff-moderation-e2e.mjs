// B1 server workflow proof: real callable reports/decisions, fictional content.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { Timestamp } = await import("firebase-admin/firestore");
const suffix = Date.now().toString(36), password = "local-fixture-password";
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function account(label, method = "signUp") {
  const email = `${label}-${suffix}@example.test`;
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const data = await res.json(); assert.ok(data.idToken); return data;
}
async function call(user, name, data) {
  const res = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  return res.json();
}
let staff = await account("moderation-staff"), reporter = await account("moderation-reporter"), owner = await account("moderation-owner");
execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local moderation workflow test"], { env: process.env });
staff = await account("moderation-staff", "signInWithPassword");
await db.doc(`users/${owner.localId}`).set({ displayName: "Fictional content author", suspended: false });
const postId = `moderation-fixture-${suffix}`, content = "Fictional full original post for restoration.";
await db.doc(`posts/${postId}`).set({ authorID: owner.localId, content, hidden: false, likeCount: 0, createdAt: Timestamp.now() });
const report = await call(reporter, "reportContent", { targetType: "post", targetId: postId, reason: "spam", details: "Fictional detailed report context" });
check("actual report enters staff queue", !!report.result?.queueId);
const queueId = report.result.queueId;
await db.doc(`moderationQueue/${queueId}`).update({ firstReportedAt: Timestamp.fromMillis(Date.now() - 21 * 3_600_000) });
const queue = await call(staff, "listModerationQueue", { status: "open", targetType: "post" });
const item = queue.result?.items?.find((x) => x.queueId === queueId);
check("queue exposes full context, reasons and report count", item?.content.content === content && item.reasons.includes("spam") &&
  item.reportCount === 1 && item.reports[0].details === "Fictional detailed report context" && item.author.displayName === "Fictional content author");
check("queue exposes prominent age and 20-hour flag", item?.hoursSinceFirstReport >= 21 && item.overdue20Hours === true);
check("queue is oldest first", queue.result.items.every((x, i, all) => !i || all[i - 1].firstReportedAtMs <= x.firstReportedAtMs));
for (const action of ["remove", "restore", "warn", "suspend"]) {
  const refused = await call(reporter, "moderateContent", { queueId, action, reason: "Fictional non-admin attempt" });
  check(`non-admin cannot ${action}`, refused.error?.status === "PERMISSION_DENIED");
  const missing = await call(staff, "moderateContent", { queueId, action });
  check(`${action} requires a reason`, missing.error?.status === "INVALID_ARGUMENT");
}
let decision = await call(staff, "moderateContent", { queueId, action: "remove", reason: "Remove fictional spam" });
check("remove hides and redacts content", decision.result?.status === "removed" && (await db.doc(`posts/${postId}`).get()).data().hidden === true &&
  (await db.doc(`posts/${postId}`).get()).data().content === "[removed by moderation]");
decision = await call(staff, "moderateContent", { queueId, action: "restore", reason: "Restore after fictional review" });
check("restore recovers original prose and visibility", decision.result?.status === "dismissed" && (await db.doc(`posts/${postId}`).get()).data().hidden === false &&
  (await db.doc(`posts/${postId}`).get()).data().content === content);
decision = await call(staff, "moderateContent", { queueId, action: "warn", reason: "Fictional warning for author" });
const warnings = await db.collection(`users/${owner.localId}/notifications`).where("kind", "==", "moderation-warning").get();
check("warn records the staff reason in an author notice", decision.result?.status === "warned" && warnings.size === 1 &&
  warnings.docs[0].data().body === "Fictional warning for author");
decision = await call(staff, "moderateContent", { queueId, action: "suspend", reason: "Suspend fictional fixture account" });
check("suspend removes content and suspends its author", decision.result?.status === "removed" &&
  (await db.doc(`users/${owner.localId}`).get()).data().suspended === true);
const audits = await db.collection("staffAudit").where("target", "==", `posts/${postId}`).get();
check("every action has an immutable actor/time/before/after/reason record", audits.size === 4 && audits.docs.every((d) =>
  d.data().actor === staff.localId && d.data().before.queue && d.data().after.queue && d.data().reason && d.data().time.toMillis() > 0));
const removed = audits.docs.find((d) => d.data().action === "moderation:remove").data();
check("audit preserves exact original and resulting redaction", removed.before.target.content === content && removed.after.target.content === "[removed by moderation]");
const history = await call(staff, "listModerationQueue", { status: "resolved", targetType: "post" });
check("resolved history retains the decision and reason", history.result?.items?.some((x) => x.queueId === queueId && x.resolution === "Suspend fictional fixture account"));
console.log(`${checks} moderation server emulator checks passed; browser proof is in staff-console-e2e.mjs`);
process.exit(0);
