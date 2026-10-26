// Focused A1–A4 emulator proof. Never reads/writes a production database.
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initializeApp as initializeClient } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore as clientFirestore, connectFirestoreEmulator, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host ?? "", /^(127\.0\.0\.1|localhost):8899$/, "Local emulator required");
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const projectId = "connectify-19dd8";
initializeApp({ projectId });
const db = getFirestore();
const suffix = Date.now().toString(36);
const email = `sprint-partners-${suffix}@example.test`, password = "local-fixture-password";
const signup = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
const account = await signup.json();
assert.ok(account.idToken, JSON.stringify(account));
const uid = account.localId;
await db.doc(`users/${uid}`).set({ areaId: "san-jose-ca", interests: ["learning"], pointsBalance: 0 });
async function call(name, data) {
  const res = await fetch(`http://127.0.0.1:5002/${projectId}/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${account.idToken}` }, body: JSON.stringify({ data }) });
  return res.json();
}
let passed = 0;
const check = (name, actual) => { assert.ok(actual, name); passed++; console.log(`PASS ${name}`); };
const origin = { lat: 37.3382, lng: -121.8863 };
const partnerId = `sprint-fixture-${suffix}`, perkId = `${partnerId}-perk`;
// Entirely fictional business with an explicitly recorded fixture agreement.
await db.doc(`partners/${partnerId}`).set({ name: "Fictional Sprint Test Shop", category: "retail", active: true,
  latitude: origin.lat + 0.001, longitude: origin.lng,
  agreement: { agreedBy: "Fictional fixture owner", agreedAt: Timestamp.now(), reference: "sprint-partners-e2e fixture; no real business" } });
await db.doc(`partnerPerks/${perkId}`).set({ partnerId, partner: "Fictional Sprint Test Shop", title: "Fixture discount",
  description: "Local fixture only", kind: "percent-off", pointCost: 500, active: true, codePoolCount: 3,
  expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000), hours: [] });
const eventIds = Array.from({ length: 6 }, (_, i) => `${partnerId}-event-${i}`);
for (const id of eventIds) await db.doc(`events/${id}`).set({ title: "Organic fixture workshop", organizer: "Fictional community",
  category: "Workshop", date: Timestamp.fromMillis(Date.now() + 86_400_000), active: true, hidden: false, broadcast: true,
  areaId: "san-jose-ca", latitude: origin.lat, longitude: origin.lng, creatorID: "system:ingest", qualityScore: 0.8,
  source: "libcal", sourceEventId: id, description: "Local event fixture" });
await db.doc("feedCaches/san-jose-ca").delete();
for (const surface of ["events_feed", "for_you", "everything"]) {
  const result = await call("sponsoredPlacement", { surface, sessionId: suffix, ...origin });
  check(`${surface} refuses partner placement`, result.error?.status === "INVALID_ARGUMENT");
}
const map = await call("nearbyPartners", { surface: "map", ...origin });
check("map has agreement-backed live offer and distinct payload", map.result?.offers?.some((p) => p.perkId === perkId && p.sponsored === true));
let nearby = await call("nearbyPartners", { surface: "near_you", sessionId: suffix, ...origin });
check("near you chooses exactly one walking-distance offer", nearby.result?.offers?.length === 1 && nearby.result.offers[0].distanceMeters <= 800);
nearby = await call("nearbyPartners", { surface: "near_you", sessionId: suffix, ...origin });
check("same session cannot claim a second near-you card", nearby.result?.offers?.length === 0);
const far = await call("nearbyPartners", { surface: "near_you", sessionId: `far-${suffix}`, lat: 37.9, lng: -122.5 });
check("no far fallback", far.result?.offers?.length === 0);
const legacyFar = await call("sponsoredPlacement", { surface: "near_you", sessionId: `legacy-${suffix}`, lat: 37.9, lng: -122.5, nearCategory: "Workshop", localHour: 9 });
check("legacy placement path cannot bypass walking distance", legacyFar.result?.placement === null);
const rewards = await call("listRewardsCatalog", {});
check("Rewards exposes partner coordinates for Nearby sort", rewards.result?.perks?.some((p) => p.id === perkId && p.latitude === origin.lat + 0.001));
const feed = await call("recommendedEvents", { areaId: "san-jose-ca", ...origin, limit: 50 });
const partnerIDs = new Set((await db.collection("partnerPerks").get()).docs.map((d) => d.id));
function hasPartnerContent(value) {
  if (typeof value === "string") return partnerIDs.has(value);
  if (Array.isArray(value)) return value.some(hasPartnerContent);
  if (!value || typeof value !== "object") return false;
  return value.sponsored === true || typeof value.partnerId === "string" || value.source === "partner" ||
    Object.values(value).some(hasPartnerContent);
}
check("actual For You response contains organic events", feed.result?.events?.some((e) => eventIds.includes(e.id)));
check("actual For You response contains no perk or sponsored placement anywhere", !hasPartnerContent(feed.result));
const app = initializeClient({ projectId, apiKey: "local" }, `sprint-client-${suffix}`);
const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
await signInWithEmailAndPassword(auth, email, password);
const client = clientFirestore(app); connectFirestoreEmulator(client, "127.0.0.1", 8899);
const everything = await getDocs(query(collection(client, "events"), where("active", "==", true), where("hidden", "==", false),
  where("broadcast", "==", true), where("areaId", "==", "san-jose-ca"), where("date", ">=", new Date()), orderBy("date"), limit(40)));
check("rules-checked Everything event query excludes all partner offers", everything.docs.some((d) => eventIds.includes(d.id)) &&
  everything.docs.every((d) => !partnerIDs.has(d.id) && !hasPartnerContent(d.data())));
const dismiss = await call("dismissPerk", { perkId }); check("dismissal callable succeeds", dismiss.result?.dismissed);
const dismissed = await call("nearbyPartners", { surface: "map", ...origin });
check("dismissal persists server-side and removes pin", !dismissed.result?.offers?.some((p) => p.perkId === perkId));
await db.doc(`users/${uid}/dismissedPerks/${perkId}`).delete();
await db.doc(`partners/${partnerId}`).update({ agreement: null });
const unagreed = await call("nearbyPartners", { surface: "map", ...origin });
check("partner without agreement cannot surface", !unagreed.result?.offers?.some((p) => p.perkId === perkId));
const unagreedCatalog = await call("listRewardsCatalog", {});
check("partner without agreement cannot enter Rewards", !unagreedCatalog.result?.perks?.some((p) => p.id === perkId));
console.log(`${passed} focused partner emulator checks passed`);
process.exit(0);
