/** Private, friend-only shared plans. No chat, public attendee list or
 * automatic RSVP: every participant chooses Going on their own account. */
import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, safeText, isBlockedEitherWay } from "./common.js";
import { areFriends } from "./friendships.js";

const plans = db.collection("groupPlans");
const validId = (value: unknown, max = 100) => {
  const id = safeText(value, max);
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Invalid plan or event.");
  return id;
};

async function validEvent(id: string, viewerIsAdult = false): Promise<boolean> {
  const snap = await db.collection("events").doc(id).get();
  const data = snap.data();
  return !!data && data.category !== "Program" && data.opportunitySubtype !== "program" && data.active === true && data.broadcast === true && data.hidden !== true &&
    (data.adultOnly !== true || viewerIsAdult) &&   // minor protection (W2)
    data.date instanceof Timestamp && data.date.toMillis() > Date.now();
}

function view(id: string, data: FirebaseFirestore.DocumentData, uid: string) {
  const members: string[] = Array.isArray(data.memberUIDs) ? data.memberUIDs : [];
  const pending: string[] = Array.isArray(data.pendingUIDs) ? data.pendingUIDs : [];
  const votes: Record<string, string[]> = typeof data.votes === "object" && data.votes ? data.votes : {};
  const counts: Record<string, number> = {};
  for (const ids of Object.values(votes)) for (const eventId of ids) {
    if ((data.eventIDs as string[]).includes(eventId)) counts[eventId] = (counts[eventId] ?? 0) + 1;
  }
  return { id, title: safeText(data.title, 80), ownerUid: data.ownerUid,
    eventIDs: data.eventIDs, memberCount: members.length, pendingCount: pending.length,
    pendingUIDs: data.ownerUid === uid ? pending : [], votes: counts,
    myVotes: votes[uid] ?? [], invitation: pending.includes(uid),
  };
}

