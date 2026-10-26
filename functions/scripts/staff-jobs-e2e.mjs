// Legacy admin jobs: durable intent/outcome, exact mutation audit and >500 backfill.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { auditedStaffJob } = await import("../lib/staff-audit.js");
const suffix = Date.now().toString(36), ownPosts = [], month = "2099-12";
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function account(method = "signUp") {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `jobs-staff-${suffix}@example.test`,
      password: "local-fixture-password", returnSecureToken: true }) });
  const data = await r.json(); assert.ok(data.idToken); return data;
}
let staff = await account();
execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local legacy staff job test"], { env: process.env });
staff = await account("signInWithPassword");
async function call(name, data = {}) {
  const r = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${staff.idToken}` }, body: JSON.stringify({ data }) });
  return r.json();
}
const treasury = db.doc(`treasury/${month}`), prior = await treasury.get(), card = db.doc(`fulfillments/staff-job-${suffix}`);
try {
  for (let offset = 0; offset < 505; offset += 200) {
    const batch = db.batch();
    for (let i = offset; i < Math.min(offset + 200, 505); i++) {
      const ref = db.doc(`posts/staff-job-${suffix}-${i}`); ownPosts.push(ref);
      batch.create(ref, { content: "Fictional legacy visibility fixture" });
    }
    await batch.commit();
  }
  let result = await call("backfillModerationFlags", { reason: "Backfill fictional pre-flags fixtures" });
  const posts = await db.getAll(...ownPosts);
  check("backfill works beyond one Firestore write batch", result.result?.updated >= 505 && posts.every((d) => d.data().hidden === false));
  result = await call("backfillModerationFlags");
  check("backfill retry is idempotent", result.result?.updated === 0);
  await treasury.set({ killSwitch: true, dollarsCommitted: 0, dollarsFulfilled: 0 });
  check("treasury reset callable clears switch", (await call("resetTreasuryKillSwitch", { month, reason: "Fixture treasury review" })).result?.killSwitch === false);
  check("reconcile completes through durable staff job", (await call("reconcileTreasury", { month })).result?.reconciled === true);
  // A sent row cannot be converted back to approved (which would cause a second vendor send).
  await card.create({ status: "sent", uid: staff.localId, rewardId: "gift-small", month, usd: 0 });
  result = await call("runFulfilment", { fulfilmentId: card.id, approve: true, reason: "Attempt approval of terminal fixture" });
  check("sent fulfilment cannot be reopened for approval", result.error?.status === "FAILED_PRECONDITION" && (await card.get()).data().status === "sent");
  result = await call("runFulfilment", { fulfilmentId: card.id, reason: "Retry terminal fixture without any vendor call" });
  check("terminal fulfilment retry is an audited no-op", result.result?.status === "sent");
  let performed = false;
  await assert.rejects(() => auditedStaffJob(staff.localId, "fixture:failure", `fixture/${suffix}`, { old: 1 }, "Fictional failure test", async () => {
    performed = true; throw new Error("Fictional job failure");
  }), /Fictional job failure/);
  const jobs = await db.collection("staffJobs").where("actor", "==", staff.localId).get();
  check("failed jobs retain intent, error and terminal state", performed && jobs.docs.some((d) => d.data().action === "fixture:failure" &&
    d.data().status === "failed" && d.data().error === "Fictional job failure"));
  const audits = await db.collection("staffAudit").where("actor", "==", staff.localId).get();
  const rows = audits.docs.map((d) => d.data());
  check("backfill batches have exact before/after flags", rows.some((a) => a.action === "moderation:backfill" &&
    a.before.some((r) => r.id.startsWith(`staff-job-${suffix}`) && r.hidden === null) && a.after.every((r) => r.hidden === false)));
  check("treasury reset audits before/after atomically", rows.some((a) => a.action === "treasury:reset" && a.before.killSwitch === true && a.after.killSwitch === false));
  for (const action of ["treasury:reconcile", "fulfilment:run", "fixture:failure"]) {
    check(`${action} has requested plus terminal audit`, rows.some((a) => a.action === `${action}:requested`) &&
      rows.some((a) => a.action === `${action}:completed` || a.action === `${action}:failed`));
  }
  console.log(`${checks} staff job checks passed`);
} finally {
  for (let offset = 0; offset < ownPosts.length; offset += 200) {
    const batch = db.batch(); for (const ref of ownPosts.slice(offset, offset + 200)) batch.delete(ref); await batch.commit();
  }
  await card.delete(); if (prior.exists) await treasury.set(prior.data()); else await treasury.delete();
}
process.exit(0);
