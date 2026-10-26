// B0 access foundation. All services and claim mutations are local-only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db, isAdmin } = await import("../lib/common.js");
const { appendStaffAudit } = await import("../lib/staff-audit.js");
const { initializeApp } = await import("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
const { getFirestore, connectFirestoreEmulator, getDoc, setDoc, updateDoc, deleteDoc, doc } = await import("firebase/firestore");
const suffix = Date.now().toString(36), password = "local-fixture-password";
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function authRequest(method, email) {
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const account = await res.json(); assert.ok(account.idToken); return { ...account, email };
}
async function call(account, name, data = {}) {
  const res = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${account.idToken}` },
    body: JSON.stringify({ data }) });
  return res.json();
}
const ordinary = await authRequest("signUp", `staff-ordinary-${suffix}@example.test`);
let staff = await authRequest("signUp", `staff-admin-${suffix}@example.test`);
await db.doc(`admins/${ordinary.localId}`).set({ role: "legacy-fixture" });
check("legacy roster cannot confer admin access", !(await isAdmin({ uid: ordinary.localId, token: {} })));
const paths = ["staffSession", "staffOperations", "moderateContent", "runModerationSweep", "listModerationQueue", "backfillModerationFlags",
  "approveOrganizer", "listOrganizerApplications", "savePartner", "importPartnerCodes", "deactivatePartnerOffer", "listStaffPartners", "upsertPartnerPerk", "seedPartnerPerks", "reconcileTreasury",
  "resetTreasuryKillSwitch", "runIngest", "getSupplyReport", "runFulfilment"];
for (const name of paths) {
  const result = await call(ordinary, name);
  check(`non-admin refused: ${name}`, result.error?.status === "PERMISSION_DENIED");
}
const cli = fileURLToPath(new URL("./staff-admin.mjs", import.meta.url));
execFileSync(process.execPath, [cli, "--uid", staff.localId, "--grant", "--reason", "Local access test fixture"], { env: process.env });
check("CLI grants the canonical Auth claim", await isAdmin({ uid: staff.localId, token: { admin: true } }));
staff = await authRequest("signInWithPassword", staff.email);
check("fresh staff token reaches the server-gated queue", !(await call(staff, "listModerationQueue")).error);
const mutation = db.batch();
const target = `staff-fixture/${suffix}`;
const auditID = appendStaffAudit(mutation, staff.localId, "fixture-update", target, { value: 0 }, { value: 1 }, "Local audit fixture");
mutation.set(db.doc(target), { value: 1 }); await mutation.commit();
const audit = await db.doc(`staffAudit/${auditID}`).get();
check("mutation and before/after audit commit together", audit.data().before.value === 0 && audit.data().after.value === 1 &&
  audit.data().actor === staff.localId && typeof audit.data().time.toMillis === "function" && (await db.doc(target).get()).data().value === 1);
async function client(account, label) {
  const app = initializeApp({ projectId: "connectify-19dd8", apiKey: "local" }, `${label}-${suffix}`);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  await signInWithEmailAndPassword(auth, account.email, password);
  const store = getFirestore(app); connectFirestoreEmulator(store, "127.0.0.1", 8899); return store;
}
const normalDB = await client(ordinary, "ordinary"), adminDB = await client(staff, "admin");
async function refused(operation) { try { await operation(); return false; } catch (e) { return e.code === "permission-denied"; } }
check("non-admin cannot read audit records", await refused(() => getDoc(doc(normalDB, `staffAudit/${auditID}`))));
check("admin can read audit records", (await getDoc(doc(adminDB, `staffAudit/${auditID}`))).exists());
check("even admins cannot create audit rows", await refused(() => setDoc(doc(adminDB, `staffAudit/client-${suffix}`), { forged: true })));
check("even admins cannot edit audit rows", await refused(() => updateDoc(doc(adminDB, `staffAudit/${auditID}`), { reason: "tampered" })));
check("even admins cannot delete audit rows", await refused(() => deleteDoc(doc(adminDB, `staffAudit/${auditID}`))));
execFileSync(process.execPath, [cli, "--uid", staff.localId, "--revoke", "--reason", "Complete local access test"], { env: process.env });
check("revoked claim is refused even with a stale admin token", !(await isAdmin({ uid: staff.localId, token: { admin: true } })) &&
  (await call(staff, "listModerationQueue")).error?.status === "PERMISSION_DENIED");
console.log(`${checks} staff-access emulator checks passed; action/browser suites are separate`);
process.exit(0);
