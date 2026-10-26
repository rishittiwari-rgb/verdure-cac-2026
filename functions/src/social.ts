/**
 * Social core — follows, Going/RSVP, invites, friends-going, notifications.
 *
 * WHY THIS IS THE PRIORITY SOCIAL FEATURE. "Sarah is going Thursday" is the one
 * signal no search engine or assistant can produce, because none of them knows
 * who Sarah is to you. Check-ins, collections and badges are past tense — they
 * inform. An RSVP from a friend moves people out the door.
 *
 * THE MODEL.
 *   users/{uid}/following/{targetId}         { uid: targetId, kind: user|organizer }
 *   events/{eventId}/attendees/{uid}         { uid, displayName, initials, visibility }
 *   users/{uid}/invites/{eventId}_{fromUid}  { eventId, fromUid, status }
 *   users/{uid}/notifications/{id}           { kind, actorUid, eventId, read }
 *   users/{uid}.rsvpEventIDs (server-owned)  the client's offline "Going" state
 *   users/{uid}.activityPrivacy              friends (default) | public
 *
 * Every write here is a callable, not a client write, for three reasons: a
 * block must be checked on the SERVER ("a blocked user's follow/RSVP attempt
 * fails server-side"), the public attendee count must stay honest, and the
 * fan-out (notify friends who saved this event) has to happen where the data
 * is. Firestore rules deny clients every write to these subcollections and let
 * them read only what the privacy model allows.
 *
 * PRIVACY. `friends` visibility (the default) means an RSVP is visible only to
 * accounts the attendee follows. "Friends going" for a reader is therefore the
 * set of attendees the reader follows whose RSVP is visible to the reader —
 * mutual follows, or anyone who set themselves public. Blocks are symmetric
 * and win over everything.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import {
  db, inEmulator, requireUid, enforceRateLimit, assertNotSuspended,
  safeString, safeText, safeBool, isBlockedEitherWay, blockedSetFor, docIdFrom,
} from "./common.js";
import { mayPush } from "./notifications.js";
import { areFriends, friendIds } from "./friendships.js";
import { rsvpAlertRef, rsvpAlertDueAt } from "./rsvp-partners.js";

const MAX_INVITES_PER_CALL = 20;
const MAX_FRIENDS_GOING_EVENTS = 50;
const FRIEND_AVATARS = 5;

type FollowKind = "user" | "organizer";
type Visibility = "friends" | "public";

interface ProfileBits { displayName: string; initials: string; visibility: Visibility; }

async function profileBits(uid: string): Promise<ProfileBits> {
  const snap = await db.collection("users").doc(uid).get();
  const d = snap.data() ?? {};
  const displayName = safeText(d.displayName, 60) || "A Verdure member";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "VM";
  const visibility: Visibility = d.activityPrivacy === "public" ? "public" : "friends";
  return { displayName, initials, visibility };
}

async function follows(follower: string, target: string): Promise<boolean> {
  if (follower === target) return false;
  return (await db.doc(`users/${follower}/following/${target}`).get()).exists;
}

/** Write an in-app notification and (outside the emulator) a push. */
export async function notify(uid: string, payload: {
  kind: string; title: string; body: string; actorUid?: string; eventId?: string; extra?: Record<string, unknown>;
}, delivery?: { notificationId: string; alreadyStored: boolean }): Promise<void> {
  const ref = delivery ? db.doc(`users/${uid}/notifications/${delivery.notificationId}`) : db.collection(`users/${uid}/notifications`).doc();
  if (!delivery?.alreadyStored) await ref.set({
    kind: payload.kind, title: payload.title, body: payload.body,
    actorUid: payload.actorUid ?? null, eventId: payload.eventId ?? null,
    ...(payload.extra ?? {}),
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
  if (inEmulator) return;
  try {
    const user = await db.collection("users").doc(uid).get();
    const tokens: string[] = Array.isArray(user.data()?.fcmTokens) ? user.data()!.fcmTokens : [];
    if (!tokens.length) return;
    await getMessaging().sendEachForMulticast({
      tokens: tokens.slice(0, 10),
      notification: { title: payload.title, body: payload.body },
      data: { kind: payload.kind, eventId: payload.eventId ?? "", notificationId: ref.id },
    });
  } catch (e) {
    console.warn(`[notify] push failed for ${uid}:`, e);
  }
}

// ── Follows ─────────────────────────────────────────────────────────────────

/**
 * followUser — follow or unfollow a member or an organizer.
 * Blocks in EITHER direction refuse the follow server-side. Counts are
 * maintained in the same transaction as the edge.
 */
export const followUser = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to follow people.");
  await enforceRateLimit(uid, "followUser");
  await assertNotSuspended(uid);

  const targetId = safeText(req.data?.targetId, 128);
  const kind = (safeString(req.data?.kind, "user") as FollowKind);
  const follow = safeBool(req.data?.follow, true);
  if (!targetId || targetId.includes("/")) throw new HttpsError("invalid-argument", "Missing target.");
  if (kind !== "user" && kind !== "organizer") throw new HttpsError("invalid-argument", "Unknown follow kind.");
  if (targetId === uid) throw new HttpsError("failed-precondition", "You can't follow yourself.");
  if (kind === "user" && follow) {
    throw new HttpsError("failed-precondition", "Send a friend request instead.");
  }

  let targetName = "";
  let targetOwnerUid: string | null = null;
  if (kind === "organizer") {
    const org = await db.collection("organizers").doc(targetId).get();
    if (!org.exists) throw new HttpsError("not-found", "That organizer doesn't exist.");
    if (org.data()?.hidden === true || org.data()?.removed === true) throw new HttpsError("not-found", "That organizer isn't available.");
    targetName = safeText(org.data()?.displayName, 60);
    targetOwnerUid = safeString(org.data()?.ownerUid) || null;
  } else {
    targetName = (await profileBits(targetId)).displayName;
  }
  // The block check applies to the person behind an organizer too.
  const blockedAgainst = kind === "organizer" ? targetOwnerUid : targetId;
  if (follow && blockedAgainst && await isBlockedEitherWay(uid, blockedAgainst)) {
    throw new HttpsError("permission-denied", "You can't follow this account.");
  }

  const edgeRef = db.doc(`users/${uid}/following/${targetId}`);
  const meRef = db.collection("users").doc(uid);
  const targetRef = kind === "organizer" ? db.collection("organizers").doc(targetId) : db.collection("users").doc(targetId);

  return db.runTransaction(async (tx) => {
    const edge = await tx.get(edgeRef);
    if (follow && edge.exists) return { following: true, changed: false };
    if (!follow && !edge.exists) return { following: false, changed: false };
    if (follow) {
      tx.set(edgeRef, { uid: targetId, kind, displayName: targetName, createdAt: FieldValue.serverTimestamp() });
      tx.set(meRef, { followingCount: FieldValue.increment(1) }, { merge: true });
      tx.set(targetRef, { followerCount: FieldValue.increment(1) }, { merge: true });
    } else {
      tx.delete(edgeRef);
      tx.set(meRef, { followingCount: FieldValue.increment(-1) }, { merge: true });
      tx.set(targetRef, { followerCount: FieldValue.increment(-1) }, { merge: true });
    }
    return { following: follow, changed: true };
  });
});

