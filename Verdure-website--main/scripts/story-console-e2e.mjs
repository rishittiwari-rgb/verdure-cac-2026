// Native staff form against LOCAL Firebase and Next. No real ownership claims.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899");
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"; process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../../functions/lib/common.js");
const { getAuth } = createRequire(new URL("../../functions/package.json", import.meta.url))("firebase-admin/auth");
const suffix = Date.now().toString(36), session = `story-console-${suffix}`, password = "local-story-console-only";
const origin = process.env.VERDURE_STAFF_TEST_URL || "http://127.0.0.1:3104";
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
let checks = 0;
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };
function browser(...args) { return execFileSync("npx", ["--yes", "agent-browser@0.38.2", "--session", session, ...args], { encoding: "utf8", timeout: 60000 }); }
function snapshot() { return browser("snapshot", "-i"); }
function fill(label, value) { browser("find", "label", label, "fill", value); }
function button(name) { browser("find", "role", "button", "click", "--name", name, "--exact"); }
const email = `story-console-${suffix}@example.test`;
const user = await (await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json();
assert.ok(user.localId);
const org = `story-console-${suffix}-org`, placeId = `osm-${Date.now()}98`, placeName = `Fictional console story place ${suffix}`;
try {
  execFileSync(process.execPath, [fileURLToPath(new URL("../../functions/scripts/staff-admin.mjs", import.meta.url)), "--uid", user.localId,
    "--grant", "--reason", "Fictional story ownership browser proof"], { env: process.env, stdio: "ignore" });
  await db.doc(`users/${user.localId}`).set({ displayName: "Fictional console QA account" });
  await db.doc(`organizers/${org}`).set({ ownerUid: user.localId, displayName: `Fictional console organizer ${suffix}`,
    status: "approved", hidden: false, createdAt: new Date(), category: "parks" });
  browser("open", `${origin}/admin`); browser("wait", "--text", "Sign in to review and manage"); snapshot();
  fill("Staff email", email); fill("Password", password); button("Sign in"); browser("wait", "--text", "Moderation"); snapshot();
  button("Place stories"); browser("wait", "--text", "Written ownership confirmation reference");
  browser("wait", "--text", `Fictional console organizer ${suffix}`);
  const initial = snapshot();
  check("authenticated staff form exposes ownership confirmation and reason", initial.includes("Written ownership confirmation reference") && initial.includes("Reason for verification"));
  fill("Place ID", placeId);
  const selectRef = initial.split("\n").find((line) => line.includes('combobox "Approved organizer"'))?.match(/ref=(e\d+)/)?.[1];
  assert.ok(selectRef); browser("select", `@${selectRef}`, org); snapshot();
  fill("Place name (outside the official park catalog)", placeName);
  fill("Official place link (outside the official park catalog)", `https://www.openstreetmap.org/node/${placeId.slice(4)}`);
  fill("Reason for verification", "Fictional local written confirmation checked"); button("Verify ownership");
  check("browser validation refuses missing ownership confirmation", !(await db.doc(`placeStoryOwnership/${placeId}`).get()).exists);
  fill("Written ownership confirmation reference", "Fictional written QA confirmation; no real place owner"); button("Verify ownership");
  browser("wait", "--text", "Ownership verified."); snapshot();
  const ownership = (await db.doc(`placeStoryOwnership/${placeId}`).get()).data();
  check("browser saves canonical approved organizer ownership", ownership.active && ownership.organizerId === org && ownership.ownerUid === user.localId);
  check("verification record is visible to staff", browser("get", "text", "body").includes("Fictional written QA confirmation; no real place owner"));
  browser("screenshot", fileURLToPath(new URL("../../docs/evidence/story-ownership-console-2026-10-04.png", import.meta.url)), "--full");
  fill(`Reason to revoke ownership of ${placeName}`, "Fictional ownership ended"); button("Revoke ownership");
  browser("wait", "--text", `Ownership revoked for ${placeName}`); snapshot();
  check("browser revocation immediately removes ownership availability", (await db.doc(`placeStoryOwnership/${placeId}`).get()).data().active === false);
  const audits = await db.collection("staffAudit").where("target", "==", `placeStoryOwnership/${placeId}`).get();
  check("both browser mutations retain staff before/after audits", audits.size === 2 && audits.docs.every((d) => d.data().actor === user.localId && d.data().before !== undefined && d.data().after && d.data().reason));
  button("Moderation"); browser("wait", "--text", "Content type");
  check("existing moderation filters offer Place story", snapshot().includes('option "Place story"'));
  console.log(`${checks} actual staff story ownership browser checks passed`);
} finally {
  browser("close");
  const assignment = (await db.doc(`placeStoryOwnership/${placeId}`).get()).data();
  if (assignment?.storyId) await db.doc(`placeStories/${assignment.storyId}`).delete();
  for (const path of [`placeStoryOwnership/${placeId}`, `placeStoryStatus/${placeId}`, `organizers/${org}`, `organizerStoryStatus/${org}`]) await db.doc(path).delete();
  await db.recursiveDelete(db.doc(`users/${user.localId}`)); await db.doc(`storyAuthorStatus/${user.localId}`).delete();
  await getAuth().deleteUser(user.localId);
  // Immutable fictional staff audits remain. No public corpus reset or deploy.
}
