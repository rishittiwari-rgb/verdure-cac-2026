/**
 * Account lifecycle — in-app account deletion (App Review 5.1.1(v)).
 *
 * WHY SERVER-SIDE. A client that deletes its own data walks a list of
 * collections it happens to know about, and stops the moment the app is killed
 * or the network drops — leaving GPS audit rows, a proof photo, a queued gift
 * card, or an organizer's events with no owner. The Firestore rules also forbid
 * clients from deleting most of this (attendance, fulfillments, other people's
 * attendee lists). So deletion is one callable run by the Admin SDK: it sweeps
 * every place the account left a trace, in a fixed order, and deletes the Auth
 * user LAST so a failure part-way leaves an account that can simply retry.
 *
 * WHAT IS KEPT. Fulfilment rows that were actually SENT are financial records
 * (a card was paid for); they are anonymised — uid and delivery email stripped —
 * not deleted, so the treasury still reconciles. Pending/failed rows are
 * deleted: nothing was delivered, nothing is owed. Reports the user filed keep
 * their queue effect but lose the reporter identity.
 *
 * Every cleaner below is idempotent, so a retried deletion is harmless.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { db, requireUid, enforceRateLimit, deleteQueryBatched, docIdFrom } from "./common.js";
import { stageStoryStatus } from "./place-stories.js";

const PROOF_BUCKET = process.env.STORAGE_BUCKET || "connectify-19dd8.firebasestorage.app";

export interface DeletionReport {
  uid: string;
  counts: Record<string, number>;
  authDeleted: boolean;
}

type Cleaner = (uid: string, counts: Record<string, number>) => Promise<void>;

function bump(counts: Record<string, number>, key: string, n: number) {
  counts[key] = (counts[key] ?? 0) + n;
}

/** Delete a document and every subcollection under it (recursively, batched). */
async function deleteDocumentTree(ref: FirebaseFirestore.DocumentReference): Promise<number> {
  let n = 0;
  const subs = await ref.listCollections();
  for (const sub of subs) {
    const docs = await sub.listDocuments();
    for (const d of docs) n += await deleteDocumentTree(d);
  }
  await ref.delete();
  return n + 1;
}

// ── Cleaners, in the order they run ─────────────────────────────────────────

/** Community posts the user wrote, plus every like ledger row that points at them. */
const cleanPosts: Cleaner = async (uid, counts) => {
  const posts = await db.collection("posts").where("authorID", "==", uid).get();
  for (const p of posts.docs) {
    bump(counts, "postLikesOnMyPosts",
      await deleteQueryBatched(db.collection("postLikes").where("postId", "==", p.id)));
    await p.ref.delete();
  }
  bump(counts, "posts", posts.size);
  // Likes the user gave to other people's posts. The +1 they contributed stays
  // (it was a real like at the time); the row naming them goes.
  bump(counts, "postLikesGiven",
    await deleteQueryBatched(db.collection("postLikes").where("uid", "==", uid)));
};

/** Events the user created or owns through an organizer profile — with their attendee lists. */
const cleanEvents: Cleaner = async (uid, counts) => {
  const owned = new Map<string, FirebaseFirestore.DocumentReference>();
  const created = await db.collection("events").where("creatorID", "==", uid).get();
  created.forEach((d) => owned.set(d.id, d.ref));
  const viaOrganizer = await db.collection("events").where("organizerOwnerUid", "==", uid).get();
  viaOrganizer.forEach((d) => owned.set(d.id, d.ref));
  for (const ref of owned.values()) {
    bump(counts, "eventDocsRemoved", await deleteDocumentTree(ref));
  }
  bump(counts, "events", owned.size);
};

/** Organizer profiles owned by the user. Their events were removed above — nothing is orphaned. */
const cleanOrganizers: Cleaner = async (uid, counts) => {
  const orgs = await db.collection("organizers").where("ownerUid", "==", uid).get();
  for (const o of orgs.docs) bump(counts, "organizerDocsRemoved", await deleteDocumentTree(o.ref));
  bump(counts, "organizers", orgs.size);
};

/** Run after organizer deletion: a concurrent writer can no longer publish.
 * Transfers are rechecked so deleting a former owner cannot revoke a successor. */