// ── Going / RSVP ────────────────────────────────────────────────────────────

/** Is this event something a member may RSVP to right now? */
async function loadRsvpableEvent(eventId: string, uid?: string) {
  const snap = await db.collection("events").doc(eventId).get();
  if (!snap.exists) throw new HttpsError("not-found", "That event no longer exists.");
  const ev = snap.data()!;
  if (ev.category === "Program" || ev.opportunitySubtype === "program") throw new HttpsError("failed-precondition", "Read the official program listing on the organization's site.");
  if (ev.hidden === true || ev.removed === true || ev.active === false) {
    throw new HttpsError("failed-precondition", "That event isn't available.");
  }
  // Minor protection (W2): only a recorded adult may RSVP to, or invite anyone to, an adult-only listing.
  if (ev.adultOnly === true && uid && !(await isAdultAccount(uid))) {
    throw new HttpsError("permission-denied", "This listing is for adults.");
  }
  return { ref: snap.ref, data: ev };
}

/** registerAgeBand recorded this account as an adult. Missing or unknown age reads as a minor. */
export async function isAdultAccount(uid: string): Promise<boolean> {
  return (await db.collection("users").doc(uid).get()).data()?.ageBand === "adult";
}

/**
 * rsvpToEvent — mark yourself Going (or not). Writes the attendee record,
 * keeps the public count honest, records the offline "Going" state on the
 * user, closes any pending invites for this event, and tells friends who saved
 * the event.
 */
