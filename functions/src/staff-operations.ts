import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db, requireAdmin, safeString, utcMonthKey } from "./common.js";
import { auditStaffRead } from "./staff-audit.js";
import { LAUNCH_AREAS, areaById } from "./ingest/areas.js";
import { SOURCES } from "./ingest/index.js";
import { loadSourceHealth } from "./ingest/health.js";
import { auditSuspectedDuplicates } from "./ingest/store.js";
import { GLOBAL_MONTHLY_TREASURY_CAP_USD } from "./economy.js";
import { SERPAPI_MONTHLY_CAP } from "./ingest/sources/serpapi.js";
import { loadPlaceSourceHealth, placeCatalogState } from "./parks/store.js";

export async function operationsSnapshot(areaId: string, now = Date.now()) {
  const area = areaById(areaId);
  if (!area) throw new HttpsError("invalid-argument", "Unknown launch area.");
  const month = utcMonthKey(new Date(now));
  const openReports = db.collection("moderationQueue").where("status", "==", "open");
  const [sources, treasury, reportCount, oldest, organizerCount, placeSources, placeCatalog] = await Promise.all([
    Promise.all(SOURCES.map((source) => loadSourceHealth(source, areaId))),
    db.doc(`treasury/${month}`).get(), openReports.count().get(),
    openReports.orderBy("firstReportedAt").limit(1).get(),
    db.collection("organizers").where("status", "==", "pending").count().get(),
    loadPlaceSourceHealth(), placeCatalogState(),
  ]);
  // Read the complete active/upcoming corpus, in pages with field projection.
  // The duplicate heuristic is the same venue/time/title audit as ingestion.
  const query = db.collection("events").where("areaId", "==", areaId).where("active", "==", true)
    .where("date", ">=", Timestamp.fromMillis(now)).orderBy("date")
    .select("source", "hidden", "removed", "active", "date", "title", "titleKey", "venueKey", "locationName", "latitude", "longitude");
  const events: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const snap = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    events.push(...snap.docs.filter((d) => d.data().hidden !== true && d.data().removed !== true).map((d) => ({ id: d.id, data: d.data() })));
    if (snap.size < 500) break;
    cursor = snap.docs[snap.size - 1];
  }
  const counts: Record<string, number> = Object.fromEntries([...SOURCES, "organizer"].map((s) => [s, 0]));
  for (const ev of events) { const source = String(ev.data.source ?? "community"); counts[source] = (counts[source] ?? 0) + 1; }
  const duplicates = auditSuspectedDuplicates({ all: events, bySourceKey: new Map(), byTitleKey: new Map() });
  const t = treasury.data() ?? {};
  const number = (key: string) => Number.isFinite(Number(t[key])) ? Number(t[key]) : 0;
  const age = oldest.docs[0]?.data().firstReportedAt?.toMillis?.();
  return { area: { id: area.id, name: area.name }, areas: LAUNCH_AREAS.map((a) => ({ id: a.id, name: a.name })),
    computedAtMs: now, month, sources: sources.map((row) => ({ ...row, activeEvents: counts[row.source] ?? 0 })),
    placeSources, placeCatalog,
    activeEvents: { total: events.length, bySource: counts },
    duplicates: { ...duplicates, method: "Suspected duplicates: similar titles, within 2 hours, same venue or within 300 m. This is a heuristic, not a human accuracy measure." },
    queues: { pendingReports: reportCount.data().count, oldestReportHours: age === undefined ? null : Math.max(0, (now - age) / 3_600_000),
      pendingOrganizers: organizerCount.data().count },
    spend: { rewardCommittedUsd: number("dollarsCommitted"), rewardFulfilledUsd: number("dollarsFulfilled"),
      rewardCapUsd: GLOBAL_MONTHLY_TREASURY_CAP_USD, rewardPaused: t.killSwitch === true,
      plannerEstimatedUsd: number("plannerCostCents") / 100 + number("plannerCostUsd"),
      adventurePlannerCalls: number("plannerCalls"), eventPlannerCalls: number("eventPlannerSessions"),
      serpApiCalls: number("serpApiCalls"), serpApiCap: SERPAPI_MONTHLY_CAP,
      serpApiEstimatedUsd: number("serpApiCostCents") / 100 + number("serpApiCostUsd"),
      note: "Planner spend is the recorded estimate, not a vendor invoice; failed/unrecorded calls may be missing. SerpApi uses the configured free quota; any separately recorded charges are included. Reward commitments include queued cards." } };
}

export const staffOperations = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (req) => {
  const staff = await requireAdmin(req.auth);
  const result = await operationsSnapshot(safeString(req.data?.areaId, LAUNCH_AREAS[0].id));
  await auditStaffRead(staff, "operations:view", result.area.id, { computedAtMs: result.computedAtMs, month: result.month,
    activeEvents: result.activeEvents.total, pendingReports: result.queues.pendingReports });
  return result;
});
