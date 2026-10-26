// Verdure backend E2E — runs against the Firebase Local Emulator Suite.
//
//   npx firebase-tools emulators:exec --only auth,functions,firestore,storage \
//       "node functions/scripts/e2e-backend.mjs"
//
// Proves the ENTIRE server loop before any real deploy: auth → proof upload
// (storage.rules) → checkInToEvent (proof + GPS validation, clamps, idempotency)
// → collectPlace → redeemReward (insufficient / success / double) → and the
// Firestore rules lockdown (client cannot write points; CAN write its own fields).
//
// Transport note: the emulator's HTTP/1.1 REST gateway hangs on this machine
// (Netty h2-detection routes h1 connections into limbo), so ALL Firestore
// traffic here goes over gRPC — firebase-admin for seeding (rules-bypassed)
// and the client JS SDK's Node build for rules-checked user writes. Auth,
// Functions (callables), and Storage speak plain HTTP, which works fine.

import http from "node:http";
import { EMULATORS } from "./local-emulator-targets.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeApp as adminInit } from "firebase-admin/app";
import { getFirestore as adminFirestore } from "firebase-admin/firestore";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getStorage as adminStorage } from "firebase-admin/storage";
import { initializeApp as clientInit } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore as clientFirestore, connectFirestoreEmulator,
  doc, setDoc, updateDoc, deleteDoc, getDoc, increment, serverTimestamp, collection, query, where, getDocs, writeBatch,
} from "firebase/firestore";

const PROJECT = "connectify-19dd8";
const REGION = "us-central1";
const AUTH = `${EMULATORS.auth.url}/identitytoolkit.googleapis.com/v1`;
const FN = `${EMULATORS.functions.url}/${PROJECT}/${REGION}`;
// Must match PROOF_BUCKET in functions/src/index.ts — the default bucket differs
// between local and CI environments, so both sides pin it explicitly.
const BUCKET = process.env.STORAGE_BUCKET || `${PROJECT}.firebasestorage.app`;
const STORAGE = `${EMULATORS.storage.url}/v0/b/${BUCKET}/o`;

// Admin Auth + Storage must also point at the emulators (deleteAccount asserts
// the Auth user and the proof photo are actually gone).

// ── admin (gRPC, bypasses rules — for seeding + audit reads) ────────────────
adminInit({ projectId: PROJECT, storageBucket: BUCKET });
const db = adminFirestore();

// ── client SDK (gRPC, rules-checked — for lockdown tests) ───────────────────
const capp = clientInit({ projectId: PROJECT, apiKey: "fake-api-key" });
const cauth = getAuth(capp);
connectAuthEmulator(cauth, EMULATORS.auth.url, { disableWarnings: true });
const cdb = clientFirestore(capp);
connectFirestoreEmulator(cdb, EMULATORS.firestore.host, EMULATORS.firestore.port);

/**
 * A second rules-checked client context, signed in as a different user.
 * Needed wherever a test must prove what user B can (not) see — the default
 * `cdb` context belongs to the first e2e user for the whole run.
 */
async function clientAs(email, pw, name) {
  const app = clientInit({ projectId: PROJECT, apiKey: "fake-api-key" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, EMULATORS.auth.url, { disableWarnings: true });
  const fdb = clientFirestore(app);
  connectFirestoreEmulator(fdb, EMULATORS.firestore.host, EMULATORS.firestore.port);
  await signInWithEmailAndPassword(auth, email, pw);
  return fdb;
}

let passed = 0, failed = 0;
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name} ${extra}`); }
}

// ── plain-HTTP helper (auth REST, callables, storage) ───────────────────────

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
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    r.on("error", reject);
    r.setTimeout(30000, () => r.destroy(new Error(`timeout: ${method} ${url}`)));
    if (data) r.write(data);
    r.end();
  });
}

async function signUp(email, password) {
  const r = await req(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!r.json?.idToken) throw new Error(`signUp failed: ${r.text}`);
  return { idToken: r.json.idToken, uid: r.json.localId };
}

async function call(name, data, idToken) {
  const r = await req(`${FN}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return r.json ?? { error: { status: "BAD_RESPONSE", message: r.text } };
}

async function uploadProofDebug(path, idToken) {
  // Multipart upload (what the SDK sends): metadata part carries contentType so
  // storage.rules' `contentType.matches('image/.*')` sees it.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
  const boundary = "e2e-boundary-7f3a";
  const meta = JSON.stringify({ name: path, contentType: "image/jpeg" });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    jpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  for (const prefix of ["Firebase", "Bearer"]) {
    const r = await req(`${STORAGE}?uploadType=multipart&name=${encodeURIComponent(path)}`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "X-Goog-Upload-Protocol": "multipart",
        Authorization: `${prefix} ${idToken}`,
      },
      body,
    });
    if (r.status === 200) return { ...r, prefix };
    if (prefix === "Bearer") return r;
  }
}

async function uploadProof(path, idToken) {
  return (await uploadProofDebug(path, idToken)).status;
}

/** Rules-checked user write via the client SDK; returns the error code or "ok". */
async function userWrite(path, fields) {
  try {
    await updateDoc(doc(cdb, path), fields);
    return "ok";
  } catch (e) {
    return e.code ?? String(e);
  }
}

// Venue at (44.98, -93.26); NEAR is a few hundred meters away, FAR ~10 km.
const NEAR = { lat: 44.9812, lng: -93.2612 };
const FAR = { lat: 45.07, lng: -93.26 };

// ── the suite ───────────────────────────────────────────────────────────────

