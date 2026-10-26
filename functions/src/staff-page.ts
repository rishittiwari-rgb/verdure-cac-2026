import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./common.js";

/** A snapshot cursor includes the implicit document-ID tie breaker. */
export async function staffPage(query: FirebaseFirestore.Query, collection: string, input: any) {
  const limit = input?.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpsError("invalid-argument", "Page size must be 1–100.");
  const afterId = input?.afterId;
  if (afterId !== undefined) {
    if (typeof afterId !== "string" || !afterId || afterId.length > 1000 || afterId.includes("/")) {
      throw new HttpsError("invalid-argument", "Invalid page cursor.");
    }
    const cursor = await db.collection(collection).doc(afterId).get();
    if (!cursor.exists) throw new HttpsError("failed-precondition", "The list changed. Refresh to start again.");
    query = query.startAfter(cursor);
  }
  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  return { docs, nextCursor: snap.size > limit ? docs[docs.length - 1].id : null };
}