export const manageGroupPlan = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "manageGroupPlan");
  const action = safeText(req.data?.action, 20);
  const viewerIsAdult = (await db.collection("users").doc(uid).get()).data()?.ageBand === "adult";
  if (action === "list") {
    const [member, invited] = await Promise.all([
      plans.where("memberUIDs", "array-contains", uid).limit(20).get(),
      plans.where("pendingUIDs", "array-contains", uid).limit(20).get(),
    ]);
    const all = new Map([...member.docs, ...invited.docs].map((doc) => [doc.id, doc]));
    const visible = [];
    for (const doc of all.values()) {
      const data = doc.data();
      if (data.ownerUid !== uid &&
          (!await areFriends(uid, data.ownerUid) || await isBlockedEitherWay(uid, data.ownerUid))) continue;
      visible.push(view(doc.id, data, uid));
    }
    return { plans: visible };
  }
  if (action === "create") {
    const sessionId = validId(req.data?.sessionId);
    const [source, owned] = await Promise.all([
      db.collection("eventPlanSessions").doc(sessionId).get(),
      plans.where("ownerUid", "==", uid).limit(20).get(),
    ]);
    if (source.data()?.uid !== uid) throw new HttpsError("not-found", "Plan session not found.");
    if (owned.size >= 20) throw new HttpsError("resource-exhausted", "Delete an older group plan first.");
    const eventIDs: string[] = Array.isArray(source.data()?.selectedIDs) ? source.data()?.selectedIDs.slice(0, 4) : [];
    if (eventIDs.length < 2 || !(await Promise.all(eventIDs.map((id) => validEvent(id, viewerIsAdult)))).every(Boolean)) {
      throw new HttpsError("failed-precondition", "Start with at least two active real events.");
    }
    const ref = plans.doc(randomBytes(12).toString("base64url"));
    await ref.create({ ownerUid: uid, memberUIDs: [uid], pendingUIDs: [],
      eventIDs, votes: {}, title: safeText(req.data?.title, 80) || "A plan together",
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { plan: view(ref.id, (await ref.get()).data()!, uid) };
  }

  const planId = validId(req.data?.planId);
  const ref = plans.doc(planId);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!data) throw new HttpsError("not-found", "Group plan not found.");
  const owner = safeText(data.ownerUid, 128);
  const members: string[] = Array.isArray(data.memberUIDs) ? data.memberUIDs : [];
  const pending: string[] = Array.isArray(data.pendingUIDs) ? data.pendingUIDs : [];
  if (uid !== owner && (!await areFriends(uid, owner) || await isBlockedEitherWay(uid, owner))) {
    throw new HttpsError("not-found", "Group plan not found.");
  }
  if (action === "get") {
    if (!members.includes(uid) && !pending.includes(uid)) throw new HttpsError("not-found", "Group plan not found.");
    return { plan: view(planId, data, uid) };
  }
  if (action === "invite") {
    if (uid !== owner) throw new HttpsError("permission-denied", "Only the owner can invite.");
    const peer = validId(req.data?.peerUid, 128);
    if (!await areFriends(uid, peer) || await isBlockedEitherWay(uid, peer)) {
      throw new HttpsError("permission-denied", "Invite an accepted friend.");
    }
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      const row = latest.data();
      if (!row || row.ownerUid !== uid) throw new HttpsError("not-found", "Group plan not found.");
      const active: string[] = row.memberUIDs ?? [];
      const waiting: string[] = row.pendingUIDs ?? [];
      if (active.length + waiting.length >= 8) throw new HttpsError("resource-exhausted", "Group is full.");
      if (!active.includes(peer) && !waiting.includes(peer)) tx.update(ref, {
        pendingUIDs: FieldValue.arrayUnion(peer), updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } else if (action === "respond") {
    const accept = req.data?.accept === true;
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      const row = latest.data();
      if (!row || !(row.pendingUIDs ?? []).includes(uid)) throw new HttpsError("not-found", "Invite not found.");
      tx.update(ref, {
        pendingUIDs: FieldValue.arrayRemove(uid),
        ...(accept ? { memberUIDs: FieldValue.arrayUnion(uid) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } else if (action === "vote") {
    if (!members.includes(uid)) throw new HttpsError("permission-denied", "Accept the invitation first.");
    const eventId = validId(req.data?.eventId, 180);
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      const row = latest.data();
      if (!row || !(row.memberUIDs ?? []).includes(uid) || !(row.eventIDs ?? []).includes(eventId)) {
        throw new HttpsError("permission-denied", "Event is not in this plan.");
      }
      const votes: Record<string, string[]> = { ...(row.votes ?? {}) };
      const mine = new Set(votes[uid] ?? []);
      if (mine.has(eventId)) mine.delete(eventId); else mine.add(eventId);
      votes[uid] = [...mine];
      tx.update(ref, { votes, updatedAt: FieldValue.serverTimestamp() });
    });
  } else if (action === "add") {
    if (!members.includes(uid)) throw new HttpsError("permission-denied", "Accept the invitation first.");
    const eventId = validId(req.data?.eventId, 180);
    if (!await validEvent(eventId, viewerIsAdult)) throw new HttpsError("not-found", "Event unavailable.");
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      const row = latest.data();
      if (!row || !(row.memberUIDs ?? []).includes(uid)) throw new HttpsError("permission-denied", "Not a member.");
      if ((row.eventIDs ?? []).length >= 10) throw new HttpsError("resource-exhausted", "Plan is full.");
      tx.update(ref, { eventIDs: FieldValue.arrayUnion(eventId), updatedAt: FieldValue.serverTimestamp() });
    });
  } else if (action === "remove" || action === "delete") {
    if (uid !== owner) throw new HttpsError("permission-denied", "Only the owner can edit this plan.");
    if (action === "delete") await ref.delete();
    else {
      const eventId = validId(req.data?.eventId, 180);
      await ref.update({ eventIDs: FieldValue.arrayRemove(eventId), updatedAt: FieldValue.serverTimestamp() });
    }
  } else {
    throw new HttpsError("invalid-argument", "Unknown group-plan action.");
  }
  if (action === "delete") return { deleted: true };
  return { plan: view(planId, (await ref.get()).data()!, uid) };
});