async function main() {
  console.log("── Verdure backend E2E (emulators) ──");
  const email = `e2e-${Date.now()}@verdure.test`;
  const password = "test-password-1";
  const { idToken, uid } = await signUp(email, password);
  await signInWithEmailAndPassword(cauth, email, password);   // client SDK user context
  console.log(`  user: ${uid}`);

  // Seed two community events (admin gRPC) with venue coordinates.
  const event = (title) => ({
    title, organizer: "E2E", date: new Date("2026-08-01T17:00:00Z"),
    time: "12:00 PM", locationName: "E2E Venue", attendeeCount: 1,
    category: "Volunteer", imagePlaceholder: "heart.fill", pointValue: 200,
    creatorID: "seed-admin", createdAt: new Date(),
    latitude: 44.98, longitude: -93.26, adultOnly: false,
  });
  await db.doc("events/e2e-event-1").set(event("E2E Cleanup One"));
  await db.doc("events/e2e-event-2").set(event("E2E Cleanup Two"));
  for (const id of ["serp-e2e-external-1", "serp-e2e-plus-multiplier",
    "serp-e2e-plus-capped", "serp-e2e-plain"]) {
    await db.doc(`events/${id}`).set({ ...event("E2E Festival"),
      category: "Festival", pointValue: 250, creatorID: "system:ingest", source: "serpapi" });
  }

  // Storage rules: owner path accepted, foreign path rejected.
  const own = await uploadProofDebug(`proofs/${uid}/p1.jpg`, idToken);
  ok("storage: owner can upload proof", own.status === 200, `got ${own.status}: ${own.text?.slice(0, 200)}`);
  ok("storage: foreign-path upload rejected", (await uploadProof("proofs/someone-else/p.jpg", idToken)) === 403);

  const proofPath = `proofs/${uid}/p1.jpg`;

  // T1 — no proof → rejected
  let r = await call("checkInToEvent", { eventId: "e2e-event-1", category: "Volunteer", claimedPoints: 200, lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("checkIn without proof rejected", r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  // T2 — no coords → rejected
  r = await call("checkInToEvent", { eventId: "e2e-event-1", category: "Volunteer", claimedPoints: 200, proofPath }, idToken);
  ok("checkIn without coords rejected", r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  // T3 — foreign proof path → rejected
  r = await call("checkInToEvent", { eventId: "e2e-event-1", category: "Volunteer", claimedPoints: 200, proofPath: "proofs/not-you/x.jpg", lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("checkIn with foreign proofPath rejected", r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  r = await call("checkInToEvent", { eventId: "event-that-does-not-exist", category: "Volunteer", claimedPoints: 200,
    proofPath, lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("checkIn cannot award points for a missing event", r.error?.status === "NOT_FOUND", JSON.stringify(r));

  // T4 — valid check-in near the venue → stored pointValue
  r = await call("checkInToEvent", { eventId: "e2e-event-1", category: "Volunteer", claimedPoints: 200, proofPath, lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("checkIn near venue awards stored pointValue", r.result?.awarded === 200 && r.result?.newBalance === 200, JSON.stringify(r));

  // T5 — duplicate check-in → idempotent no-op
  r = await call("checkInToEvent", { eventId: "e2e-event-1", category: "Volunteer", claimedPoints: 200, proofPath, lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("duplicate checkIn is a no-op", r.result?.alreadyCheckedIn === true && r.result?.awarded === 0, JSON.stringify(r));

  // T6 — too far from a coordinated event → rejected
  r = await call("checkInToEvent", { eventId: "e2e-event-2", category: "Volunteer", claimedPoints: 200, proofPath, lat: FAR.lat, lng: FAR.lng }, idToken);
  ok("checkIn too far rejected (haversine)", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));

  // T7 — indexed external event: claims clamp to the category ceiling
  r = await call("checkInToEvent", { eventId: "serp-e2e-external-1", category: "Festival", claimedPoints: 99999, proofPath, lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("external checkIn clamped to category ceiling (250)", r.result?.awarded === 250 && r.result?.newBalance === 450, JSON.stringify(r));

  // T8 — attendance audit doc written with evidence
  const audit = (await db.doc(`attendance/${uid}_e2e-event-1`).get()).data();
  ok("attendance audit doc has proof + GPS", !!audit?.proofPath && typeof audit?.lat === "number", JSON.stringify(audit ?? {}));

  // T9 — RULES LOCKDOWN (client SDK over gRPC, rules-checked)
  let code = await userWrite(`users/${uid}`, { pointsBalance: 999999 });
  ok("rules: client write to pointsBalance DENIED", code === "permission-denied", `got ${code}`);
  code = await userWrite(`users/${uid}`, { checkedInEventIDs: ["cheat"] });
  ok("rules: client write to checkedInEventIDs DENIED", code === "permission-denied", `got ${code}`);
  // G4 — a leaderboard is only meaningful if a position cannot be claimed.
  // These two fields ARE the leaderboard, so the denial is the feature.
  code = await userWrite(`users/${uid}`, { monthlyEarnPoints: 999999 });
  ok("rules: client write to monthlyEarnPoints DENIED (leaderboard)", code === "permission-denied", `got ${code}`);
  code = await userWrite(`users/${uid}`, { lifetimePoints: 999999 });
  ok("rules: client write to lifetimePoints DENIED (leaderboard)", code === "permission-denied", `got ${code}`);
  code = await userWrite(`users/${uid}`, { notifyBudget: { week: "2099-W01", sent: 0 } });
  ok("rules: client write to notifyBudget DENIED (push cap)", code === "permission-denied", `got ${code}`);
  code = await userWrite(`users/${uid}`, { plannerUsage: { "2026-09": 0 } });
  ok("rules: client write to plannerUsage DENIED (planner quota)", code === "permission-denied", `got ${code}`);
  code = await userWrite(`users/${uid}`, { redeemedRewardIDs: ["free-stuff"] });
  ok("rules: client write to redeemedRewardIDs DENIED", code === "permission-denied", `got ${code}`);
  code = await userWrite(`users/${uid}`, { collectedPlaceIDs: ["osm-123"] });
  ok("rules: client write to collectedPlaceIDs allowed", code === "ok", `got ${code}`);

  // T10 — collectPlace clamps to rarity ceiling + idempotent
  r = await call("collectPlace", { placeId: "osm-999", claimedPoints: 5000, lat: NEAR.lat, lng: NEAR.lng }, idToken);
  ok("collectPlace clamped to 50", r.result?.awarded === 50 && r.result?.newBalance === 500, JSON.stringify(r));
  r = await call("collectPlace", { placeId: "osm-999", claimedPoints: 50 }, idToken);
  ok("duplicate collect is a no-op", r.result?.alreadyCollected === true, JSON.stringify(r));

  // T11 — cash gift cards are a Verdure+ benefit: a free member is refused BEFORE
  // any points check (free members earn partner perks instead).
  r = await call("redeemReward", { rewardId: "starbucks-5" }, idToken);
  ok("redeem: a FREE member cannot redeem a cash card", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));

  // Grant a verified entitlement the only legitimate way (Admin SDK = what the
  // App Store notification handler does). Balance is 500 < 35,000.
  await db.doc(`users/${uid}`).set({ plusExpiresAt: new Date(Date.now() + 86_400_000) }, { merge: true });
  r = await call("redeemReward", { rewardId: "starbucks-5" }, idToken);
  ok("redeem with insufficient points rejected (35,000 needed at 7,000 pts/$)", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));

  // Fund the balance (server-side) to exactly one $5 card.
  await db.doc(`users/${uid}`).set({ pointsBalance: 35000 }, { merge: true });

  // T12 — redeem success
  r = await call("redeemReward", { rewardId: "starbucks-5" }, idToken);
  ok("redeem succeeds and returns remaining", r.result?.redeemed === true && r.result?.remaining === 0 && r.result?.kind === "cash", JSON.stringify(r));

  // T13 — double redeem → rejected
  r = await call("redeemReward", { rewardId: "starbucks-5" }, idToken);
  ok("double redeem rejected", r.error?.status === "ALREADY_EXISTS", JSON.stringify(r));

  // T14 — unknown reward → rejected
  r = await call("redeemReward", { rewardId: "free-yacht" }, idToken);
  ok("unknown reward rejected", r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  // T15 — unauthenticated call → rejected
  r = await call("checkInToEvent", { eventId: "x", category: "Social", claimedPoints: 1 }, null);
  ok("unauthenticated checkIn rejected", r.error?.status === "UNAUTHENTICATED", JSON.stringify(r));

  // T16 — community-post likes: exactly +1 on likeCount is the only allowed edit
  let code2;
  try {
    await setDoc(doc(cdb, "posts/e2e-post-1"), {
      authorID: uid, authorName: "E2E User", authorInitials: "EU",
      placeName: "E2E Venue", content: "hello neighborhood",
      likeCount: 0, hidden: false, createdAt: serverTimestamp(),
    });
    code2 = "ok";
  } catch (e) { code2 = e.code ?? String(e); }
  ok("rules: author can create a post", code2 === "ok", `got ${code2}`);

  // A bare +1 is now REFUSED — that was the like-inflation vulnerability.
  code2 = await userWrite("posts/e2e-post-1", { likeCount: increment(1) });
  ok("rules: bare +1 like refused (needs ledger entry)",
     code2 === "permission-denied", `got ${code2}`);

  // The supported path: +1 and the per-user ledger row in ONE batch.
  code2 = await (async () => {
    try {
      const b = writeBatch(cdb);
      b.update(doc(cdb, "posts/e2e-post-1"), { likeCount: increment(1) });
      b.set(doc(cdb, `postLikes/e2e-post-1_${uid}`),
            { postId: "e2e-post-1", uid, createdAt: serverTimestamp() });
      await b.commit();
      return "ok";
    } catch (e) { return e.code ?? String(e); }
  })();
  ok("rules: like via batch + ledger allowed", code2 === "ok", `got ${code2}`);
  code2 = await userWrite("posts/e2e-post-1", { likeCount: increment(5) });
  ok("rules: like (+5) denied", code2 === "permission-denied", `got ${code2}`);
  code2 = await userWrite("posts/e2e-post-1", { content: "vandalized" });
  ok("rules: editing post content denied", code2 === "permission-denied", `got ${code2}`);

  // ── Verdure+ entitlement & limited-time drops ────────────────────────────
  //
  // The entitlement (`users/{uid}.plusExpiresAt`) must be UNWRITABLE by clients:
  // it gates the earn multiplier and early reward access.
  code2 = await userWrite(`users/${uid}`, { plusExpiresAt: Date.now() + 86_400_000 });
  ok("rules: client CANNOT grant itself Verdure+ (plusExpiresAt denied)",
     code2 === "permission-denied", `got ${code2}`);

  // Retired rewards (amazon-25, nike-25, apple-50, rei-50, the seasonal drops)
  // stay in the catalog as INACTIVE records — visible to code, never redeemable.
  // At the sustainable earn rate they are 2–4-year goals: honest-copy policy.
  await db.doc(`users/${uid}`).set({ pointsBalance: 400000 }, { merge: true });
  r = await call("redeemReward", { rewardId: "patagonia-30-earth" }, idToken);
  ok("retired seasonal drop is not redeemable even by a funded Plus member",
     r.error?.status === "FAILED_PRECONDITION" && /catalog/i.test(r.error?.message ?? ""), JSON.stringify(r));
  r = await call("redeemReward", { rewardId: "apple-50" }, idToken);
  ok("retired $50 card is not redeemable", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));
  await db.doc(`users/${uid}`).set({ pointsBalance: 0 }, { merge: true });

  // DAILY_POINT_CAP = 600: this user already earned 500 today, so a 312-point
  // award is clamped to the 100 that remain — the cap is a CLAMP, the check-in
  // still counts. (At the old 2,000 cap this same call paid out in full.)
  r = await call("checkInToEvent", {
    eventId: "serp-e2e-plus-multiplier", category: "Festival",
    claimedPoints: 99999, proofPath, lat: NEAR.lat, lng: NEAR.lng,
  }, idToken);
  ok("daily cap (600): a member at 500 today receives only the remaining 100, check-in still counts",
     r.result?.awarded === 100 && r.result?.dailyCapReached === true && r.result?.alreadyCheckedIn === false, JSON.stringify(r));
  r = await call("checkInToEvent", {
    eventId: "serp-e2e-plus-capped", category: "Festival",
    claimedPoints: 250, proofPath, lat: NEAR.lat, lng: NEAR.lng,
  }, idToken);
  ok("daily cap (600): at the cap, further check-ins award 0 but are still recorded",
     r.result?.awarded === 0 && r.result?.dailyCapReached === true && r.result?.alreadyCheckedIn === false, JSON.stringify(r));

  // The Verdure+ earn multiplier on a FRESH member: base award clamped to the
  // category ceiling FIRST (Festival = 250), then multiplied → floor(312.5) = 312.
  const freshPlus = await signUp(`e2e-freshplus-${Date.now()}@verdure.test`, password);
  await uploadProof(`proofs/${freshPlus.uid}/p.jpg`, freshPlus.idToken);
  await db.doc(`users/${freshPlus.uid}`).set({ plusExpiresAt: new Date(Date.now() + 86_400_000) }, { merge: true });
  r = await call("checkInToEvent", {
    eventId: "serp-e2e-plus-multiplier", category: "Festival",
    claimedPoints: 99999, proofPath: `proofs/${freshPlus.uid}/p.jpg`, lat: NEAR.lat, lng: NEAR.lng,
  }, freshPlus.idToken);
  ok("verified Plus earns the 1.25× multiplier (ceiling clamped first)",
     r.result?.awarded === 312, JSON.stringify(r));

  // And a fresh user WITHOUT the entitlement still earns the base rate — proving
  // the multiplier is gated on the server-verified field, not on any client claim.
  const plain = await signUp(`e2e-plain-${Date.now()}@verdure.test`, password);
  await uploadProof(`proofs/${plain.uid}/p1.jpg`, plain.idToken);
  r = await call("checkInToEvent", {
    eventId: "serp-e2e-plain", category: "Festival", claimedPoints: 99999,
    proofPath: `proofs/${plain.uid}/p1.jpg`, lat: NEAR.lat, lng: NEAR.lng,
  }, plain.idToken);
  ok("non-Plus user earns the base rate (no multiplier)",
     r.result?.awarded === 250, JSON.stringify(r));

  // ── Redemption fulfilment + server-only collection privacy ───────────────
  //
  // A redemption must never just debit points: it has to leave a durable,
  // recoverable order behind (the vendor integration isn't live yet).
  const ff = (await db.doc(`fulfillments/${uid}_starbucks-5`).get()).data();
  ok("redemption writes a durable fulfilment record",
     ff?.status === "pending" && ff?.rewardId === "starbucks-5" && ff?.pointsSpent === 35000 && ff?.usd === 5,
     JSON.stringify(ff ?? {}));

  // Those records hold a delivery email + spend, and /attendance holds GPS —
  // clients must not be able to read either.
  try {
    await getDocs(query(collection(cdb, "fulfillments")));
    ok("rules: client CANNOT read /fulfillments (PII)", false, "read succeeded!");
  } catch (e) {
    ok("rules: client CANNOT read /fulfillments (PII)", e.code === "permission-denied", `got ${e.code}`);
  }
  try {
    await getDocs(query(collection(cdb, "attendance")));
    ok("rules: client CANNOT read /attendance (GPS)", false, "read succeeded!");
  } catch (e) {
    ok("rules: client CANNOT read /attendance (GPS)", e.code === "permission-denied", `got ${e.code}`);
  }

  // ── Rate limiting at the trust boundary ──────────────────────────────────
  //
  // The callables are reachable directly with any signed-in token, bypassing
  // every client-side gate — so volume has to be bounded on the server.
  // redeemReward is capped at 5/hour; this user has already spent some budget
  // above, so drive it to the ceiling and confirm it actually stops.
  const REDEEM_CEILING = 15;   // keep in sync with RATE_LIMITS in index.ts
  const rl = await signUp(`e2e-rl-${Date.now()}@verdure.test`, password);
  let exhausted = null;
  for (let i = 0; i < REDEEM_CEILING + 5; i++) {
    // Unknown reward → rejected on its own merits, but the limiter runs FIRST,
    // so this still consumes budget and eventually flips to resource-exhausted.
    const res = await call("redeemReward", { rewardId: `nope-${i}` }, rl.idToken);
    if (res.error?.status === "RESOURCE_EXHAUSTED") { exhausted = i + 1; break; }
  }
  ok("redeemReward rate limit trips at its ceiling",
     exhausted === REDEEM_CEILING + 1,
     `tripped after ${exhausted} calls, expected ${REDEEM_CEILING + 1}`);

  // Limits are per-user: an abuser must not lock everyone else out.
  const bystander = await signUp(`e2e-bystander-${Date.now()}@verdure.test`, password);
  r = await call("redeemReward", { rewardId: "unknown-reward" }, bystander.idToken);
  ok("rate limit is per-user (bystander unaffected)",
     r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  // Counters must be server-only: a client that could reset its own counter
  // would have no limit at all.
  code2 = await userWrite(`rateLimits/${rl.uid}_redeemReward`, { count: 0 });
  ok("rules: client CANNOT reset its own rate-limit counter",
     code2 === "permission-denied", `got ${code2}`);

  // ────────────────────────────────────────────────────────────────────────
  // VERDURE+ ENTITLEMENT
  //
  // These benefits shipped inert: hasActivePlus() reads users/{uid}.plusExpiresAt
  // and NOTHING wrote it, so a paying member got the same 1.0x multiplier and the
  // same "not available yet" on early-access drops as everyone else. Now that
  // subscriptions.ts writes the field, these prove the benefits actually fire —
  // and, just as importantly, that they DON'T fire for a non-member.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Verdure+ entitlement ──");

  const plusUser = await signUp(`e2e-plus-${Date.now()}@verdure.test`, password);
  const freeUser = await signUp(`e2e-free-${Date.now()}@verdure.test`, password);
  const plusProof = `proofs/${plusUser.uid}/plus.jpg`;
  const freeProof = `proofs/${freeUser.uid}/free.jpg`;
  await uploadProof(plusProof, plusUser.idToken);
  await uploadProof(freeProof, freeUser.idToken);

  // Only the Admin SDK can write this — exactly how subscriptions.ts does it.
  await db.doc(`users/${plusUser.uid}`).set(
    { plusExpiresAt: new Date(Date.now() + 30 * 86400_000) }, { merge: true });

  // Same event, same claim, different entitlement → different award.
  await db.doc("events/e2e-plus-event").set({
    ...event("E2E Plus Multiplier"), pointValue: 100, category: "Social",
  });

  r = await call("checkInToEvent", {
    eventId: "e2e-plus-event", category: "Social", claimedPoints: 100,
    proofPath: freeProof, lat: NEAR.lat, lng: NEAR.lng,
  }, freeUser.idToken);
  const freeAward = r.result?.awarded;
  ok("non-member earns the base award (no multiplier)", freeAward === 100, `got ${freeAward}`);

  r = await call("checkInToEvent", {
    eventId: "e2e-plus-event", category: "Social", claimedPoints: 100,
    proofPath: plusProof, lat: NEAR.lat, lng: NEAR.lng,
  }, plusUser.idToken);
  const plusAward = r.result?.awarded;
  ok("Verdure+ member earns the 1.25x multiplier", plusAward === 125, `got ${plusAward}`);

  // The multiplier must apply AFTER the category ceiling, never as a way to
  // smuggle an inflated base value past the clamp.
  await db.doc("events/e2e-plus-ceiling").set({
    ...event("E2E Plus Ceiling"), pointValue: 999, category: "Market",  // ceiling 75
  });
  r = await call("checkInToEvent", {
    eventId: "e2e-plus-ceiling", category: "Market", claimedPoints: 999,
    proofPath: plusProof, lat: NEAR.lat, lng: NEAR.lng,
  }, plusUser.idToken);
  ok("multiplier applies after the category ceiling, not before",
     r.result?.awarded === Math.floor(75 * 1.25), `got ${r.result?.awarded}`);

  // Early access is now a property of PARTNER PERKS (earlyAccessUntil) and is
  // covered in the economy section below with a controllable timestamp — no
  // more date-of-month-dependent tests.

  // An EXPIRED entitlement must read as no entitlement.
  const expiredUser = await signUp(`e2e-expired-${Date.now()}@verdure.test`, password);
  const expiredProof = `proofs/${expiredUser.uid}/e.jpg`;
  await uploadProof(expiredProof, expiredUser.idToken);
  await db.doc(`users/${expiredUser.uid}`).set(
    { plusExpiresAt: new Date(Date.now() - 86400_000) }, { merge: true });
  r = await call("checkInToEvent", {
    eventId: "e2e-plus-event", category: "Social", claimedPoints: 100,
    proofPath: expiredProof, lat: NEAR.lat, lng: NEAR.lng,
  }, expiredUser.idToken);
  ok("an expired Verdure+ entitlement grants no multiplier",
     r.result?.awarded === 100, `got ${r.result?.awarded}`);

  // A client must never be able to grant itself Plus.
  code2 = await userWrite(`users/${freeUser.uid}`,
    { plusExpiresAt: new Date(Date.now() + 86400_000) });
  ok("rules: client CANNOT grant itself plusExpiresAt",
     code2 === "permission-denied", `got ${code2}`);
  code2 = await userWrite(`users/${freeUser.uid}`,
    { plusOriginalTransactionId: "someone-elses-transaction" });
  ok("rules: client CANNOT point itself at another Apple subscription",
     code2 === "permission-denied", `got ${code2}`);

  // ────────────────────────────────────────────────────────────────────────
  // FULFILMENT QUEUE
  //
  // redeemReward debits points and enqueues a card. Until this release nothing
  // read that queue, so every redemption took value and delivered nothing.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Gift-card fulfilment queue ──");

  const buyer = await signUp(`e2e-buyer-${Date.now()}@verdure.test`, password);
  await db.doc(`users/${buyer.uid}`).set({ pointsBalance: 40000, plusExpiresAt: new Date(Date.now() + 30 * 86400_000) }, { merge: true });

  r = await call("redeemReward", { rewardId: "starbucks-5" }, buyer.idToken);
  ok("redeem succeeds and debits", r.result?.redeemed === true, JSON.stringify(r));

  const fdoc = await db.doc(`fulfillments/${buyer.uid}_starbucks-5`).get();
  const f = fdoc.data();
  ok("a durable fulfilment row is written in the same transaction", fdoc.exists);
  ok("fulfilment row starts pending with the points recorded",
     f?.status === "pending" && f?.pointsSpent === 35000 && f?.usd === 5, JSON.stringify(f));
  ok("fulfilment row carries a delivery address",
     typeof f?.deliverToEmail === "string" && f.deliverToEmail.includes("@"),
     String(f?.deliverToEmail));

  // The queue is server-only: a client that could edit it could mark its own
  // card "sent", or point the delivery at someone else's inbox.
  code2 = await userWrite(`fulfillments/${buyer.uid}_starbucks-5`, { status: "sent" });
  ok("rules: client CANNOT mark its own fulfilment sent",
     code2 === "permission-denied", `got ${code2}`);

  // ────────────────────────────────────────────────────────────────────────
  // CONTENT MODERATION (App Review 1.2)
  //
  // Report → queue → auto-hide at 3 distinct reporters → staff decision or the
  // 24-hour sweep. Visibility is enforced by the rules (hidden content is
  // served only to its author), the flags are server-owned, and the queue is
  // invisible to clients.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Content moderation ──");

  const authorEmail = `e2e-author-${Date.now()}@verdure.test`;
  const author = await signUp(authorEmail, password);
  const rep1 = await signUp(`e2e-rep1-${Date.now()}@verdure.test`, password);
  const rep2 = await signUp(`e2e-rep2-${Date.now()}@verdure.test`, password);
  const rep3 = await signUp(`e2e-rep3-${Date.now()}@verdure.test`, password);
  const staffEmail = `e2e-staff-${Date.now()}@verdure.test`;
  const staff = await signUp(staffEmail, password);
  execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)),
    "--uid", staff.uid, "--grant", "--reason", "Backend E2E local staff fixture"], { env: process.env });
  const refreshedStaff = await req(`${AUTH}/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: staffEmail, password, returnSecureToken: true }),
  });
  if (!refreshedStaff.json?.idToken) throw new Error("Failed to refresh local staff token");
  staff.idToken = refreshedStaff.json.idToken;

  const postId = `e2e-mod-post-${Date.now()}`;
  await db.doc(`posts/${postId}`).set({
    authorID: author.uid, authorName: "Author", authorInitials: "AU",
    placeName: "Park", content: "questionable content", likeCount: 0,
    hidden: false, createdAt: new Date(),
  });

  const readAs = async (fdb, path) => {
    try { return (await getDoc(doc(fdb, path))).exists() ? "ok" : "missing"; } catch (e) { return e.code; }
  };

  // The client (signed in as the first e2e user) can see it.
  let visible = await readAs(cdb, `posts/${postId}`);
  ok("moderation: a visible post is readable", visible === "ok", `got ${visible}`);

  r = await call("reportContent", { targetType: "post", targetId: postId, reason: "spam" }, author.idToken);
  ok("moderation: cannot report your own content", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));

  r = await call("reportContent", { targetType: "post", targetId: postId, reason: "nonsense" }, rep1.idToken);
  ok("moderation: unknown reason rejected", r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  r = await call("reportContent", { targetType: "post", targetId: postId, reason: "spam", details: "looks like an ad" }, rep1.idToken);
  ok("moderation: first report is queued, content stays visible",
     r.result?.reported === true && r.result?.hidden === false, JSON.stringify(r));

  r = await call("reportContent", { targetType: "post", targetId: postId, reason: "spam" }, rep1.idToken);
  ok("moderation: same reporter twice is idempotent (one account can't reach the threshold alone)",
     r.result?.alreadyReported === true && r.result?.hidden === false, JSON.stringify(r));
  let qdoc = (await db.doc(`moderationQueue/post_${postId}`).get()).data();
  ok("moderation: queue counts distinct reporters (1)", qdoc?.reportCount === 1 && qdoc?.status === "open", JSON.stringify(qdoc));
  ok("moderation: queue item carries a 24h SLA deadline",
     typeof qdoc?.slaDeadline?.toMillis === "function" &&
     Math.abs(qdoc.slaDeadline.toMillis() - qdoc.firstReportedAt.toMillis() - 86_400_000) < 1000);

  await call("reportContent", { targetType: "post", targetId: postId, reason: "harassment" }, rep2.idToken);
  r = await call("reportContent", { targetType: "post", targetId: postId, reason: "hate" }, rep3.idToken);
  ok("moderation: third distinct reporter auto-hides the content", r.result?.hidden === true, JSON.stringify(r));
  const hiddenPost = (await db.doc(`posts/${postId}`).get()).data();
  ok("moderation: target document is flagged hidden", hiddenPost?.hidden === true);

  visible = await readAs(cdb, `posts/${postId}`);
  ok("rules: hidden post is NOT readable by other users", visible === "permission-denied", `got ${visible}`);

  // The author still sees their own hidden post (so they know it was hidden).
  const authorDb = await clientAs(authorEmail, password, "author");
  visible = await readAs(authorDb, `posts/${postId}`);
  ok("rules: the author CAN still read their own hidden post", visible === "ok", `got ${visible}`);

  // Feeds must be able to exclude hidden content with a query.
  let listCode;
  try {
    const snap = await getDocs(query(collection(cdb, "posts"), where("hidden", "==", false)));
    listCode = snap.docs.some((d) => d.id === postId) ? "leaked" : "ok";
  } catch (e) { listCode = e.code; }
  ok("rules: feed query (hidden == false) excludes the hidden post", listCode === "ok", `got ${listCode}`);

  // Flags are server-owned.
  code2 = await userWrite(`posts/e2e-post-1`, { hidden: true });
  ok("rules: client cannot hide/unhide a post", code2 === "permission-denied", `got ${code2}`);
  let created;
  try {
    await setDoc(doc(cdb, `posts/e2e-prehidden-${Date.now()}`), {
      authorID: uid, authorName: "E2E User", authorInitials: "EU", placeName: "X",
      content: "sneaky", likeCount: 0, hidden: true, createdAt: serverTimestamp(),
    });
    created = "ok";
  } catch (e) { created = e.code; }
  ok("rules: a post cannot be created pre-hidden", created === "permission-denied", `got ${created}`);
  try {
    await setDoc(doc(cdb, `posts/e2e-noflag-${Date.now()}`), {
      authorID: uid, authorName: "E2E User", authorInitials: "EU", placeName: "X",
      content: "no flag", likeCount: 0, createdAt: serverTimestamp(),
    });
    created = "ok";
  } catch (e) { created = e.code; }
  ok("rules: a post must be created with hidden: false (so feeds can filter)", created === "permission-denied", `got ${created}`);

  // Queue + reports are invisible to clients.
  for (const coll of ["reports", "moderationQueue", "admins"]) {
    let c; try { await getDocs(query(collection(cdb, coll))); c = "ok"; } catch (e) { c = e.code; }
    ok(`rules: client CANNOT read /${coll}`, c === "permission-denied", `got ${c}`);
  }

  // Staff gate.
  r = await call("moderateContent", { queueId: `post_${postId}`, action: "dismiss", reason: "Backend E2E fixture decision" }, rep1.idToken);
  ok("moderation: a non-staff user cannot moderate", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));
  r = await call("listModerationQueue", { status: "open" }, staff.idToken);
  ok("moderation: staff can list the open queue",
     Array.isArray(r.result?.items) && r.result.items.some((i) => i.queueId === `post_${postId}`), JSON.stringify(r).slice(0, 200));

  r = await call("moderateContent", { queueId: `post_${postId}`, action: "dismiss", reason: "Backend E2E fixture decision" }, staff.idToken);
  ok("moderation: staff dismiss restores visibility",
     r.result?.status === "dismissed" && (await db.doc(`posts/${postId}`).get()).data()?.hidden === false, JSON.stringify(r));

  // 24-hour guarantee: re-report to reopen, then simulate the deadline passing.
  await call("reportContent", { targetType: "post", targetId: postId, reason: "spam" }, plusUser.idToken);
  qdoc = (await db.doc(`moderationQueue/post_${postId}`).get()).data();
  ok("moderation: a dismissed item re-opens on a new report",
     qdoc?.status === "open" && qdoc?.hidden === false, JSON.stringify(qdoc));
  r = await call("runModerationSweep", {}, staff.idToken);
  ok("moderation: sweep before the deadline changes nothing", r.result?.removed === 0, JSON.stringify(r));
  await db.doc(`moderationQueue/post_${postId}`).set({ slaDeadline: new Date(Date.now() - 60_000) }, { merge: true });
  r = await call("runModerationSweep", {}, staff.idToken);
  const swept = (await db.doc(`posts/${postId}`).get()).data();
  ok("moderation: unreviewed content is removed once the 24h deadline passes",
     r.result?.removed === 1 && swept?.removed === true && swept?.hidden === true && swept?.content === "[removed by moderation]",
     JSON.stringify({ r, swept }));
  r = await call("runModerationSweep", {}, staff.idToken);
  ok("moderation: the sweep is idempotent", r.result?.removed === 0, JSON.stringify(r));

  // Suspension: a removed *account* can read but not act.
  r = await call("reportContent", { targetType: "user", targetId: author.uid, reason: "harassment" }, rep1.idToken);
  ok("moderation: users can be reported (never auto-hidden)", r.result?.reported === true && r.result?.hidden === false, JSON.stringify(r));
  r = await call("moderateContent", { queueId: `user_${author.uid}`, action: "remove", reason: "Backend E2E fixture decision" }, staff.idToken);
  const suspended = (await db.doc(`users/${author.uid}`).get()).data();
  ok("moderation: staff can suspend an account", suspended?.suspended === true, JSON.stringify(suspended));
  await uploadProof(`proofs/${author.uid}/p.jpg`, author.idToken);
  r = await call("checkInToEvent", { eventId: "e2e-event-1", category: "Volunteer", claimedPoints: 200,
    proofPath: `proofs/${author.uid}/p.jpg`, lat: NEAR.lat, lng: NEAR.lng }, author.idToken);
  ok("moderation: a suspended account cannot earn", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));
  code2 = await userWrite(`users/${author.uid}`, { suspended: false });
  ok("rules: a client cannot lift its own suspension", code2 === "permission-denied", `got ${code2}`);

  // ── Blocks ──
  console.log("\n── Blocks ──");
  let bcode;
  try { await setDoc(doc(cdb, `users/${uid}/blocks/${rep1.uid}`), { uid: rep1.uid, createdAt: serverTimestamp() }); bcode = "ok"; } catch (e) { bcode = e.code; }
  ok("rules: a user can block another user", bcode === "ok", `got ${bcode}`);
  try { await setDoc(doc(cdb, `users/${rep1.uid}/blocks/${uid}`), { uid, createdAt: serverTimestamp() }); bcode = "ok"; } catch (e) { bcode = e.code; }
  ok("rules: a user cannot write into someone else's block list", bcode === "permission-denied", `got ${bcode}`);
  try { await setDoc(doc(cdb, `users/${uid}/blocks/${rep2.uid}`), { uid: rep3.uid, createdAt: serverTimestamp() }); bcode = "ok"; } catch (e) { bcode = e.code; }
  ok("rules: block doc id must match its uid field", bcode === "permission-denied", `got ${bcode}`);
  try { await deleteDoc(doc(cdb, `users/${uid}/blocks/${rep1.uid}`)); bcode = "ok"; } catch (e) { bcode = e.code; }
  ok("rules: a user can unblock", bcode === "ok", `got ${bcode}`);

  // ────────────────────────────────────────────────────────────────────────
  // ACCOUNT DELETION (App Review 5.1.1(v))
  //
  // Seed one account with a footprint in every collection that can name it,
  // delete it through the callable, and prove the footprint is gone: no
  // document, no photo, no queued fulfilment, no attendee record, no orphaned
  // event. Delivered gift cards are the one thing kept — anonymised.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Account deletion ──");

  const delEmail = `e2e-del-${Date.now()}@verdure.test`;
  const del = await signUp(delEmail, password);
  const delDb = await clientAs(delEmail, password, "del");
  const bystander2 = await signUp(`e2e-del-bystander-${Date.now()}@verdure.test`, password);

  // Profile doc via the client (rules-checked, like the app does).
  await setDoc(doc(delDb, `users/${del.uid}`), {
    displayName: "Delete Me", email: delEmail, interests: ["Parks"],
    collectedPlaceIDs: [], createdAt: serverTimestamp(), lastUpdated: serverTimestamp(),
  });
  await setDoc(doc(delDb, `users/${del.uid}/blocks/${bystander2.uid}`), { uid: bystander2.uid, createdAt: serverTimestamp() });
  // Content.
  await setDoc(doc(delDb, `posts/e2e-del-post`), {
    authorID: del.uid, authorName: "Delete Me", authorInitials: "DM", placeName: "Park",
    content: "my post", likeCount: 0, hidden: false, createdAt: serverTimestamp(),
  });
  const likeBatch = writeBatch(delDb);
  likeBatch.update(doc(delDb, "posts/e2e-post-1"), { likeCount: increment(1) });
  likeBatch.set(doc(delDb, `postLikes/e2e-post-1_${del.uid}`), { postId: "e2e-post-1", uid: del.uid, createdAt: serverTimestamp() });
  await likeBatch.commit();
  await setDoc(doc(delDb, `events/e2e-del-event`), {
    title: "Deleter's Event", organizer: "Delete Me", date: new Date("2026-12-01T17:00:00Z"),
    time: "12:00 PM", locationName: "Venue", attendeeCount: 1, category: "Social",
    imagePlaceholder: "cup.and.saucer.fill", pointValue: 100, creatorID: del.uid,
    createdAt: serverTimestamp(), hidden: false, active: true, source: "community", adultOnly: false,
  });
  // Someone RSVP'd to their event; they RSVP'd to someone else's (server-written rows).
  await db.doc(`events/e2e-del-event/attendees/${bystander2.uid}`).set({ uid: bystander2.uid, createdAt: new Date() });
  await db.doc(`events/e2e-event-2/attendees/${del.uid}`).set({ uid: del.uid, createdAt: new Date() });
  await db.doc(`events/e2e-event-2`).set({ attendeeCount: 5 }, { merge: true });
  // Evidence + money.
  const delProof = `proofs/${del.uid}/p.jpg`;
  await uploadProof(delProof, del.idToken);
  r = await call("checkInToEvent", { eventId: "e2e-event-2", category: "Volunteer", claimedPoints: 200,
    proofPath: delProof, lat: NEAR.lat, lng: NEAR.lng }, del.idToken);
  ok("deletion setup: account has a real check-in (attendance row)", r.result?.awarded === 200, JSON.stringify(r));
  await db.doc(`fulfillments/${del.uid}_starbucks-5`).set({ uid: del.uid, rewardId: "starbucks-5", pointsSpent: 1000,
    status: "pending", deliverToEmail: delEmail, requestedAt: new Date() });
  await db.doc(`fulfillments/${del.uid}_dunkin-5`).set({ uid: del.uid, rewardId: "dunkin-5", pointsSpent: 1000,
    status: "sent", deliverToEmail: delEmail, requestedAt: new Date(), vendorOrderId: "ord_123" });
  await db.doc("analytics/2026-09-27/events/e2e-del-analytics").set({ uid: del.uid,
    installID: "e2e-install", event: "event_opened", ts: new Date() });
  await db.doc(`users/${del.uid}/friends/${bystander2.uid}`).set({ uid: bystander2.uid });
  await db.doc(`users/${bystander2.uid}/friends/${del.uid}`).set({ uid: del.uid });
  await db.doc(`users/${del.uid}/friendRequests/${bystander2.uid}`).set({ fromUid: del.uid, toUid: bystander2.uid });
  await db.doc(`users/${bystander2.uid}/friendRequests/${del.uid}`).set({ fromUid: del.uid, toUid: bystander2.uid });
  // A report they filed, and their profile picture.
  await call("reportContent", { targetType: "post", targetId: "e2e-post-1", reason: "spam" }, del.idToken);
  const beforeAttendance = await db.collection("attendance").where("uid", "==", del.uid).get();
  ok("deletion setup: attendance + rate-limit rows exist", beforeAttendance.size >= 1);

  // ── Delete ──
  r = await call("deleteAccount", {}, del.idToken);
  ok("deleteAccount succeeds", r.result?.deleted === true, JSON.stringify(r));

  const gone = async (path) => !(await db.doc(path).get()).exists;
  ok("deleted: profile document", await gone(`users/${del.uid}`));
  ok("deleted: block list", await gone(`users/${del.uid}/blocks/${bystander2.uid}`));
  ok("deleted: reverse friendship edge", await gone(`users/${bystander2.uid}/friends/${del.uid}`));
  ok("deleted: pending request from both participants", await gone(`users/${bystander2.uid}/friendRequests/${del.uid}`));
  ok("deleted: their post", await gone("posts/e2e-del-post"));
  ok("deleted: their like ledger row", await gone(`postLikes/e2e-post-1_${del.uid}`));
  ok("deleted: their event (no orphan)", await gone("events/e2e-del-event"));
  ok("deleted: attendee list under their event", await gone(`events/e2e-del-event/attendees/${bystander2.uid}`));
  ok("deleted: their RSVP on someone else's event", await gone(`events/e2e-event-2/attendees/${del.uid}`));
  ok("deleted: attendee count decremented honestly",
     (await db.doc("events/e2e-event-2").get()).data()?.attendeeCount === 4);
  ok("deleted: attendance (GPS) rows", (await db.collection("attendance").where("uid", "==", del.uid).get()).empty);
  ok("deleted: rate-limit counters", (await db.collection("rateLimits").where("uid", "==", del.uid).get()).empty);
  ok("deleted: analytics event rows", await gone("analytics/2026-09-27/events/e2e-del-analytics"));
  ok("deleted: queued (pending) fulfilment", await gone(`fulfillments/${del.uid}_starbucks-5`));
  const sentRow = (await db.doc(`fulfillments/${del.uid}_dunkin-5`).get()).data();
  ok("kept but anonymised: a DELIVERED gift card (financial record, no PII)",
     !!sentRow && sentRow.uid === null && sentRow.deliverToEmail === null && sentRow.vendorOrderId === "ord_123",
     JSON.stringify(sentRow));
  const theirReport = (await db.doc(`reports/post_e2e-post-1_${del.uid}`).get()).data();
  ok("anonymised: reports they filed lose the reporter identity", theirReport?.reporterUid === "deleted-account", JSON.stringify(theirReport));
  const [proofStillThere] = await adminStorage().bucket(BUCKET).file(delProof).exists();
  ok("deleted: proof photo in Storage", proofStillThere === false);
  let authGone = false;
  try { await adminAuth().getUser(del.uid); } catch (e) { authGone = String(e.code ?? e).includes("user-not-found"); }
  ok("deleted: the Firebase Auth user", authGone);
  ok("untouched: other people's content survives", !(await gone("posts/e2e-post-1")) && !(await gone("events/e2e-event-2")));

  // ────────────────────────────────────────────────────────────────────────
  // EVENT INGESTION — ingest-and-own (Part 2 §1)
  //
  // The admin-only runIngest payload mode pushes already-normalized records
  // through the SAME store code the scheduled fetchers use, so dedupe,
  // staleness, geographic scoping and the client's read path are proven on
  // the emulator without a vendor call. No user request here reaches upstream.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Event ingestion (ingest-and-own) ──");

  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000);
  const iso = (d, plusMin = 0) => new Date(d.getTime() + plusMin * 60_000).toISOString();
  const A = { source: "ticketmaster", sourceEventId: "tmA1", title: "Symphony Silicon Valley: Beethoven at the California",
    start: iso(inTwoWeeks), locationName: "California Theatre", latitude: 37.3318, longitude: -121.8895,
    category: "Festival", isFree: false, priceMin: 25, website: "https://www.ticketmaster.com/e/A1" };
  const C = { source: "ticketmaster", sourceEventId: "tmC1", title: "Sharks vs. Kings",
    start: iso(inTwoWeeks, 24 * 60), locationName: "SAP Center", latitude: 37.3327, longitude: -121.9013,
    category: "Sports", isFree: false, priceMin: 12 };
  const OUT_OF_AREA = { source: "ticketmaster", sourceEventId: "tmFAR", title: "Columbus Thing",
    start: iso(inTwoWeeks), locationName: "Nationwide Arena", latitude: 39.9692, longitude: -83.0061 };

  r = await call("runIngest", { source: "ticketmaster", payload: [A, C, OUT_OF_AREA] }, rep1.idToken);
  ok("ingest: a non-staff user cannot run ingestion", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));

  r = await call("runIngest", { areaId: "san-jose-ca", source: "ticketmaster", payload: [A, C, OUT_OF_AREA] }, staff.idToken);
  let res = r.result?.results?.[0];
  // W1.2: an out-of-area listing is now a REJECTION (John's outside_region rule) recorded in /rejectedListings, not a silent skip.
  ok("ingest: payload run creates the in-area records and rejects the out-of-area one with a reason",
     res?.created === 2 && res?.rejected === 1 && res?.rejectedByReason?.outside_region === 1 && res?.skipped === 0 && res?.errors?.length === 0, JSON.stringify(res));
  ok("ingest: the rejection is recorded with its reason and a 30-day expiry",
     await (async () => { const rej = (await db.doc("rejectedListings/ticketmaster-tmFAR").get()).data(); return rej?.reasons?.includes("outside_region") && rej?.source === "ticketmaster" && (rej?.expiresAt?.toMillis?.() ?? 0) > Date.now() + 29 * 86_400_000; })());
  ok("ingest: documents carry provenance + visibility flags",
     await (async () => {
       const d = (await db.doc("events/ticketmaster-tmA1").get()).data();
       return d?.source === "ticketmaster" && d?.active === true && d?.hidden === false && d?.broadcast === true
         && Array.isArray(d?.sourceKeys) && d.sourceKeys.includes("ticketmaster:tmA1") && d?.areaId === "san-jose-ca"
         && d?.creatorID === "system:ingest" && d?.pointValue === 250;
     })());
  ok("ingest: out-of-area record was never written", !(await db.doc("events/ticketmaster-tmFAR").get()).exists);

  // Cross-source duplicate: LibCal lists the same concert with a differently
  // punctuated title, 30 minutes later, venue string with the city appended.
  const B = { source: "libcal", sourceEventId: "LibCal-8758-999", title: "Symphony Silicon Valley — Beethoven At The California!",
    start: iso(inTwoWeeks, 30), locationName: "California Theatre, San Jose",
    description: "A much richer description of the concert from the library's calendar listing.",
    website: "https://sjpl.bibliocommons.com/events/999" };
  r = await call("runIngest", { areaId: "san-jose-ca", source: "libcal", payload: [B] }, staff.idToken);
  res = r.result?.results?.[0];
  ok("ingest: cross-source duplicate is MERGED, not created", res?.merged === 1 && res?.created === 0, JSON.stringify(res));
  const mergedDoc = (await db.doc("events/ticketmaster-tmA1").get()).data();
  ok("ingest: merged doc records both feeds in sources[] / sourceKeys[]",
     mergedDoc?.sources?.length === 2 && mergedDoc.sourceKeys.includes("libcal:LibCal-8758-999"), JSON.stringify(mergedDoc?.sources));
  ok("ingest: merge keeps the richer description and the primary's price",
     (mergedDoc?.description ?? "").includes("richer description") && mergedDoc?.isFree === false && mergedDoc?.priceMin === 25);
  ok("ingest: no second document was created for the duplicate", !(await db.doc("events/libcal-LibCal-8758-999").get()).exists);

  // Re-running the same feed is idempotent (updates, no new docs).
  r = await call("runIngest", { areaId: "san-jose-ca", source: "libcal", payload: [B] }, staff.idToken);
  res = r.result?.results?.[0];
  // W1.4: identical records minutes later are "unchanged" — seen, not rewritten.
  ok("ingest: re-seeing a merged source is recorded as unchanged with zero event writes", res?.unchanged === 1 && res?.updated === 0 && res?.created === 0 && res?.merged === 0 && res?.writes === 0, JSON.stringify(res));

  // THE CLIENT READS FIRESTORE ONLY — with exactly the query the app uses.
  // This account has no recorded age band, so the app's query carries the adultOnly filter (W2).
  const appQuery = query(collection(cdb, "events"),
    where("hidden", "==", false), where("active", "==", true), where("broadcast", "==", true),
    where("adultOnly", "==", false), where("date", ">=", new Date()));
  let visibleIds = [];
  try { visibleIds = (await getDocs(appQuery)).docs.map((d) => d.id); } catch (e) { visibleIds = [`ERR:${e.code}`]; }
  ok("client: the app's Firestore query returns the ingested events (no upstream call)",
     visibleIds.includes("ticketmaster-tmA1") && visibleIds.includes("ticketmaster-tmC1"), JSON.stringify(visibleIds));
  code2 = await userWrite("events/ticketmaster-tmA1", { pointValue: 1000 });
  ok("rules: clients cannot edit ingested events", code2 === "permission-denied", `got ${code2}`);
  try { await deleteDoc(doc(cdb, "events/ticketmaster-tmA1")); code2 = "ok"; } catch (e) { code2 = e.code; }
  ok("rules: clients cannot delete ingested events", code2 === "permission-denied", `got ${code2}`);

  // STALENESS: the feed stops listing A (cancelled). Not seen for 3 cycles → inactive.
  r = await call("runIngest", { areaId: "san-jose-ca", source: "ticketmaster", payload: [C] }, staff.idToken);
  res = r.result?.results?.[0];
  let aDoc = (await db.doc("events/ticketmaster-tmA1").get()).data();
  ok("staleness: first miss increments missedCycles but keeps the event active",
     res?.markedStale === 1 && aDoc?.missedCycles === 1 && aDoc?.active === true, JSON.stringify({ res, missed: aDoc?.missedCycles }));
  await call("runIngest", { areaId: "san-jose-ca", source: "ticketmaster", payload: [C] }, staff.idToken);
  r = await call("runIngest", { areaId: "san-jose-ca", source: "ticketmaster", payload: [C] }, staff.idToken);
  res = r.result?.results?.[0];
  aDoc = (await db.doc("events/ticketmaster-tmA1").get()).data();
  ok("staleness: third consecutive miss deactivates (never deletes) the event",
     res?.deactivated === 1 && aDoc?.active === false && aDoc?.inactiveAt, JSON.stringify({ res, active: aDoc?.active }));
  try { visibleIds = (await getDocs(appQuery)).docs.map((d) => d.id); } catch (e) { visibleIds = [`ERR:${e.code}`]; }
  ok("client: a deactivated event disappears from the app query while C remains",
     !visibleIds.includes("ticketmaster-tmA1") && visibleIds.includes("ticketmaster-tmC1"), JSON.stringify(visibleIds));

  // A feed outage (zero records) must NOT age the corpus.
  const cBefore = (await db.doc("events/ticketmaster-tmC1").get()).data()?.missedCycles ?? 0;
  r = await call("runIngest", { areaId: "san-jose-ca", source: "ticketmaster", payload: [] }, staff.idToken);
  const cAfter = (await db.doc("events/ticketmaster-tmC1").get()).data()?.missedCycles ?? 0;
  ok("staleness: an empty fetch marks nothing stale (outage ≠ cancellations)",
     r.result?.results?.[0]?.markedStale === 0 && cAfter === cBefore, JSON.stringify(r.result));

  // A reappearing event is reactivated.
  await call("runIngest", { areaId: "san-jose-ca", source: "ticketmaster", payload: [A, C] }, staff.idToken);
  aDoc = (await db.doc("events/ticketmaster-tmA1").get()).data();
  ok("staleness: an event that reappears is reactivated with a clean counter",
     aDoc?.active === true && aDoc?.missedCycles === 0, JSON.stringify({ active: aDoc?.active, missed: aDoc?.missedCycles }));

  // Every run is logged, and supply telemetry lands in /treasury.
  const runs = await db.collection("ingestRuns").where("source", "==", "ticketmaster").get();
  ok("ingest: every run writes an ingestRuns record", runs.size >= 5, `runs=${runs.size}`);
  const month = new Date().toISOString().slice(0, 7);
  const treasury = (await db.doc(`treasury/${month}`).get()).data();
  ok("ingest: /treasury carries per-source supply counters",
     (treasury?.supply?.["ticketmaster.runs"] ?? 0) >= 5 && (treasury?.supply?.["libcal.fetched"] ?? 0) >= 2, JSON.stringify(treasury?.supply));

  // Coverage report (Part 2 §1e) — computed server-side, admin-only.
  r = await call("getSupplyReport", { areaId: "san-jose-ca" }, rep1.idToken);
  ok("supply: report is staff-only", r.error?.status === "PERMISSION_DENIED");
  r = await call("getSupplyReport", { areaId: "san-jose-ca" }, staff.idToken);
  const rep = r.result;
  ok("supply: report counts active upcoming events by source and multi-source merges",
     rep?.totalActiveUpcoming >= 2 && rep?.bySource?.ticketmaster >= 2 && rep?.byAnySource?.libcal >= 1 && rep?.multiSourceEvents >= 1,
     JSON.stringify(rep && { t: rep.totalActiveUpcoming, s: rep.bySource, any: rep.byAnySource, m: rep.multiSourceEvents }));
  ok("supply: 'not in Google' share is measured (no serpapi source → counts as not-in-Google)",
     typeof rep?.notInGoogleShare === "number" && rep.notInGoogleShare === 1, String(rep?.notInGoogleShare));
  ok("supply: targets are reported honestly (300+ not met on a 2-event emulator)",
     rep?.meets?.total === false && rep?.targets?.total === 300);
  ok("rules: clients cannot read /ingestRuns or /supplyReports",
     await (async () => { try { await getDocs(query(collection(cdb, "ingestRuns"))); return false; } catch (e) { return e.code === "permission-denied"; } })()
     && await (async () => { try { await getDocs(query(collection(cdb, "supplyReports"))); return false; } catch (e) { return e.code === "permission-denied"; } })());
  // GUESTS BROWSE. Broadcast listings are public information; a signed-out
  // client must be able to run the app's query so "Continue as guest" shows
  // real events. Everything else about /events stays authenticated.
  const guestApp = clientInit({ projectId: PROJECT, apiKey: "fake-api-key" }, "guest");
  const guestDb = clientFirestore(guestApp);
  connectFirestoreEmulator(guestDb, EMULATORS.firestore.host, EMULATORS.firestore.port);
  let guestIds = [];
  try {
    guestIds = (await getDocs(query(collection(guestDb, "events"),
      where("hidden", "==", false), where("active", "==", true), where("broadcast", "==", true),
      where("adultOnly", "==", false), where("date", ">=", new Date())))).docs.map((d) => d.id);
  } catch (e) { guestIds = [`ERR:${e.code}`]; }
  ok("rules: a signed-out guest can read broadcast events (the app's query)",
     guestIds.includes("ticketmaster-tmC1"), JSON.stringify(guestIds));
  let guestCode;
  try { await getDocs(query(collection(guestDb, "events"), where("hidden", "==", false))); guestCode = "ok"; }
  catch (e) { guestCode = e.code; }
  ok("rules: a guest cannot list non-broadcast events", guestCode === "permission-denied", `got ${guestCode}`);
  try { await getDoc(doc(guestDb, "posts/e2e-post-1")); guestCode = "ok"; } catch (e) { guestCode = e.code; }
  ok("rules: a guest still cannot read community posts", guestCode === "permission-denied", `got ${guestCode}`);

  // A client cannot broadcast its own event or forge provenance on create.
  const baseEvent = {
    title: "Self Broadcast", organizer: "Me", date: new Date(Date.now() + 7 * 86_400_000), time: "6 PM",
    locationName: "Somewhere", attendeeCount: 1, category: "Social", imagePlaceholder: "cup.and.saucer.fill",
    pointValue: 100, creatorID: uid, createdAt: serverTimestamp(), hidden: false, active: true, source: "community", adultOnly: false,
  };
  const tryCreate = async (id, extra) => { try { await setDoc(doc(cdb, `events/${id}`), { ...baseEvent, ...extra }); return "ok"; } catch (e) { return e.code; } };
  ok("rules: client cannot create an event with broadcast: true", (await tryCreate("e2e-selfbc", { broadcast: true })) === "permission-denied");
  ok("rules: client cannot forge an ingested source", (await tryCreate("e2e-forge-src", { source: "ticketmaster" })) === "permission-denied");
  ok("rules: client cannot pre-set provenance (sources[])", (await tryCreate("e2e-forge-prov", { sources: [{ source: "libcal" }] })) === "permission-denied");
  ok("rules: a plain community event (active, not broadcast) is accepted", (await tryCreate("e2e-plain-community", {})) === "ok");
  code2 = await userWrite("events/e2e-plain-community", { broadcast: true });
  ok("rules: creator cannot flip broadcast on later", code2 === "permission-denied", `got ${code2}`);
  code2 = await userWrite("events/e2e-plain-community", { description: "edited by creator" });
  ok("rules: creator CAN still edit their own event copy", code2 === "ok", `got ${code2}`);


  // ────────────────────────────────────────────────────────────────────────
  // W2 — ADULT-ONLY LISTINGS. Rules, client queries and every server surface.
  //
  // A minor, an unknown-age account and a signed-out session can neither list
  // nor get an adultOnly listing and never receive one from any server surface;
  // a recorded adult can. Signed-out browsing of ordinary events keeps working.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Adult-only listings (W2) ──");
  const nowYear = new Date().getUTCFullYear();
  const mkAge = async (label, birthYear) => {
    const em = `e2e-${label}-${Date.now()}@verdure.test`;
    const u = await signUp(em, password);
    const fdb = await clientAs(em, password, `age-${label}-${Date.now()}`);
    await setDoc(doc(fdb, `users/${u.uid}`), { displayName: `${label} user`, email: em, interests: [], collectedPlaceIDs: [],
      createdAt: serverTimestamp(), lastUpdated: serverTimestamp() });
    if (birthYear) await call("registerAgeBand", { birthYear }, u.idToken);
    return { ...u, email: em, fdb };
  };
  const minor = await mkAge("minor", nowYear - 16);
  const unknownAge = await mkAge("unknownage", null);
  const adult = await mkAge("adult", nowYear - 30);
  ok("ages recorded: minor and adult", (await db.doc(`users/${minor.uid}`).get()).data()?.ageBand === "minor" &&
     (await db.doc(`users/${adult.uid}`).get()).data()?.ageBand === "adult");
  const soonMs = Date.now() + 2 * 86_400_000;
  const w2Event = (id, title, extra) => db.doc(`events/${id}`).set({
    title, organizer: "W2 Seed", date: new Date(soonMs), time: "6:00 PM", locationName: "Plaza de César Chávez", attendeeCount: 0,
    category: "Social", imagePlaceholder: "cup.and.saucer.fill", pointValue: 100, creatorID: "system:ingest", createdAt: new Date(),
    hidden: false, active: true, broadcast: true, source: "ics", areaId: "san-jose-ca", latitude: 37.3325, longitude: -121.8890,
    qualityScore: 0.9, topicTags: ["community"], contentHash: "w2", ...extra });
  await w2Event("w2-adult-beer", "Downtown Brewery Crawl", { adultOnly: true, adultOnlyReason: "alcohol" });
  await w2Event("w2-ordinary-1", "Plaza Storytime", { adultOnly: false, adultOnlyReason: null });
  await w2Event("w2-ordinary-2", "Community Walk", { adultOnly: false, adultOnlyReason: null });
  await w2Event("w2-ordinary-3", "Chess in the Park", { adultOnly: false, adultOnlyReason: null });
  await db.doc("feedCaches/san-jose-ca").delete().catch(() => {});

  const listIds = async (fdb, withFilter) => {
    const constraints = [where("hidden", "==", false), where("active", "==", true), where("broadcast", "==", true)];
    if (withFilter) constraints.push(where("adultOnly", "==", false));
    constraints.push(where("date", ">=", new Date()));
    try { return (await getDocs(query(collection(fdb, "events"), ...constraints))).docs.map((d) => d.id); } catch (e) { return [`ERR:${e.code}`]; }
  };
  const getCode = async (fdb, id) => { try { const s = await getDoc(doc(fdb, `events/${id}`)); return s.exists() ? "ok" : "missing"; } catch (e) { return e.code; } };
  const guest2 = clientFirestore(clientInit({ projectId: PROJECT, apiKey: "fake-api-key" }, "guest-w2"));
  connectFirestoreEmulator(guest2, EMULATORS.firestore.host, EMULATORS.firestore.port);
  let w2ids = await listIds(guest2, true);
  ok("regression: a signed-out guest still browses ordinary broadcast events", w2ids.includes("w2-ordinary-1") && !w2ids.includes("w2-adult-beer"), JSON.stringify(w2ids));
  ok("rules: a signed-out list WITHOUT the adultOnly filter is denied outright", (await listIds(guest2, false))[0] === "ERR:permission-denied");
  ok("rules: a signed-out get of an adult-only listing is denied; an ordinary one works",
     (await getCode(guest2, "w2-adult-beer")) === "permission-denied" && (await getCode(guest2, "w2-ordinary-1")) === "ok");
  w2ids = await listIds(minor.fdb, true);
  ok("rules: a minor's filtered list never contains an adult-only listing", w2ids.includes("w2-ordinary-1") && !w2ids.includes("w2-adult-beer"), JSON.stringify(w2ids));
  ok("rules: a minor's unfiltered list is denied", (await listIds(minor.fdb, false))[0] === "ERR:permission-denied");
  ok("rules: a minor cannot get an adult-only listing by id", (await getCode(minor.fdb, "w2-adult-beer")) === "permission-denied");
  ok("rules: an unknown-age account is treated as a minor (filtered list works, unfiltered denied, adult get denied)",
     (await listIds(unknownAge.fdb, true)).includes("w2-ordinary-1") && (await listIds(unknownAge.fdb, false))[0] === "ERR:permission-denied" &&
     (await getCode(unknownAge.fdb, "w2-adult-beer")) === "permission-denied");
  w2ids = await listIds(adult.fdb, false);
  ok("rules: a recorded adult lists everything without the filter, adult-only included", w2ids.includes("w2-adult-beer") && w2ids.includes("w2-ordinary-1"), JSON.stringify(w2ids));
  ok("rules: a recorded adult can get an adult-only listing", (await getCode(adult.fdb, "w2-adult-beer")) === "ok");
  ok("rules: nobody can flip adultOnly from a client",
     (await (async () => { try { await updateDoc(doc(adult.fdb, "events/w2-adult-beer"), { adultOnly: false }); return "ok"; } catch (e) { return e.code; } })()) === "permission-denied");
  const recIds = async (u) => ((await call("recommendedEvents", { areaId: "san-jose-ca", lat: 37.3382, lng: -121.8863, limit: 50 }, u.idToken)).result?.events ?? []).map((e) => e.id);
  const minorRec = await recIds(minor), unknownRec = await recIds(unknownAge), adultRec = await recIds(adult);
  ok("ranking: a minor's and an unknown-age account's For You never contain the adult-only listing",
     !minorRec.includes("w2-adult-beer") && !unknownRec.includes("w2-adult-beer") && minorRec.includes("w2-ordinary-1"), JSON.stringify(minorRec));
  ok("ranking: a recorded adult's For You can contain it", adultRec.includes("w2-adult-beer"), JSON.stringify(adultRec));
  r = await call("rsvpToEvent", { eventId: "w2-adult-beer", going: true }, minor.idToken);
  ok("rsvp: a minor cannot RSVP to an adult-only listing", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));
  r = await call("rsvpToEvent", { eventId: "w2-adult-beer", going: true }, adult.idToken);
  ok("rsvp: a recorded adult can", r.result?.going === true, JSON.stringify(r));
  const minorInvite = (await call("myFriendInvite", {}, minor.idToken)).result;
  await call("sendFriendRequest", { targetUid: minor.uid, inviteToken: minorInvite?.token }, adult.idToken);
  await call("respondToFriendRequest", { fromUid: adult.uid, accept: true }, minor.idToken);
  const minorUpcoming = ((await call("friendsUpcoming", {}, minor.idToken)).result?.events ?? []).map((e) => e.id);
  ok("friends upcoming: the minor never sees the adult friend's adult-only RSVP", !minorUpcoming.includes("w2-adult-beer"), JSON.stringify(minorUpcoming));
  r = await call("inviteToEvent", { eventId: "w2-adult-beer", toUids: [minor.uid] }, adult.idToken);
  ok("invites: an adult cannot invite a minor to an adult-only listing (skipped, never delivered)",
     (r.result?.skipped ?? []).includes(minor.uid) && !(r.result?.delivered ?? []).includes(minor.uid), JSON.stringify(r));
  const targetDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(soonMs));
  r = await call("planEvents", { when: "Pick a date", targetDate, who: "Anyone", distance: "Anywhere nearby", budget: "Any", note: "", areaId: "san-jose-ca", lat: 37.3382, lng: -121.8863 }, minor.idToken);
  ok("planner: a minor's plan is built from ordinary listings only", !!r.result && (r.result.stops ?? []).length >= 2 && !(r.result.stops ?? []).some((s) => s.eventId === "w2-adult-beer"), JSON.stringify(r.result ?? r.error));
  r = await call("planEvents", { when: "Pick a date", targetDate, who: "Anyone", distance: "Anywhere nearby", budget: "Any", note: "brewery", areaId: "san-jose-ca", lat: 37.3382, lng: -121.8863 }, minor.idToken);
  ok("planner: a minor asking for 'brewery' gets no plan rather than the adult-only listing", !!r.error, JSON.stringify(r.result ?? r.error));

  r = await call("listLaunchAreas", {}, rep1.idToken);
  ok("areas: any signed-in user can list launch areas (to explain coverage honestly)",
     Array.isArray(r.result?.areas) && r.result.areas[0]?.id === "san-jose-ca", JSON.stringify(r.result));

  // ────────────────────────────────────────────────────────────────────────
  // SOCIAL — follows, Going/RSVP, invites, friends-going (Part 2 §4)
  //
  // Every write is a callable; blocks are enforced server-side; the rules
  // decide who may read an attendee record. "Sarah is going Thursday" must be
  // visible to Sarah's friends, invisible across a block, and impossible to
  // forge.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Social: follows / RSVP / invites / friends-going ──");

  const mk = async (label) => {
    const em = `e2e-${label}-${Date.now()}@verdure.test`;
    const u = await signUp(em, password);
    const fdb = await clientAs(em, password, label);
    await setDoc(doc(fdb, `users/${u.uid}`), {
      displayName: label === "sarah" ? "Sarah Park" : label === "quinn" ? "Quinn Lee" : `${label} user`,
      email: em, interests: [], collectedPlaceIDs: [], createdAt: serverTimestamp(), lastUpdated: serverTimestamp(),
    });
    return { ...u, email: em, fdb };
  };
  const sarah = await mk("sarah");    // the friend who RSVPs
  const quinn = await mk("quinn");    // saved the event; friends with Sarah
  const stranger = await mk("stranger");
  const blocker = await mk("blocker");

  const socialEventId = `e2e-social-event-${Date.now()}`;
  await db.doc(`events/${socialEventId}`).set({
    title: "Thursday Trail Cleanup", organizer: "Metroparks Friends", date: new Date(Date.now() + 5 * 86_400_000),
    time: "6:00 PM", locationName: "Edgewater Park", attendeeCount: 0, category: "Cleanup",
    imagePlaceholder: "sparkles", pointValue: 200, creatorID: "system:ingest", createdAt: new Date(),
    hidden: false, active: true, broadcast: true, source: "libcal", areaId: "san-jose-ca", adultOnly: false,
    latitude: 37.3230, longitude: -121.9200,
  });

  // ── Mutual friend requests ──
  r = await call("followUser", { targetId: sarah.uid, kind: "user" }, quinn.idToken);
  ok("friends: legacy one-way user follow is rejected", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));
  const adultYear = new Date().getUTCFullYear() - 25;
  r = await call("registerAgeBand", { birthYear: adultYear }, sarah.idToken);
  ok("friends: adult age band recorded", r.result?.ageBand === "adult", JSON.stringify(r));
  await call("registerAgeBand", { birthYear: adultYear }, quinn.idToken);
  await call("registerAgeBand", { birthYear: adultYear }, blocker.idToken);
  const sharedEventId = `e2e-shared-past-${Date.now()}`;
  await db.doc(`events/${sharedEventId}`).set({ adultOnly: false,
    title: "Shared Park Day", organizer: "Parks", date: new Date(Date.now() + 86_400_000),
    endDate: new Date(Date.now() + 90_000_000), active: true, hidden: false,
    creatorID: "system:ingest", attendeeCount: 0,
  });
  await call("rsvpToEvent", { eventId: sharedEventId, going: true }, quinn.idToken);
  await call("rsvpToEvent", { eventId: sharedEventId, going: true }, blocker.idToken);
  r = await call("sharedPastEventMembers", {}, quinn.idToken);
  ok("friends: upcoming shared event never exposes attendees", r.result?.members?.length === 0, JSON.stringify(r));
  await db.doc(`events/${sharedEventId}`).update({
    date: new Date(Date.now() - 3 * 86_400_000), endDate: new Date(Date.now() - 2 * 86_400_000),
  });
  // Simulate the event crossing its end after both actual RSVP timestamps.
  // Backdating these seeded attendee rows keeps the privacy predicate honest.
  await db.doc(`events/${sharedEventId}/attendees/${quinn.uid}`).update({ createdAt: new Date(Date.now() - 4 * 86_400_000) });
  await db.doc(`events/${sharedEventId}/attendees/${blocker.uid}`).update({ createdAt: new Date(Date.now() - 4 * 86_400_000) });
  r = await call("sharedPastEventMembers", {}, quinn.idToken);
  ok("friends: completed shared RSVP reveals an adult candidate",
    r.result?.members?.some((member) => member.uid === blocker.uid && member.eventTitle === "Shared Park Day"), JSON.stringify(r));
  await db.doc(`events/${sharedEventId}`).update({ active: false });
  r = await call("sharedPastEventMembers", {}, quinn.idToken);
  ok("friends: retired source listings preserve genuine past-event connections",
    r.result?.members?.some((member) => member.uid === blocker.uid), JSON.stringify(r));
  await db.doc(`events/${sharedEventId}/attendees/${blocker.uid}`).update({ createdAt: new Date() });
  r = await call("sharedPastEventMembers", {}, quinn.idToken);
  ok("friends: a late RSVP cannot enumerate past attendees", r.result?.members?.length === 0, JSON.stringify(r));
  await db.doc(`events/${sharedEventId}/attendees/${blocker.uid}`).update({ createdAt: new Date(Date.now() - 4 * 86_400_000) });
  await db.doc(`users/${blocker.uid}`).update({ ageBand: "minor" });
  r = await call("sharedPastEventMembers", {}, quinn.idToken);
  ok("friends: a minor is absent from shared-event discovery", r.result?.members?.length === 0, JSON.stringify(r));
  await db.doc(`users/${blocker.uid}`).update({ ageBand: "adult" });
  await call("claimUsername", { username: "sarahpark" }, sarah.idToken);
  r = await call("findFriendByUsername", { username: "sarahpark" }, quinn.idToken);
  ok("friends: exact adult username lookup", r.result?.member?.uid === sarah.uid, JSON.stringify(r));
  r = await call("sendFriendRequest", { targetUid: sarah.uid }, quinn.idToken);
  ok("friends: Quinn sends a request", r.result?.status === "pending_sent" && r.result?.changed === true, JSON.stringify(r));
  r = await call("sendFriendRequest", { targetUid: sarah.uid }, quinn.idToken);
  ok("friends: repeat request is idempotent", r.result?.changed === false, JSON.stringify(r));
  const incoming = (await db.doc(`users/${sarah.uid}/friendRequests/${quinn.uid}`).get()).data();
  ok("friends: request mirrored to both participants", incoming?.fromUid === quinn.uid &&
     (await db.doc(`users/${quinn.uid}/friendRequests/${sarah.uid}`).get()).exists);
  r = await call("respondToFriendRequest", { fromUid: quinn.uid, accept: true }, sarah.idToken);
  ok("friends: Sarah accepts", r.result?.status === "accepted", JSON.stringify(r));
  ok("friends: acceptance creates both edges and clears request", (await db.doc(`users/${sarah.uid}/friends/${quinn.uid}`).get()).exists &&
     (await db.doc(`users/${quinn.uid}/friends/${sarah.uid}`).get()).exists &&
     !(await db.doc(`users/${sarah.uid}/friendRequests/${quinn.uid}`).get()).exists);
  r = await call("respondToFriendRequest", { fromUid: quinn.uid, accept: true }, sarah.idToken);
  ok("friends: consumed request cannot be accepted again", r.error?.status === "NOT_FOUND", JSON.stringify(r));
  r = await call("sendFriendRequest", { targetUid: quinn.uid }, stranger.idToken);
  ok("friends: unknown-age sender can request an adult", r.result?.status === "pending_sent", JSON.stringify(r));
  r = await call("respondToFriendRequest", { fromUid: stranger.uid, accept: false }, quinn.idToken);
  ok("friends: decline clears both request copies", r.result?.status === "declined" &&
     !(await db.doc(`users/${stranger.uid}/friendRequests/${quinn.uid}`).get()).exists);
  await call("registerAgeBand", { birthYear: new Date().getUTCFullYear() - 16 }, stranger.idToken);
  await call("claimUsername", { username: "strangerteen" }, stranger.idToken);
  r = await call("findFriendByUsername", { username: "strangerteen" }, quinn.idToken);
  ok("friends: minor absent from adult username search", r.result?.member === null, JSON.stringify(r));
  const privateInvite = (await call("myFriendInvite", {}, stranger.idToken)).result;
  r = await call("sendFriendRequest", { targetUid: stranger.uid }, quinn.idToken);
  ok("friends: unknown-age target requires private invite", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));
  r = await call("sendFriendRequest", { targetUid: stranger.uid, inviteToken: privateInvite?.token }, quinn.idToken);
  ok("friends: private invite permits request", r.result?.status === "pending_sent", JSON.stringify(r));
  await call("respondToFriendRequest", { fromUid: quinn.uid, accept: false }, stranger.idToken);
  // The suite runs at any local hour. Disable Quinn's quiet window for the
  // notification round-trip; quiet-hours behavior has its own unit checks.
  await db.doc(`users/${quinn.uid}`).set({ notificationPrefs: {
    eventSuggestions: true, friendActivity: true, quietStart: 0, quietEnd: 0,
    timeZone: "America/Los_Angeles",
  } }, { merge: true });
  r = await call("sendFriendRequest", { targetUid: sarah.uid }, sarah.idToken);
  ok("friends: cannot add yourself", r.error?.status === "FAILED_PRECONDITION");
  let fcode;
  try { await setDoc(doc(quinn.fdb, `users/${quinn.uid}/following/${stranger.uid}`), { uid: stranger.uid, kind: "user" }); fcode = "ok"; } catch (e) { fcode = e.code; }
  ok("rules: a client cannot write its own following list (callable only)", fcode === "permission-denied", `got ${fcode}`);
  try { await setDoc(doc(quinn.fdb, `users/${sarah.uid}/following/${quinn.uid}`), { uid: quinn.uid, kind: "user" }); fcode = "ok"; } catch (e) { fcode = e.code; }
  ok("rules: a client cannot write another user's following list", fcode === "permission-denied", `got ${fcode}`);
  try { fcode = (await getDoc(doc(quinn.fdb, `users/${quinn.uid}/friends/${sarah.uid}`))).exists() ? "ok" : "missing"; } catch (e) { fcode = e.code; }
  ok("rules: owner can read their accepted friends", fcode === "ok", `got ${fcode}`);
  try { await getDoc(doc(stranger.fdb, `users/${quinn.uid}/friends/${sarah.uid}`)); fcode = "ok"; } catch (e) { fcode = e.code; }
  ok("rules: others cannot read your friends", fcode === "permission-denied", `got ${fcode}`);
  try { await setDoc(doc(quinn.fdb, `users/${sarah.uid}/friends/${quinn.uid}`), { uid: quinn.uid }); fcode = "ok"; } catch (e) { fcode = e.code; }
  ok("rules: no cross-user friend-list writes", fcode === "permission-denied", `got ${fcode}`);
  try { await getDoc(doc(stranger.fdb, `users/${sarah.uid}/friendRequests/${quinn.uid}`)); fcode = "ok"; } catch (e) { fcode = e.code; }
  ok("rules: requests visible only to participants", fcode === "permission-denied", `got ${fcode}`);
  try { fcode = await (async () => { await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { followerCount: 999 }); return "ok"; })(); } catch (e) { fcode = e.code; }
  ok("rules: client cannot inflate its own follower count", fcode === "permission-denied", `got ${fcode}`);

  // Optional household preferences stay owner-writable and constrained to the
  // exact vocabulary the recommender understands.
  let householdCode = await (async () => { try {
    await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), {
      householdYoungestAge: 7, householdChildAges: [7, 12], householdTransportMode: "transit",
      householdRadiusMiles: 15, householdAccessibilityNeeds: ["stepFree", "seating"],
    }); return "ok";
  } catch (e) { return e.code; } })();
  const household = (await getDoc(doc(quinn.fdb, `users/${quinn.uid}`))).data();
  ok("rules: household preferences persist together",
     householdCode === "ok" && household?.householdRadiusMiles === 15 &&
     household?.householdChildAges?.length === 2 &&
     household?.householdAccessibilityNeeds?.includes("stepFree"), `got ${householdCode}`);
  householdCode = await (async () => { try {
    await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { householdAccessibilityNeeds: ["unverifiedClaim"] });
    return "ok";
  } catch (e) { return e.code; } })();
  ok("rules: unknown accessibility claims are rejected", householdCode === "permission-denied", `got ${householdCode}`);
  householdCode = await (async () => { try {
    await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { householdRadiusMiles: 500 });
    return "ok";
  } catch (e) { return e.code; } })();
  ok("rules: out-of-range household radius is rejected", householdCode === "permission-denied", `got ${householdCode}`);
  householdCode = await (async () => { try {
    await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { householdChildAges: [18] });
    return "ok";
  } catch (e) { return e.code; } })();
  ok("rules: household child ages are bounded to 0–17", householdCode === "permission-denied", `got ${householdCode}`);

  // Blocks refuse friend requests server-side, in both directions.
  await setDoc(doc(blocker.fdb, `users/${blocker.uid}/blocks/${sarah.uid}`), { uid: sarah.uid, createdAt: serverTimestamp() });
  r = await call("sendFriendRequest", { targetUid: blocker.uid }, sarah.idToken);
  ok("friends: a blocked user's request fails server-side", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));
  r = await call("sendFriendRequest", { targetUid: sarah.uid }, blocker.idToken);
  ok("friends: blocker cannot request the person they blocked", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r));

  // ── Saved events + privacy are the user's own choices ──
  let ucode = await (async () => { try { await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { savedEventIDs: [socialEventId] }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: client can save an event (savedEventIDs)", ucode === "ok", `got ${ucode}`);
  ucode = await (async () => { try { await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { activityPrivacy: "everyone-please" }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: activityPrivacy accepts only friends|public", ucode === "permission-denied", `got ${ucode}`);
  ucode = await (async () => { try { await updateDoc(doc(quinn.fdb, `users/${quinn.uid}`), { rsvpEventIDs: [socialEventId] }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: client cannot fake an RSVP via rsvpEventIDs", ucode === "permission-denied", `got ${ucode}`);

  // ── RSVP ──
  r = await call("rsvpToEvent", { eventId: socialEventId, going: true }, sarah.idToken);
  ok("rsvp: Sarah marks herself Going", r.result?.going === true && r.result?.changed === true && r.result?.attendeeCount === 1, JSON.stringify(r));
  const att = (await db.doc(`events/${socialEventId}/attendees/${sarah.uid}`).get()).data();
  ok("rsvp: attendee record written with name, initials and privacy (friends by default)",
     att?.uid === sarah.uid && att?.displayName === "Sarah Park" && att?.initials === "SP" && att?.visibility === "friends", JSON.stringify(att));
  ok("rsvp: public count on the event is honest", (await db.doc(`events/${socialEventId}`).get()).data()?.attendeeCount === 1);
  ok("rsvp: the user's offline Going state is recorded server-side",
     ((await db.doc(`users/${sarah.uid}`).get()).data()?.rsvpEventIDs ?? []).includes(socialEventId));
  r = await call("rsvpToEvent", { eventId: socialEventId, going: true }, sarah.idToken);
  ok("rsvp: repeating is idempotent (count stays 1)", r.result?.changed === false && r.result?.attendeeCount === 1);
  const qNotifs = await db.collection(`users/${quinn.uid}/notifications`).where("kind", "==", "friend-rsvp").get();
  ok("rsvp: a friend who SAVED the event is notified", qNotifs.size === 1 && qNotifs.docs[0].data().actorUid === sarah.uid && qNotifs.docs[0].data().eventId === socialEventId,
     JSON.stringify(qNotifs.docs.map((d) => d.data())));
  const sNotifs = await db.collection(`users/${stranger.uid}/notifications`).get();
  ok("rsvp: a stranger who did not save it hears nothing", sNotifs.empty);
  const act = await db.collection("activity").where("actorUid", "==", sarah.uid).where("kind", "==", "rsvp").get();
  ok("rsvp: an activity row is written for the friends feed", act.size === 1 && act.docs[0].data().eventId === socialEventId);

  // Rules on attendee records.
  let acode;
  try { await setDoc(doc(sarah.fdb, `events/${socialEventId}/attendees/${sarah.uid}`), { uid: sarah.uid }); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: a client cannot write even its OWN attendee document", acode === "permission-denied", `got ${acode}`);
  try { await setDoc(doc(quinn.fdb, `events/${socialEventId}/attendees/${sarah.uid}`), { uid: sarah.uid }); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: a client cannot write another user's attendee document", acode === "permission-denied", `got ${acode}`);
  try { await deleteDoc(doc(quinn.fdb, `events/${socialEventId}/attendees/${sarah.uid}`)); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: a client cannot delete another user's RSVP", acode === "permission-denied", `got ${acode}`);
  try { acode = (await getDoc(doc(quinn.fdb, `events/${socialEventId}/attendees/${sarah.uid}`))).exists() ? "ok" : "missing"; } catch (e) { acode = e.code; }
  ok("rules: accepted friend CAN read Sarah's RSVP", acode === "ok", `got ${acode}`);
  try { await getDoc(doc(stranger.fdb, `events/${socialEventId}/attendees/${sarah.uid}`)); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: a stranger CANNOT read a friends-only RSVP", acode === "permission-denied", `got ${acode}`);
  try { await getDocs(collection(quinn.fdb, `events/${socialEventId}/attendees`)); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: nobody can LIST attendees (friendsGoing is the only window)", acode === "permission-denied", `got ${acode}`);

  // ── Friends going ──
  r = await call("friendsGoing", { eventIds: [socialEventId] }, quinn.idToken);
  const fg = r.result?.events?.[socialEventId];
  ok("friendsGoing: Quinn sees accepted friend Sarah", fg?.count === 1 && fg?.friends?.[0]?.uid === sarah.uid && fg.friends[0].initials === "SP", JSON.stringify(r.result));
  r = await call("friendsUpcoming", {}, quinn.idToken);
  ok("friendsUpcoming: accepted friend's future RSVP leads the tab",
     r.result?.events?.some((ev) => ev.id === socialEventId && ev.friends.includes("Sarah Park")), JSON.stringify(r.result));
  r = await call("friendsUpcoming", {}, stranger.idToken);
  ok("friendsUpcoming: unrelated member sees no friend's plan",
     !r.result?.events?.some((ev) => ev.id === socialEventId), JSON.stringify(r.result));
  r = await call("recommendedEvents", { areaId: "san-jose-ca", lat: 37.3382, lng: -121.8863 }, quinn.idToken);
  ok("ranking: accepted friend's event enters the bounded candidate set",
     r.result?.events?.some((ev) => ev.id === socialEventId && ev.parts?.social > 0), JSON.stringify(r.result));
  const feedCache = await db.doc("feedCaches/san-jose-ca").get();
  ok("ranking: area candidate snapshot is cached", feedCache.exists && Array.isArray(feedCache.data()?.events));
  r = await call("friendsGoing", { eventIds: [socialEventId] }, stranger.idToken);
  ok("friendsGoing: a stranger sees 0 (not a friend)", r.result?.events?.[socialEventId]?.count === 0, JSON.stringify(r.result));
  // ── Friends leaderboard (G4) ──
  //
  // The point of these is the DENIALS. A leaderboard is only meaningful if a
  // position cannot be claimed, so the tests that matter assert that a client
  // cannot write its own score and that a blocked account disappears from it.
  r = await call("friendsLeaderboard", { period: "allTime" }, quinn.idToken);
  const board = r.result?.rows ?? [];
  ok("leaderboard: includes me and accepted friends",
     board.some((x) => x.isMe) && board.some((x) => x.uid === sarah.uid),
     `err=${JSON.stringify(r.error)} result=${JSON.stringify(r.result)}`);
  ok("leaderboard: rows expose only display fields, never email or subscription state",
     board.every((x) => Object.keys(x).every((k) =>
       ["uid", "displayName", "initials", "points", "isMe", "rank"].includes(k))),
     JSON.stringify(board[0]));
  ok("leaderboard: sorted descending by points",
     board.every((x, i) => i === 0 || board[i - 1].points >= x.points), JSON.stringify(board.map((x) => x.points)));
  ok("leaderboard: a solo user is told so rather than shown an empty board",
     (await call("friendsLeaderboard", {}, stranger.idToken)).result?.isSolo === true);

  // Legacy one-way follows never grant activity access, even under an old
  // public visibility setting. This is the privacy regression the sprint fixes.
  const oneway = await mk("oneway");
  await db.doc(`users/${oneway.uid}/following/${sarah.uid}`).set({ uid: sarah.uid, kind: "user" });
  r = await call("friendsGoing", { eventIds: [socialEventId] }, oneway.idToken);
  ok("friendsGoing: a one-way follower sees nothing", r.result?.events?.[socialEventId]?.count === 0, JSON.stringify(r.result));
  await db.doc(`users/${sarah.uid}`).set({ activityPrivacy: "public" }, { merge: true });
  await call("rsvpToEvent", { eventId: socialEventId, going: false }, sarah.idToken);
  await call("rsvpToEvent", { eventId: socialEventId, going: true }, sarah.idToken);   // re-stamps visibility
  r = await call("friendsGoing", { eventIds: [socialEventId] }, oneway.idToken);
  ok("friendsGoing: old public flag still does not expose RSVP", r.result?.events?.[socialEventId]?.count === 0, JSON.stringify(r.result));
  try { await getDoc(doc(oneway.fdb, `events/${socialEventId}/attendees/${sarah.uid}`)); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: one-way follower cannot read public-flag RSVP", acode === "permission-denied", `got ${acode}`);
  // Blocks win over everything, in both directions.
  const viewer = await mk("viewer");
  await call("sendFriendRequest", { targetUid: sarah.uid }, viewer.idToken);
  await call("respondToFriendRequest", { fromUid: viewer.uid, accept: true }, sarah.idToken);
  r = await call("friendsGoing", { eventIds: [socialEventId] }, viewer.idToken);
  ok("friendsGoing: accepted viewer sees Sarah before block", r.result?.events?.[socialEventId]?.count === 1);
  await setDoc(doc(viewer.fdb, `users/${viewer.uid}/blocks/${sarah.uid}`), { uid: sarah.uid, createdAt: serverTimestamp() });
  r = await call("friendsGoing", { eventIds: [socialEventId] }, viewer.idToken);
  ok("friendsGoing: after blocking Sarah, her RSVP is invisible to the blocker", r.result?.events?.[socialEventId]?.count === 0);
  try { await getDoc(doc(viewer.fdb, `events/${socialEventId}/attendees/${sarah.uid}`)); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: a blocked-in-either-direction RSVP is unreadable even when public", acode === "permission-denied", `got ${acode}`);
  await setDoc(doc(blocker.fdb, `users/${blocker.uid}/blocks/${quinn.uid}`), { uid: quinn.uid, createdAt: serverTimestamp() });
  r = await call("rsvpToEvent", { eventId: socialEventId, going: true }, blocker.idToken);
  ok("rsvp: the blocker can still RSVP to a public listing", r.result?.going === true);
  r = await call("friendsGoing", { eventIds: [socialEventId] }, quinn.idToken);
  ok("friendsGoing: the blocked side never sees the blocker's RSVP (Quinn sees only Sarah)",
     r.result?.events?.[socialEventId]?.count === 1 && r.result.events[socialEventId].friends.every((f) => f.uid !== blocker.uid), JSON.stringify(r.result));

  // ── Invites ──
  r = await call("inviteToEvent", { eventId: socialEventId, toUids: [quinn.uid, stranger.uid], message: "Come with me!" }, sarah.idToken);
  ok("invite: delivered to a friend, skipped for a non-friend",
     r.result?.delivered?.includes(quinn.uid) && r.result?.skipped?.includes(stranger.uid), JSON.stringify(r.result));
  const invId = `${socialEventId}_${sarah.uid}`;
  const inv = (await db.doc(`users/${quinn.uid}/invites/${invId}`).get()).data();
  ok("invite: durable invite row is pending with the sender and message", inv?.status === "pending" && inv?.fromUid === sarah.uid && inv?.message === "Come with me!", JSON.stringify(inv));
  const invNotif = await db.collection(`users/${quinn.uid}/notifications`).where("kind", "==", "invite").get();
  ok("invite: recipient is notified with the inviteId to act on", invNotif.size === 1 && invNotif.docs[0].data().inviteId === invId, JSON.stringify(invNotif.docs.map((d) => d.data())));
  try { acode = (await getDoc(doc(quinn.fdb, `users/${quinn.uid}/invites/${invId}`))).exists() ? "ok" : "missing"; } catch (e) { acode = e.code; }
  ok("rules: recipient can read their invite", acode === "ok", `got ${acode}`);
  try { await getDoc(doc(stranger.fdb, `users/${quinn.uid}/invites/${invId}`)); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: others cannot read someone's invites", acode === "permission-denied", `got ${acode}`);
  try { await setDoc(doc(stranger.fdb, `users/${quinn.uid}/invites/forged`), { eventId: socialEventId, fromUid: stranger.uid, status: "pending" }); acode = "ok"; } catch (e) { acode = e.code; }
  ok("rules: a client cannot forge an invite", acode === "permission-denied", `got ${acode}`);
  r = await call("inviteToEvent", { eventId: socialEventId, toUids: [quinn.uid] }, sarah.idToken);
  ok("invite: the same invite is not sent twice", r.result?.skipped?.includes(quinn.uid) && !r.result?.delivered?.length);
  // Round-trip: Quinn RSVPs from the invite → invite accepted, Sarah told.
  r = await call("rsvpToEvent", { eventId: socialEventId, going: true }, quinn.idToken);
  ok("invite → rsvp: recipient RSVPs", r.result?.going === true);
  ok("invite → rsvp: invite flips to accepted", (await db.doc(`users/${quinn.uid}/invites/${invId}`).get()).data()?.status === "accepted");
  const accepted = await db.collection(`users/${sarah.uid}/notifications`).where("kind", "==", "invite-accepted").get();
  ok("invite → rsvp: the inviter is told their friend is going", accepted.size === 1 && accepted.docs[0].data().actorUid === quinn.uid);
  // Declining.
  r = await call("inviteToEvent", { eventId: socialEventId, toUids: [sarah.uid] }, quinn.idToken);
  r = await call("respondToInvite", { inviteId: `${socialEventId}_${quinn.uid}` }, sarah.idToken);
  ok("invite: recipient can decline", r.result?.status === "declined" && (await db.doc(`users/${sarah.uid}/invites/${socialEventId}_${quinn.uid}`).get()).data()?.status === "declined");

  // ── Notifications rules ──
  const nDoc = qNotifs.docs[0].ref.path;
  let ncode = await (async () => { try { await updateDoc(doc(quinn.fdb, nDoc), { read: true }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: owner can mark a notification read", ncode === "ok", `got ${ncode}`);
  ncode = await (async () => { try { await updateDoc(doc(quinn.fdb, nDoc), { title: "spoofed" }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: owner cannot rewrite a notification's content", ncode === "permission-denied", `got ${ncode}`);
  try { await getDoc(doc(stranger.fdb, nDoc)); ncode = "ok"; } catch (e) { ncode = e.code; }
  ok("rules: others cannot read your notifications", ncode === "permission-denied", `got ${ncode}`);

  // ── Un-RSVP + unavailable events ──
  r = await call("rsvpToEvent", { eventId: socialEventId, going: false }, quinn.idToken);
  ok("rsvp: un-going removes the record and decrements the count",
     r.result?.going === false && r.result?.changed === true && !(await db.doc(`events/${socialEventId}/attendees/${quinn.uid}`).get()).exists
     && !((await db.doc(`users/${quinn.uid}`).get()).data()?.rsvpEventIDs ?? []).includes(socialEventId), JSON.stringify(r));
  await db.doc(`events/${socialEventId}`).set({ active: false }, { merge: true });
  r = await call("rsvpToEvent", { eventId: socialEventId, going: true }, stranger.idToken);
  ok("rsvp: an inactive (cancelled) event cannot be RSVP'd", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));
  await db.doc(`events/${socialEventId}`).set({ active: true }, { merge: true });
  r = await call("rsvpToEvent", { eventId: "does-not-exist" }, stranger.idToken);
  ok("rsvp: unknown event → not found", r.error?.status === "NOT_FOUND");
  r = await call("rsvpToEvent", { eventId: { toString: "x" } }, stranger.idToken);
  ok("rsvp: hostile input is rejected, not crashed", r.error?.status === "INVALID_ARGUMENT", JSON.stringify(r));

  r = await call("removeFriend", { peerUid: sarah.uid }, quinn.idToken);
  ok("friends: either participant can remove both edges", r.result?.removed === true &&
     !(await db.doc(`users/${quinn.uid}/friends/${sarah.uid}`).get()).exists &&
     !(await db.doc(`users/${sarah.uid}/friends/${quinn.uid}`).get()).exists);

  // ────────────────────────────────────────────────────────────────────────
  // ORGANIZER ACCOUNTS (Part 2 §5)
  //
  // Unverified organizers may create, not broadcast. Approval is a staff action
  // enforced server-side; the rules make an unverified organizer's events
  // invisible to anyone who doesn't follow them; organizer content is
  // reportable and moderatable like anything else.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Organizer accounts ──");

  const orgOwner = await mk("orgowner");
  const fan = await mk("fan");
  const nonfan = await mk("nonfan");

  r = await call("createEvent", { title: "Pickup Soccer", locationName: "Edgewater Park", startMs: Date.now() + 3 * 86_400_000, category: "Sports" }, orgOwner.idToken);
  ok("organizer: publishing without a profile is refused", r.error?.status === "FAILED_PRECONDITION", JSON.stringify(r));

  r = await call("createOrganizer", { displayName: "Lakefront Rec League", category: "rec-league", description: "Weekly pickup sports on the lakefront.", website: "https://example.org" }, orgOwner.idToken);
  const organizerId = r.result?.organizerId;
  ok("organizer: profile created as PENDING", !!organizerId && r.result?.status === "pending" && r.result?.alreadyExists === false, JSON.stringify(r));
  r = await call("createOrganizer", { displayName: "Dup", category: "other" }, orgOwner.idToken);
  ok("organizer: one profile per account (second call returns the existing one)", r.result?.organizerId === organizerId && r.result?.alreadyExists === true);
  const orgDoc = (await db.doc(`organizers/${organizerId}`).get()).data();
  ok("organizer: record shaped for a future merchant (kind + billing null), owned by the applicant",
     orgDoc?.ownerUid === orgOwner.uid && orgDoc?.kind === "organizer" && orgDoc?.billing === null && orgDoc?.status === "pending");
  ok("organizer: owner's user doc points at the profile", (await db.doc(`users/${orgOwner.uid}`).get()).data()?.organizerId === organizerId);

  // Rules on the organizer record.
  let ocode = await (async () => { try { await updateDoc(doc(orgOwner.fdb, `organizers/${organizerId}`), { status: "approved" }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: owner cannot approve themselves", ocode === "permission-denied", `got ${ocode}`);
  ocode = await (async () => { try { await updateDoc(doc(orgOwner.fdb, `organizers/${organizerId}`), { description: "Updated blurb", updatedAt: serverTimestamp() }); return "ok"; } catch (e) { return e.code; } })();
  ok("rules: owner CAN edit their description", ocode === "ok", `got ${ocode}`);
  try { await getDoc(doc(nonfan.fdb, `organizers/${organizerId}`)); ocode = "ok"; } catch (e) { ocode = e.code; }
  ok("rules: a pending organizer is not readable by the public", ocode === "permission-denied", `got ${ocode}`);
  try { await setDoc(doc(nonfan.fdb, `organizers/forged`), { ownerUid: nonfan.uid, displayName: "Forged", status: "approved" }); ocode = "ok"; } catch (e) { ocode = e.code; }
  ok("rules: a client cannot create an organizer record directly", ocode === "permission-denied", `got ${ocode}`);

  // Unverified organizer publishes: visible to followers only.
  r = await call("createEvent", { title: "Pickup Soccer", description: "All levels.", locationName: "Edgewater Park", time: "6:00 PM",
    startMs: Date.now() + 3 * 86_400_000, category: "Sports", latitude: 37.3230, longitude: -121.9200,
    expectedSize: 24, indoorOutdoor: "outdoor", ageSuitability: "all", minimumAge: 13,
    accessibilityFeatures: ["stepFree", "seating"], publicVenue: true, recurring: true }, orgOwner.idToken);
  const orgEventId = r.result?.eventId;
  ok("organizer: pending organizer CAN create — but not broadcast", !!orgEventId && r.result?.broadcast === false && r.result?.organizerStatus === "pending", JSON.stringify(r));
  const orgEv = (await db.doc(`events/${orgEventId}`).get()).data();
  ok("organizer: event carries organizer provenance, area, honest flags",
     orgEv?.source === "organizer" && orgEv?.organizerId === organizerId && orgEv?.organizerOwnerUid === orgOwner.uid
     && orgEv?.areaId === "san-jose-ca" && orgEv?.active === true && orgEv?.hidden === false && orgEv?.broadcast === false && orgEv?.pointValue === 150,
     JSON.stringify(orgEv && { s: orgEv.source, o: orgEv.organizerId, a: orgEv.areaId, b: orgEv.broadcast, p: orgEv.pointValue }));
  ok("organizer: practical event details survive publication",
     orgEv?.expectedSize === 24 && orgEv?.indoorOutdoor === "outdoor" &&
     orgEv?.ageSuitability === "all" && orgEv?.minimumAge === 13 &&
     orgEv?.publicVenue === true && orgEv?.recurring === true &&
     orgEv?.accessibilityFeatures?.includes("stepFree"));

  // These accounts have no recorded age band, so every list carries the adultOnly filter the app adds (W2).
  const publicIds = (await getDocs(query(collection(nonfan.fdb, "events"),
    where("hidden", "==", false), where("active", "==", true), where("broadcast", "==", true), where("adultOnly", "==", false), where("date", ">=", new Date())))).docs.map((d) => d.id);
  ok("visibility: an unverified organizer's event is NOT in the public feed", !publicIds.includes(orgEventId));
  const orgQuery = (fdb) => query(collection(fdb, "events"), where("hidden", "==", false), where("active", "==", true), where("organizerId", "==", organizerId), where("adultOnly", "==", false));
  try { await getDocs(orgQuery(nonfan.fdb)); ocode = "ok"; } catch (e) { ocode = e.code; }
  ok("visibility: a non-follower cannot read the organizer's calendar", ocode === "permission-denied", `got ${ocode}`);

  r = await call("followUser", { targetId: organizerId, kind: "organizer" }, fan.idToken);
  ok("organizer: a member can follow an organizer", r.result?.following === true, JSON.stringify(r));
  ok("organizer: organizer followerCount maintained", (await db.doc(`organizers/${organizerId}`).get()).data()?.followerCount === 1);
  let fanIds = [];
  try { fanIds = (await getDocs(orgQuery(fan.fdb))).docs.map((d) => d.id); } catch (e) { fanIds = [`ERR:${e.code}`]; }
  ok("visibility: a FOLLOWER can read the unverified organizer's events", fanIds.includes(orgEventId), JSON.stringify(fanIds));
  try { ocode = (await getDoc(doc(fan.fdb, `organizers/${organizerId}`))).exists() ? "ok" : "missing"; } catch (e) { ocode = e.code; }
  ok("rules: a follower can read the pending organizer's profile", ocode === "ok", `got ${ocode}`);
  let ownIds = [];
  try { ownIds = (await getDocs(query(collection(orgOwner.fdb, "events"), where("hidden", "==", false), where("creatorID", "==", orgOwner.uid)))).docs.map((d) => d.id); } catch (e) { ownIds = [`ERR:${e.code}`]; }
  ok("visibility: the organizer sees their own unbroadcast events", ownIds.includes(orgEventId), JSON.stringify(ownIds));
  const orgAct = await db.collection("activity").where("organizerId", "==", organizerId).get();
  ok("organizer: publishing writes an activity row for followers' feeds", orgAct.size === 1 && orgAct.docs[0].data().kind === "organizer-event");

  // Approval is staff-only and mirrors onto the events.
  r = await call("approveOrganizer", { organizerId, action: "approve", reason: "Backend E2E fixture decision" }, orgOwner.idToken);
  ok("organizer: a non-staff user cannot approve", r.error?.status === "PERMISSION_DENIED");
  r = await call("approveOrganizer", { organizerId, action: "approve", reason: "Backend E2E fixture decision" }, staff.idToken);
  ok("organizer: staff approval flips status and every owned event to broadcast",
     r.result?.status === "approved" && r.result?.eventsUpdated === 1
     && (await db.doc(`events/${orgEventId}`).get()).data()?.broadcast === true
     && (await db.doc(`organizers/${organizerId}`).get()).data()?.status === "approved", JSON.stringify(r));
  const publicAfter = (await getDocs(query(collection(nonfan.fdb, "events"),
    where("hidden", "==", false), where("active", "==", true), where("broadcast", "==", true), where("adultOnly", "==", false), where("date", ">=", new Date())))).docs.map((d) => d.id);
  ok("visibility: after approval the event is in the public feed", publicAfter.includes(orgEventId));
  try { ocode = (await getDoc(doc(nonfan.fdb, `organizers/${organizerId}`))).exists() ? "ok" : "missing"; } catch (e) { ocode = e.code; }
  ok("rules: an approved organizer's profile is publicly readable", ocode === "ok", `got ${ocode}`);
  r = await call("createEvent", { title: "Sunset Volleyball", locationName: "Edgewater Beach", startMs: Date.now() + 4 * 86_400_000, category: "Sports" }, orgOwner.idToken);
  ok("organizer: an approved organizer's new events broadcast immediately", r.result?.broadcast === true);
  const approvedEventId = r.result?.eventId;
  r = await call("recordEventFeedback", { eventId: approvedEventId, kind: "more" }, nonfan.idToken);
  ok("ranking: explicit event feedback persists on the server",
     r.result?.recorded === true &&
     (await db.doc(`users/${nonfan.uid}`).get()).data()?.eventFeedback?.[approvedEventId]?.kind === "more");
  r = await call("recordEventFeedback", { eventId: approvedEventId, kind: "view" }, nonfan.idToken);
  ok("ranking: a later view cannot overwrite an explicit preference",
     r.result?.recorded === true &&
     (await db.doc(`users/${nonfan.uid}`).get()).data()?.eventFeedback?.[approvedEventId]?.kind === "more");
  try { await updateDoc(doc(nonfan.fdb, `users/${nonfan.uid}`), { eventFeedback: {} }); ocode = "ok"; }
  catch (e) { ocode = e.code; }
  ok("rules: client cannot erase server-owned ranking feedback", ocode === "permission-denied", `got ${ocode}`);

  // Suspension pulls everything back.
  r = await call("approveOrganizer", { organizerId, action: "suspend", reason: "Backend E2E fixture decision" }, staff.idToken);
  ok("organizer: suspension flips every event back to follower-only",
     r.result?.eventsUpdated === 2 && (await db.doc(`events/${approvedEventId}`).get()).data()?.broadcast === false);
  r = await call("createEvent", { title: "Nope", locationName: "X", startMs: Date.now() + 86_400_000 }, orgOwner.idToken);
  ok("organizer: a suspended organizer cannot publish", r.error?.status === "PERMISSION_DENIED");
  await call("approveOrganizer", { organizerId, action: "reinstate", reason: "Backend E2E fixture decision" }, staff.idToken);

  // The manual window counts distinct manual approvals, including past approvals.
  const approvalCounterBefore = (await db.doc("staffCounters/manualOrganizerApprovals").get()).data();
  await db.doc("staffCounters/manualOrganizerApprovals").set({ used: 50, limit: 50 });
  for (let i = 0; i < 50; i++) await db.doc(`organizers/e2e-approved-${i}`).set({ ownerUid: `seed-${i}`, displayName: `Org ${i}`, category: "other", status: "approved", hidden: false, createdAt: new Date() });
  await db.doc("organizers/e2e-pending-51").set({ ownerUid: "seed-51", displayName: "Fifty-first", category: "other", status: "pending", hidden: false, createdAt: new Date() });
  r = await call("approveOrganizer", { organizerId: "e2e-pending-51", action: "approve", reason: "Backend E2E fixture decision" }, staff.idToken);
  ok("organizer: the 51st approval is refused (manual window is 50)", r.error?.status === "RESOURCE_EXHAUSTED", JSON.stringify(r.error));
  for (let i = 0; i < 50; i++) await db.doc(`organizers/e2e-approved-${i}`).delete();
  await db.doc("staffCounters/manualOrganizerApprovals").set(approvalCounterBefore);

  // Verification exempts nothing: organizer events + profiles are moderatable.
  r = await call("reportContent", { targetType: "event", targetId: orgEventId, reason: "spam" }, nonfan.idToken);
  ok("moderation: an organizer's event can be reported", r.result?.reported === true);
  r = await call("reportContent", { targetType: "organizer", targetId: organizerId, reason: "impersonation" }, nonfan.idToken);
  ok("moderation: an organizer profile can be reported", r.result?.reported === true);
  r = await call("moderateContent", { queueId: `organizer_${organizerId}`, action: "remove", reason: "Backend E2E fixture decision" }, staff.idToken);
  ok("moderation: staff can remove (hide) an organizer profile", (await db.doc(`organizers/${organizerId}`).get()).data()?.hidden === true);
  r = await call("followUser", { targetId: organizerId, kind: "organizer" }, nonfan.idToken);
  ok("moderation: a hidden organizer cannot gain followers", r.error?.status === "NOT_FOUND");
  r = await call("createEvent", { title: "Nope", locationName: "X", startMs: Date.now() + 86_400_000 }, orgOwner.idToken);
  ok("moderation: a hidden organizer cannot publish", r.error?.status === "PERMISSION_DENIED");
  await call("moderateContent", { queueId: `organizer_${organizerId}`, action: "restore", reason: "Backend E2E fixture decision" }, staff.idToken);

  // Deleting the owner leaves no orphaned organizer events.
  r = await call("deleteAccount", {}, orgOwner.idToken);
  ok("organizer: deleting the owner removes the profile and every event they published",
     r.result?.deleted === true && !(await db.doc(`organizers/${organizerId}`).get()).exists
     && !(await db.doc(`events/${orgEventId}`).get()).exists && !(await db.doc(`events/${approvedEventId}`).get()).exists, JSON.stringify(r));

  // ────────────────────────────────────────────────────────────────────────
  // REWARD ECONOMY (Part 3 §1)
  //
  // 7,000 pts ≈ $1. Cash cards are Verdure+ only, capped at $25 per rolling 12
  // months per member (enforced in the SAME transaction as the debit) and
  // $200/month programme-wide with a kill switch. Partner perks are the primary
  // redemption surface: a code from a pre-loaded pool, no vendor call.
  // ────────────────────────────────────────────────────────────────────────
  console.log("\n── Reward economy ──");

  const thisMonth = new Date().toISOString().slice(0, 7);
  const grantPlus = (u) => db.doc(`users/${u.uid}`).set({ plusExpiresAt: new Date(Date.now() + 30 * 86400_000) }, { merge: true });
  const fund = (u, pts) => db.doc(`users/${u.uid}`).set({ pointsBalance: pts }, { merge: true });

  // ── Verdure+ interest profiles: the entitlement lives on the server. ──
  const profileUser = await mk("profileuser");
  const profileArea = `e2e-profiles-${Date.now()}`;
  for (const [id, category] of [["hack", "Hackathon"], ["clean", "Cleanup"]]) {
    await db.doc(`events/${profileArea}-${id}`).set({ adultOnly: false,
      title: `${category} day`, description: "A public local activity", organizer: "Verdure QA",
      date: new Date(Date.now() + 3 * 86_400_000), time: "10:00 AM", locationName: "San Jose",
      attendeeCount: 0, category, pointValue: 100, creatorID: "system:ingest",
      hidden: false, active: true, broadcast: true, areaId: profileArea,
      qualityScore: 0.8, latitude: 37.3382, longitude: -121.8863,
    });
  }
  const profileShape = (name, interests) => ({ name, interests, radiusMiles: 25,
    categories: [], exclusions: [], distancePreset: "balanced" });
  r = await call("manageInterestProfiles", { action: "save", profile: profileShape("Tech nights", ["tech"]) }, profileUser.idToken);
  ok("profiles: free account cannot create a Plus profile", r.error?.status === "PERMISSION_DENIED");
  await grantPlus(profileUser);
  r = await call("manageInterestProfiles", { action: "save", profile: profileShape("Tech nights", ["tech"]) }, profileUser.idToken);
  const techProfile = r.result?.id;
  r = await call("manageInterestProfiles", { action: "save", profile: profileShape("Trail days", ["volunteering"]) }, profileUser.idToken);
  const trailProfile = r.result?.id;
  ok("profiles: member can create and name two profiles", !!techProfile && !!trailProfile && techProfile !== trailProfile);
  r = await call("recommendedEvents", { areaId: profileArea, lat: 37.3382, lng: -121.8863 }, profileUser.idToken);
  ok("profiles: tech profile ranks the hackathon first", r.result?.events?.[0]?.id === `${profileArea}-hack`, JSON.stringify(r.result?.events?.map((e) => e.id)));
  await call("manageInterestProfiles", { action: "switch", id: trailProfile }, profileUser.idToken);
  r = await call("recommendedEvents", { areaId: profileArea, lat: 37.3382, lng: -121.8863 }, profileUser.idToken);
  ok("profiles: switching changes the ranked first event", r.result?.events?.[0]?.id === `${profileArea}-clean`, JSON.stringify(r.result?.events?.map((e) => e.id)));
  r = await call("manageInterestProfiles", { action: "saveFilter", name: "Free weekends", categories: ["Cleanup"], cost: "free", radiusMiles: 15, dateRange: "weekend" }, profileUser.idToken);
  const filterId = r.result?.id;
  r = await call("manageInterestProfiles", { action: "list" }, profileUser.idToken);
  ok("profiles: saved filter survives a later read", !!filterId && r.result?.savedFilters?.[filterId]?.name === "Free weekends");
  code2 = await userWrite(`users/${profileUser.uid}`, { activeProfileId: techProfile });
  ok("rules: client cannot switch Plus profile without server entitlement check", code2 === "permission-denied", `got ${code2}`);
  await call("manageInterestProfiles", { action: "delete", id: trailProfile }, profileUser.idToken);
  r = await call("manageInterestProfiles", { action: "list" }, profileUser.idToken);
  ok("profiles: deleting active profile falls back to remaining profile", r.result?.activeProfileId === techProfile);

  // The planner may narrate only verified /events IDs. Reuse tests also
  // exercise the session quota and recent-history path without a model key.
  const plannerArea = `e2e-plan-${Date.now()}`;
  for (let i = 0; i < 8; i++) {
    await db.doc(`events/${plannerArea}-${i}`).set({ adultOnly: false,
      title: i % 2 ? `Community cleanup ${i}` : `Tech workshop ${i}`,
      description: "A public local activity", organizer: `Organizer ${i}`,
      date: new Date(Date.now() + (i + 1) * 86_400_000), time: "10:00 AM",
      locationName: `Venue ${i}`, isFree: true, attendeeCount: 0,
      category: i % 2 ? "Cleanup" : "Hackathon", pointValue: 100,
      creatorID: "system:ingest", hidden: false, active: true, broadcast: true,
      areaId: plannerArea, qualityScore: 0.8, latitude: 37.3382, longitude: -121.8863,
    });
  }
  const planInput = { areaId: plannerArea, when: "Any day", who: "Just me",
    distance: "Anywhere nearby", budget: "Free", note: "", lat: 37.3382, lng: -121.8863 };
  const firstPlan = await call("planEvents", planInput, profileUser.idToken);
  const firstIDs = firstPlan.result?.stops?.map((stop) => stop.eventId) ?? [];
  ok("planner: every stop resolves to a real event document",
    firstIDs.length >= 2 && (await Promise.all(firstIDs.map((id) => db.doc(`events/${id}`).get()))).every((doc) => doc.exists));
  const secondPlan = await call("planEvents", planInput, profileUser.idToken);
  const secondIDs = secondPlan.result?.stops?.map((stop) => stop.eventId) ?? [];
  ok("planner: returning user's next plan avoids recent stops",
    secondIDs.length >= 2 && secondIDs.every((id) => !firstIDs.includes(id)), JSON.stringify({ firstIDs, secondIDs }));
  const otherProfileUser = await mk("otherprofile");
  await grantPlus(otherProfileUser);
  await call("manageInterestProfiles", { action: "save", profile: profileShape("Cleanup days", ["volunteering"]) }, otherProfileUser.idToken);
  const otherPlan = await call("planEvents", planInput, otherProfileUser.idToken);
  ok("planner: different interest profiles change the first venue",
    !!firstIDs[0] && !!otherPlan.result?.stops?.[0]?.eventId && firstIDs[0] !== otherPlan.result.stops[0].eventId,
    JSON.stringify({ firstIDs, other: otherPlan.result?.stops }));
  const refined = await call("refineEventPlan", { sessionId: firstPlan.result?.sessionId,
    action: "swap", targetId: firstIDs[0] }, profileUser.idToken);
  ok("planner: swap reuses session without a model call",
    refined.result?.selectedIDs?.[0] !== firstIDs[0] && refined.result?.modelCalls === 0,
    JSON.stringify(refined));
  const stolen = await call("refineEventPlan", { sessionId: firstPlan.result?.sessionId,
    action: "shorter" }, otherProfileUser.idToken);
  ok("planner: another user cannot refine a session", stolen.error?.status === "NOT_FOUND");

  // CAC 2026 (1.2): the Adventure Planner answers with NO model key — the rules engine plans from the candidate allowlist.
  const planCandidates = [
    // Hours are 24/7 so the check holds at whatever hour the suite runs (a sunrise-sunset park is closed after dark, which the engine rightly refuses).
    { id: "osm-1", name: "St. James Park", category: "Parks", latitude: 37.3395, longitude: -121.8900, hours: "24/7" },
    { id: "osm-2", name: "Guadalupe River Trail", category: "Trails", latitude: 37.3360, longitude: -121.8940, hours: "24/7" },
    { id: "osm-3", name: "Plaza de Cesar Chavez", category: "Parks", latitude: 37.3328, longitude: -121.8898, hours: "24/7" },
    { id: "osm-4", name: "Northside Community Center", category: "Community", latitude: 37.3480, longitude: -121.8830, hours: "24/7" },
  ];
  const adventure = await call("planAdventure", { lat: 37.3382, lng: -121.8863, interests: ["Parks", "Community"], timeOfDay: "afternoon", durationMinutes: 120, candidates: planCandidates }, profileUser.idToken);
  const advStops = adventure.result?.stops ?? [];
  ok("adventure planner: a plan comes back with no ANTHROPIC_API_KEY, from the rules engine, with 2–4 stops that are all supplied candidates",
    adventure.result?.engine === "rules" && advStops.length >= 2 && advStops.length <= 4 && advStops.every((st) => planCandidates.some((c) => c.id === st.placeId && c.name === st.name)),
    JSON.stringify(adventure).slice(0, 300));
  ok("adventure planner: stops are numbered from 1, each has minutes and a one-sentence why, and notes is an array",
    advStops.every((st, i) => st.order === i + 1 && st.minutes >= 5 && typeof st.why === "string" && st.why.length > 20) && Array.isArray(adventure.result?.notes));
  ok("adventure planner: weather carries the Open-Meteo attribution when present, or is null (emulator offline) — never invented",
    adventure.result?.weather === null || (typeof adventure.result?.weather?.temperatureF === "number" && adventure.result?.weather?.attribution === "Weather data by Open-Meteo.com"), JSON.stringify(adventure.result?.weather));
  ok("adventure planner: a Verdure+ member sees no quota, the plan is private to the member",
    adventure.result?.isPlus === true && adventure.result?.plansRemaining === null &&
    (await db.collection(`users/${profileUser.uid}/adventurePlans`).get()).size >= 1);
  const tooFew = await call("planAdventure", { lat: 37.3382, lng: -121.8863, interests: [], timeOfDay: "afternoon", durationMinutes: 60, candidates: planCandidates.slice(0, 1) }, profileUser.idToken);
  ok("adventure planner: fewer than two candidates is refused with failed-precondition, not a crash", tooFew.error?.status === "FAILED_PRECONDITION", JSON.stringify(tooFew.error));
  const memberOnly = await call("planAdventure", { lat: 37.3382, lng: -121.8863, interests: ["Community"], timeOfDay: "afternoon", durationMinutes: 60,
    candidates: [...planCandidates, { id: "osm-9", name: "Masonic Lodge Hall", category: "Community", latitude: 37.3390, longitude: -121.8870, hours: "24/7" }] }, profileUser.idToken);
  ok("adventure planner: a member-only organisation is never a stop", !(memberOnly.result?.stops ?? []).some((st) => st.placeId === "osm-9"), JSON.stringify(memberOnly.result?.stops?.map((st) => st.name)));
  code2 = await userWrite(`users/${profileUser.uid}`, { recentPlanEventIDs: [] });
  ok("rules: client cannot erase planner repeat memory", code2 === "permission-denied", `got ${code2}`);

  const telemetryFeed = await call("recommendedEvents", { areaId: plannerArea, lat: 37.3382, lng: -121.8863, telemetryEnabled: true }, profileUser.idToken);
  const optedOutFeed = await call("recommendedEvents", { areaId: plannerArea, lat: 37.3382, lng: -121.8863, telemetryEnabled: false }, profileUser.idToken);
  ok("telemetry: an opted-out feed creates no account-linked session", optedOutFeed.result?.feedSessionId === null);
  const feedSessionId = telemetryFeed.result?.feedSessionId;
  const firstFeedEvent = telemetryFeed.result?.events?.[0]?.id;
  r = await call("recordFeedEvent", { sessionId: feedSessionId, eventId: firstFeedEvent, action: "impression" }, profileUser.idToken);
  ok("telemetry: visible card records an ignored impression", r.result?.outcome === "ignored");
  r = await call("recordFeedEvent", { sessionId: feedSessionId, eventId: firstFeedEvent, action: "tap" }, profileUser.idToken);
  const impression = (await db.doc(`feedImpressions/${profileUser.uid}_${feedSessionId}_${firstFeedEvent}`).get()).data();
  ok("telemetry: tap keeps server score, position and signal parts",
    r.result?.outcome === "tap" && impression?.position === 0 && typeof impression?.score === "number" &&
    typeof impression?.parts?.interest === "number");
  r = await call("recordFeedEvent", { sessionId: feedSessionId, eventId: "invented-event", action: "impression" }, profileUser.idToken);
  ok("telemetry: cannot fabricate an event outside the ranked slate", r.error?.status === "PERMISSION_DENIED");
  r = await call("recordFeedEvent", { sessionId: feedSessionId, eventId: firstFeedEvent, action: "tap" }, otherProfileUser.idToken);
  ok("telemetry: another member cannot write an impression", r.error?.status === "NOT_FOUND");

  const group = await call("manageGroupPlan", { action: "create", sessionId: firstPlan.result?.sessionId }, profileUser.idToken);
  const groupId = group.result?.plan?.id;
  ok("group: a verified planner session becomes a private group plan", !!groupId && group.result?.plan?.eventIDs?.length >= 2);
  r = await call("manageGroupPlan", { action: "invite", planId: groupId, peerUid: otherProfileUser.uid }, profileUser.idToken);
  ok("group: cannot invite a non-friend", r.error?.status === "PERMISSION_DENIED");
  const adultBirthYear = new Date().getUTCFullYear() - 25;
  await call("registerAgeBand", { birthYear: adultBirthYear }, profileUser.idToken);
  await call("registerAgeBand", { birthYear: adultBirthYear }, otherProfileUser.idToken);
  await call("sendFriendRequest", { targetUid: otherProfileUser.uid }, profileUser.idToken);
  await call("respondToFriendRequest", { fromUid: profileUser.uid, accept: true }, otherProfileUser.idToken);
  r = await call("manageGroupPlan", { action: "invite", planId: groupId, peerUid: otherProfileUser.uid }, profileUser.idToken);
  ok("group: accepted friend gets a private invitation", r.result?.plan?.pendingCount === 1);
  r = await call("manageGroupPlan", { action: "list" }, otherProfileUser.idToken);
  ok("group: invitee sees pending group plan", r.result?.plans?.some((plan) => plan.id === groupId && plan.invitation));
  r = await call("manageGroupPlan", { action: "respond", planId: groupId, accept: true }, otherProfileUser.idToken);
  ok("group: invitee explicitly joins", r.result?.plan?.memberCount === 2 && !r.result?.plan?.invitation);
  const groupEventId = group.result?.plan?.eventIDs?.[0];
  r = await call("manageGroupPlan", { action: "vote", planId: groupId, eventId: groupEventId }, otherProfileUser.idToken);
  ok("group: member can shortlist a verified candidate", r.result?.plan?.votes?.[groupEventId] === 1);
  r = await call("manageGroupPlan", { action: "add", planId: groupId, eventId: "invented-event" }, otherProfileUser.idToken);
  ok("group: cannot add a nonexistent event", r.error?.status === "NOT_FOUND");
  code2 = await userWrite(`groupPlans/${groupId}`, { eventIDs: ["invented-event"] });
  ok("rules: direct group-plan writes are denied", code2 === "permission-denied", `got ${code2}`);
  await call("removeFriend", { peerUid: otherProfileUser.uid }, profileUser.idToken);
  r = await call("manageGroupPlan", { action: "get", planId: groupId }, otherProfileUser.idToken);
  ok("group: former friend loses access immediately", r.error?.status === "NOT_FOUND");

  // Catalog as the app sees it — eligibility decided server-side.
  const freeMember = await mk("freemember");
  await fund(freeMember, 2000);
  r = await call("listRewardsCatalog", {}, freeMember.idToken);
  ok("catalog: free member sees cash as NOT eligible, 7,000 pts per $, $25 ceiling",
     r.result?.cashEligible === false && r.result?.pointsPerDollar === 7000 && r.result?.rollingCeilingUsd === 25
     && r.result?.cash?.find((c) => c.id === "starbucks-5")?.cost === 35000
     && r.result?.cash?.find((c) => c.id === "amazon-25")?.active === false, JSON.stringify(r.result).slice(0, 300));

  // ── Rolling 12-month ceiling ──
  const spender = await mk("spender");
  await grantPlus(spender); await fund(spender, 500000);
  for (const id of ["starbucks-5", "dunkin-5", "amazon-10"]) {          // $5 + $5 + $10 = $20
    r = await call("redeemReward", { rewardId: id }, spender.idToken);
    ok(`ceiling: ${id} redeems ($${r.result?.rollingSpentUsd ?? "?"} of $25 used)`, r.result?.redeemed === true, JSON.stringify(r));
  }
  r = await call("redeemReward", { rewardId: "target-10" }, spender.idToken);
  ok("ceiling: the redemption that would cross $25 is refused with the release date",
     r.error?.status === "FAILED_PRECONDITION" && /\$25/.test(r.error?.message ?? "") && /frees up on \d{4}-\d{2}-\d{2}/.test(r.error?.message ?? ""),
     JSON.stringify(r.error));
  const spenderDoc = (await db.doc(`users/${spender.uid}`).get()).data();
  ok("ceiling: the ledger on the user doc holds exactly the live entries",
     spenderDoc?.redemptionBudget?.entries?.length === 3 && spenderDoc?.pointsBalance === 500000 - 140000, JSON.stringify(spenderDoc?.redemptionBudget));
  code2 = await userWrite(`users/${spender.uid}`, { redemptionBudget: { entries: [] } });
  ok("rules: a client cannot reset its own rolling ledger", code2 === "permission-denied", `got ${code2}`);

  // Concurrency: three $10 cards fired at once against a fresh $25 ceiling — exactly two may land.
  const racer = await mk("racer");
  await grantPlus(racer); await fund(racer, 500000);
  const results = await Promise.all(["amazon-10", "target-10", "chipotle-10"].map((id) => call("redeemReward", { rewardId: id }, racer.idToken)));
  const landed = results.filter((x) => x.result?.redeemed === true).length;
  const refused = results.filter((x) => x.error?.status === "FAILED_PRECONDITION").length;
  ok("ceiling: concurrent redemptions cannot both slip under the ceiling (2 of 3 land, 1 refused)",
     landed === 2 && refused === 1, JSON.stringify(results.map((x) => x.result?.redeemed ?? x.error?.status)));
  const racerDoc = (await db.doc(`users/${racer.uid}`).get()).data();
  ok("ceiling: after the race the ledger shows $20, never $30", racerDoc?.redemptionBudget?.entries?.reduce((a, e) => a + e.usd, 0) === 20);

  // ── Global monthly treasury cap + kill switch ──
  const tBefore = (await db.doc(`treasury/${thisMonth}`).get()).data() ?? {};
  await db.doc(`treasury/${thisMonth}`).set({ dollarsCommitted: 195, killSwitch: false }, { merge: true });
  const capUser = await mk("capuser");
  await grantPlus(capUser); await fund(capUser, 500000);
  r = await call("redeemReward", { rewardId: "starbucks-5" }, capUser.idToken);
  ok("treasury: a $5 card that lands exactly on $200 is allowed", r.result?.redeemed === true, JSON.stringify(r));
  r = await call("redeemReward", { rewardId: "dunkin-5" }, capUser.idToken);
  ok("treasury: the card that would exceed $200/month is refused with an honest message",
     r.error?.status === "UNAVAILABLE" && /paused/i.test(r.error?.message ?? "") && /points are safe/i.test(r.error?.message ?? ""), JSON.stringify(r.error));
  ok("treasury: the kill switch is now ON", (await db.doc(`treasury/${thisMonth}`).get()).data()?.killSwitch === true);
  r = await call("redeemReward", { rewardId: "starbucks-5" }, racer.idToken);
  ok("treasury: with the kill switch on, every member's cash redemption halts cleanly", r.error?.status === "UNAVAILABLE");
  r = await call("listRewardsCatalog", {}, racer.idToken);
  ok("catalog: reports treasuryPaused so the app can say so", r.result?.treasuryPaused === true);
  r = await call("resetTreasuryKillSwitch", { month: thisMonth }, racer.idToken);
  ok("treasury: only staff can lift the kill switch", r.error?.status === "PERMISSION_DENIED");
  r = await call("resetTreasuryKillSwitch", { month: thisMonth }, staff.idToken);
  ok("treasury: staff can lift it after review", r.result?.killSwitch === false);
  // Restore the month's committed total so later runs aren't capped by this test.
  await db.doc(`treasury/${thisMonth}`).set({ dollarsCommitted: (Number(tBefore.dollarsCommitted) || 0) + 45, killSwitch: false }, { merge: true });

  // ── Telemetry + reconciliation against /fulfillments for a simulated month ──
  const simMonth = "2026-01";
  const seedF = (id, status, usd, extra = {}) => db.doc(`fulfillments/${id}`).set({
    uid: "sim", rewardId: usd === 5 ? "starbucks-5" : "amazon-10", pointsSpent: usd * 7000, usd, status, month: simMonth,
    requestedAt: new Date("2026-01-10T12:00:00Z"), deliverToEmail: "sim@verdure.test", ...extra });
  await seedF("sim-1", "sent", 5); await seedF("sim-2", "sent", 10); await seedF("sim-3", "pending", 5); await seedF("sim-4", "failed", 10);
  await db.doc(`treasury/${simMonth}`).set({ dollarsFulfilled: 15, dollarsCommitted: 20, pointsIssued: 90000, pointsBurned: 140000, earnersCount: 12, plannerCostUsd: 0.6 });
  r = await call("reconcileTreasury", { month: simMonth }, staff.idToken);
  ok("treasury: reconciles fulfilled ($15) and committed ($20) against /fulfillments",
     r.result?.reconciled === true && r.result?.fulfillments?.sentUsd === 15 && r.result?.fulfillments?.committedUsd === 20, JSON.stringify(r.result?.fulfillments));
  ok("treasury: cost per active user is derived ((15 + 0.6) / 12)", r.result?.costPerActiveUser === 1.3);
  await db.doc(`treasury/${simMonth}`).set({ dollarsFulfilled: 99 }, { merge: true });
  r = await call("reconcileTreasury", { month: simMonth }, staff.idToken);
  ok("treasury: drift is reported, never silent", r.result?.reconciled === false);
  const live = (await db.doc(`treasury/${thisMonth}`).get()).data();
  ok("treasury: this month's counters carry points issued / burned / cash redemptions / earners",
     (live?.pointsIssued ?? 0) > 0 && (live?.pointsBurned ?? 0) >= 140000 && (live?.cashRedemptions ?? 0) >= 6 && (live?.earnersCount ?? 0) >= 1,
     JSON.stringify({ issued: live?.pointsIssued, burned: live?.pointsBurned, cash: live?.cashRedemptions, earners: live?.earnersCount }));

  // ── Partner perks (primary redemption surface) ──
  let pcode;
  r = await call("seedPartnerPerks", {}, freeMember.idToken);
  ok("perks: seeding is staff-only", r.error?.status === "PERMISSION_DENIED");
  r = await call("seedPartnerPerks", {}, staff.idToken);
  ok("perks: placeholder perks seeded with code pools", r.result?.added === 3, JSON.stringify(r));
  r = await call("listRewardsCatalog", {}, freeMember.idToken);
  const coffee = r.result?.perks?.find((p) => p.id === "placeholder-coffee-20");
  ok("catalog: a free member sees perks first-class with cost, codes left and redeemable", coffee?.pointCost === 500 && coffee?.redeemable === true && coffee?.codesLeft === 5, JSON.stringify(coffee));
  r = await call("redeemReward", { rewardId: "placeholder-coffee-20" }, freeMember.idToken);
  ok("perks: a FREE member redeems a perk and receives a code — no Tremendous, no dollars",
     r.result?.redeemed === true && r.result?.kind === "perk" && /^PLACEHOL-\d{3}$/.test(r.result?.code ?? "") && r.result?.remaining === 1500, JSON.stringify(r.result));
  ok("perks: no fulfilment row is created for a perk", !(await db.doc(`fulfillments/${freeMember.uid}_placeholder-coffee-20`).get()).exists);
  const myCode = (await db.doc(`users/${freeMember.uid}/perkCodes/placeholder-coffee-20`).get()).data();
  ok("perks: the member's copy of the code is stored under their profile", myCode?.code === r.result?.code && myCode?.partner === "Placeholder Coffee Co.");
  const perkDoc = (await db.doc("partnerPerks/placeholder-coffee-20").get()).data();
  ok("perks: pool decremented and redemption counted", perkDoc?.codePoolCount === 4 && perkDoc?.redeemedCount === 1);
  r = await call("redeemReward", { rewardId: "placeholder-coffee-20" }, freeMember.idToken);
  ok("perks: one redemption per member per perk", r.error?.status === "ALREADY_EXISTS");
  try { pcode = (await getDoc(doc(freeMember.fdb, `users/${freeMember.uid}/perkCodes/placeholder-coffee-20`))).exists() ? "ok" : "missing"; } catch (e) { pcode = e.code; }
  ok("rules: the member can read their own perk code", pcode === "ok", `got ${pcode}`);
  try { await getDoc(doc(spender.fdb, `users/${freeMember.uid}/perkCodes/placeholder-coffee-20`)); pcode = "ok"; } catch (e) { pcode = e.code; }
  ok("rules: nobody else can read it", pcode === "permission-denied", `got ${pcode}`);
  try { await getDocs(collection(freeMember.fdb, "partnerPerks")); pcode = "ok"; } catch (e) { pcode = e.code; }
  ok("rules: the perk catalog is not directly readable (served by listRewardsCatalog)", pcode === "permission-denied", `got ${pcode}`);
  try { await getDocs(collection(freeMember.fdb, "partnerPerks/placeholder-coffee-20/codes")); pcode = "ok"; } catch (e) { pcode = e.code; }
  ok("rules: the code pool is never readable", pcode === "permission-denied", `got ${pcode}`);
  ok("treasury: perksRedeemed counted", ((await db.doc(`treasury/${thisMonth}`).get()).data()?.perksRedeemed ?? 0) >= 1);

  // earlyAccessUntil: Verdure+ only until the timestamp, everyone after.
  r = await call("upsertPartnerPerk", { perkId: "early-bird-brunch", title: "Free brunch side", partnerId: "placeholder-coffee-20-partner", kind: "free-item",
    terms: "Local fictional fixture only", expiresAtMs: Date.now() + 30 * 86400000, reason: "Create fictional E2E early-access perk",
    pointCost: 600, codes: ["EB-001", "EB-002", "EB-003"], earlyAccessUntilMs: Date.now() + 86_400_000 }, staff.idToken);
  ok("perks: staff can load a perk with a code pool and an early-access window", r.result?.codesAdded === 3, JSON.stringify(r));
  r = await call("listRewardsCatalog", {}, freeMember.idToken);
  const early = r.result?.perks?.find((p) => p.id === "early-bird-brunch");
  ok("early access: a free member sees the perk as Plus-only-until-opens and not redeemable", early?.plusOnlyUntilOpens === true && early?.redeemable === false, JSON.stringify(early));
  r = await call("redeemReward", { rewardId: "early-bird-brunch" }, freeMember.idToken);
  ok("early access: a free member is refused before the timestamp", r.error?.status === "PERMISSION_DENIED", JSON.stringify(r.error));
  await fund(spender, 5000);
  r = await call("redeemReward", { rewardId: "early-bird-brunch" }, spender.idToken);
  ok("early access: a Verdure+ member redeems it during the window", r.result?.redeemed === true && r.result?.code === "EB-001", JSON.stringify(r.result));
  await db.doc("partnerPerks/early-bird-brunch").set({ earlyAccessUntil: new Date(Date.now() - 1000) }, { merge: true });
  r = await call("listRewardsCatalog", {}, freeMember.idToken);
  ok("early access: after the timestamp the same perk is visible and redeemable to a free member",
     r.result?.perks?.find((p) => p.id === "early-bird-brunch")?.redeemable === true);
  r = await call("redeemReward", { rewardId: "early-bird-brunch" }, freeMember.idToken);
  ok("early access: and the free member can redeem it", r.result?.redeemed === true && r.result?.code === "EB-002", JSON.stringify(r.result));
  // Pool exhaustion is an honest error, not a silent debit.
  const last = await mk("lastcode");
  await fund(last, 5000);
  r = await call("redeemReward", { rewardId: "early-bird-brunch" }, last.idToken);
  ok("perks: the last code goes out", r.result?.code === "EB-003");
  const nobody = await mk("nocode");
  await fund(nobody, 5000);
  r = await call("redeemReward", { rewardId: "early-bird-brunch" }, nobody.idToken);
  ok("perks: an empty pool refuses without debiting points",
     r.error?.status === "RESOURCE_EXHAUSTED" && (await db.doc(`users/${nobody.uid}`).get()).data()?.pointsBalance === 5000, JSON.stringify(r.error));

  console.log(`\n══ ${passed} passed, ${failed} failed ══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("E2E crashed:", e); process.exit(1); });
