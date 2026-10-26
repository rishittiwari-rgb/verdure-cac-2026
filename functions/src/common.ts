/**
 * Shared server plumbing for every Cloud Functions module.
 *
 * WHY THIS FILE EXISTS. The first modules (index.ts, adventure.ts) each carried
 * their own copies of the input-hardening helpers and the rate limiter — fine
 * for two files, a liability for ten. Moderation, social, organizer, economy and
 * ingestion code all need the same guarantees (no crash on hostile input, per-user
 * volume ceilings, one definition of "is this account Verdure+"), and a guarantee
 * that exists in one place cannot drift between copies.
 *
 * Nothing here talks to a vendor. Nothing here is exported to the client.
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) initializeApp();
export const db = getFirestore();
// Normalized event records carry optional fields; Firestore rejects `undefined`
// unless told to drop it. Must be set before the first operation on `db`.
try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already initialised */ }

/** True under the Local Emulator Suite — used to skip triggers the emulator can't host. */
export const inEmulator = process.env.FUNCTIONS_EMULATOR === "true";

/**
 * Coerce caller-supplied input to a string, safely.
 *
 * `String(x)` THROWS on a hostile payload — `{"toString": "x"}` makes toString
 * non-callable, so the coercion raises TypeError, the callable dies, and the
 * caller gets INTERNAL. That's an unhandled crash reachable by anyone with a
 * token: a cheap denial-of-service and a leak that we failed unexpectedly
 * rather than rejected deliberately. Anything that isn't already a primitive
 * string is simply not a string, so treat it as absent.
 */
export function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Bounded, trimmed string or the fallback. */
export function safeText(v: unknown, max: number, fallback = ""): string {
  const s = safeString(v, fallback).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** Caller-supplied boolean, strictly. */
export function safeBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Parse + range-check a coordinate component; NaN → undefined. */
export function parseCoord(v: unknown, max: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) return undefined;
  return n;
}

