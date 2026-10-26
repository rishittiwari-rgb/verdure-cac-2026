import { Timestamp } from "firebase-admin/firestore";
import { db } from "../common.js";
import type { IngestResult } from "./types.js";

export function sourceHealthId(source: string, areaId: string) { return `${areaId}_${source}`; }

/** Preserve success across outages, and don't let an older concurrent run win. */
export async function recordSourceHealth(result: IngestResult, runAt: Timestamp) {
  const ref = db.collection("sourceHealth").doc(sourceHealthId(result.source, result.areaId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), before = snap.data() ?? {};
    const newest = runAt.toMillis() >= (before.lastRunAt?.toMillis?.() ?? 0);
    const success = result.errors.length === 0;
    const patch = {
      source: result.source, areaId: result.areaId,
      ...(newest ? { lastRunAt: runAt, lastRunEvents: result.fetched, lastOutcome: success ? "success" : "failed",
        lastErrors: result.errors.map((x) => x.slice(0, 1000)), durationMs: result.durationMs } : {}),
      ...(success && runAt.toMillis() >= (before.lastSuccessfulRunAt?.toMillis?.() ?? 0)
        ? { lastSuccessfulRunAt: runAt, lastSuccessfulEvents: result.fetched } : {}),
      ...(!success && runAt.toMillis() >= (before.lastErrorAt?.toMillis?.() ?? 0)
        ? { lastErrorAt: runAt, lastError: result.errors.join("; ").slice(0, 1000) } : {}),
    };
    tx.set(ref, patch, { merge: true });
  });
}

/** Older runs remain usable: don't require a production migration to see them. */
export async function loadSourceHealth(source: string, areaId: string) {
  const snap = await db.collection("sourceHealth").doc(sourceHealthId(source, areaId)).get();
  const health = snap.data() ?? {};
  if (!health.lastRunAt || !health.lastSuccessfulRunAt) {
    const query = db.collection("ingestRuns").where("source", "==", source).where("areaId", "==", areaId);
    const [latest, successful] = await Promise.all([
      query.orderBy("runAt", "desc").limit(1).get(),
      query.where("errors", "==", []).orderBy("runAt", "desc").limit(1).get(),
    ]);
    const last = latest.docs[0]?.data(), good = successful.docs[0]?.data();
    if (last && (!health.lastRunAt || last.runAt.toMillis() > health.lastRunAt.toMillis())) Object.assign(health, {
      lastRunAt: last.runAt, lastRunEvents: last.fetched, lastOutcome: last.errors?.length ? "failed" : "success",
      lastErrors: last.errors ?? [], ...(last.errors?.length ? { lastError: last.errors.join("; "), lastErrorAt: last.runAt } : {}),
    });
    if (good && (!health.lastSuccessfulRunAt || good.runAt.toMillis() > health.lastSuccessfulRunAt.toMillis())) {
      Object.assign(health, { lastSuccessfulRunAt: good.runAt, lastSuccessfulEvents: good.fetched });
    }
  }
  return { source, areaId, lastRunAtMs: health.lastRunAt?.toMillis?.() ?? null,
    lastSuccessfulRunAtMs: health.lastSuccessfulRunAt?.toMillis?.() ?? null,
    lastSuccessfulEvents: health.lastSuccessfulEvents ?? null, lastRunEvents: health.lastRunEvents ?? null,
    lastOutcome: health.lastOutcome ?? "never-run", currentErrors: health.lastErrors ?? [],
    lastError: health.lastError ?? null, lastErrorAtMs: health.lastErrorAt?.toMillis?.() ?? null };
}
