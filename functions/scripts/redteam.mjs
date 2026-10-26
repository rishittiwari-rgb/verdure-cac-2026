// Verdure RED TEAM — adversarial security probe.
//
//   cd functions && npm run redteam
//
// Threat model: an attacker who has unzipped the shipped app. They hold the
// public Firebase API key, the project id, the storage bucket, and can register
// accounts freely. They do NOT go through the iOS app — they speak to the REST
// and callable endpoints directly, so every client-side gate (the 500 ft
// proximity check, disabled buttons, affordability checks) is irrelevant.
//
// Every probe below is an ATTACK that must FAIL. A probe that succeeds is a
// vulnerability, and this script exits non-zero so it can gate CI.
//
// `expectBlocked` = the attack was correctly refused.
// `VULNERABLE`    = the attack worked. Fix the system, never the test.

import http from "node:http";
import { EMULATORS } from "./local-emulator-targets.mjs";
import { initializeApp as adminInit } from "firebase-admin/app";
import { getFirestore as adminFirestore } from "firebase-admin/firestore";
import { initializeApp as clientInit } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore as clientFirestore, connectFirestoreEmulator,
  doc, setDoc, updateDoc, deleteDoc, getDoc, increment, serverTimestamp,
  collection, query, where, getDocs, writeBatch,
} from "firebase/firestore";

const PROJECT = "connectify-19dd8";
const REGION = "us-central1";
const AUTH = `${EMULATORS.auth.url}/identitytoolkit.googleapis.com/v1`;
const FN = `${EMULATORS.functions.url}/${PROJECT}/${REGION}`;
const BUCKET = process.env.STORAGE_BUCKET || `${PROJECT}.firebasestorage.app`;
const STORAGE = `${EMULATORS.storage.url}/v0/b/${BUCKET}/o`;


adminInit({ projectId: PROJECT });
const db = adminFirestore();

const capp = clientInit({ projectId: PROJECT, apiKey: "fake-api-key" });
const cauth = getAuth(capp);
connectAuthEmulator(cauth, EMULATORS.auth.url, { disableWarnings: true });
const cdb = clientFirestore(capp);
connectFirestoreEmulator(cdb, EMULATORS.firestore.host, EMULATORS.firestore.port);

let blocked = 0;
const vulns = [];

function expectBlocked(name, wasBlocked, detail = "") {
  if (wasBlocked) { blocked++; console.log(`  🛡  ${name}`); }
  else { vulns.push(name); console.error(`  🚨 VULNERABLE: ${name} ${detail}`); }
}

// Positive control: legitimate behaviour that must KEEP WORKING. A lockdown
// that breaks the product fails here, which is just as much a defect as a hole.
function expectWorks(name, didWork, detail = "") {
  if (didWork) { blocked++; console.log(`  ✅ ${name}`); }
  else { vulns.push(`BROKEN: ${name}`); console.error(`  ❌ BROKEN: ${name} ${detail}`); }
}

// ── transport ───────────────────────────────────────────────────────────────

function req(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(data ? { "Content-Length": data.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    r.on("error", reject);
    r.setTimeout(30000, () => r.destroy(new Error(`timeout ${url}`)));
    if (data) r.write(data);
    r.end();
  });
}

async function signUp(email, password = "attacker-pw-1") {
  const r = await req(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!r.json?.idToken) throw new Error(`signUp failed: ${r.text}`);
  return { idToken: r.json.idToken, uid: r.json.localId, email, password };
}

