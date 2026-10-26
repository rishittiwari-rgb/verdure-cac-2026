/** Out-of-band claim management. There is deliberately no grant callable/UI. */
import { parseArgs } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const { values } = parseArgs({ options: {
  uid: { type: "string" }, reason: { type: "string" }, project: { type: "string", default: "connectify-19dd8" },
  grant: { type: "boolean" }, revoke: { type: "boolean" }, live: { type: "boolean", default: false },
} });
if (!values.uid || !values.reason?.trim() || !!values.grant === !!values.revoke)
  throw new Error("Use --uid UID --reason REASON and exactly one of --grant or --revoke");
const local = /^(127\.0\.0\.1|localhost):\d+$/;
if (!values.live && (!local.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "") ||
    !local.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")))
  throw new Error("Local Auth and Firestore emulators required. Live claim changes require explicit --live and trusted credentials.");
if (values.live && (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST))
  throw new Error("Refusing mixed live/emulator administration");
initializeApp({ projectId: values.project });
const auth = getAuth(), db = getFirestore();
const user = await auth.getUser(values.uid);
const before = user.customClaims ?? {}, after = { ...before };
if (values.grant) after.admin = true; else delete after.admin;
const audit = db.collection("staffAudit").doc();
await audit.create({ actor: `cli:${process.env.USER ?? "operator"}`, action: "admin-claim-change", target: `auth/${values.uid}`,
  time: Timestamp.now(), before, after, reason: values.reason.trim(), status: "requested" });
try {
  await auth.setCustomUserClaims(values.uid, after);
  if (values.revoke) await auth.revokeRefreshTokens(values.uid);
  // Append the outcome; never rewrite an audit row. Auth/Firestore are separate systems.
  await db.collection("staffAudit").add({ actor: `cli:${process.env.USER ?? "operator"}`, action: "admin-claim-result",
    target: `auth/${values.uid}`, time: Timestamp.now(), before, after, reason: values.reason.trim(), requestId: audit.id, status: "completed" });
  console.log(`${values.grant ? "Granted" : "Revoked"} admin claim for ${values.uid}. Sign in again to refresh the token.`);
} catch (e) {
  await db.collection("staffAudit").add({ actor: `cli:${process.env.USER ?? "operator"}`, action: "admin-claim-result",
    target: `auth/${values.uid}`, time: Timestamp.now(), before, after: null, reason: values.reason.trim(), requestId: audit.id, status: "failed" });
  throw e;
}
