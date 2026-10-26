/* eslint-disable import/first */
/**
 * Verdure Cloud Functions — server-authoritative game logic.
 *
 * Why this exists: the iOS client computes points locally and the Firestore rules
 * only *clamp* them to a sane range — they can't verify points were actually earned.
 * These callables move the trust boundary to the server: the client asks to check in /
 * redeem, and the SERVER decides the outcome inside a transaction. Pair this with the
 * "production lockdown" rules (see firestore.rules) that deny the client direct writes
 * to points/checkedInEventIDs/redeemedRewardIDs.
 *
 * Deploy:  cd functions && npm i && npm run deploy
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";
import {
  db, inEmulator, safeString, parseCoord, distanceMeters,
  enforceRateLimit, hasActivePlus, assertNotSuspended,
} from "./common.js";
import { RECREATION_GOV_KEY, NPS_API_KEY } from "./secrets.js";
import { DAILY_POINT_CAP, PLUS_POINT_MULTIPLIER, recordPointsIssued } from "./economy.js";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Client gate is 500 ft (~152 m); the server allows generous GPS slop on top —
// anything beyond this is not "at the event".
const MAX_CHECKIN_DISTANCE_M = 1500;

// The proof-photo bucket, stated explicitly.
//
// `getStorage().bucket()` resolves its default from ambient project metadata,
// which differs by environment: it gave `<project>.firebasestorage.app` locally
// but `<project>.appspot.com` in CI. That mismatch meant proofs were uploaded to
// one bucket and looked for in another, so every check-in failed with "proof not
// found". Pinning it here (overridable for tests) keeps dev, CI and production
// pointed at the same place — and it matches STORAGE_BUCKET in
// GoogleService-Info.plist, which is what the iOS app uploads to.
const PROOF_BUCKET =
  process.env.STORAGE_BUCKET || "connectify-19dd8.firebasestorage.app";

// Server-trusted ceilings so a spoofed client can't claim absurd point values.
// Keep in sync with EventCategory.defaultPoints in the app.
const CATEGORY_MAX_POINTS: Record<string, number> = {
  Cleanup: 200, Sports: 150, Social: 100, Workshop: 150, Market: 75,
  Festival: 250, Hackathon: 200, Meetup: 100, Volunteer: 200, Program: 100,
};

// ── Daily earning ceiling (economic backstop) ───────────────────────────────
//
// Rate limits bound how many REQUESTS an account can make; this bounds how much
// VALUE it can extract, which is the thing that actually costs money. It is the
// control that still holds if a future change reopens a farming path nobody
// spotted — worst case becomes "a slow leak" instead of "unlimited gift cards".
//
// DAILY_POINT_CAP = 600 (economy.ts). At 7,000 points per dollar a member
// farming the cap earns 750/day × 30.5 ≈ 22,900 points ≈ $3.27/month against
// $4.24 of net revenue — the cap only became a real abuse ceiling once the
// earn rate was fixed (at the old 1,200:1 rate the same behaviour cost $19).
//
// Deliberately a CLAMP, not a rejection: the check-in still succeeds and still
// counts toward streaks, challenges and badges — only the points stop. A real
// user who somehow hit the ceiling keeps their attendance record.

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);   // yyyy-mm-dd
}

/**
 * How many points this user may still earn today.
 * Read inside the caller's transaction so concurrent check-ins can't both
 * see the same remaining budget and each spend it.
 */
function remainingDailyBudget(data: FirebaseFirestore.DocumentData | undefined): number {
  const today = utcDayKey();
  const earned = data?.dailyEarnDay === today ? Number(data?.dailyEarnPoints) || 0 : 0;
  return Math.max(0, DAILY_POINT_CAP - earned);
}

/** Fields recording today's spend, to merge into the user doc. */
function dailyEarnUpdate(data: FirebaseFirestore.DocumentData | undefined, awarded: number) {
  const today = utcDayKey();
  const earned = data?.dailyEarnDay === today ? Number(data?.dailyEarnPoints) || 0 : 0;
  return { dailyEarnDay: today, dailyEarnPoints: earned + awarded };
}


