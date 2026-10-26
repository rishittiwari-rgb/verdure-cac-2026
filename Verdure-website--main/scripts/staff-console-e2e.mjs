// Browser-native B1/B2/B3 workflows against LOCAL Next + Firebase emulators.
// Uses agent-browser's own isolated Chrome session, never a personal profile.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const origin = process.env.VERDURE_STAFF_TEST_URL || "http://127.0.0.1:3104";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../../functions/lib/common.js");
const { geocodeFixtureId } = await import("../../functions/lib/staff-partners.js");
const { runSource } = await import("../../functions/lib/ingest/index.js");
const { LAUNCH_AREAS } = await import("../../functions/lib/ingest/areas.js");
const { sourceHealthId } = await import("../../functions/lib/ingest/health.js");
const suffix = Date.now().toString(36), password = "local-fixture-password", session = `verdure-console-${suffix}`;
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function account(label) {
  const email = `${label}-${suffix}@example.test`;
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const data = await r.json(); assert.ok(data.idToken); return { ...data, email };
}
async function callable(user, name, data) {
  const r = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  const body = await r.json(); assert.ok(body.result, JSON.stringify(body)); return body.result;
}
function browser(...args) {
  return execFileSync("npx", ["--yes", "agent-browser@0.38.2", "--session", session, ...args], { encoding: "utf8", timeout: 60000 });
}
function fill(label, value) { browser("find", "label", label, "fill", value); }
function fillDate(name, value) {
  // The CLI's generic fill does not reliably edit Chromium's segmented native
  // date widget. Use its native input setter, then dispatch the normal events.
  browser("eval", `(() => { const el=document.querySelector('input[name="${name}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); return el.value; })()`);
  assert.equal(browser("get", "value", `input[name="${name}"]`).trim(), value);
}
function button(label) { browser("find", "role", "button", "click", "--name", label, "--exact"); }
function wait(text) { browser("wait", "--text", text); }
function select(label, value) {
  const line = browser("snapshot", "-i").split("\n").find((x) => x.includes(`combobox "${label}"`));
  const ref = line?.match(/ref=(e\d+)/)?.[1]; assert.ok(ref, `Missing select ${label}`);
  browser("select", `@${ref}`, value);
}
const staff = await account("console-staff"), owner = await account("console-owner"), reporter = await account("console-reporter");
execFileSync(process.execPath, [fileURLToPath(new URL("../../functions/scripts/staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local staff console browser test"], { env: process.env });
await db.doc(`users/${owner.localId}`).set({ displayName: "Fictional console content author", suspended: false });
const postId = `console-post-${suffix}`, content = `Console fixture post ${suffix}: original content for review.`;
await db.doc(`posts/${postId}`).set({ authorID: owner.localId, content, hidden: false, createdAt: new Date() });
const report = await callable(reporter, "reportContent", { targetType: "post", targetId: postId, reason: "spam", details: "Fictional console report details" });
await db.doc(`moderationQueue/${report.queueId}`).update({ firstReportedAt: new Date(Date.now() - 21 * 3600000) });
const orgName = `Console fixture organization ${suffix}`;
const org = await callable(owner, "createOrganizer", { displayName: orgName, category: "community-org", description: "Fictional organization for approval proof." });
const address = `456 Fixture Avenue ${suffix}, San Jose, CA 95113`, partnerName = `Console fictional partner ${suffix}`, perkTitle = `Console fictional offer ${suffix}`;
await db.doc(`qaGeocodes/${geocodeFixtureId(address)}`).set({ response: { result: { addressMatches: [{ matchedAddress: address.toUpperCase(), coordinates: { x: -121.89, y: 37.335 } }] } } });
const csvPath = `/tmp/verdure-console-${suffix}.csv`;
writeFileSync(csvPath, `code\nCONSOLE-${suffix.toUpperCase()}-001\nCONSOLE-${suffix.toUpperCase()}-002\nCONSOLE-${suffix.toUpperCase()}-003\n`);
const pagingRefs = [], healthRef = db.doc(`sourceHealth/${sourceHealthId("ticketmaster", LAUNCH_AREAS[0].id)}`);
const beforeHealth = await healthRef.get(); let sourceRunStarted = 0;
const paging = db.batch();
for (let i = 0; i < 105; i++) {
  const id = `console-page-${suffix}-${String(i).padStart(3,"0")}`;
  const post = db.doc(`posts/${id}`), queue = db.doc(`moderationQueue/${id}`), organizer = db.doc(`organizers/${id}`);
  pagingRefs.push(post, queue, organizer);
  paging.create(post, { content: `Fictional paging content ${i}`, hidden: false });
  paging.create(queue, { targetType: "post", targetId: id, status: "open", reportCount: 0, firstReportedAt: new Date(1000) });
  paging.create(organizer, { displayName: `Fictional paging organization ${i}`, status: "pending", createdAt: new Date(1000) });
}
await paging.commit();
try {
  const unauth = await fetch(`${origin}/admin/api/call`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "listModerationQueue" }) });
  check("website refuses a call without a staff session", unauth.status === 401);
  const csrf = await fetch(`${origin}/admin/api/session`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ email: staff.email, password }) });
  check("website refuses cross-origin sign-in", csrf.status === 403);
  const nonadmin = await fetch(`${origin}/admin/api/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: reporter.email, password }) });
  check("valid non-admin credentials cannot open staff console", nonadmin.status === 403 && !nonadmin.headers.get("set-cookie"));
  browser("--executable-path", process.env.VERDURE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "open", `${origin}/admin`);
  wait("Sign in to review and manage");
  browser("snapshot", "-i");
  fill("Staff email", staff.email); fill("Password", password); button("Sign in"); wait("Review reports");
  wait("Load more reports"); button("Load more reports"); wait(content.slice(0, 100));
  check("browser reaches reports beyond the first 100", browser("get", "text", "body").includes(content.slice(0, 100)));
  check("browser signs in to the real staff queue", browser("get", "text", "body").includes("Review reports"));
  check("session token is inaccessible to browser scripts", browser("eval", 'document.cookie.includes("verdure_staff_session")').trim() === "false");
  browser("find", "text", content.slice(0, 100), "click"); wait("Reported post");
  check("report content details count and overdue age render", browser("get", "text", "body").includes("Fictional console report details") && browser("get", "text", "body").includes("needs attention"));
  fill("Reason for this decision", "Remove fictional console report"); button("Remove"); wait("Review saved: remove.");
  check("browser removal changes authoritative post and audit", (await db.doc(`posts/${postId}`).get()).data().hidden === true &&
    (await db.collection("staffAudit").where("target", "==", `posts/${postId}`).get()).docs.some((x) => x.data().actor === staff.localId));
  select("Report status", "resolved"); wait(content.slice(0, 100));
  browser("find", "text", content.slice(0, 100), "click"); wait("Previous decision:");
  fill("Reason for this decision", "Restore fictional console report"); button("Restore"); wait("Review saved: restore.");
  check("resolved history supports real restore", (await db.doc(`posts/${postId}`).get()).data().content === content && (await db.doc(`posts/${postId}`).get()).data().hidden === false);
  button("Organizers"); wait("Load more applications"); button("Load more applications"); wait(orgName);
  check("browser reaches applications beyond the first 100", browser("get", "text", "body").includes(orgName));
  check("organizer review displays manual cap used and remaining", browser("get", "text", "body").includes("manual approvals used") && browser("get", "text", "body").includes("remaining"));
  browser("find", "text", orgName, "click"); fill("Reason for organizer decision", "Approve fictional console organization"); button("Approve"); wait("Organizer decision saved: approve.");
  check("browser approval changes authoritative organizer", (await db.doc(`organizers/${org.organizerId}`).get()).data().status === "approved");
  button("Partners"); wait("New partner draft");
  fill("Business name", partnerName); select("Business category", "retail"); fill("Full street address", address);
  fill("Contact name", "Fictional console contact"); fill("Contact email", "console@example.test"); fill("Reason for saving", "Create fictional console draft");
  browser("find", "label", "Activate partner", "check"); button("Save partner"); wait("Record who agreed");
  check("browser cannot activate without agreement", (await db.collection("partners").where("name", "==", partnerName).get()).empty);
  fill("Who agreed", "Fictional fixture contact"); fillDate("agreedAt", "2026-10-03T12:00"); fill("Written confirmation reference", "Fixture only; no real business agreement");
  button("Save partner"); wait("Partner saved. Address matched:");
  const partnerRow = (await db.collection("partners").where("name", "==", partnerName).get()).docs[0];
  check("browser saves agreed geocoded partner", partnerRow.data().active === true && partnerRow.data().latitude === 37.335 && partnerRow.data().agreement.reference.includes("Fixture only"));
  fill("Perk title", perkTitle); fill("Point cost (500–2,000)", "700"); fillDate("expiresAt", "2026-11-03T12:00"); fill("Offer terms", "Fictional browser-test terms"); fill("Reason for saving perk", "Create fictional console offer");
  button("Save perk"); wait("Perk saved."); wait(perkTitle);
  const perkRow = (await db.collection("partnerPerks").where("title", "==", perkTitle).get()).docs[0];
  check("browser creates perk under agreed business", perkRow.data().partnerId === partnerRow.id && perkRow.data().pointCost === 700);
  browser("find", "text", perkTitle, "click"); wait(`Load codes for ${perkTitle}`);
  browser("upload", "input[type=file]", csvPath); browser("wait", "--fn", `Array.from(document.querySelectorAll("textarea")).some(x => x.value.includes("CONSOLE-${suffix.toUpperCase()}-001"))`);
  fill("Reason for code upload or deactivation", "Load fictional console CSV"); button("Load CSV codes"); wait("3 codes loaded; 3 unused codes remain.");
  check("browser CSV upload loads actual codes and shows low stock", (await perkRow.ref.get()).data().codePoolCount === 3 && browser("get", "text", "body").includes("low stock"));
  const map = await callable(reporter, "nearbyPartners", { surface: "map", lat: 37.335, lng: -121.89 });
  check("console-created offer reaches map endpoint", map.offers.some((x) => x.perkId === perkRow.id && x.partnerId === partnerRow.id));
  browser("screenshot", `/tmp/verdure-admin-partners-${suffix}.png`);
  fill("Reason for code upload or deactivation", "Deactivate fictional browser-test partner"); button("Deactivate partner"); wait("Partner deactivated.");
  check("browser deactivation removes actual map offer", !(await callable(reporter, "nearbyPartners", { surface: "map", lat: 37.335, lng: -121.89 })).offers.some((x) => x.perkId === perkRow.id));
  sourceRunStarted = Date.now(); await runSource("ticketmaster", LAUNCH_AREAS[0], {});
  button("Operations"); wait("TICKETMASTER_KEY not configured"); wait("Spend and limits");
  const operations = browser("get", "text", "body");
  check("browser surfaces actual adapter failure and last-success column", operations.includes("failed") && operations.includes("Last successful run") && operations.includes("Events returned"));
  check("browser shows queues duplicate metric and spend against cap", operations.includes("Suspected duplicate rate") && operations.includes("Pending organizers") &&
    operations.includes("$200.00") && operations.includes("not a vendor invoice") && operations.includes("monthly searches"));
  browser("screenshot", `/tmp/verdure-admin-operations-${suffix}.png`);
  browser("set", "viewport", "390", "844"); browser("screenshot", `/tmp/verdure-admin-mobile-${suffix}.png`);
  check("staff layout fits mobile viewport", browser("eval", "document.documentElement.scrollWidth <= window.innerWidth").trim() === "true");
  check("no browser page errors", browser("errors").trim().length === 0);
  button("Sign out"); wait("Sign in to review and manage");
  check("browser sign-out clears access", browser("get", "text", "body").includes("Sign in to review and manage"));
  console.log(`${checks} staff console browser/server checks passed`);
} catch (error) {
  browser("screenshot", `/tmp/verdure-admin-failure-${suffix}.png`); console.error(browser("snapshot", "-i")); throw error;
} finally {
  browser("close");
  for (let offset = 0; offset < pagingRefs.length; offset += 200) {
    const batch = db.batch(); for (const ref of pagingRefs.slice(offset, offset + 200)) batch.delete(ref); await batch.commit();
  }
  if (sourceRunStarted) {
    const runs = await db.collection("ingestRuns").where("source", "==", "ticketmaster").where("runAt", ">=", new Date(sourceRunStarted)).get();
    for (const d of runs.docs) await d.ref.delete();
  }
  if (beforeHealth.exists) await healthRef.set(beforeHealth.data()); else await healthRef.delete();
}
process.exit(0);
