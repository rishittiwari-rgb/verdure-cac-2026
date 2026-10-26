/**
 * For You honours onboarding picks — emulator check against the real ingested events.
 *
 * Two fresh accounts store their picks exactly as the app writes them (PlaceCategory raw
 * values), call the actual recommendedEvents callable, and must get visibly different
 * top 10s. The student who picked Parks + Trails must see mostly outdoor listings. Then one
 * account per pick (`foryou-pick-<pick>`) must get a top-10 card that names its own pick; with
 * --keep these are the accounts DemoWalkthroughUITests signs in to for demo-screens/foryou-<pick>.png.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node scripts/foryou-interests-e2e.mjs [--keep]
 */
import assert from "node:assert/strict";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899", "emulator only");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099", "emulator only");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { getAuth } = await import("firebase-admin/auth");

const FUNCTIONS = "http://127.0.0.1:5002/connectify-19dd8/us-central1";
const SJSU = { lat: 37.3352, lng: -121.8811 };
const OUTDOOR = /\b(hike|hiking|trail|nature|walk|ramble|preserve|park|garden|birding|wildflower|creek|open space|outdoor|ranger|docent)\b/i;
const CAREERISH = /\b(career|resume|interview|internship|hackathon|networking|employer|job|developer|coding|workshop|info session)\b/i;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`  ${cond ? "✅" : "❌"} ${name} ${cond ? "" : extra}`); };

async function account(uid, interests, extra = {}) {
  const email = `${uid}@example.test`, password = "local-foryou-check";
  try { await getAuth().deleteUser(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  await getAuth().createUser({ uid, email, password });
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await db.doc(`users/${uid}`).set({ displayName: uid, birthYear: 2004, ageBand: "adult", interests, pointsBalance: 0, ...extra });
  await db.doc(`rateLimits/${uid}_recommendedEvents`).delete();
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await res.json()).idToken;
}

async function forYou(token) {
  const res = await fetch(`${FUNCTIONS}/recommendedEvents`, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { areaId: "san-jose-ca", lat: SJSU.lat, lng: SJSU.lng, limit: 10 } }) });
  const body = await res.json();
  assert.ok(body.result, `recommendedEvents failed: ${JSON.stringify(body)}`);
  const rows = body.result.events.slice(0, 10);
  const docs = await Promise.all(rows.map((r) => db.doc(`events/${r.id}`).get()));
  return rows.map((r, i) => ({ ...r, title: docs[i].data()?.title ?? "", category: docs[i].data()?.category ?? "", source: docs[i].data()?.source ?? "" }));
}

const student = await forYou(await account("foryou-student-trails", ["Parks", "Trails"], { studentStatus: true, school: "San José State University" }));
const community = await forYou(await account("foryou-community-sports", ["Community", "Sports"]));
const show = (label, rows) => { console.log(`\n${label}`); for (const r of rows) console.log(`   ${r.score.toFixed(3)}  [${r.category}] ${r.title.slice(0, 70)}  — ${r.reasons.join(" · ")}`); };
show("Student · Parks + Trails", student);
show("Community + Sports", community);
console.log("");

const outdoor = student.filter((r) => OUTDOOR.test(r.title) || r.source === "midpen" || r.category === "Cleanup").length;
const careerish = student.filter((r) => CAREERISH.test(r.title)).length;
ok("student Parks + Trails: top 10 is mostly outdoor", outdoor >= 6, `${outdoor}/10`);
ok("student Parks + Trails: at most 2 workshop/hackathon/career listings", careerish <= 2, `${careerish}`);
const overlap = student.filter((r) => community.some((c) => c.id === r.id)).length;
ok("the two accounts get visibly different top 10s", overlap <= 4, `${overlap} shared`);
ok("the reasons line names a pick, not an internal word",
   student.some((r) => r.reasons.some((x) => /^Because you like (Parks|Trails)$/.test(x))) &&
   !student.some((r) => r.reasons.some((x) => /the outdoors|hiking/.test(x))));

const PICKS = ["Parks", "Trails", "Gardens", "Playgrounds", "Waterfront", "Sports", "Scenic", "Community"];
const pickUids = PICKS.map((pick) => `foryou-pick-${pick.toLowerCase()}`);
for (const [i, pick] of PICKS.entries()) {
  const rows = await forYou(await account(pickUids[i], [pick]));
  ok(`${pick} alone: a top-10 card says "Because you like ${pick}"`,
     rows.some((r) => r.reasons.includes(`Because you like ${pick}`)), JSON.stringify(rows.map((r) => r.reasons[0])));
}

if (!process.argv.includes("--keep")) {
  for (const uid of ["foryou-student-trails", "foryou-community-sports", ...pickUids]) {
    await getAuth().deleteUser(uid).catch(() => {}); await db.recursiveDelete(db.doc(`users/${uid}`));
  }
}
console.log(`══ foryou-interests: ${pass} passed, ${fail} failed ══`);
process.exit(fail ? 1 : 0);
