// B3 full callable workflow with fictional businesses and local geocoder data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { geocodeFixtureId, parseCensusGeocode } = await import("../lib/staff-partners.js");
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
async function call(user, name, data = {}) {
  const res = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${user.idToken}` }, body: JSON.stringify({ data }) });
  return res.json();
}
let staff = await account("partner-staff"), member = await account("partner-member"), second = await account("partner-second");
execFileSync(process.execPath, [fileURLToPath(new URL("./staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
  "--grant", "--reason", "Local partner-management test"], { env: process.env });
staff = await account("partner-staff", "signInWithPassword");
await db.doc(`users/${member.localId}`).set({ pointsBalance: 10000, redeemedRewardIDs: [], suspended: false });
await db.doc(`users/${second.localId}`).set({ pointsBalance: 10000, redeemedRewardIDs: [], suspended: false });
const address = `123 Fixture Road ${suffix}, San Jose, CA 95113`, badAddress = `999 Unmatched Road ${suffix}, San Jose, CA 95113`;
const fixture = { result: { addressMatches: [{ matchedAddress: address.toUpperCase(), coordinates: { x: -121.89, y: 37.335 } }] } };
await db.doc(`qaGeocodes/${geocodeFixtureId(address)}`).set({ response: fixture });
await db.doc(`qaGeocodes/${geocodeFixtureId(badAddress)}`).set({ response: { result: { addressMatches: [] } } });
const partnerId = `fixture-store-${suffix}`, perkId = `fixture-offer-${suffix}`;
const partner = { partnerId, name: `Fictional Fixture Shop ${suffix}`, category: "retail", address,
  contactName: "Fictional Contact", contactEmail: "contact@example.test", active: false, reason: "Create fictional partner draft" };
const agreement = { agreedBy: "Fictional business contact", agreedAtMs: Date.now() - 1000, reference: "Fixture only; no real business agreement" };
const perk = { perkId, partnerId, title: "Fictional local offer", terms: "Fixture terms only", description: "Fictional test offer", kind: "local-offer",
  pointCost: 600, expiresAtMs: Date.now() + 30 * 86400000, reason: "Create fictional partner perk" };
for (const name of ["savePartner", "upsertPartnerPerk", "importPartnerCodes", "deactivatePartnerOffer", "listStaffPartners"]) {
  check(`non-admin refused: ${name}`, (await call(member, name, {})).error?.status === "PERMISSION_DENIED");
}
for (const name of ["savePartner", "upsertPartnerPerk", "importPartnerCodes", "deactivatePartnerOffer"]) {
  check(`${name} requires reason`, (await call(staff, name, {})).error?.status === "INVALID_ARGUMENT");
}
check("Census parser uses x longitude and y latitude", parseCensusGeocode(fixture).latitude === 37.335 && parseCensusGeocode(fixture).longitude === -121.89);
let r = await call(staff, "savePartner", { ...partner, address: badAddress });
check("unmatched address saves nothing", r.error?.status === "FAILED_PRECONDITION" && !(await db.doc(`partners/${partnerId}`).get()).exists);
r = await call(staff, "savePartner", { ...partner, latitude: 0, longitude: 0 });
check("client cannot forge geocoded coordinates", r.error?.status === "INVALID_ARGUMENT");
r = await call(staff, "savePartner", partner);
check("draft is geocoded on server and retains contact", r.result?.active === false && r.result.latitude === 37.335 &&
  (await db.doc(`partners/${partnerId}`).get()).data().contactEmail === partner.contactEmail);
r = await call(staff, "savePartner", { ...partner, active: true });
check("partner cannot activate without agreement", r.error?.status === "FAILED_PRECONDITION");
r = await call(staff, "upsertPartnerPerk", perk);
check("perk cannot activate under unagreed partner", r.error?.status === "FAILED_PRECONDITION");
r = await call(staff, "savePartner", { ...partner, active: true, agreement });
check("recorded who when reference allows activation", r.result?.active === true &&
  (await db.doc(`partners/${partnerId}`).get()).data().agreement.recordedBy === staff.localId);
check("future agreement is refused", (await call(staff, "savePartner", { ...partner, active: true,
  agreement: { ...agreement, agreedAtMs: Date.now() + 86400000 } })).error?.status === "INVALID_ARGUMENT");
for (const pointCost of [499, 2001, 500.5, "500", null]) {
  check(`invalid point cost rejected: ${JSON.stringify(pointCost)}`, (await call(staff, "upsertPartnerPerk", { ...perk, pointCost })).error?.status === "INVALID_ARGUMENT");
}
check("expiry is mandatory", (await call(staff, "upsertPartnerPerk", { ...perk, expiresAtMs: null })).error?.status === "INVALID_ARGUMENT");
check("early access cannot outlast expiry", (await call(staff, "upsertPartnerPerk", { ...perk, earlyAccessUntilMs: perk.expiresAtMs + 1 })).error?.status === "INVALID_ARGUMENT");
r = await call(staff, "upsertPartnerPerk", perk);
check("valid perk starts with empty low-stock pool", r.result?.codesLeft === 0 && r.result.lowStock === true);
for (const csv of ["wrong\nABC-001", "code,other\nABC-001,x", 'code\n"unfinished', "code\nBAD CODE", "code\nABC-001\nabc-001"]) {
  r = await call(staff, "importPartnerCodes", { perkId, csv, reason: "Validate malformed fixture upload" });
  check(`invalid CSV rejected without loading: ${JSON.stringify(csv)}`, !!r.error && (await db.doc(`partnerPerks/${perkId}`).get()).data().codePoolCount === 0);
}
const codes = Array.from({ length: 12 }, (_, i) => `FIXTURE-${suffix.toUpperCase()}-${String(i + 1).padStart(3, "0")}`);
r = await call(staff, "importPartnerCodes", { perkId, csv: `\uFEFFcode\r\n${codes.map((x) => `"${x}"`).join("\r\n")}\r\n`, reason: "Load fictional CSV code pool" });
check("CSV loads exact count and removes low-stock flag", r.result?.codesAdded === 12 && r.result.codesLeft === 12 && r.result.lowStock === false);
const map = await call(member, "nearbyPartners", { surface: "map", lat: 37.335, lng: -121.89 });
check("staff-created agreed partner appears on actual map endpoint", map.result?.offers.some((x) => x.partnerId === partnerId && x.perkId === perkId && x.pointCost === 600));
r = await call(staff, "importPartnerCodes", { perkId, csv: `code\n${codes[0]}\nNEW-VALID-001`, reason: "Reject duplicate fixture code" });
check("existing duplicate rejects entire batch without inflating stock", r.error?.status === "ALREADY_EXISTS" &&
  (await db.doc(`partnerPerks/${perkId}`).get()).data().codePoolCount === 12 && !(await db.doc(`partnerPerks/${perkId}/codes/NEW-VALID-001`).get()).exists);
const raced = await Promise.all([1, 2].map(() => call(staff, "importPartnerCodes", { perkId, csv: "code\nRACE-UNIQUE-001", reason: "Concurrent fixture import" })));
check("parallel duplicate imports load exactly once", raced.filter((x) => x.result?.codesAdded === 1).length === 1 && raced.filter((x) => x.error?.status === "ALREADY_EXISTS").length === 1 &&
  (await db.doc(`partnerPerks/${perkId}`).get()).data().codePoolCount === 13);
r = await call(member, "redeemReward", { rewardId: perkId });
check("free member redeems valid agreed perk", r.result?.redeemed === true && r.result.remaining === 9400 && typeof r.result.code === "string");
const claimedCode = r.result.code, claimedRef = db.doc(`partnerPerks/${perkId}/codes/${claimedCode.toUpperCase()}`);
r = await call(staff, "importPartnerCodes", { perkId, csv: `code\n${claimedCode.toLowerCase()}`, reason: "Attempt fixture redeemed-code reload" });
check("redeemed code cannot be reset by case-changing reupload", r.error?.status === "ALREADY_EXISTS" && (await claimedRef.get()).data().claimedBy === member.localId);
r = await call(staff, "upsertPartnerPerk", { ...perk, title: "Updated fictional offer" });
check("editing perk preserves stock and redeemed count", r.result?.codesLeft === 12 && (await db.doc(`partnerPerks/${perkId}`).get()).data().redeemedCount === 1);
await db.doc(`partnerPerks/${perkId}/codes/LeGaCy-001`).set({ code: "LeGaCy-001", claimedBy: member.localId, claimedAt: Timestamp.now() });
check("legacy mixed-case claimed codes also reject reupload", (await call(staff, "importPartnerCodes", {
  perkId, csv: "code\nLEGACY-001", reason: "Reject legacy duplicate fixture" })).error?.status === "ALREADY_EXISTS");
r = await call(staff, "listStaffPartners", { kind: "perks", partnerId });
check("staff inventory returns stock and expiry without coupon values", r.result?.items.some((x) => x.id === perkId && x.codesLeft === 12 && x.expiresAtMs === perk.expiresAtMs) && !JSON.stringify(r.result).includes(claimedCode));
await call(staff, "deactivatePartnerOffer", { kind: "perk", targetId: perkId, reason: "Deactivate fictional perk immediately" });
check("deactivated perk disappears from map", !(await call(member, "nearbyPartners", { surface: "map", lat: 37.335, lng: -121.89 })).result?.offers.some((x) => x.perkId === perkId));
check("deactivated perk refuses redemption without debit", (await call(second, "redeemReward", { rewardId: perkId })).error?.status === "FAILED_PRECONDITION" &&
  (await db.doc(`users/${second.localId}`).get()).data().pointsBalance === 10000);
await call(staff, "upsertPartnerPerk", { ...perk, earlyAccessUntilMs: Date.now() + 86400000 });
check("free redemption respects current early access", (await call(second, "redeemReward", { rewardId: perkId })).error?.status === "PERMISSION_DENIED");
await call(staff, "upsertPartnerPerk", perk);
await call(staff, "deactivatePartnerOffer", { kind: "partner", targetId: partnerId, reason: "Deactivate fictional partner immediately" });
check("deactivated partner disappears from Rewards", !(await call(member, "listRewardsCatalog")).result?.perks.some((x) => x.id === perkId));
check("current partner state gates redemption atomically", (await call(second, "redeemReward", { rewardId: perkId })).error?.status === "FAILED_PRECONDITION" &&
  (await db.doc(`users/${second.localId}`).get()).data().pointsBalance === 10000);
await call(staff, "savePartner", { ...partner, active: true });
await db.doc(`partnerPerks/${perkId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
check("expired perk refuses redemption without debit", (await call(second, "redeemReward", { rewardId: perkId })).error?.status === "FAILED_PRECONDITION" &&
  (await db.doc(`users/${second.localId}`).get()).data().pointsBalance === 10000);
const audits = await db.collection("staffAudit").where("target", "in", [`partners/${partnerId}`, `partnerPerks/${perkId}`]).get();
check("successful partner and perk mutations all audited", audits.size === 11 && audits.docs.every((x) => x.data().actor === staff.localId &&
  x.data().reason && x.data().time.toMillis() > 0 && "before" in x.data() && "after" in x.data()));
check("code import audit reports counts without coupon values", audits.docs.filter((x) => x.data().action === "perk:import-codes").length === 2 &&
  audits.docs.every((x) => !JSON.stringify(x.data()).includes(claimedCode)));
console.log(`${checks} staff partner-management emulator checks passed; console UI still pending`);
process.exit(0);
