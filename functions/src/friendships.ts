/**
 * Accepted, two-sided friendships. The client may read only its own copies;
 * every edge and request is written by these callables in a transaction.
 * Legacy user follows are deliberately not considered consent.
 */
import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  db, requireUid, enforceRateLimit, assertNotSuspended,
  safeText, isBlockedEitherWay,
} from "./common.js";

const user = (uid: string) => db.collection("users").doc(uid);
const friend = (uid: string, peer: string) => user(uid).collection("friends").doc(peer);
const request = (uid: string, peer: string) => user(uid).collection("friendRequests").doc(peer);

function validUid(value: unknown): string {
  const uid = safeText(value, 128);
  if (!uid || uid.includes("/")) throw new HttpsError("invalid-argument", "Invalid member.");
  return uid;
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  return (await friend(a, b).get()).exists;
}

export async function friendIds(uid: string, limit = 200): Promise<string[]> {
  const snap = await user(uid).collection("friends").limit(limit).get();
  return snap.docs.map((d) => d.id);
}

/** A share/QR invite has an unguessable token. Existing unknown-age accounts
 * also require this path; they cannot accidentally become searchable adults. */
export const myFriendInvite = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "myFriendInvite");
  const ref = user(uid);
  const created = randomBytes(24).toString("base64url");
  const token = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = safeText(snap.data()?.friendInviteToken, 64);
    if (existing) return existing;
    tx.set(ref, { friendInviteToken: created }, { merge: true });
    return created;
  });
  // Keep the private token in the fragment so it is not sent in the HTTP
  // request URL or referrer. The landing page clears the fragment on load.
  return { uid, token, url: `https://verdure-app.com/invite#uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}` };
});

/** Exact username claim. No public /usernames reads are permitted by rules. */
export const claimUsername = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "claimUsername");
  await assertNotSuspended(uid);
  const name = safeText(req.data?.username, 24).toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(name)) {
    throw new HttpsError("invalid-argument", "Use 3–24 letters, numbers or underscores, starting with a letter.");
  }
  const nameRef = db.collection("usernames").doc(name);
  const me = user(uid);
  await db.runTransaction(async (tx) => {
    const [reserved, profile] = await Promise.all([tx.get(nameRef), tx.get(me)]);
    if (reserved.exists && reserved.data()?.uid !== uid) {
      throw new HttpsError("already-exists", "That username is taken.");
    }
    const old = safeText(profile.data()?.username, 24);
    const oldRef = old && old !== name ? db.collection("usernames").doc(old) : null;
    const oldSnap = oldRef ? await tx.get(oldRef) : null;
    if (oldRef && oldSnap?.data()?.uid === uid) tx.delete(oldRef);
    tx.set(nameRef, { uid, username: name, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(me, { username: name }, { merge: true });
  });
  return { username: name };
});

/** Exact match only. Minor and unknown-age accounts are never returned. */
export const findFriendByUsername = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "findFriendByUsername");
  const name = safeText(req.data?.username, 24).toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(name)) return { member: null };
  const hit = await db.collection("usernames").doc(name).get();
  const target = safeText(hit.data()?.uid, 128);
  if (!target || target === uid || await isBlockedEitherWay(uid, target)) return { member: null };
  const profile = await user(target).get();
  const data = profile.data();
  if (data?.ageBand !== "adult" || data.suspended === true) return { member: null };
  return { member: { uid: target, username: name, displayName: safeText(data.displayName, 60) || "Verdure member" } };
});

/** Opt-in discovery through a completed event. Never enumerate current or
 * future attendees, and never show minor/unknown-age profiles to an adult. */
export const sharedPastEventMembers = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "sharedPastEventMembers");
  const mine = await user(uid).get();
  const ids: string[] = Array.isArray(mine.data()?.rsvpEventIDs)
    ? mine.data()!.rsvpEventIDs.filter((v: unknown): v is string =>
      typeof v === "string" && v.length < 180 && !v.includes("/")).slice(-10) : [];
  if (!ids.length) return { members: [] };
  const alreadyFriends = new Set(await friendIds(uid, 200));
  const members: Array<{ uid: string; displayName: string; eventTitle: string }> = [];
  const seen = new Set<string>([uid]);
  for (const eventId of ids.reverse()) {
    const eventRef = db.collection("events").doc(eventId);
    const event = await eventRef.get();
    const eventData = event.data();
    // Ingest marks old listings inactive after they disappear from a source;
    // that does not erase a real shared RSVP. Moderated/removed rows stay out.
    if (!eventData || eventData.hidden === true || eventData.removed === true) continue;
    const starts = eventData.date instanceof Timestamp ? eventData.date.toMillis() : Infinity;
    const ends = eventData.endDate instanceof Timestamp ? eventData.endDate.toMillis() :
      starts + 24 * 60 * 60 * 1000;
    if (starts > Date.now() || ends > Date.now() || ends < starts) continue;
    const ownRsvp = await eventRef.collection("attendees").doc(uid).get();
    const ownAt = ownRsvp.data()?.createdAt;
    if (!(ownAt instanceof Timestamp) || ownAt.toMillis() > ends) continue;
    const attendees = await eventRef.collection("attendees").limit(40).get();
    for (const attendee of attendees.docs) {
      const peerAt = attendee.data().createdAt;
      if (!(peerAt instanceof Timestamp) || peerAt.toMillis() > ends) continue;
      const peer = attendee.id;
      if (seen.has(peer) || alreadyFriends.has(peer)) continue;
      seen.add(peer);
      if (await isBlockedEitherWay(uid, peer)) continue;
      const profile = await user(peer).get();
      if (profile.data()?.ageBand !== "adult" || profile.data()?.suspended === true) continue;
      members.push({ uid: peer,
        displayName: safeText(profile.data()?.displayName, 60) || "Verdure member",
        eventTitle: safeText(eventData.title, 80) || "a shared event" });
      if (members.length >= 12) break;
    }
    if (members.length >= 12) break;
  }
  return { members };
});

