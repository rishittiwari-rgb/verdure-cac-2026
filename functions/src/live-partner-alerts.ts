/** Optional adult-only background proximity alerts. Locations are evaluated, never stored. */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, distanceMeters, docIdFrom, plusActiveFrom } from "./common.js";
import { loadSurfacablePerks, nearYouEligible } from "./partners.js";
import { partnerHasAgreement, partnerStatus, perkStatus } from "./partner-status.js";
import { readPrefs, inQuietHours, weekKey, MAX_PUSH_PER_WEEK } from "./notifications.js";

export const LIVE_REGION_LIMIT = 20;
export function livePartnerEligible(data: FirebaseFirestore.DocumentData | undefined) {
  return data?.ageBand === "adult" && data.suspended !== true;
}
export function livePartnerEnabled(data: FirebaseFirestore.DocumentData | undefined) {
  return livePartnerEligible(data) && data?.notificationPrefs?.livePartnerAlerts === true &&
    data.notificationPrefs.livePartnerConsentVersion === "live-deals-v1";
}
function point(data: any, fresh = false) {
  if (typeof data?.lat !== "number" || typeof data?.lng !== "number" || !Number.isFinite(data.lat) || !Number.isFinite(data.lng) ||
      Math.abs(data.lat) > 90 || Math.abs(data.lng) > 180 || (fresh &&
      (typeof data.accuracy !== "number" || !Number.isFinite(data.accuracy) || data.accuracy < 0 || data.accuracy > 100 ||
       typeof data.sampleAtMs !== "number" || !Number.isFinite(data.sampleAtMs) || Math.abs(Date.now() - data.sampleAtMs) > 60_000)))
    throw new HttpsError("invalid-argument", "A recent accurate location is required.");
  return { lat: data.lat as number, lng: data.lng as number };
}
export const getLivePartnerConsent = onCall(async (req) => {
  const uid = requireUid(req.auth), profile = (await db.doc(`users/${uid}`).get()).data();
  return { eligible: livePartnerEligible(profile), enabled: livePartnerEnabled(profile) };
});
export const setLivePartnerConsent = onCall(async (req) => {
  const uid = requireUid(req.auth); await enforceRateLimit(uid, "setNotificationPrefs");
  if (typeof req.data?.enabled !== "boolean" || (req.data.enabled && req.data.promotionalConsent !== true))
    throw new HttpsError("invalid-argument", "Explicit consent to promotional proximity alerts is required.");
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`), profile = (await tx.get(ref)).data();
    if (!profile || (req.data.enabled && !livePartnerEligible(profile)))
      throw new HttpsError("permission-denied", "Proximity offers are available only to adult accounts.");
    tx.set(ref, { notificationPrefs: { livePartnerAlerts: req.data.enabled,
      livePartnerConsentVersion: req.data.enabled ? "live-deals-v1" : null,
      livePartnerConsentAt: Timestamp.now() } }, { merge: true });
    return { eligible: livePartnerEligible(profile), enabled: req.data.enabled };
  });
});
export const livePartnerRegions = onCall(async (req) => {
  const uid = requireUid(req.auth); await enforceRateLimit(uid, "livePartnerRegions");
  const origin = point(req.data), now = Date.now(), profile = (await db.doc(`users/${uid}`).get()).data();
  if (!livePartnerEnabled(profile)) return { regions: [] };
  const dismissals = new Set((await db.collection(`users/${uid}/dismissedPerks`).get()).docs.map((d) => d.id));
  const perks = (await loadSurfacablePerks(plusActiveFrom(profile, now), now)).filter((p) => p.claimable && !dismissals.has(p.id) &&
    p.latitude !== undefined && p.longitude !== undefined && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180)
    .map((p) => ({ ...p, distance: distanceMeters(origin.lat, origin.lng, p.latitude!, p.longitude!) }))
    .filter((p) => p.distance <= 40_233.6).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  const unique = new Map<string, typeof perks[number]>();
  for (const perk of perks) if (perk.partnerId && !unique.has(perk.partnerId)) unique.set(perk.partnerId, perk);
  return { regions: [...unique.values()].slice(0, LIVE_REGION_LIMIT).map((p) => ({ partnerId: p.partnerId,
    perkId: p.id, latitude: p.latitude, longitude: p.longitude, expiresAtMs: p.expiresAtMs })) };
});
export const livePartnerEntry = onCall(async (req) => {
  const uid = requireUid(req.auth); await enforceRateLimit(uid, "livePartnerEntry");
  const origin = point(req.data, true), perkId = req.data?.perkId;
  if (typeof perkId !== "string" || perkId.length > 128 || !perkId || perkId.includes("/")) throw new HttpsError("invalid-argument", "Choose an offer.");
  const now = Date.now(), data = (await db.doc(`users/${uid}`).get()).data();
  if (!livePartnerEnabled(data)) return { alert: null };
  const chosen = (await loadSurfacablePerks(plusActiveFrom(data, now), now)).find((p) => p.id === perkId);
  if (!chosen?.partnerId || !chosen.claimable) return { alert: null };
  const wk = weekKey(now), id = docIdFrom(uid, chosen.partnerId, wk), userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const entryRef = db.doc(`users/${uid}/livePartnerAlerts/${id}`);
    const [user, prior, perk, partner, dismissed] = await Promise.all([tx.get(userRef), tx.get(entryRef),
      tx.get(db.doc(`partnerPerks/${perkId}`)), tx.get(db.doc(`partners/${chosen.partnerId}`)), tx.get(db.doc(`users/${uid}/dismissedPerks/${perkId}`))]);
    const profile = user.data(), offer = perk.data(), prefs = readPrefs(profile);
    // Partner opening/category hours use the launch area's venue clock. Quiet
    // hours continue to use the account's notification timezone independently.
    const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(now));
    const hour = Number(clock.find((p) => p.type === "hour")?.value), day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(clock.find((p) => p.type === "weekday")?.value ?? "");
    const budget = profile?.notifyBudget ?? {}, sent = budget.week === wk ? Number(budget.sent) || 0 : 0;
    if (!livePartnerEnabled(profile) || inQuietHours(now, prefs) || prior.exists || dismissed.exists || sent >= MAX_PUSH_PER_WEEK ||
      !partnerHasAgreement(partner.data()) || partnerStatus(partner.data()).revision !== chosen.partnerRevision ||
      perkStatus(offer).revision !== chosen.perkRevision || (offer?.earlyAccessUntil?.toMillis?.() > now && !plusActiveFrom(profile, now)) ||
      !nearYouEligible(chosen, { ...origin, localHour: hour }, day)) return { alert: null };
    const alert = { id, perkId, title: "A deal near you", body: `${chosen.partner} is a short walk away — ${chosen.title}.` };
    tx.set(userRef, { notifyBudget: { week: wk, sent: sent + 1 } }, { merge: true });
    tx.set(entryRef, { perkId, createdAt: Timestamp.fromMillis(now) });
    tx.set(db.doc(`users/${uid}/notifications/${id}`), { ...alert, kind: "live-partner", sponsored: true, read: false, createdAt: Timestamp.fromMillis(now) });
    return { alert };
  });
});