export const rsvpToEvent = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to RSVP.");
  await enforceRateLimit(uid, "rsvpToEvent");
  await assertNotSuspended(uid);

  const eventId = safeText(req.data?.eventId, 200);
  const going = safeBool(req.data?.going, true);
  if (!eventId || eventId.includes("/")) throw new HttpsError("invalid-argument", "Missing eventId.");

  const { ref: eventRef, data: ev } = await loadRsvpableEvent(eventId, uid);
  // An event from an organizer who blocked you (or whom you blocked) is off limits.
  const organizerOwner = safeString(ev.organizerOwnerUid) || (safeString(ev.creatorID).startsWith("system") ? "" : safeString(ev.creatorID));
  if (going && organizerOwner && organizerOwner !== uid && await isBlockedEitherWay(uid, organizerOwner)) {
    throw new HttpsError("permission-denied", "You can't RSVP to this event.");
  }

  const me = await profileBits(uid);
  const attendeeRef = eventRef.collection("attendees").doc(uid);
  const userRef = db.collection("users").doc(uid);
  const alertRef = rsvpAlertRef(uid, eventId);

  const outcome = await db.runTransaction(async (tx) => {
    const existing = await tx.get(attendeeRef);
    const evNow = await tx.get(eventRef);
    const alert = await tx.get(alertRef);
    const count = Number(evNow.data()?.attendeeCount) || 0;
    if (going) {
      if (existing.exists) return { going: true, changed: false, attendeeCount: count };
      tx.set(attendeeRef, {
        uid, displayName: me.displayName, initials: me.initials, visibility: me.visibility,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(eventRef, { attendeeCount: count + 1 }, { merge: true });
      tx.set(userRef, { rsvpEventIDs: FieldValue.arrayUnion(eventId), lastUpdated: FieldValue.serverTimestamp() }, { merge: true });
      if (alert.data()?.status !== "sent") tx.set(alertRef, {
        uid, eventId, status: "queued",
        dueAt: Timestamp.fromMillis(rsvpAlertDueAt(evNow.data()?.date?.toMillis?.() ?? 0, Date.now())),
        createdAt: FieldValue.serverTimestamp(),
      });
      return { going: true, changed: true, attendeeCount: count + 1 };
    }
    if (!existing.exists) return { going: false, changed: false, attendeeCount: count };
    tx.delete(attendeeRef);
    tx.set(eventRef, { attendeeCount: Math.max(0, count - 1) }, { merge: true });
    tx.set(userRef, { rsvpEventIDs: FieldValue.arrayRemove(eventId), lastUpdated: FieldValue.serverTimestamp() }, { merge: true });
    if (alert.exists && alert.data()?.status !== "sent") tx.update(alertRef, { status: "cancelled" });
    return { going: false, changed: true, attendeeCount: Math.max(0, count - 1) };
  });

  if (outcome.changed && going) {
    // Close the loop on invites: the inviter learns their friend is coming.
    const invites = await db.collection(`users/${uid}/invites`).where("eventId", "==", eventId).where("status", "==", "pending").get();
    for (const inv of invites.docs) {
      await inv.ref.set({ status: "accepted", respondedAt: FieldValue.serverTimestamp() }, { merge: true });
      const fromUid = safeString(inv.data().fromUid);
      if (fromUid && !(await isBlockedEitherWay(uid, fromUid))) {
        await notify(fromUid, {
          kind: "invite-accepted", actorUid: uid, eventId,
          title: `${me.displayName} is going`,
          body: `${me.displayName} accepted your invite to ${safeText(ev.title, 80)}.`,
        });
      }
    }
    // "A notification when a friend RSVPs to an event the user has saved."
    const savers = await db.collection("users").where("savedEventIDs", "array-contains", eventId).limit(200).get();
    for (const saver of savers.docs) {
      const target = saver.id;
      if (target === uid) continue;
      if (await isBlockedEitherWay(uid, target)) continue;
      // A follow is not consent to disclose where someone is going.
      if (!(await areFriends(target, uid))) continue;
      // Preferences, quiet hours and the 2/week push cap. The privacy checks
      // above stay here because they are specific to RSVP visibility; mayPush
      // owns only the things every discretionary push shares. A true result has
      // already spent a budget slot, so it must be the last check before send.
      if (!(await mayPush(target, "friend_activity"))) continue;
      await notify(target, {
        kind: "friend-rsvp", actorUid: uid, eventId,
        title: `${me.displayName} is going`,
        body: `${me.displayName} is going to ${safeText(ev.title, 80)} — you saved it.`,
      });
    }
    // Activity feed entry (read by friendsFeed, privacy applied at read time).
    await db.collection("activity").add({
      kind: "rsvp", actorUid: uid, actorName: me.displayName, actorInitials: me.initials,
      visibility: me.visibility, eventId, eventTitle: safeText(ev.title, 120),
      eventDate: ev.date ?? null, createdAt: FieldValue.serverTimestamp(),
    });
  }
  return outcome;
});

// ── Invites ─────────────────────────────────────────────────────────────────