const cleanPlaceStories: Cleaner = async (uid, counts) => {
  const stories = await db.collection("placeStories").where("ownerUid", "==", uid).get();
  for (const story of stories.docs) await db.runTransaction(async (tx) => {
    const current = await tx.get(story.ref);
    if (!current.exists || current.data()?.ownerUid !== uid) return;
    const queueRef = db.doc(`moderationQueue/${docIdFrom("place_story", story.id)}`);
    const queue = await tx.get(queueRef);
    tx.delete(story.ref);
    if (queue.exists) tx.update(queueRef, { authorUid: "deleted-account", snapshot: "[deleted by author]",
      originalContent: FieldValue.delete(), status: "dismissed", resolution: "Author deleted their account" });
  });
  bump(counts, "placeStories", stories.size);
  const assignments = await db.collection("placeStoryOwnership").where("ownerUid", "==", uid).get();
  for (const assignment of assignments.docs) await db.runTransaction(async (tx) => {
    const current = await tx.get(assignment.ref);
    if (!current.exists || current.data()?.ownerUid !== uid) return;
    tx.delete(assignment.ref); stageStoryStatus(tx, assignment.id, undefined);
  });
  bump(counts, "placeStoryOwnership", assignments.size);
  const gate = db.batch(); gate.set(db.doc(`storyAuthorStatus/${uid}`), { allowed: false }); await gate.commit();
};

/** RSVPs the user made on OTHER people's events (events/{id}/attendees/{uid}). */
const cleanAttendeeRecords: Cleaner = async (uid, counts) => {
  const rows = await db.collectionGroup("attendees").where("uid", "==", uid).get();
  for (const row of rows.docs) {
    const eventRef = row.ref.parent.parent;
    await row.ref.delete();
    if (eventRef) {
      // Keep the public count honest; never let it go negative.
      await db.runTransaction(async (tx) => {
        const ev = await tx.get(eventRef);
        if (!ev.exists) return;
        const current = Number(ev.data()?.attendeeCount) || 0;
        if (current > 0) tx.update(eventRef, { attendeeCount: current - 1 });
      });
    }
  }
  bump(counts, "attendeeRecords", rows.size);
};

/** Social graph: who they follow, who follows them, invites they sent, activity they generated. */
const cleanSocialGraph: Cleaner = async (uid, counts) => {
  // Rows in OTHER users' subcollections that name this user.
  bump(counts, "followersOfMe",
    await deleteQueryBatched(db.collectionGroup("following").where("uid", "==", uid)));
  bump(counts, "friendEdgesNamingMe",
    await deleteQueryBatched(db.collectionGroup("friends").where("uid", "==", uid)));
  bump(counts, "friendRequestsFromMe",
    await deleteQueryBatched(db.collectionGroup("friendRequests").where("fromUid", "==", uid)));
  bump(counts, "friendRequestsToMe",
    await deleteQueryBatched(db.collectionGroup("friendRequests").where("toUid", "==", uid)));
  bump(counts, "blocksNamingMe",
    await deleteQueryBatched(db.collectionGroup("blocks").where("uid", "==", uid)));
  bump(counts, "invitesSent",
    await deleteQueryBatched(db.collectionGroup("invites").where("fromUid", "==", uid)));
  bump(counts, "notificationsAboutMe",
    await deleteQueryBatched(db.collectionGroup("notifications").where("actorUid", "==", uid)));
  bump(counts, "activity",
    await deleteQueryBatched(db.collection("activity").where("actorUid", "==", uid)));
  bump(counts, "usernames",
    await deleteQueryBatched(db.collection("usernames").where("uid", "==", uid)));
  bump(counts, "leaderboardEntries",
    await deleteQueryBatched(db.collectionGroup("entries").where("uid", "==", uid)));
  bump(counts, "friendLeaderboards",
    await deleteQueryBatched(db.collection("leaderboards").doc("friends").collection("users").where("uid", "==", uid)));
};

/** Server-only evidence and counters keyed by uid. */
const cleanServerRecords: Cleaner = async (uid, counts) => {
  bump(counts, "attendance",
    await deleteQueryBatched(db.collection("attendance").where("uid", "==", uid)));
  bump(counts, "rateLimits",
    await deleteQueryBatched(db.collection("rateLimits").where("uid", "==", uid)));
  bump(counts, "storyEngagementKeys", await deleteQueryBatched(db.collection("storyEngagementKeys").where("uid", "==", uid)));
  bump(counts, "analytics",
    await deleteQueryBatched(db.collectionGroup("events").where("uid", "==", uid)));
  bump(counts, "plannerRuns",
    await deleteQueryBatched(db.collection("plannerRuns").where("uid", "==", uid)));
  bump(counts, "eventPlanSessions",
    await deleteQueryBatched(db.collection("eventPlanSessions").where("uid", "==", uid)));
  bump(counts, "feedSessions",
    await deleteQueryBatched(db.collection("feedSessions").where("uid", "==", uid)));
  bump(counts, "feedImpressions",
    await deleteQueryBatched(db.collection("feedImpressions").where("uid", "==", uid)));
  const ownedPlans = await db.collection("groupPlans").where("ownerUid", "==", uid).get();
  for (const plan of ownedPlans.docs) await plan.ref.delete();
  bump(counts, "groupPlansOwned", ownedPlans.size);
  const memberPlans = await db.collection("groupPlans").where("memberUIDs", "array-contains", uid).get();
  for (const plan of memberPlans.docs) await plan.ref.update({
    memberUIDs: FieldValue.arrayRemove(uid), [`votes.${uid}`]: FieldValue.delete(),
  });
  bump(counts, "groupPlansJoined", memberPlans.size);
  const invitations = await db.collection("groupPlans").where("pendingUIDs", "array-contains", uid).get();
  for (const plan of invitations.docs) await plan.ref.update({ pendingUIDs: FieldValue.arrayRemove(uid) });
  bump(counts, "groupPlanInvites", invitations.size);
};