async function earnMultiplier(uid: string): Promise<number> {
  return (await hasActivePlus(uid)) ? PLUS_POINT_MULTIPLIER : 1.0;
}

/**
 * checkInToEvent — record an attendance and award points, server-side & idempotent.
 * Community events (in /events) are validated against their stored pointValue;
 * external events are clamped to the category ceiling. Double check-ins are no-ops.
 *
 * ATTENDANCE EVIDENCE (required):
 *  - proofPath: a Storage object under proofs/{uid}/ (the caller's own folder —
 *    storage.rules make it owner-writable). Existence is verified best-effort.
 *  - lat/lng: the user's GPS fix. If the event doc stores venue coordinates, the
 *    fix must be within MAX_CHECKIN_DISTANCE_M; otherwise the fix is recorded in
 *    /attendance for manual spot-checking.
 */
export const checkInToEvent = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to check in.");
  await enforceRateLimit(uid, "checkInToEvent");
  await assertNotSuspended(uid);

  const eventId = safeString(req.data?.eventId).slice(0, 200);
  const category = safeString(req.data?.category, "Social");
  const claimed = Math.max(0, Math.floor(Number(req.data?.claimedPoints ?? 0)));
  if (!eventId) throw new HttpsError("invalid-argument", "Missing eventId.");

  // ── Evidence: proof photo reference ──
  const proofPath = safeString(req.data?.proofPath);
  if (!proofPath.startsWith(`proofs/${uid}/`) || proofPath.includes("..")) {
    throw new HttpsError("invalid-argument", "A proof-of-attendance photo is required to check in.");
  }
  // Best-effort existence check: hard-fail only on a definitive "not there".
  // (Storage being unreachable/misconfigured shouldn't block honest check-ins.)
  try {
    const bucket = getStorage().bucket(PROOF_BUCKET);
    const [exists] = await bucket.file(proofPath).exists();
    if (!exists) {
      console.warn(`[checkIn] proof missing: bucket=${bucket.name} path=${proofPath}`);
      throw new HttpsError("invalid-argument", "Proof photo was not found — upload it first.");
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.warn(`[checkIn] proof existence check unavailable for ${proofPath}:`, e);
  }

  // ── Evidence: GPS fix ──
  const lat = parseCoord(req.data?.lat, 90);
  const lng = parseCoord(req.data?.lng, 180);
  if (lat === undefined || lng === undefined) {
    throw new HttpsError("invalid-argument", "Your location is required to check in.");
  }

  // Determine the authoritative point value + venue coordinate (if stored).
  // The claim is clamped to the category ceiling BEFORE any multiplier, so a
  // Verdure+ bonus can never be used to smuggle an inflated base award through.
  let award = Math.min(claimed, CATEGORY_MAX_POINTS[category] ?? 100);
  let distanceM: number | null = null;
  const eventSnap = await db.collection("events").doc(eventId).get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "That event no longer exists.");
  }
  if (eventSnap.exists) {
    const ev = eventSnap.data() ?? {};
    if (ev.category === "Program" || ev.opportunitySubtype === "program") throw new HttpsError("failed-precondition", "Programs link to their organization; attendance points are unavailable.");

    // SELF-DEALING. Community events are created by users, and the creator
    // chooses the venue coordinates — so an event you made is always "nearby"
    // and its proof requirement is trivially satisfied. Paying points for it
    // makes the whole economy self-service: create event → check in → repeat.
    // Attending your own event is fine; being paid for it is not.
    if (typeof ev.creatorID === "string" && ev.creatorID === uid) {
      throw new HttpsError(
        "failed-precondition",
        "You can't earn points for an event you created."
      );
    }

    // VALUE COMES FROM OUR TABLE, NOT THEIR DOCUMENT.
    // `pointValue` lives in a client-written document: the rules only bound it
    // to <=1000, so anyone could publish a "Market" event worth 1000 and mint
    // 13x its real value. Clamp to the ceiling for the category recorded ON THE
    // EVENT (not the category the caller claims, which is also theirs to pick).
    const storedCategory = safeString(ev.category, category);
    const ceiling = CATEGORY_MAX_POINTS[storedCategory] ?? 100;
    const storedValue = Number(ev.pointValue);
    award = Math.min(Number.isFinite(storedValue) ? storedValue : ceiling, ceiling);

    const evLat = parseCoord(ev.latitude, 90);
    const evLng = parseCoord(ev.longitude, 180);
    if (evLat !== undefined && evLng !== undefined) {
      distanceM = distanceMeters(lat, lng, evLat, evLng);
      if (distanceM > MAX_CHECKIN_DISTANCE_M) {
        throw new HttpsError(
          "failed-precondition",
          `Too far from the event to check in (${Math.round(distanceM)} m away).`
        );
      }
    }
  }

  // Verdure+ earn bonus, applied AFTER the ceiling clamp above.
  const multiplier = await earnMultiplier(uid);
  const baseAward = award;
  award = Math.floor(award * multiplier);

  // Audit trail for manual spot-checks (server-only collection — no client rules).
  const attendanceId = `${uid}_${eventId}`.replace(/[\/#?%]/g, "-").slice(0, 900);
  await db.collection("attendance").doc(attendanceId).set({
    uid, eventId, proofPath, lat, lng,
    distanceM: distanceM === null ? null : Math.round(distanceM),
    category, claimedPoints: claimed,
    baseAward, multiplier, award,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const userRef = db.collection("users").doc(uid);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() ?? {};
    const checkedIn: string[] = data.checkedInEventIDs ?? [];
    const balance = Number(data.pointsBalance) || 0;
    const lifetime = Number(data.lifetimePoints) || 0;
    if (checkedIn.includes(eventId)) {
      return { alreadyCheckedIn: true, awarded: 0, newBalance: balance, newLifetime: lifetime };
    }

    // Economic backstop, read inside the transaction so two concurrent
    // check-ins can't both spend the same remaining budget.
    const granted = Math.min(award, remainingDailyBudget(data));

    tx.set(userRef, {
      checkedInEventIDs: FieldValue.arrayUnion(eventId),
      pointsBalance: balance + granted,
      lifetimePoints: lifetime + granted,
      ...dailyEarnUpdate(data, granted),
      ...recordPointsIssued(tx, data, granted),   // /treasury pointsIssued + distinct earners
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      alreadyCheckedIn: false, awarded: granted,
      newBalance: balance + granted, newLifetime: lifetime + granted,
      dailyCapReached: granted < award,
    };
  });

  return result;
});

/**
 * collectPlace — record a place collection and award its (small) points, server-side
 * & idempotent. Place points are capped at the Legendary ceiling (50 — see
 * PlaceRarity.pointValue in the app), so a spoofed client can't inflate them.
 */
const PLACE_MAX_POINTS = 50;

export const collectPlace = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to collect.");
  await enforceRateLimit(uid, "collectPlace");
  await assertNotSuspended(uid);

  const placeId = safeString(req.data?.placeId).slice(0, 200);
  const claimed = Math.max(0, Math.floor(Number(req.data?.claimedPoints ?? 0)));
  if (!placeId) throw new HttpsError("invalid-argument", "Missing placeId.");
  const award = Math.min(claimed, PLACE_MAX_POINTS);

  // Record the GPS fix (when provided) for spot-checking — places have no
  // server-side registry to hard-validate against, so this is evidence, not a gate.
  const lat = parseCoord(req.data?.lat, 90);
  const lng = parseCoord(req.data?.lng, 180);
  if (lat !== undefined && lng !== undefined) {
    const collectionId = `${uid}_${placeId}`.replace(/[\/#?%]/g, "-").slice(0, 900);
    await db.collection("attendance").doc(collectionId).set({
      uid, placeId, lat, lng, kind: "collect",
      claimedPoints: claimed,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() ?? {};
    const collected: string[] = data.collectedPlaceIDs ?? [];
    const balance = Number(data.pointsBalance) || 0;
    const lifetime = Number(data.lifetimePoints) || 0;
    if (collected.includes(placeId)) {
      return { alreadyCollected: true, awarded: 0, newBalance: balance, newLifetime: lifetime };
    }

    const granted = Math.min(award, remainingDailyBudget(data));

    tx.set(userRef, {
      collectedPlaceIDs: FieldValue.arrayUnion(placeId),
      pointsBalance: balance + granted,
      lifetimePoints: lifetime + granted,
      ...dailyEarnUpdate(data, granted),
      ...recordPointsIssued(tx, data, granted),
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      alreadyCollected: false, awarded: granted,
      newBalance: balance + granted, newLifetime: lifetime + granted,
      dailyCapReached: granted < award,
    };
  });
});

/**
 * onPostCreated — fan-out a push notification when a community post is created.
 * Requires FCM tokens stored at users/{uid}.fcmTokens (set from the iOS client).
 *
 * Skipped under the Local Emulator Suite: the Firestore emulator rejects v2
 * eventarc trigger registration (tools/jar version skew) and this trigger isn't
 * part of the E2E surface — only the callables are.
 */
export const onPostCreated: unknown = inEmulator ? undefined
  : onDocumentCreated("posts/{postId}", async (event) => {
  const post = event.data?.data();
  if (!post) return;
  // Collect a handful of recent tokens (a real app would target by proximity/follows).
  const usersSnap = await db.collection("users").limit(200).get();
  const tokens: string[] = [];
  usersSnap.forEach((d) => {
    const t = d.data().fcmTokens;
    if (Array.isArray(t)) tokens.push(...t);
  });
  if (tokens.length === 0) return;

  await getMessaging().sendEachForMulticast({
    tokens: tokens.slice(0, 500),
    notification: {
      title: `${post.authorName ?? "Someone"} posted in the community`,
      body: String(post.content ?? "").slice(0, 120),
    },
  });
});

// sendEventReminders was an empty function body behind a daily schedule — it
// shipped, ran every morning, and did nothing. Replaced by notifications.ts,
// which sends a RANKED digest twice a week under a hard 2/week per-user cap
// rather than a reminder every morning. See that file for why each gate exists.
export {
  sendEventSuggestions, setNotificationPrefs, getNotificationPrefs, dismissSuggestion,
} from "./notifications.js";

// ── External API proxy ──────────────────────────────────────────────────────
//
// WHY THIS EXISTS.
// The app shipped five billable third-party keys inside its Info.plist —
// SerpApi, Ticketmaster, NPS, Recreation.gov and an Eventbrite token. Anyone
// who unzips the .ipa reads them straight out (`plutil -p Info.plist`), and
// nothing in the app can prevent that: a key that reaches the device is public.
// The exposure isn't user data — these endpoints serve public parks and events
// — it's OUR QUOTA AND BILL. A stolen SerpApi key is someone else's search
// budget spent on our card.
//
// The only real fix is to stop shipping them: the keys live in the Functions
// runtime config, the app asks this proxy, and the proxy calls the vendor.
// The client sends a provider name and a coordinate, never a key.
//
// MIGRATION (must be done in this order, or the app loses its data sources):
//   1. deploy these functions with the keys set server-side:
//        firebase functions:secrets:set SERPAPI_KEY   (etc.)
//   2. ship an app build that prefers the proxy (already wired — see
//      ProviderConfig.proxyEnabled in EventProviders.swift)
//   3. THEN blank the keys in Secrets.xcconfig and ROTATE ALL FIVE, because
//      every key in a build already released is compromised for good.
// Until step 3 the keys are still in the bundle; the proxy alone doesn't undo
// an exposure that already happened.
//
// The proxy is rate limited like every other callable: it spends real money per
// call, so it's the last thing that should be freely hammerable.
// SECRETS MUST BE BOUND, NOT MERELY SET.
//
// This code read `process.env.RECREATION_GOV_KEY` directly while the callable
// declared no secrets. A secret stored with `functions:secrets:set` is only
// mounted into a function that DECLARES it — so both keys were `undefined` in
// production and the proxy answered "<provider> is not configured" forever,
// while working locally where the values come from a shell env. The migration
// note below tells you to set these secrets; without these declarations that
// instruction silently does nothing.
// Declared once in secrets.ts and shared with the ingestion jobs.

const PROXY_ALLOWLIST: Record<string, (params: Record<string, string>) => string | null> = {
  // Recreation.gov facilities near a point.
  recreation: (p) => {
    const key = RECREATION_GOV_KEY.value();
    if (!key) return null;
    const q = new URLSearchParams({
      latitude: p.lat, longitude: p.lng, radius: "25", limit: "20",
    });
    return `https://ridb.recreation.gov/api/v1/facilities?${q}`;
  },
  // National Park Service sites in a state.
  nps: (p) => {
    const key = NPS_API_KEY.value();
    if (!key) return null;
    const q = new URLSearchParams({ stateCode: p.state ?? "", limit: "15", api_key: key });
    return `https://developer.nps.gov/api/v1/parks?${q}`;
  },
};

export const externalFetch = onCall({
  secrets: [RECREATION_GOV_KEY, NPS_API_KEY],
}, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  await enforceRateLimit(uid, "externalFetch");

  const provider = safeString(req.data?.provider);
  const build = PROXY_ALLOWLIST[provider];
  if (!build) throw new HttpsError("invalid-argument", "Unknown provider.");

  // Only ever build URLs from an allowlisted template with sanitised params —
  // never anything the caller supplies verbatim, which would make this an SSRF
  // gadget pointed at internal metadata endpoints.
  const lat = parseCoord(req.data?.lat, 90);
  const lng = parseCoord(req.data?.lng, 180);
  const state = safeString(req.data?.state).replace(/[^A-Za-z]/g, "").slice(0, 2);
  if ((provider === "recreation") && (lat === undefined || lng === undefined)) {
    throw new HttpsError("invalid-argument", "Coordinates required.");
  }

  const url = build({ lat: String(lat), lng: String(lng), state });
  if (!url) throw new HttpsError("failed-precondition", `${provider} is not configured.`);

  const headers: Record<string, string> =
    provider === "recreation" ? { apikey: RECREATION_GOV_KEY.value() } : {};

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new HttpsError("unavailable", `${provider} returned ${res.status}`);
    // Cap the payload so a vendor can't be used to blow up our egress bill.
    const text = (await res.text()).slice(0, 500_000);
    return { provider, body: text };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("unavailable", `${provider} is unreachable.`);
  }
});

// ── Gift-card fulfilment (Tremendous) ───────────────────────────────────────
// Re-exported so the deploy picks them up. See fulfillment.ts for why each
// control exists — the short version is that /fulfillments was written by
// redeemReward and never read by anything, so every redemption to date took
// points and delivered no card.
export { onFulfilmentWritten, sweepFulfilments, runFulfilment } from "./fulfillment.js";

// ── Verdure+ entitlement (App Store Server API) ─────────────────────────────
// The only writers of users/{uid}.plusExpiresAt, which hasActivePlus() reads.
// Until these existed that field was never set, so every Plus benefit above was
// inert for paying members. See subscriptions.ts for the ownership-binding model.
export { linkSubscription, appStoreNotifications, refreshMySubscription, getAppAccountToken } from "./subscriptions.js";

// ── Adventure Planner ───────────────────────────────────────────────────────
// A rules engine by default (adventure-engine.ts); a language model only when
// ANTHROPIC_API_KEY is configured. Either way grounded in real nearby places:
// stops come from a candidate allowlist and anything else is dropped
// server-side. See adventure.ts.
export { planAdventure } from "./adventure.js";

// Personalized ranking. Nothing read users/{uid}.interests before this — the
// field was collected at onboarding and used by no query on either side.
// Notifications (sendEventReminders) and partner surfacing call recommendFor()
// directly rather than re-implementing the ordering.
export { recordEventFeedback } from "./ranking.js";
export { recommendedEvents } from "./program-feed.js";
export { manageInterestProfiles } from "./profiles.js";
export { planEvents, refineEventPlan } from "./eventPlanner.js";
export { recordFeedEvent, pruneFeedTelemetry } from "./feedTelemetry.js";
export { manageGroupPlan } from "./groupPlans.js";

// Partner surfacing. Separate from ranking.ts on purpose: that module has no
// partner input and this one cannot reach into it, so a paid placement is
// structurally incapable of moving an organic result.
export { sponsoredPlacement, dismissPerk, recordPerkTap, nearbyPartners } from "./partners.js";

// ── Content moderation ──────────────────────────────────────────────────────
// Report flow, auto-hide threshold, 24-hour SLA sweep and staff decisions.
// See moderation.ts for the model; firestore.rules for the visibility guarantee.
export {
  reportContent, moderateContent, moderationSweep, runModerationSweep,
  listModerationQueue, backfillModerationFlags,
} from "./moderation.js";

// ── Account deletion (App Review 5.1.1(v)) ──────────────────────────────────
// One callable removes everything the account owns, Storage included, and the
// Auth user last. See account.ts for what is deleted vs. anonymised and why.
export { deleteAccount } from "./account.js";

// W4 — automatic discovery, weekly re-check, intake, removal (no human approval anywhere).
export { discoverSources, recheckSourcesWeekly, runDiscoveryNow, sourceIntake } from "./discovery/discover.js";
export { requestSourceRemoval, removalToken } from "./discovery/removal.js";

// ── Event ingestion (ingest-and-own) ────────────────────────────────────────
// Scheduled jobs write the normalized /events store; the app reads Firestore
// only. See ingest/index.ts and ingest/areas.ts (launch areas + verified feeds).
export {
  ingestTicketed, ingestCivic, runIngest,
  supplyReportWeekly, getSupplyReport, listLaunchAreas,
} from "./ingest/index.js";

// ── Social: follows, Going/RSVP, invites, friends-going ─────────────────────
// Every write is a callable so blocks are enforced server-side and counts stay
// honest; rules deny clients all writes to these subcollections. See social.ts.
export { followUser, rsvpToEvent, inviteToEvent, respondToInvite, friendsGoing, friendsUpcoming, friendsLeaderboard } from "./social.js";
export { sendRsvpPartnerAlerts } from "./rsvp-partners.js";
export { sendFriendRequest, respondToFriendRequest, removeFriend, myFriendInvite,
         claimUsername, findFriendByUsername, sharedPastEventMembers, registerAgeBand } from "./friendships.js";

// ── Organizer accounts (Part 2 §5) ──────────────────────────────────────────
// Unverified organizers may create, not broadcast; approval is a staff action
// enforced server-side and mirrored onto every event they own. See organizers.ts.
export { createOrganizer, approveOrganizer, listOrganizerApplications, createEvent, myOrganizer } from "./organizers.js";

// ── Reward economy (Part 3) ─────────────────────────────────────────────────
// 7,000 pts ≈ $1; cash cards are Verdure+ only with a $25 rolling-12-month
// ceiling and a $200/month global cap + kill switch; partner perks are the
// primary redemption surface. See economy.ts for the derivation of every number.
export {
  redeemReward, listRewardsCatalog, upsertPartnerPerk, seedPartnerPerks,
  reconcileTreasury, resetTreasuryKillSwitch,
} from "./economy.js";

// Staff-managed partners: authorization and immutable audits are server-side.
export { savePartner, importPartnerCodes, deactivatePartnerOffer, listStaffPartners } from "./staff-partners.js";
export { staffSession } from "./staff-session.js";
export { staffOperations } from "./staff-operations.js";
export { placeDataWeekly } from "./parks/index.js";
export { nearbyParkGuides, parksAtCoordinate, parkGuide } from "./parks/api.js";
export { setPlaceStoryOwnership, listStaffStoryPlaces, getPlaceStory, savePlaceStory, myStoryPlaces,
  updateOrganizerStoryStatus, updateStoryAuthorStatus, recordStoryEngagement } from "./place-stories.js";

export { offlinePack, expireOfflinePackStages } from "./offline/packs.js";

export { saveProgram, deactivateProgram, listStaffPrograms, programListings, expireProgramListings } from "./programs.js";

export { getLivePartnerConsent, setLivePartnerConsent, livePartnerRegions, livePartnerEntry } from "./live-partner-alerts.js";