/**
 * inviteToEvent — send an event to accepted friends. Blocks refuse silently
 * per recipient, and each recipient gets one invite per (event, sender).
 */
export const inviteToEvent = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to invite friends.");
  await enforceRateLimit(uid, "inviteToEvent");
  await assertNotSuspended(uid);

  const eventId = safeText(req.data?.eventId, 200);
  const raw = Array.isArray(req.data?.toUids) ? req.data.toUids : [];
  const toUids: string[] = Array.from(new Set(
    (raw as unknown[]).map((v) => safeText(v, 128)).filter((v) => v && v !== uid && !v.includes("/")),
  )).slice(0, MAX_INVITES_PER_CALL);
  const message = safeText(req.data?.message, 280);
  if (!eventId || eventId.includes("/")) throw new HttpsError("invalid-argument", "Missing eventId.");
  if (!toUids.length) throw new HttpsError("invalid-argument", "Choose at least one friend.");

  const { data: ev } = await loadRsvpableEvent(eventId, uid);
  const me = await profileBits(uid);
  const delivered: string[] = [], skipped: string[] = [];

  for (const target of toUids) {
    if (!(await areFriends(uid, target))) { skipped.push(target); continue; }
    if (await isBlockedEitherWay(uid, target)) { skipped.push(target); continue; }
    // A minor is never invited to an adult-only listing, even by an adult friend.
    if (ev.adultOnly === true && !(await isAdultAccount(target))) { skipped.push(target); continue; }
    const inviteRef = db.doc(`users/${target}/invites/${docIdFrom(eventId, uid)}`);
    const existing = await inviteRef.get();
    if (existing.exists) { skipped.push(target); continue; }
    await inviteRef.set({
      eventId, eventTitle: safeText(ev.title, 120), eventDate: ev.date ?? null,
      fromUid: uid, fromName: me.displayName, fromInitials: me.initials,
      message, status: "pending", createdAt: FieldValue.serverTimestamp(),
    });
    await notify(target, {
      kind: "invite", actorUid: uid, eventId,
      title: `${me.displayName} invited you`,
      body: message ? `${safeText(ev.title, 80)} — “${message}”` : `Come to ${safeText(ev.title, 80)}?`,
      extra: { inviteId: inviteRef.id },
    });
    delivered.push(target);
  }
  return { delivered, skipped };
});