/** Gift-card queue: queued rows vanish, delivered rows are anonymised (financial record). */
const cleanFulfilments: Cleaner = async (uid, counts) => {
  const rows = await db.collection("fulfillments").where("uid", "==", uid).get();
  for (const row of rows.docs) {
    const status = String(row.data().status ?? "pending");
    if (status === "sent" || status === "approved" || status === "processing") {
      await row.ref.set({
        uid: null, deliverToEmail: null, anonymizedAt: FieldValue.serverTimestamp(),
        anonymizedReason: "account-deleted",
      }, { merge: true });
      bump(counts, "fulfilmentsAnonymized", 1);
    } else {
      await row.ref.delete();
      bump(counts, "fulfilmentsDeleted", 1);
    }
  }
};

/** Reports they filed lose the reporter identity; reports ABOUT them are closed. */
const cleanModeration: Cleaner = async (uid, counts) => {
  const filed = await db.collection("reports").where("reporterUid", "==", uid).get();
  for (const r of filed.docs) await r.ref.set({ reporterUid: "deleted-account" }, { merge: true });
  bump(counts, "reportsAnonymized", filed.size);
  const aboutMe = await db.collection("moderationQueue")
    .where("targetType", "==", "user").where("targetId", "==", uid).get();
  for (const q of aboutMe.docs) await q.ref.delete();
  bump(counts, "userReportQueueItems", aboutMe.size);
};

/** Proof photos and the profile picture. */
const cleanStorage: Cleaner = async (uid, counts) => {
  const bucket = getStorage().bucket(PROOF_BUCKET);
  let n = 0;
  for (const prefix of [`proofs/${uid}/`, `profilePics/${uid}`]) {
    try {
      const [files] = await bucket.getFiles({ prefix });
      for (const f of files) {
        await f.delete({ ignoreNotFound: true });
        n++;
      }
    } catch (e) {
      // A missing bucket (Storage not initialised) must not block deletion of
      // everything else — but it is logged, because it means a photo may remain.
      console.warn(`[deleteAccount] storage sweep failed for ${prefix}:`, e);
    }
  }
  bump(counts, "storageObjects", n);
};

/** The profile document and every subcollection under it (blocks, following, notifications, invites…). */
const cleanUserDocument: Cleaner = async (uid, counts) => {
  bump(counts, "userTreeDocs", await deleteDocumentTree(db.collection("users").doc(uid)));
};

const CLEANERS: Cleaner[] = [
  cleanPosts, cleanEvents, cleanOrganizers, cleanPlaceStories, cleanAttendeeRecords, cleanSocialGraph,
  cleanServerRecords, cleanFulfilments, cleanModeration, cleanStorage, cleanUserDocument,
];

/** Run every cleaner, then remove the Auth user. Exported for tests + the callable. */
export async function deleteAccountData(uid: string, opts: { deleteAuthUser?: boolean } = {}): Promise<DeletionReport> {
  const counts: Record<string, number> = {};
  for (const clean of CLEANERS) await clean(uid, counts);

  let authDeleted = false;
  if (opts.deleteAuthUser !== false) {
    try {
      await getAuth().deleteUser(uid);
      authDeleted = true;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? "";
      if (code.includes("user-not-found")) authDeleted = true;   // already gone — idempotent
      else throw e;
    }
  }
  return { uid, counts, authDeleted };
}

/**
 * deleteAccount — permanently delete the CALLER's account and everything it owns.
 *
 * No admin override, no "delete another user": the uid always comes from the
 * verified token. Rate limited because each run is dozens of queries.
 */
export const deleteAccount = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to delete your account.");
  await enforceRateLimit(uid, "deleteAccount");
  const report = await deleteAccountData(uid);
  console.log(`[deleteAccount] ${uid}: ${JSON.stringify(report.counts)} auth=${report.authDeleted}`);
  return { deleted: true, counts: report.counts };
});

// The Firestore rules cannot express "delete this doc if it belongs to me AND
// clean up everything else", which is why account deletion is a callable rather
// than an `allow delete` rule. If a future cleaner is added, register it in
// CLEANERS above; E2E asserts the end state (nothing owned by the uid remains).
export { HttpsError };
