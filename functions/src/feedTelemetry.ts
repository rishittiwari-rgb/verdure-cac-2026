/** A feed impression is a card actually presented by the client. The
 * recommendation callable stores the scored slate first; this callable only
 * accepts IDs from that server-owned slate. An untouched impression starts
 * with outcome "ignored" and is changed by the strongest later action. */
import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, safeText } from "./common.js";
import type { ScoredEvent } from "./ranking.js";
import { markShown } from "./ranking-v2.js";

const outcomes = ["impression", "tap", "save", "rsvp", "dismiss"] as const;
const weight: Record<string, number> = { ignored: 0, tap: 1, save: 2, rsvp: 3, dismiss: 4 };

export async function createFeedSession(uid: string, areaId: string, events: ScoredEvent[]): Promise<string> {
  const id = randomBytes(12).toString("base64url");
  await db.collection("feedSessions").doc(id).create({
    uid, areaId, events: events.slice(0, 100).map((e, position) => ({
      id: e.id, position, score: Number(e.score.toFixed(4)), parts: e.parts,
      ...(e.version ? { version: e.version } : {}),
    })), createdAt: FieldValue.serverTimestamp(),
  });
  return id;
}

export const recordFeedEvent = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "recordFeedEvent");
  const sessionId = safeText(req.data?.sessionId, 64);
  const eventId = safeText(req.data?.eventId, 180);
  const action = safeText(req.data?.action, 20);
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !eventId || eventId.includes("/") ||
      !outcomes.includes(action as typeof outcomes[number])) {
    throw new HttpsError("invalid-argument", "Invalid feed event.");
  }
  const sessionRef = db.collection("feedSessions").doc(sessionId);
  const eventRef = db.collection("feedImpressions").doc(`${uid}_${sessionId}_${eventId}`);
  return db.runTransaction(async (tx) => {
    // Every read happens before the first write: Firestore transactions refuse a read after a write.
    const userRef = db.collection("users").doc(uid);
    const [session, existing, user] = await Promise.all([tx.get(sessionRef), tx.get(eventRef), action === "impression" ? tx.get(userRef) : Promise.resolve(null)]);
    if (session.data()?.uid !== uid) throw new HttpsError("not-found", "Feed not found.");
    const created = session.data()?.createdAt?.toMillis?.() ?? 0;
    if (Date.now() - created > 24 * 3_600_000) throw new HttpsError("failed-precondition", "Feed expired.");
    const row = (session.data()?.events as Array<{ id: string; position: number; score: number; parts: Record<string, number>; version?: string }> | undefined)
      ?.find((e) => e.id === eventId);
    if (!row) throw new HttpsError("permission-denied", "Event was not in this feed.");
    const next = action === "impression" ? "ignored" : action;
    const previous = existing.data()?.outcome as string | undefined;
    const outcome = (weight[next] ?? 0) >= (weight[previous ?? "ignored"] ?? 0) ? next : previous;
    tx.set(eventRef, {
      uid, sessionId, eventId, areaId: session.data()?.areaId,
      position: row.position, score: row.score, parts: row.parts,
      ...(row.version ? { version: row.version } : {}),
      outcome, createdAt: existing.exists ? existing.data()?.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // W3.6 novelty: a presented card is "first shown" once, in one bounded map on the user document.
    if (action === "impression" && user) {
      const current = user.data()?.firstShown;
      if (!(current && typeof current === "object" && typeof current[eventId] === "number")) {
        tx.set(userRef, { firstShown: markShown(current && typeof current === "object" ? current : undefined, [eventId], Date.now()) }, { merge: true });
      }
    }
    return { recorded: true, outcome };
  });
});

/** Bound retention even before a Firestore TTL policy is configured. Each run
 * can clear 8,000 old rows; the next run continues if there is more. */
export const pruneFeedTelemetry = onSchedule("every 24 hours", async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - 30 * 86_400_000);
  for (const collection of ["feedImpressions", "feedSessions", "eventPlanSessions"]) {
    for (let page = 0; page < 20; page++) {
      const stale = await db.collection(collection).where("createdAt", "<", cutoff).limit(400).get();
      if (stale.empty) break;
      const batch = db.batch();
      stale.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      if (stale.size < 400) break;
    }
  }
});