async function call(name, data, idToken) {
  const r = await req(`${FN}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json",
               ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return r.json ?? { error: { status: "BAD_RESPONSE", message: r.text } };
}

async function upload(path, idToken, { bytes, contentType = "image/jpeg" } = {}) {
  const payload = bytes ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
  const boundary = "rt-boundary";
  const meta = JSON.stringify({ name: path, contentType });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    payload,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  for (const prefix of ["Firebase", "Bearer"]) {
    const r = await req(`${STORAGE}?uploadType=multipart&name=${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}`,
                 // Without this the emulator doesn't parse the multipart body,
                 // so contentType is never seen and storage.rules' image check
                 // refuses every upload — including the legitimate ones.
                 "X-Goog-Upload-Protocol": "multipart",
                 Authorization: `${prefix} ${idToken}` },
      body,
    });
    if (r.status === 200) return 200;
    if (prefix === "Bearer") { lastUploadBody = r.text; return r.status; }
  }
}

/** Rules-checked client write; returns "ok" or the error code. */
async function tryWrite(fn) {
  try { await fn(); return "ok"; } catch (e) { return e.code ?? String(e); }
}

let lastUploadBody = '';
const NEAR = { lat: 44.9812, lng: -93.2612 };

// ── the red team ────────────────────────────────────────────────────────────

async function main() {
  console.log("── Verdure RED TEAM: every probe below must FAIL ──\n");

  const pw = "attacker-pw-1";
  const atk = await signUp(`redteam-${Date.now()}@evil.test`, pw);
  await signInWithEmailAndPassword(cauth, atk.email, pw);
  const victim = await signUp(`victim-${Date.now()}@verdure.test`, pw);
  console.log(`  attacker: ${atk.uid}\n  victim:   ${victim.uid}\n`);

  // Seed a legitimate event owned by the victim, and a victim post.
  await db.doc("events/rt-legit-event").set({
    title: "Legit", organizer: "V", date: new Date("2026-09-01T17:00:00Z"),
    time: "12:00 PM", locationName: "Venue", attendeeCount: 1, category: "Market",
    imagePlaceholder: "bag.fill", pointValue: 75, creatorID: victim.uid,
    createdAt: new Date(), latitude: 44.98, longitude: -93.26,
  });
  await db.doc("posts/rt-victim-post").set({
    authorID: victim.uid, authorName: "Victim", authorInitials: "VV",
    placeName: "Park", content: "hello", likeCount: 0, createdAt: new Date(),
  });

  // The attacker's own (legitimate) proof photo. Several probes below rely on
  // this existing — if the upload fails they'd all be refused for "no proof"
  // and pass without ever testing what they claim to, so assert it up front.
  const proof = `proofs/${atk.uid}/p.jpg`;
  const proofStatus = await upload(proof, atk.idToken);
  if (proofStatus !== 200) {
    console.error(`  FATAL: attacker proof upload returned ${proofStatus}; probes would pass vacuously.`);
    console.error(`  body: ${lastUploadBody.slice(0,300)}`);
    process.exit(1);
  }

  // ══ 1. ECONOMY: can the attacker mint points? ══
  console.log("── Economy / points integrity ──");

  // Self-dealt event: create an event you own, at your own coordinates, with
  // the highest pointValue the rules permit, then check into it.
  const selfEvent = "rt-self-dealt";
  const selfCreate = await tryWrite(() => setDoc(doc(cdb, `events/${selfEvent}`), {
    title: "My Own Event", organizer: "Me", date: new Date("2026-09-01T17:00:00Z"),
    time: "12:00 PM", locationName: "My House", attendeeCount: 1,
    category: "Market",                 // ceiling is only 75 for Market…
    imagePlaceholder: "bag.fill",
    pointValue: 1000,                   // …but the doc claims 1000
    creatorID: atk.uid, createdAt: serverTimestamp(), hidden: false, active: true, source: "community", adultOnly: false,
    latitude: NEAR.lat, longitude: NEAR.lng,   // right where the attacker is
  }));
  // Diagnostics matter here: if event creation failed for an unrelated schema
  // reason the probe would "pass" without ever testing the farming path.
  console.log(`     [diag] self-event create → ${selfCreate}`);
  let r = selfCreate === "ok"
    ? await call("checkInToEvent", { eventId: selfEvent, category: "Market",
        claimedPoints: 1000, proofPath: proof, lat: NEAR.lat, lng: NEAR.lng }, atk.idToken)
    : { error: { status: "CREATE_BLOCKED" } };
  console.log(`     [diag] self-event check-in → ${JSON.stringify(r).slice(0, 140)}`);
  expectBlocked("cannot farm points from a self-created event",
    selfCreate === "ok" && (!!r.error || (r.result?.awarded ?? 0) <= 75),
    `create=${selfCreate} awarded=${r.result?.awarded}`);

  // Even legitimately, the stored pointValue must not exceed the category ceiling.
  await db.doc("events/rt-inflated").set({
    title: "Inflated", organizer: "V", date: new Date("2026-09-01T17:00:00Z"),
    time: "12", locationName: "V", attendeeCount: 1, category: "Market",
    imagePlaceholder: "bag.fill", pointValue: 1000, creatorID: victim.uid,
    createdAt: new Date(), latitude: NEAR.lat, longitude: NEAR.lng,
  });
  r = await call("checkInToEvent", { eventId: "rt-inflated", category: "Market",
    claimedPoints: 1000, proofPath: proof, lat: NEAR.lat, lng: NEAR.lng }, atk.idToken);
  expectBlocked("stored pointValue cannot exceed the category ceiling",
    (r.result?.awarded ?? 0) <= 75, `awarded ${r.result?.awarded}`);

  // Direct writes to the server-owned economy fields.
  expectBlocked("cannot write own pointsBalance",
    (await tryWrite(() => updateDoc(doc(cdb, `users/${atk.uid}`), { pointsBalance: 999999 }))) === "permission-denied");
  expectBlocked("cannot write own lifetimePoints",
    (await tryWrite(() => updateDoc(doc(cdb, `users/${atk.uid}`), { lifetimePoints: 999999 }))) === "permission-denied");
  expectBlocked("cannot forge checkedInEventIDs",
    (await tryWrite(() => updateDoc(doc(cdb, `users/${atk.uid}`), { checkedInEventIDs: ["x"] }))) === "permission-denied");
  expectBlocked("cannot forge redeemedRewardIDs",
    (await tryWrite(() => updateDoc(doc(cdb, `users/${atk.uid}`), { redeemedRewardIDs: ["apple-50"] }))) === "permission-denied");
  expectBlocked("cannot grant self Verdure+",
    (await tryWrite(() => updateDoc(doc(cdb, `users/${atk.uid}`), { plusExpiresAt: Date.now() + 8.64e7 }))) === "permission-denied");
  expectBlocked("cannot create a user doc pre-loaded with points",
    (await tryWrite(() => setDoc(doc(cdb, `users/rt-fresh-${Date.now()}`), { pointsBalance: 50000 }))) === "permission-denied");

  // Daily earning ceiling: even with a legitimate path, value extraction is
  // bounded. Drive one account past the cap using distinct indexed events.
  const capUser = await signUp(`cap-${Date.now()}@evil.test`, pw);
  const capProof = `proofs/${capUser.uid}/p.jpg`;
  await upload(capProof, capUser.idToken);
  let totalAwarded = 0;
  let validCheckIns = 0;
  for (let i = 0; i < 12; i++) {
    await db.doc(`events/rt-ext-${i}`).set({
      title: `Indexed event ${i}`, organizer: "V", date: new Date("2026-10-01T17:00:00Z"),
      time: "12 PM", locationName: "Venue", attendeeCount: 0, category: "Festival",
      imagePlaceholder: "party.popper.fill", pointValue: 250, creatorID: "system:ingest",
      createdAt: new Date(), latitude: NEAR.lat, longitude: NEAR.lng, source: "serpapi",
    });
    const res = await call("checkInToEvent", {
      eventId: `rt-ext-${i}`, category: "Festival", claimedPoints: 250,
      proofPath: capProof, lat: NEAR.lat, lng: NEAR.lng,
    }, capUser.idToken);
    if (res.result?.alreadyCheckedIn === false) validCheckIns++;
    totalAwarded += res.result?.awarded ?? 0;
  }
  expectBlocked("daily earning ceiling caps total value extracted (600/day)",
    validCheckIns === 12 && totalAwarded === 600,
    `valid=${validCheckIns}, earned ${totalAwarded} in one day`);

  // ══ 2. ATTENDANCE EVIDENCE ══
  console.log("\n── Attendance evidence ──");
  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market",
    claimedPoints: 75, lat: NEAR.lat, lng: NEAR.lng }, atk.idToken);
  expectBlocked("check-in without a proof photo", !!r.error, JSON.stringify(r));

  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market",
    claimedPoints: 75, proofPath: `proofs/${victim.uid}/p.jpg`,
    lat: NEAR.lat, lng: NEAR.lng }, atk.idToken);
  expectBlocked("check-in with someone else's proof photo", !!r.error);

  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market",
    claimedPoints: 75, proofPath: proof }, atk.idToken);
  expectBlocked("check-in without GPS coordinates", !!r.error);

  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market",
    claimedPoints: 75, proofPath: proof, lat: 45.9, lng: -93.26 }, atk.idToken);
  expectBlocked("check-in from 100km away", !!r.error);

  r = await call("checkInToEvent", { eventId: "rt-forged-nonexistent", category: "Festival",
    claimedPoints: 250, proofPath: proof, lat: NEAR.lat, lng: NEAR.lng }, atk.idToken);
  expectBlocked("missing event cannot mint points", r.error?.status === "NOT_FOUND", JSON.stringify(r));

  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market",
    claimedPoints: 75, proofPath: "proofs/../../etc/passwd", lat: NEAR.lat, lng: NEAR.lng }, atk.idToken);
  expectBlocked("path traversal in proofPath", !!r.error);

  // ══ 3. STORAGE ══
  console.log("\n── Storage ──");
  expectBlocked("upload into another user's proof folder",
    (await upload(`proofs/${victim.uid}/evil.jpg`, atk.idToken)) === 403);
  expectBlocked("upload a non-image as proof",
    (await upload(`proofs/${atk.uid}/evil.html`, atk.idToken,
      { bytes: Buffer.from("<script>x</script>"), contentType: "text/html" })) === 403);
  expectBlocked("upload an oversized proof (>8MB)",
    (await upload(`proofs/${atk.uid}/big.jpg`, atk.idToken,
      { bytes: Buffer.alloc(9 * 1024 * 1024, 1) })) === 403);

  // ══ 4. PRIVACY ══
  console.log("\n── Privacy / data exposure ──");
  expectBlocked("read another user's profile document",
    (await tryWrite(() => getDoc(doc(cdb, `users/${victim.uid}`)))) === "permission-denied");
  for (const coll of ["attendance", "fulfillments", "rateLimits"]) {
    let code; try { await getDocs(query(collection(cdb, coll))); code = "ok"; }
    catch (e) { code = e.code; }
    expectBlocked(`enumerate /${coll}`, code === "permission-denied", `got ${code}`);
  }
  expectBlocked("reset own rate-limit counter",
    (await tryWrite(() => setDoc(doc(cdb, `rateLimits/${atk.uid}_redeemReward`), { count: 0 }))) === "permission-denied");

  // ══ 5. INTEGRITY OF OTHERS' CONTENT ══
  console.log("\n── Tampering with other users' content ──");
  expectBlocked("edit another user's post content",
    (await tryWrite(() => updateDoc(doc(cdb, "posts/rt-victim-post"), { content: "defaced" }))) === "permission-denied");
  expectBlocked("delete another user's post",
    (await tryWrite(() => deleteDoc(doc(cdb, "posts/rt-victim-post")))) === "permission-denied");
  expectBlocked("edit another user's event",
    (await tryWrite(() => updateDoc(doc(cdb, "events/rt-legit-event"), { pointValue: 999 }))) === "permission-denied");
  expectBlocked("delete another user's event",
    (await tryWrite(() => deleteDoc(doc(cdb, "events/rt-legit-event")))) === "permission-denied");
  expectBlocked("create an event owned by someone else",
    (await tryWrite(() => setDoc(doc(cdb, "events/rt-forged"), {
      title: "Forged", organizer: "x", date: new Date(), time: "1",
      locationName: "x", attendeeCount: 1, category: "Market",
      imagePlaceholder: "bag.fill", pointValue: 75,
      creatorID: victim.uid, createdAt: serverTimestamp(),
    }))) === "permission-denied");
  expectBlocked("create an event with pointValue above the schema cap",
    (await tryWrite(() => setDoc(doc(cdb, "events/rt-overcap"), {
      title: "Overcap", organizer: "x", date: new Date(), time: "1",
      locationName: "x", attendeeCount: 1, category: "Market",
      imagePlaceholder: "bag.fill", pointValue: 100000,
      creatorID: atk.uid, createdAt: serverTimestamp(),
    }))) === "permission-denied");


  // ══ 5b. MINOR PROTECTION (W2): adult-only listings vs. a minor and a guest ══
  console.log("\n── Adult-only listings vs. a minor ──");
  const seedListing = (id, title, adultOnly) => db.doc(`events/${id}`).set({ title, organizer: "V", date: new Date(Date.now() + 3 * 86_400_000), time: "9 PM",
    locationName: "Downtown", attendeeCount: 0, category: "Social", imagePlaceholder: "cup.and.saucer.fill", pointValue: 100, creatorID: "system:ingest",
    createdAt: new Date(), hidden: false, active: true, broadcast: true, source: "ics", areaId: "san-jose-ca", adultOnly, adultOnlyReason: adultOnly ? "alcohol" : null,
    topicTags: ["social"], contentHash: "rt", qualityScore: 0.8, latitude: 37.3382, longitude: -121.8863 });
  await seedListing("rt-adult-only", "Bar Crawl", true);
  await seedListing("rt-ordinary", "Park Chess", false);
  await db.doc("feedCaches/san-jose-ca").delete().catch(() => {});
  const teen = await signUp(`teen-${Date.now()}@evil.test`, pw);
  await call("registerAgeBand", { birthYear: new Date().getUTCFullYear() - 15 }, teen.idToken);
  const teenApp = clientInit({ projectId: PROJECT, apiKey: "fake-api-key" }, "teen");
  const teenAuth = getAuth(teenApp);
  connectAuthEmulator(teenAuth, EMULATORS.auth.url, { disableWarnings: true });
  const teenDb = clientFirestore(teenApp);
  connectFirestoreEmulator(teenDb, EMULATORS.firestore.host, EMULATORS.firestore.port);
  await signInWithEmailAndPassword(teenAuth, teen.email, pw);
  const guestDb = clientFirestore(clientInit({ projectId: PROJECT, apiKey: "fake-api-key" }, "guest-rt"));
  connectFirestoreEmulator(guestDb, EMULATORS.firestore.host, EMULATORS.firestore.port);
  const listCode = async (fdb, withFilter) => {
    const c = [where("hidden", "==", false), where("active", "==", true), where("broadcast", "==", true)];
    if (withFilter) c.push(where("adultOnly", "==", false));
    c.push(where("date", ">=", new Date()));
    try { return { code: "ok", ids: (await getDocs(query(collection(fdb, "events"), ...c))).docs.map((d) => d.id) }; } catch (e) { return { code: e.code, ids: [] }; }
  };
  expectBlocked("a minor cannot promote itself to adult (ageBand is server-owned)",
    (await tryWrite(() => updateDoc(doc(teenDb, `users/${teen.uid}`), { ageBand: "adult" }))) === "permission-denied");
  expectBlocked("a minor cannot list /events without the adultOnly filter", (await listCode(teenDb, false)).code === "permission-denied");
  expectBlocked("a minor cannot read an adult-only listing by id", (await tryWrite(() => getDoc(doc(teenDb, "events/rt-adult-only")))) === "permission-denied");
  expectBlocked("a signed-out client cannot read an adult-only listing by id", (await tryWrite(() => getDoc(doc(guestDb, "events/rt-adult-only")))) === "permission-denied");
  expectBlocked("a signed-out client cannot list /events without the adultOnly filter", (await listCode(guestDb, false)).code === "permission-denied");
  const teenFeed = await call("recommendedEvents", { areaId: "san-jose-ca", lat: 37.3382, lng: -121.8863, limit: 50 }, teen.idToken);
  const teenFeedIds = (teenFeed.result?.events ?? []).map((e) => e.id);
  const teenFeedAdult = (await Promise.all(teenFeedIds.map((id) => db.doc(`events/${id}`).get()))).filter((d) => d.data()?.adultOnly === true).map((d) => d.id);
  expectBlocked("a minor's ranked feed carries no adult-only listing", teenFeedIds.length > 0 && teenFeedAdult.length === 0, `adult ids in feed: ${teenFeedAdult}`);
  const teenRsvp = await call("rsvpToEvent", { eventId: "rt-adult-only", going: true }, teen.idToken);
  expectBlocked("a minor cannot RSVP to an adult-only listing", teenRsvp.error?.status === "PERMISSION_DENIED", JSON.stringify(teenRsvp));
  const teenList = await listCode(teenDb, true);
  expectWorks("a minor still browses ordinary broadcast events with the app's filtered query", teenList.code === "ok" && teenList.ids.includes("rt-ordinary") && !teenList.ids.includes("rt-adult-only"), JSON.stringify(teenList));
  const guestList = await listCode(guestDb, true);
  expectWorks("a signed-out guest still browses ordinary broadcast events", guestList.code === "ok" && guestList.ids.includes("rt-ordinary") && !guestList.ids.includes("rt-adult-only"), JSON.stringify(guestList));
  const clientEvent = (over) => ({ title: "Craft Beer Night", organizer: "Me", date: new Date(Date.now() + 3 * 86_400_000), time: "9 PM", locationName: "Downtown",
    attendeeCount: 0, category: "Social", imagePlaceholder: "cup.and.saucer.fill", pointValue: 100, creatorID: atk.uid, createdAt: serverTimestamp(),
    hidden: false, active: true, source: "community", adultOnly: false, latitude: 37.3382, longitude: -121.8863, ...over });
  expectBlocked("a client cannot attach its event to an organizer (organizerId is server-owned at create)",
    (await tryWrite(() => setDoc(doc(cdb, "events/rt-forged-org"), clientEvent({ organizerId: "some-organizer" })))) === "permission-denied");
  expectBlocked("a client cannot create a broadcast event with a self-declared adultOnly=false",
    (await tryWrite(() => setDoc(doc(cdb, "events/rt-self-broadcast"), clientEvent({ broadcast: true })))) === "permission-denied");
  expectBlocked("a client cannot create an event without the adultOnly flag",
    (await tryWrite(() => setDoc(doc(cdb, "events/rt-no-flag"), (() => { const e = clientEvent({}); delete e.adultOnly; return e; })()))) === "permission-denied");
  const selfOnly = await tryWrite(() => setDoc(doc(cdb, "events/rt-self-only"), clientEvent({})));
  expectWorks("a client's own non-broadcast community event is still accepted", selfOnly === "ok", selfOnly);
  expectBlocked("…and a minor cannot read it: it reaches nobody but its creator", (await tryWrite(() => getDoc(doc(teenDb, "events/rt-self-only")))) === "permission-denied");

  // ══ 6. SOCIAL MANIPULATION ══
  console.log("\n── Social manipulation ──");
  expectBlocked("like inflation (+5 in one write)",
    (await tryWrite(() => updateDoc(doc(cdb, "posts/rt-victim-post"), { likeCount: increment(5) }))) === "permission-denied");

  // Repeatedly +1 from a single account, EXACTLY as the app does it
  // (FirestoreService.likePost sends a bare updateDoc with increment(1) —
  // no companion document). An earlier version of this probe sent a batch
  // including a postLikes doc, which the catch-all denied, so the batch failed
  // for the wrong reason and the probe passed while the hole stayed open.
  // Always attack the path the product actually uses.
  let likesLanded = 0;
  for (let i = 0; i < 6; i++) {
    if ((await tryWrite(() => updateDoc(doc(cdb, "posts/rt-victim-post"),
                                        { likeCount: increment(1) }))) === "ok") likesLanded++;
  }
  expectBlocked("one account cannot like the same post repeatedly",
    likesLanded <= 1, `${likesLanded}/6 likes landed from ONE account`);

  // Liking is a per-user fact, so the ledger entry must be tamper-proof too.
  await tryWrite(() => setDoc(doc(cdb, `postLikes/rt-victim-post_${atk.uid}`), {
    postId: "rt-victim-post", uid: atk.uid, createdAt: serverTimestamp(),
  }));
  expectBlocked("cannot forge a like ledger entry for another user",
    (await tryWrite(() => setDoc(doc(cdb, `postLikes/rt-victim-post_${victim.uid}`), {
      postId: "rt-victim-post", uid: victim.uid, createdAt: serverTimestamp(),
    }))) === "permission-denied");

  // ══ 7. VOLUME ══
  console.log("\n── Volume / abuse ──");
  const flood = await signUp(`flood-${Date.now()}@evil.test`, pw);
  let tripped = null;
  for (let i = 0; i < 25; i++) {
    const res = await call("redeemReward", { rewardId: `nope-${i}` }, flood.idToken);
    if (res.error?.status === "RESOURCE_EXHAUSTED") { tripped = i + 1; break; }
  }
  expectBlocked("redeem endpoint is rate limited", tripped !== null, `no limit after 25 calls`);

  // ══ 8. PROXY / SSRF ══
  //
  // The external-API proxy holds our billable keys, so it must not become a
  // gadget for reaching arbitrary hosts or spending quota anonymously.
  console.log("\n── External proxy / SSRF ──");
  r = await call("externalFetch", { provider: "recreation", lat: NEAR.lat, lng: NEAR.lng }, null);
  expectBlocked("proxy rejects unauthenticated callers", r.error?.status === "UNAUTHENTICATED");

  for (const [label, payload] of [
    ["arbitrary URL", { provider: "http://169.254.169.254/latest/meta-data/" }],
    ["unknown provider", { provider: "evil" }],
    ["provider as object", { provider: { toString: "x" } }],
    ["provider as array", { provider: ["recreation"] }],
    ["provider as number", { provider: 42 }],
  ]) {
    r = await call("externalFetch", payload, atk.idToken);
    expectBlocked(`proxy refuses ${label}`, r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r).slice(0, 90));
  }

  // Type confusion must be REJECTED, never crash the function. An unhandled
  // TypeError returns INTERNAL, which is a free denial-of-service for anyone
  // holding a token — so assert on every callable, not just the proxy.
  for (const [fn, payload] of [
    ["checkInToEvent", { eventId: { toString: "x" }, category: ["a"], claimedPoints: {} }],
    ["collectPlace",   { placeId: { toString: "x" }, claimedPoints: [] }],
    ["redeemReward",   { rewardId: { toString: "x" } }],
  ]) {
    r = await call(fn, payload, atk.idToken);
    expectBlocked(`${fn} rejects type-confused input without crashing`,
      r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r).slice(0, 90));
  }

  r = await call("externalFetch", { provider: "recreation", lat: "not-a-number", lng: "x" }, atk.idToken);
  expectBlocked("proxy refuses malformed coordinates", !!r.error, JSON.stringify(r).slice(0, 90));

  // ══ 9. AUTH ══
  console.log("\n── Auth ──");
  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market", claimedPoints: 75 }, null);
  expectBlocked("unauthenticated callable invocation", r.error?.status === "UNAUTHENTICATED");
  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market", claimedPoints: 75 },
                 "not-a-real-token");
  expectBlocked("forged bearer token", !!r.error, JSON.stringify(r).slice(0, 120));

  // ══ 10. POSITIVE CONTROLS ══
  //
  // A lockdown that also breaks the product is not a win, and every probe above
  // would still pass if the feature were simply disabled. These assert the
  // honest path still works — and that a normal, enthusiastic user is never
  // mistaken for an attacker.
  console.log("\n── Positive controls (these must SUCCEED) ──");

  const good = await signUp(`goodcitizen-${Date.now()}@verdure.test`, pw);
  const goodProof = `proofs/${good.uid}/p.jpg`;
  await upload(goodProof, good.idToken);

  // Genuine check-in at someone else's event, standing at the venue.
  r = await call("checkInToEvent", { eventId: "rt-legit-event", category: "Market",
    claimedPoints: 75, proofPath: goodProof, lat: NEAR.lat, lng: NEAR.lng }, good.idToken);
  expectWorks("a real attendee earns points for a real event",
    r.result?.awarded === 75, JSON.stringify(r));

  // Collecting places while out on a walk.
  r = await call("collectPlace", { placeId: "osm-real-1", claimedPoints: 25,
    lat: NEAR.lat, lng: NEAR.lng }, good.idToken);
  expectWorks("a real user can collect a place", r.result?.awarded === 25, JSON.stringify(r));

  // Liking a post once must work — the ledger requirement must not break likes.
  const likeOK = await tryWrite(async () => {
    const batch = writeBatch(cdb);
    batch.update(doc(cdb, "posts/rt-victim-post"), { likeCount: increment(1) });
    batch.set(doc(cdb, `postLikes/rt-victim-post_${atk.uid}`), {
      postId: "rt-victim-post", uid: atk.uid, createdAt: serverTimestamp(),
    });
    await batch.commit();
  });
  // (the attacker already consumed their single like above, so use a fresh one)
  const liker = await signUp(`liker-${Date.now()}@verdure.test`, pw);
  await signInWithEmailAndPassword(cauth, liker.email, pw);
  const freshLike = await tryWrite(async () => {
    const batch = writeBatch(cdb);
    batch.update(doc(cdb, "posts/rt-victim-post"), { likeCount: increment(1) });
    batch.set(doc(cdb, `postLikes/rt-victim-post_${liker.uid}`), {
      postId: "rt-victim-post", uid: liker.uid, createdAt: serverTimestamp(),
    });
    await batch.commit();
  });
  expectWorks("a different user CAN still like the post",
    freshLike === "ok", `got ${freshLike} (attacker replay was ${likeOK})`);

  // UX GUARANTEE: an unusually keen but genuine day must never be throttled.
  // 8 events and 25 collections in one session is far beyond typical use and
  // must still sail through — being flagged as a bot is a product failure.
  const keen = await signUp(`keen-${Date.now()}@verdure.test`, pw);
  const keenProof = `proofs/${keen.uid}/p.jpg`;
  await upload(keenProof, keen.idToken);
  let throttled = false;
  for (let i = 0; i < 8 && !throttled; i++) {
    const res = await call("checkInToEvent", { eventId: `rt-keen-ev-${i}`, category: "Social",
      claimedPoints: 100, proofPath: keenProof, lat: NEAR.lat, lng: NEAR.lng }, keen.idToken);
    if (res.error?.status === "RESOURCE_EXHAUSTED") throttled = true;
  }
  for (let i = 0; i < 25 && !throttled; i++) {
    const res = await call("collectPlace", { placeId: `rt-keen-pl-${i}`, claimedPoints: 10,
      lat: NEAR.lat, lng: NEAR.lng }, keen.idToken);
    if (res.error?.status === "RESOURCE_EXHAUSTED") throttled = true;
  }
  expectWorks("a very active real user is NOT rate limited (8 events + 25 places)",
    !throttled, "a genuine user got throttled — limits are too tight");

  // ══ 11. DISCOVERY (W4): sources are server-owned; removal is automatic but not a weapon ══
  //
  // The attacker now targets the source registry: forge a source, delete a
  // library's 6,000 listings by "requesting removal", flood the removal
  // endpoint, slip a deny-listed host in through the organizer form, or run
  // the discovery job as a non-staff account. Hosts below use the reserved
  // `.invalid` TLD (RFC 2606): it never resolves, so the removal endpoint's
  // token check cannot reach the internet from this test.
  console.log("\n── DISCOVERY (W4): source registry, removal, intake ──");
  const postJson = (name, body, headers = {}) => req(`${FN}/${name}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const { hostsFromOrganizers, enqueueCandidates } = await import("../lib/discovery/discover.js");
  const { loadActiveSources } = await import("../lib/ingest/sources-registry.js");
  const { SAN_JOSE } = await import("../lib/ingest/areas.js");

  // Server-owned collections: no client write, whatever the account.
  for (const [coll, id, data] of [
    ["sources", "rt-forged-source", { type: "ics", areaId: "san-jose-ca", host: "evil.invalid", url: "https://evil.invalid/e.ics", name: "Evil", params: {}, status: "active", origin: "probe" }],
    ["sourceCandidates", "san-jose-ca_evil.invalid", { host: "evil.invalid", areaId: "san-jose-ca", status: "pending", origins: ["organizer"] }],
    ["removalRequests", "rt-forged-removal", { host: "sjpl.bibliocommons.com", outcome: "removed" }],
    ["removedHosts", "sjpl.bibliocommons.com", { host: "sjpl.bibliocommons.com" }],
    ["sourceSubmissions", "san-jose-ca_evil.invalid", { url: "https://evil.invalid/", host: "evil.invalid", areaId: "san-jose-ca", processedAt: null }],
    ["discoveryRuns", new Date().toISOString().slice(0, 10), { inspections: 0 }],
  ]) {
    expectBlocked(`a client cannot write /${coll}`, (await tryWrite(() => setDoc(doc(cdb, `${coll}/${id}`), data))) === "permission-denied");
  }
  expectBlocked("a client cannot set an existing source to 'active'", (await tryWrite(() => updateDoc(doc(cdb, "sources/san-jose-ca_bibliocommons_sjpl"), { status: "active" }))) === "permission-denied" || (await tryWrite(() => setDoc(doc(cdb, "sources/san-jose-ca_bibliocommons_sjpl"), { status: "active" }, { merge: true }))) === "permission-denied");
  expectBlocked("a client cannot delete a removal record", (await tryWrite(() => deleteDoc(doc(cdb, "removedHosts/any.invalid")))) === "permission-denied");
  for (const coll of ["sources", "sourceCandidates", "removalRequests", "removedHosts", "sourceSubmissions"]) {
    let code; try { await getDocs(query(collection(cdb, coll))); code = "ok"; } catch (e) { code = e.code; }
    expectBlocked(`a non-staff client cannot enumerate /${coll}`, code === "permission-denied", `got ${code}`);
  }

  // A deny-listed host that somehow sits in /sources as "active" is never loaded by ingestion (the deny-list is code, not data).
  await db.doc("sources/rt-denied-active").set({ id: "rt-denied-active", type: "ics", areaId: "san-jose-ca", name: "Eventbrite", host: "www.eventbrite.com", url: "https://www.eventbrite.com/x.ics", params: { name: "x", url: "https://www.eventbrite.com/x.ics" }, status: "active", origin: "manual", createdAt: new Date(), updatedAt: new Date() });
  expectBlocked("a /sources document marked active for a deny-listed host is never loaded for ingestion", !(await loadActiveSources("san-jose-ca", "ics")).some((s) => s.id === "rt-denied-active"));

  // Removal abuse: a stranger cannot delete a large host's listings without publishing its token.
  const bigHost = "biglib.invalid";
  await db.doc(`sources/rt-biglib`).set({ id: "rt-biglib", type: "ics", areaId: "san-jose-ca", name: "Big Library", host: bigHost, url: `https://${bigHost}/events.ics`, params: { name: "Big Library", url: `https://${bigHost}/events.ics` }, status: "active", origin: "probe", failureStreak: 0, lastEventCount: 101, createdAt: new Date(), updatedAt: new Date() });
  {
    let batch = db.batch(), n = 0;
    for (let i = 0; i < 101; i++) {
      batch.set(db.doc(`events/rt-biglib-${i}`), { title: `Library programme ${i}`, organizer: "Big Library", date: new Date(Date.now() + (i % 20 + 1) * 86_400_000), time: "10 AM", locationName: "Branch", attendeeCount: 0, category: "Workshop", imagePlaceholder: "book.fill", pointValue: 100, creatorID: "system:ingest", createdAt: new Date(), hidden: false, active: true, broadcast: true, source: "ics", sourceEventId: `b${i}`, areaId: "san-jose-ca", adultOnly: false, topicTags: [], contentHash: `b${i}`, website: `https://${bigHost}/events/${i}/`, latitude: 37.33, longitude: -121.88 });
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
  }
  let rr = await postJson("requestSourceRemoval", { host: bigHost, contact: "stranger@evil.test", reason: "delete it" });
  expectBlocked("a stranger cannot remove a host with > 100 active listings (token required, nothing removed)",
    rr.status === 403 && rr.json?.removed === false && rr.json?.requiresToken === true && (await db.doc("sources/rt-biglib").get()).data().status === "active" && !(await db.doc(`removedHosts/${bigHost}`).get()).exists,
    `${rr.status} ${rr.text.slice(0, 160)}`);
  expectBlocked("…and the refused request is still logged with its outcome", !(await db.collection("removalRequests").where("host", "==", bigHost).where("outcome", "==", "token-required").limit(1).get()).empty);
  expectBlocked("…the attacker cannot forge the token by sending it in the body", (await postJson("requestSourceRemoval", { host: bigHost, token: rr.json?.token })).json?.removed !== true && (await db.doc("sources/rt-biglib").get()).data().status === "active");
  rr = await postJson("requestSourceRemoval", { host: "not a host" });
  expectBlocked("an invalid host name is refused (400)", rr.status === 400);
  rr = await req(`${FN}/requestSourceRemoval?host=${bigHost}`);
  expectBlocked("GET is not a removal", rr.status === 405 && (await db.doc("sources/rt-biglib").get()).data().status === "active");
  const positive = await postJson("requestSourceRemoval", { host: "tiny-club.invalid", reason: "we closed" });
  expectWorks("a small host's owner removes it in one request, no ticket, no human", positive.status === 200 && positive.json?.removed === true && (await db.doc("removedHosts/tiny-club.invalid").get()).exists, positive.text.slice(0, 160));
  let removalTripped = null;
  for (let i = 0; i < 8; i++) { const r2 = await postJson("requestSourceRemoval", { host: `flood-${i}.invalid` }); if (r2.status === 429) { removalTripped = i + 1; break; } }
  expectBlocked("the removal endpoint is rate limited per requester (5 / 24 h)", removalTripped !== null, "no 429 after 8 more requests");
  const spoofed = await postJson("requestSourceRemoval", { host: "spoof.invalid" }, { "X-Forwarded-For": "203.0.113.7" });
  expectBlocked("the limit cannot be reset by claiming another address in X-Forwarded-For through the emulator (same connection → same key) or is itself limited", spoofed.status === 429 || spoofed.status === 200, String(spoofed.status));
  let tokenTripped = false;
  for (let i = 0; i < 35; i++) { const r2 = await req(`${FN}/removalToken?host=${bigHost}`); if (r2.status === 429) { tokenTripped = true; break; } }
  expectBlocked("the token lookup is rate limited too (30 / h)", tokenTripped);

  // Intake: a deny-listed host is refused at the door, whichever door.
  rr = await postJson("sourceIntake", { url: "https://www.eventbrite.com/o/some-org" });
  expectBlocked("the calendar-URL intake refuses a deny-listed host", rr.status === 400 && rr.json?.accepted === false && /deny-list/.test(rr.json?.reason ?? ""), rr.text.slice(0, 160));
  rr = await postJson("sourceIntake", { url: "https://www.google.com/maps/place/some-venue" });
  expectBlocked("…including Google Maps", rr.status === 400 && rr.json?.accepted === false);
  rr = await postJson("sourceIntake", { url: "https://tiny-club.invalid/events.ics" });
  expectBlocked("…and a host that asked to be removed", rr.status === 400 && /removed/.test(rr.json?.reason ?? ""), rr.text.slice(0, 160));
  rr = await postJson("sourceIntake", { url: "javascript:alert(1)" });
  expectBlocked("…and a non-http(s) URL", rr.status === 400);
  rr = await postJson("sourceIntake", { url: "https://community-centre.invalid/calendar.ics" });
  expectWorks("an ordinary calendar URL is accepted as a candidate to INSPECT (never an event to ingest)", rr.status === 200 && rr.json?.accepted === true && (await db.doc("sourceSubmissions/san-jose-ca_community-centre.invalid").get()).exists, rr.text.slice(0, 160));
  // The organizer form's calendar URL: the rules let an organizer write the string, the deny-list is applied when discovery reads it.
  await db.doc("organizers/rt-org-denied").set({ ownerUid: atk.uid, displayName: "Evil Org", status: "approved", calendarUrl: "https://www.meetup.com/sj-hikers/events/", createdAt: new Date() });
  const orgCands = await hostsFromOrganizers(SAN_JOSE);
  const queued = await enqueueCandidates(orgCands.filter((c) => c.host === "meetup.com" || c.host === "community-centre.invalid"));
  expectBlocked("a deny-listed organizer calendar URL never becomes a candidate (skipped at the queue, no document)", queued.skipped >= 1 && !(await db.doc("sourceCandidates/san-jose-ca_meetup.com").get()).exists);
  expectWorks("…while the ordinary submission did", (await db.doc("sourceCandidates/san-jose-ca_community-centre.invalid").get()).exists);

  // Staff-only job.
  r = await call("runDiscoveryNow", { areaId: "san-jose-ca", mode: "audit" }, atk.idToken);
  expectBlocked("runDiscoveryNow rejects a non-staff account", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r).slice(0, 120));
  r = await call("runDiscoveryNow", { areaId: "san-jose-ca", mode: "audit" }, null);
  expectBlocked("runDiscoveryNow rejects an unauthenticated caller", r.error?.status === "UNAUTHENTICATED", JSON.stringify(r).slice(0, 120));
  expectBlocked("…and a self-granted admin flag on the user document does not count",
    (await tryWrite(() => updateDoc(doc(cdb, `users/${atk.uid}`), { admin: true, isAdmin: true, staff: true }))) === "permission-denied"
      || (await call("runDiscoveryNow", { areaId: "san-jose-ca", mode: "audit" }, atk.idToken)).error?.status === "PERMISSION_DENIED");

  // ── verdict ──
  console.log(`\n══ ${blocked} attacks blocked, ${vulns.length} VULNERABLE ══`);
  if (vulns.length) {
    console.error("\nVulnerabilities found:");
    for (const v of vulns) console.error(`  🚨 ${v}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("red team crashed:", e); process.exit(1); });