/** Decline an invite (accepting happens through rsvpToEvent). */
export const respondToInvite = onCall(async (req) => {
  const uid = requireUid(req.auth);
  const inviteId = safeText(req.data?.inviteId, 900);
  if (!inviteId || inviteId.includes("/")) throw new HttpsError("invalid-argument", "Missing inviteId.");
  const ref = db.doc(`users/${uid}/invites/${inviteId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invite not found.");
  await ref.set({ status: "declined", respondedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { status: "declined" };
});

// ── Friends going ───────────────────────────────────────────────────────────

/**
 * friendsGoing — for up to 50 events, accepted friends going, plus a
 * count. This is what the avatar stack on cards, the feed and the planner use;
 * privacy is decided here, never by the client filtering a list it can't read.
 */
export const friendsGoing = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "friendsGoing");
  const raw = Array.isArray(req.data?.eventIds) ? req.data.eventIds : [];
  const eventIds: string[] = Array.from(new Set(
    (raw as unknown[]).map((v) => safeText(v, 200)).filter((v) => v && !v.includes("/")),
  )).slice(0, MAX_FRIENDS_GOING_EVENTS);
  if (!eventIds.length) return { events: {} };

  const [friendUids, blocked] = await Promise.all([friendIds(uid), blockedSetFor(uid)]);
  const accepted = new Set(friendUids.filter((id) => !blocked.has(id)));
  if (!accepted.size) return { events: Object.fromEntries(eventIds.map((id) => [id, { count: 0, friends: [] }])) };

  const events: Record<string, { count: number; friends: { uid: string; displayName: string; initials: string }[] }> = {};
  for (const eventId of eventIds) {
    const attendees = await db.collection(`events/${eventId}/attendees`).get();
    const friends: { uid: string; displayName: string; initials: string }[] = [];
    for (const a of attendees.docs) {
      const other = a.id;
      if (other === uid || !accepted.has(other)) continue;
      if (blocked.has(other)) continue;
      friends.push({ uid: other, displayName: safeText(a.data().displayName, 60), initials: safeText(a.data().initials, 3) });
    }
    events[eventId] = { count: friends.length, friends: friends.slice(0, FRIEND_AVATARS) };
  }
  return { events };
});

/** A bounded upcoming view that does not depend on which events the client
 * happened to load first. It reads accepted friend profiles only; old follows
 * and a public activity flag cannot grant access. */
export const friendsUpcoming = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "friendsUpcoming");
  const [ids, blocked, viewerIsAdult] = await Promise.all([friendIds(uid, 100), blockedSetFor(uid), isAdultAccount(uid)]);
  const visible = ids.filter((id) => !blocked.has(id));
  const profiles = await Promise.all(visible.map((id) => db.collection("users").doc(id).get()));
  const people = new Map<string, string[]>();
  for (const profile of profiles) {
    const name = safeText(profile.data()?.displayName, 60) || "A friend";
    const rsvps = Array.isArray(profile.data()?.rsvpEventIDs) ? profile.data()!.rsvpEventIDs as unknown[] : [];
    for (const raw of rsvps.slice(-20)) {
      const eventId = safeText(raw, 200);
      if (!eventId || eventId.includes("/")) continue;
      const names = people.get(eventId) ?? [];
      if (names.length < 5) names.push(name);
      people.set(eventId, names);
    }
  }
  const eventIds = Array.from(people.keys()).slice(0, 150);
  const eventDocs = await Promise.all(eventIds.map((id) => db.collection("events").doc(id).get()));
  const now = Date.now();
  const events = eventDocs.flatMap((doc) => {
    const x = doc.data();
    const startsAt = typeof x?.date?.toMillis === "function" ? x.date.toMillis() as number : 0;
    if (!x || x.active !== true || x.hidden === true || startsAt < now) return [];
    if (x.adultOnly === true && !viewerIsAdult) return [];   // minor protection (W2)
    return [{
      id: doc.id, title: safeText(x.title, 120),
      locationName: safeText(x.locationName, 100), startsAt,
      friends: people.get(doc.id) ?? [],
    }];
  }).sort((a, b) => a.startsAt - b.startsAt).slice(0, 20);
  return { events };
});

/** Exported for organizer / feed modules. */
export { profileBits, follows };

// ── Friends leaderboard (G4) ────────────────────────────────────────────────
//
// WHY THIS IS A CALLABLE AND NOT A QUERY. A leaderboard is the one social
// feature where the ranking IS the payload, so it has to be computed somewhere
// the numbers can be trusted. If the client read friends' point balances
// directly it would need read access to other users' documents, which would
// leak their email, their RSVPs and their subscription state alongside the
// score. Rules therefore deny that read outright, and this returns the only
// three fields a leaderboard needs.
//
// Scores are never written here. `pointsBalance` and `lifetimePoints` are
// already server-owned and client-unwritable (see noServerOwnedFieldChanges),
// which is what makes a leaderboard position meaningful rather than a claim.
export const friendsLeaderboard = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "friendsLeaderboard");

  const period = safeString(req.data?.period) === "month" ? "month" : "allTime";

  const [meSnap, accepted] = await Promise.all([
    db.collection("users").doc(uid).get(),
    friendIds(uid),
  ]);

  const candidates = [uid, ...accepted];
  const rows: { uid: string; displayName: string; initials: string; points: number; isMe: boolean }[] = [];

  for (const id of candidates) {
    const snap = id === uid ? meSnap : await db.collection("users").doc(id).get();
    const d = snap.data();
    if (!d || d.suspended === true) continue;
    // Blocks are symmetric and win over everything — including a leaderboard
    // that would otherwise reintroduce a blocked person into someone's feed.
    if (id !== uid && await isBlockedEitherWay(uid, id)) continue;

    // Monthly uses the same ledger the earn cap reads, so the two can never
    // disagree about what this month's points were.
    // A stale lastEarnMonth means they have earned nothing THIS month, so the
    // total is 0 — no cron needed to reset it. See recordPointsIssued.
    const points = period === "month"
      ? (String(d.lastEarnMonth ?? "") === currentMonthKey() ? Number(d.monthlyEarnPoints) || 0 : 0)
      : Number(d.lifetimePoints) || 0;

    rows.push({
      uid: id,
      displayName: safeText(d.displayName, 60) || "Verdure member",
      initials: safeText(d.initials, 3) || safeText(d.displayName, 1).toUpperCase(),
      points,
      isMe: id === uid,
    });
  }

  rows.sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));

  return {
    period,
    // Rank is assigned AFTER sorting so ties share a position rather than
    // silently ordering one friend above another on a coin flip.
    rows: rows.map((r, i) => ({
      ...r,
      rank: i > 0 && rows[i - 1].points === r.points ? undefined : i + 1,
    })),
    // Said plainly so a one-row leaderboard reads as "follow someone" rather
    // than "you have no friends".
    isSolo: rows.length <= 1,
  };
});

function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