/** Great-circle distance in meters (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** A Firestore document id made from caller-influenced parts. */
export function docIdFrom(...parts: string[]): string {
  return parts.join("_").replace(/[\/#?%]/g, "-").slice(0, 900);
}

/** Require a signed-in caller or throw UNAUTHENTICATED. */
export function requireUid(auth: { uid?: string } | undefined, message = "Sign in first."): string {
  const uid = auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", message);
  return uid;
}

// ── Rate limiting at the trust boundary ─────────────────────────────────────
//
// Every callable is reachable directly at POST /<project>/<region>/<name> with
// any signed-in user's token, bypassing every gate that lives in the iOS client.
// Idempotency stops the same action being farmed twice; this bounds VOLUME.
// Per-user rather than global so one abuser can't lock honest users out.
// Ceilings count rejected calls too — otherwise malformed requests are free.

export interface RateLimit { max: number; windowMs: number; }

const HOUR = 60 * 60 * 1000;

export const RATE_LIMITS: Record<string, RateLimit> = {
  // W4.6 / W4.4 public HTTP endpoints, keyed by a hash of the requester's address (see discovery/removal.ts).
  requestSourceRemoval: { max: 5,  windowMs: 24 * HOUR },
  removalToken:         { max: 30, windowMs: HOUR },
  sourceIntake:         { max: 10, windowMs: 24 * HOUR },
  checkInToEvent:   { max: 20,  windowMs: HOUR },
  collectPlace:     { max: 60,  windowMs: HOUR },
  redeemReward:     { max: 15,  windowMs: HOUR },
  externalFetch:    { max: 120, windowMs: HOUR },
  reportContent:    { max: 30,  windowMs: HOUR },
  deleteAccount:    { max: 3,   windowMs: HOUR },
  rsvpToEvent:      { max: 60,  windowMs: HOUR },
  inviteToEvent:    { max: 60,  windowMs: HOUR },
  friendsGoing:     { max: 240, windowMs: HOUR },
  friendsUpcoming:  { max: 60,  windowMs: HOUR },
  myFriendInvite:   { max: 30,  windowMs: HOUR },
  claimUsername:    { max: 12,  windowMs: HOUR },
  findFriendByUsername: { max: 60, windowMs: HOUR },
  sharedPastEventMembers: { max: 30, windowMs: HOUR },
  registerAgeBand:  { max: 6,   windowMs: HOUR },
  sendFriendRequest:{ max: 30,  windowMs: HOUR },
  respondToFriendRequest: { max: 60, windowMs: HOUR },
  removeFriend:     { max: 30,  windowMs: HOUR },
  followUser:       { max: 120, windowMs: HOUR },
  friendsFeed:      { max: 240, windowMs: HOUR },
  createOrganizer:  { max: 3,   windowMs: HOUR },
  createEvent:      { max: 20,  windowMs: HOUR },
  planAdventure:    { max: 30,  windowMs: HOUR },
  recommendedEvents:{ max: 240, windowMs: HOUR },
  programListings: { max: 120, windowMs: HOUR },
  offlinePackGenerate: { max: 12, windowMs: HOUR },
  offlinePackRead: { max: 2000, windowMs: HOUR },
  offlinePackControl: { max: 60, windowMs: HOUR },
  parkBrowse: { max: 240, windowMs: HOUR },
  getPlaceStory: { max: 240, windowMs: HOUR },
  recordStoryEngagement: { max: 240, windowMs: HOUR },
  livePartnerRegions: { max: 60, windowMs: HOUR },
  livePartnerEntry: { max: 60, windowMs: HOUR },
  savePlaceStory: { max: 30, windowMs: HOUR },
  recordEventFeedback: { max: 120, windowMs: HOUR },
  manageInterestProfiles: { max: 120, windowMs: HOUR },
  planEvents: { max: 30, windowMs: HOUR },
  refineEventPlan: { max: 300, windowMs: HOUR },
  recordFeedEvent: { max: 500, windowMs: HOUR },
  manageGroupPlan: { max: 180, windowMs: HOUR },
  setNotificationPrefs: { max: 60, windowMs: HOUR },
  dismissSuggestion:    { max: 120, windowMs: HOUR },
  sponsoredPlacement:   { max: 120, windowMs: HOUR },
  dismissPerk:          { max: 60,  windowMs: HOUR },
  recordPerkTap:        { max: 120, windowMs: HOUR },
  friendsLeaderboard:   { max: 120, windowMs: HOUR },
  trackEvent:       { max: 600, windowMs: HOUR },
};

/**
 * Consume one unit of a user's budget for `action`, or throw RESOURCE_EXHAUSTED.
 *
 * Runs in a transaction so parallel calls can't both read the same count and
 * each decide they're under the cap. Counters live in `rateLimits`, a
 * server-only collection the Firestore rules deny to clients.
 */
export async function enforceRateLimit(uid: string, action: string): Promise<void> {
  const limit = RATE_LIMITS[action];
  if (!limit) return;

  const ref = db.collection("rateLimits").doc(`${uid}_${action}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const now = Date.now();

    const startedAt: number = typeof data?.windowStart?.toMillis === "function"
      ? data.windowStart.toMillis()
      : 0;
    const expired = now - startedAt >= limit.windowMs;
    const count: number = expired ? 0 : (Number(data?.count) || 0);

    if (count >= limit.max) {
      const retryInSec = Math.ceil((startedAt + limit.windowMs - now) / 1000);
      throw new HttpsError(
        "resource-exhausted",
        `Too many ${action} requests. Try again in about ${Math.ceil(retryInSec / 60)} minute(s).`
      );
    }

    tx.set(ref, {
      uid,
      action,
      count: count + 1,
      windowStart: expired ? Timestamp.fromMillis(now) : (data?.windowStart ?? Timestamp.fromMillis(now)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

// ── Verdure+ entitlement (server-verified only) ─────────────────────────────
//
// A client's claim that it is subscribed is NEVER trusted for server-side
// value. The only source of truth is `users/{uid}.plusExpiresAt`, which the
// Firestore rules deny to clients — it is written exclusively by the Admin SDK
// (subscriptions.ts, after Apple verifies the purchase).

export function plusActiveFrom(data: FirebaseFirestore.DocumentData | undefined, now = Date.now()): boolean {
  const expiresAt = data?.plusExpiresAt;
  if (!expiresAt) return false;
  const ms = typeof expiresAt?.toMillis === "function"
    ? expiresAt.toMillis()
    : Number(expiresAt);
  return Number.isFinite(ms) && ms > now;
}

export async function hasActivePlus(uid: string): Promise<boolean> {
  const snap = await db.collection("users").doc(uid).get();
  return plusActiveFrom(snap.data());
}

// ── Admin gate ──────────────────────────────────────────────────────────────
//
// Moderation actions, organizer approval and manual ingestion runs are staff
// operations. Only an admin custom claim grants access. staff-admin.mjs is the
// out-of-band management path; legacy /admins rows confer no authority.
// Re-read Auth to refuse a revoked claim even while an old token still exists.

export async function isAdmin(auth: { uid?: string; token?: Record<string, unknown> } | undefined): Promise<boolean> {
  const uid = auth?.uid;
  if (!uid || auth?.token?.admin !== true) return false;
  try {
    const user = await getAuth().getUser(uid);
    return !user.disabled && user.customClaims?.admin === true;
  } catch { return false; }
}

export async function requireAdmin(auth: { uid?: string; token?: Record<string, unknown> } | undefined): Promise<string> {
  const uid = requireUid(auth);
  if (!(await isAdmin(auth))) {
    throw new HttpsError("permission-denied", "This action requires a Verdure staff account.");
  }
  return uid;
}

// ── Account status ──────────────────────────────────────────────────────────

/** Suspended accounts (a moderation outcome) may read but not act. */
export async function assertNotSuspended(uid: string): Promise<void> {
  const snap = await db.collection("users").doc(uid).get();
  if (snap.data()?.suspended === true) {
    throw new HttpsError("permission-denied",
      "This account has been suspended. Contact support@verdure-app.com to appeal.");
  }
}

// ── Blocks ──────────────────────────────────────────────────────────────────
//
// Blocks live at users/{uid}/blocks/{targetUid} (owner-writable). Every social
// surface must treat a block as symmetric: if either side blocked the other,
// neither sees the other. Centralised so no module can get the direction wrong.

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [ab, ba] = await Promise.all([
    db.doc(`users/${a}/blocks/${b}`).get(),
    db.doc(`users/${b}/blocks/${a}`).get(),
  ]);
  return ab.exists || ba.exists;
}

/** Set of uids that `uid` has blocked or been blocked by (both directions). */
export async function blockedSetFor(uid: string): Promise<Set<string>> {
  const out = new Set<string>();
  const mine = await db.collection(`users/${uid}/blocks`).get();
  mine.forEach((d) => out.add(d.id));
  // Reverse direction: anyone whose block list contains me.
  const theirs = await db.collectionGroup("blocks").where("uid", "==", uid).get();
  theirs.forEach((d) => {
    const owner = d.ref.parent.parent?.id;
    if (owner) out.add(owner);
  });
  return out;
}

// ── Month keys (treasury / telemetry / budgets) ─────────────────────────────

export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);   // yyyy-mm-dd
}

export function utcMonthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);    // yyyy-mm
}

/** Delete every document in a query in batches of 400 (Firestore's limit is 500). */
export async function deleteQueryBatched(query: FirebaseFirestore.Query, batchSize = 400): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await query.limit(batchSize).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) return deleted;
  }
}