/** Record age privately, once. Unknown age remains private by default. */
export const registerAgeBand = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "registerAgeBand");
  const year = Number(req.data?.birthYear);
  const nowYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < nowYear - 110 || year > nowYear - 13) {
    throw new HttpsError("invalid-argument", "Verdure accounts require age 13 or older.");
  }
  // Conservative at age 18: treat as a minor through the entire birth year.
  const ageBand = nowYear - year > 18 ? "adult" : "minor";
  await db.runTransaction(async (tx) => {
    const ref = user(uid);
    const snap = await tx.get(ref);
    if (snap.data()?.birthYear !== undefined) {
      if (snap.data()?.birthYear !== year) throw new HttpsError("failed-precondition", "Birth year is already set.");
      return;
    }
    tx.set(ref, { birthYear: year, ageBand }, { merge: true });
  });
  return { ageBand };
});

export const sendFriendRequest = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to add a friend.");
  await enforceRateLimit(uid, "sendFriendRequest");
  await assertNotSuspended(uid);
  const target = validUid(req.data?.targetUid);
  if (target === uid) throw new HttpsError("failed-precondition", "You can't add yourself.");
  if (await isBlockedEitherWay(uid, target)) throw new HttpsError("permission-denied", "Friend request unavailable.");
  const [meSnap, targetSnap] = await Promise.all([user(uid).get(), user(target).get()]);
  if (!targetSnap.exists || targetSnap.data()?.suspended === true) {
    throw new HttpsError("not-found", "That member isn't available.");
  }
  const targetData = targetSnap.data() ?? {};
  if (targetData.ageBand !== "adult") {
    const token = safeText(req.data?.inviteToken, 64);
    if (!token || token !== targetData.friendInviteToken) {
      throw new HttpsError("permission-denied", "Use this member's private invite link or QR code.");
    }
  }
  const meName = safeText(meSnap.data()?.displayName, 60) || "Verdure member";
  const targetName = safeText(targetData.displayName, 60) || "Verdure member";
  const mine = request(uid, target), theirs = request(target, uid);
  return db.runTransaction(async (tx) => {
    const [existingFriend, outgoing, incoming, latestTarget, blockedByMe, blockedByThem] = await Promise.all([
      tx.get(friend(uid, target)), tx.get(mine), tx.get(theirs), tx.get(user(target)),
      tx.get(user(uid).collection("blocks").doc(target)),
      tx.get(user(target).collection("blocks").doc(uid)),
    ]);
    if (blockedByMe.exists || blockedByThem.exists) {
      throw new HttpsError("permission-denied", "Friend request unavailable.");
    }
    if (!latestTarget.exists || latestTarget.data()?.suspended === true) {
      throw new HttpsError("not-found", "That member isn't available.");
    }
    if (latestTarget.data()?.ageBand !== "adult" &&
        safeText(req.data?.inviteToken, 64) !== latestTarget.data()?.friendInviteToken) {
      throw new HttpsError("permission-denied", "Use this member's private invite link or QR code.");
    }
    if (existingFriend.exists) return { status: "friends", changed: false };
    if (outgoing.exists || incoming.exists) {
      const row = outgoing.data() ?? incoming.data();
      return { status: row?.fromUid === uid ? "pending_sent" : "pending_received", changed: false };
    }
    const base = { fromUid: uid, toUid: target, status: "pending", createdAt: FieldValue.serverTimestamp() };
    tx.set(mine, { ...base, peerUid: target, peerName: targetName });
    tx.set(theirs, { ...base, peerUid: uid, peerName: meName });
    return { status: "pending_sent", changed: true };
  });
});

export const respondToFriendRequest = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "respondToFriendRequest");
  await assertNotSuspended(uid);
  const from = validUid(req.data?.fromUid);
  const accept = req.data?.accept === true;
  if (from === uid) throw new HttpsError("invalid-argument", "Invalid requester.");
  if (accept && await isBlockedEitherWay(uid, from)) {
    throw new HttpsError("permission-denied", "Friend request unavailable.");
  }
  const incoming = request(uid, from), outgoing = request(from, uid);
  return db.runTransaction(async (tx) => {
    const [row, me, them, blockedByMe, blockedByThem] = await Promise.all([
      tx.get(incoming), tx.get(user(uid)), tx.get(user(from)),
      tx.get(user(uid).collection("blocks").doc(from)),
      tx.get(user(from).collection("blocks").doc(uid)),
    ]);
    if (!row.exists || row.data()?.fromUid !== from || row.data()?.toUid !== uid) {
      throw new HttpsError("not-found", "That request is no longer pending.");
    }
    tx.delete(incoming);
    tx.delete(outgoing);
    if (accept) {
      if (blockedByMe.exists || blockedByThem.exists) {
        throw new HttpsError("permission-denied", "Friend request unavailable.");
      }
      if (!them.exists) throw new HttpsError("not-found", "That member isn't available.");
      tx.set(friend(uid, from), {
        uid: from, displayName: safeText(them.data()?.displayName, 60) || "Verdure member",
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(friend(from, uid), {
        uid, displayName: safeText(me.data()?.displayName, 60) || "Verdure member",
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { status: accept ? "accepted" : "declined" };
  });
});

export const removeFriend = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "removeFriend");
  const peer = validUid(req.data?.peerUid);
  if (peer === uid) throw new HttpsError("invalid-argument", "Invalid friend.");
  const own = friend(uid, peer), other = friend(peer, uid);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(own);
    tx.delete(own);
    tx.delete(other);
    return { removed: current.exists };
  });
});
