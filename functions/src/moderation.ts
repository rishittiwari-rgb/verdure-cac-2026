/**
 * Content moderation — report flow, auto-hide, 24-hour review SLA, blocks.
 *
 * WHY THIS EXISTS. Verdure carries user-generated content (community posts,
 * organizer events, profiles). App Review guideline 1.2 requires that users can
 * report objectionable content, that reported content is acted on promptly, that
 * users can block abusive accounts, and that a contact for concerns is published.
 * None of that existed: a post could be reported nowhere and removed by nobody.
 *
 * THE MODEL.
 *   /reports/{queueId}_{reporterUid}   one row per (target, reporter) — server-only
 *   /moderationQueue/{targetType}_{id} one row per reported target — server-only
 *   target documents carry two SERVER-OWNED flags:
 *     hidden   — not visible to anyone but the author (auto at threshold, or by staff)
 *     removed  — permanently taken down (staff action or the 24h sweep)
 *   Firestore rules make both flags unwritable by clients and refuse to serve
 *   hidden documents to anyone but their author. Enforcement is in the rules and
 *   here, never in the client.
 *
 * THE TIMELINE. A report enters the queue immediately. At AUTO_HIDE_REPORT_THRESHOLD
 * distinct reporters the content is hidden instantly (visible only to its author).
 * Every open queue item carries an `slaDeadline` 24 hours after the first report;
 * if staff have not reviewed it by then, `moderationSweep` removes it. Reported
 * content therefore never stays up past 24 hours without a human decision — the
 * SLA is enforced by code, not by a promise in the listing.
 *
 * Published contact for concerns: MODERATION_CONTACT (mirrored in the app's
 * Settings and in AppStore/LISTING.md).
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  db, requireUid, requireAdmin, enforceRateLimit, safeString, safeText,
  docIdFrom, isBlockedEitherWay,
} from "./common.js";

import { appendStaffAudit, auditStaffRead, auditedStaffJob, staffReason } from "./staff-audit.js";
import { staffPage } from "./staff-page.js";
import { stageStoryStatus, stageOrganizerStoryGate, stageAuthorStoryGate } from "./place-stories.js";

export const MODERATION_CONTACT = "support@verdure-app.com";

/** Distinct reporters needed before content is hidden automatically. */
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

/** Reported content is removed if nobody has reviewed it within this window. */
export const MODERATION_SLA_MS = 24 * 60 * 60 * 1000;

export const REPORT_REASONS = [
  "spam", "harassment", "hate", "sexual", "violence", "dangerous",
  "misinformation", "impersonation", "other",
] as const;
type ReportReason = typeof REPORT_REASONS[number];

export type TargetType = "post" | "event" | "user" | "organizer" | "place_story";

const TARGET_COLLECTIONS: Record<TargetType, string> = {
  post: "posts",
  event: "events",
  user: "users",
  organizer: "organizers",
  place_story: "placeStories",
};

/** Which field on the target names its author (owner). */
function authorOf(type: TargetType, data: FirebaseFirestore.DocumentData | undefined, id: string): string | null {
  if (!data) return type === "user" ? id : null;
  switch (type) {
    case "post": return safeString(data.authorID) || null;
    case "event": return safeString(data.creatorID) || null;
    case "organizer": return safeString(data.ownerUid) || null;
    case "place_story": return safeString(data.ownerUid) || null;
    case "user": return id;
  }
}

/** A short excerpt of the content so reviewers can triage without opening it. */
function snapshotOf(type: TargetType, data: FirebaseFirestore.DocumentData | undefined): string {
  if (!data) return "";
  const raw = type === "post" ? data.content
    : type === "event" ? `${data.title ?? ""} — ${data.description ?? ""}`
    : type === "organizer" ? `${data.displayName ?? ""} — ${data.description ?? ""}`
    : type === "place_story" ? `${data.placeName ?? ""} — ${data.content ?? ""}`
    : data.displayName ?? "";
  return safeText(raw, 280);
}

export function queueIdFor(type: TargetType, id: string): string {
  return docIdFrom(type, id);
}

/**
 * reportContent — file a report against a post, event, organizer or user.
 *
 * Idempotent per (target, reporter): reporting the same thing twice is a no-op,
 * so a single account cannot push content over the auto-hide threshold alone.
 * Everything happens in one transaction so two simultaneous third reports can't
 * both observe "2 reporters" and leave the content visible.
 */
export const reportContent = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to report content.");
  await enforceRateLimit(uid, "reportContent");

  const targetType = safeString(req.data?.targetType) as TargetType;
  const targetId = safeText(req.data?.targetId, 200);
  const reason = safeString(req.data?.reason, "other") as ReportReason;
  const details = safeText(req.data?.details, 1000);

  if (!Object.hasOwn(TARGET_COLLECTIONS, targetType)) throw new HttpsError("invalid-argument", "Unknown content type.");
  if (!targetId || targetId.includes("/")) throw new HttpsError("invalid-argument", "Missing content id.");
  if (!REPORT_REASONS.includes(reason)) throw new HttpsError("invalid-argument", "Unknown report reason.");

  const targetRef = db.collection(TARGET_COLLECTIONS[targetType]).doc(targetId);
  const queueId = queueIdFor(targetType, targetId);
  const queueRef = db.collection("moderationQueue").doc(queueId);
  const reportRef = db.collection("reports").doc(docIdFrom(queueId, uid));

  return db.runTransaction(async (tx) => {
    const [targetSnap, queueSnap, reportSnap] = await Promise.all([
      tx.get(targetRef), tx.get(queueRef), tx.get(reportRef),
    ]);
    // Users may not have a profile document yet; every other type must exist.
    if (!targetSnap.exists && targetType !== "user") {
      throw new HttpsError("not-found", "That content no longer exists.");
    }
    const target = targetSnap.data();
    const storyOwnership = targetType === "place_story" && target?.placeId
      ? (await tx.get(db.doc(`placeStoryOwnership/${target.placeId}`))).data() : undefined;
    const author = authorOf(targetType, target, targetId);
    if (author === uid) {
      throw new HttpsError("failed-precondition", "You can't report your own content.");
    }
    if (reportSnap.exists) {
      return { reported: true, alreadyReported: true, hidden: queueSnap.data()?.hidden === true, queueId };
    }

    const now = Timestamp.now();
    const q = queueSnap.data() ?? {};
    const alreadyResolved = q.status === "removed";
    // A dismissed item that gets reported again reopens with a fresh SLA clock
    // AND a fresh reporter count: staff already judged the earlier reports, so
    // they must not be able to re-trip the auto-hide on their own.
    const reopening = q.status === "dismissed";
    const reporters: string[] = (!reopening && Array.isArray(q.reporters)) ? q.reporters : [];
    const distinct = new Set(reporters); distinct.add(uid);
    const firstReportedAt: Timestamp = (!queueSnap.exists || reopening) ? now : (q.firstReportedAt ?? now);
    const slaDeadline = Timestamp.fromMillis(firstReportedAt.toMillis() + MODERATION_SLA_MS);

    const canHide = targetType !== "user";
    const shouldHide = canHide && !alreadyResolved && distinct.size >= AUTO_HIDE_REPORT_THRESHOLD;

    tx.set(reportRef, {
      queueId, targetType, targetId, reporterUid: uid, reason, details,
      status: "open", createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(queueRef, {
      targetType, targetId,
      authorUid: author,
      snapshot: snapshotOf(targetType, target),
      reporters: Array.from(distinct),
      reportCount: distinct.size,
      reasons: FieldValue.arrayUnion(reason),
      firstReportedAt,
      lastReportedAt: now,
      slaDeadline,
      status: alreadyResolved ? "removed" : "open",
      hidden: alreadyResolved ? true : (shouldHide || q.hidden === true),
      ...(shouldHide && q.hidden !== true ? { hiddenAt: now, hiddenBy: "auto-threshold" } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (shouldHide && targetSnap.exists && target?.hidden !== true) {
      tx.set(targetRef, { hidden: true, hiddenAt: now }, { merge: true });
      if (targetType === "place_story" && storyOwnership?.storyId === targetId)
        stageStoryStatus(tx, target!.placeId, storyOwnership, { ...target, hidden: true });
      if (targetType === "organizer") stageOrganizerStoryGate(tx, targetId, { ...target, hidden: true });
    }
    return { reported: true, alreadyReported: false, hidden: shouldHide || q.hidden === true, queueId };
  });
});

type ModerationAction = "remove" | "dismiss" | "restore" | "suspend" | "warn";

/** Decision, affected records and before/after audit share one transaction. */
async function applyDecision(queueId: string, action: ModerationAction, by: string, resolution: string) {
  const queueRef = db.doc(`moderationQueue/${queueId}`);
  const decision = await db.runTransaction(async (tx) => {
    const queue = await tx.get(queueRef);
    if (!queue.exists) throw new HttpsError("not-found", "No such moderation item.");
    const q = queue.data()!;
    if (by === "system" && q.status !== "open") return { queueId, status: q.status, resolution: q.resolution };
    const type = q.targetType as TargetType;
    if (!Object.hasOwn(TARGET_COLLECTIONS, type)) throw new HttpsError("failed-precondition", "Unknown reported content type.");
    const targetRef = db.doc(`${TARGET_COLLECTIONS[type]}/${q.targetId}`);
    const authorRef = q.authorUid ? db.doc(`users/${q.authorUid}`) : null;
    const [target, author] = await Promise.all([
      tx.get(targetRef),
      authorRef ? tx.get(authorRef) : Promise.resolve(null),
    ]);
    const storyOwnership = type === "place_story" && target.data()?.placeId
      ? (await tx.get(db.doc(`placeStoryOwnership/${target.data()!.placeId}`))).data() : undefined;
    const now = Timestamp.now();
    let update: Record<string, unknown> = {};
    let status = "dismissed";
    const original = q.originalContent ?? {
      ...(typeof target.data()?.content === "string" ? { content: target.data()!.content } : {}),
      ...(typeof target.data()?.description === "string" ? { description: target.data()!.description } : {}),
    };
    if (action === "remove" || action === "suspend") {
      status = "removed";
      update = type === "user" ? { suspended: true, suspendedAt: now } : { hidden: true, removed: true, removedAt: now };
      if (action === "remove" && (type === "post" || type === "place_story")) update.content = "[removed by moderation]";
      if (action === "remove" && type === "event") update.description = "[removed by moderation]";
    } else if (action === "restore") {
      update = type === "user" ? { suspended: false } : { hidden: false, removed: false, ...original };
    } else if (action === "dismiss") {
      if (type !== "user") update = { hidden: false };
    } else {
      status = "warned";
      if (type !== "user") update = { hidden: false };
    }
    const after = { ...q, status, hidden: status === "removed", resolution,
      reviewedAt: now, reviewedBy: by, updatedAt: now,
      ...((action === "remove" || action === "suspend") ? { originalContent: original } : {}),
    };
    if (Object.keys(update).length && (target.exists || type === "user")) tx.set(targetRef, update, { merge: true });
    const authorUpdate = action === "suspend" && authorRef ? { suspended: true, suspendedAt: now } : null;
    if (authorUpdate && authorRef) tx.set(authorRef, authorUpdate, { merge: true });
    if (type === "place_story" && storyOwnership?.storyId === q.targetId)
      stageStoryStatus(tx, target.data()!.placeId, storyOwnership, { ...target.data(), ...update });
    if (type === "organizer") stageOrganizerStoryGate(tx, q.targetId, { ...target.data(), ...update });
    if (authorUpdate && q.authorUid) stageAuthorStoryGate(tx, q.authorUid, { ...author?.data(), ...authorUpdate });
    if (type === "user") stageAuthorStoryGate(tx, q.targetId, { ...target.data(), ...update });
    tx.set(queueRef, after);
    if (action === "warn" && authorRef) tx.create(authorRef.collection("notifications").doc(), {
      kind: "moderation-warning", title: "A note from Verdure staff", body: resolution, read: false,
      createdAt: now, actorUid: by, eventId: null,
    });
    appendStaffAudit(tx, by, `moderation:${action}`, targetRef.path,
      { queue: q, target: target.data() ?? null, author: author?.data() ?? null },
      { queue: after, target: { ...(target.data() ?? {}), ...update },
        author: authorUpdate ? { ...(author?.data() ?? {}), ...authorUpdate } : author?.data() ?? null }, resolution);
    return { queueId, status, resolution };
  });
  // The queue/target decision and its audit are atomic. Individual reports are
  // derived records: reconcile in bounded transactions against the CURRENT
  // decision, so thousands of reporters cannot prevent staff from acting and
  // concurrent restore/remove cannot apply an obsolete status.
  const reports = await db.collection("reports").where("queueId", "==", queueId).get();
  for (let offset = 0; offset < reports.size; offset += 200) {
    const group = reports.docs.slice(offset, offset + 200);
    await db.runTransaction(async (tx) => {
      const queue = await tx.get(queueRef);
      const rows = await tx.getAll(...group.map((d) => d.ref));
      const q = queue.data()!;
      const status = q.status === "open" ? "open" : ["removed", "warned"].includes(q.status) ? "actioned" : "dismissed";
      const changed = rows.filter((d) => d.exists && d.data()?.status !== status);
      for (const row of changed) tx.update(row.ref, { status, reviewedAt: q.reviewedAt ?? null });
      if (changed.length) appendStaffAudit(tx, by, "moderation:report-status", queueRef.path,
        changed.map((d) => ({ id: d.id, status: d.data()?.status ?? null })),
        changed.map((d) => ({ id: d.id, status })), resolution);
    });
  }
  return decision;
}

/**
 * moderateContent — staff decision on a queue item.
 *   remove  → content hidden + marked removed (prose redacted); user → suspended
 *   dismiss → content visible again, item closed
 *   restore → undo a removal
 *   suspend → remove the content AND suspend its author
 */
export const moderateContent = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const queueId = safeText(req.data?.queueId, 900);
  const action = safeString(req.data?.action) as ModerationAction;
  if (!queueId || queueId.includes("/")) throw new HttpsError("invalid-argument", "Missing queueId.");
  if (!["remove", "dismiss", "restore", "suspend", "warn"].includes(action)) {
    throw new HttpsError("invalid-argument", "Unknown moderation action.");
  }
  return applyDecision(queueId, action, staff, staffReason(req.data?.reason));
});

/**
 * The 24-hour guarantee. Any open item whose deadline has passed is removed.
 * Idempotent: an already-decided item is skipped, so re-running is harmless.
 */
export async function sweepModerationQueue(now = Date.now()): Promise<{ removed: number }> {
  const due = await db.collection("moderationQueue")
    .where("status", "==", "open")
    .where("slaDeadline", "<=", Timestamp.fromMillis(now))
    .limit(200)
    .get();
  let removed = 0;
  for (const d of due.docs) {
    const type = d.data().targetType as TargetType;
    // Reports against a *person* are never auto-actioned — suspending an account
    // on a timer with no human in the loop is the abuse vector, not the fix.
    if (type === "user") continue;
    await applyDecision(d.id, "remove", "system", "auto:24h-sla");
    removed++;
  }
  return { removed };
}

export const moderationSweep = onSchedule("every 60 minutes", async () => {
  const { removed } = await sweepModerationQueue();
  if (removed) console.log(`[moderation] SLA sweep removed ${removed} item(s)`);
});

/** Manual trigger for the sweep (staff / E2E — schedules don't fire in the emulator). */
export const runModerationSweep = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const open = await db.collection("moderationQueue").where("status", "==", "open").count().get();
  return auditedStaffJob(staff, "moderation:sweep", "moderationQueue", { pending: open.data().count },
    req.data?.reason ? staffReason(req.data.reason) : "Manual moderation SLA sweep", () => sweepModerationQueue());
});

/**
 * Staff view of the queue. Clients cannot read /moderationQueue directly (rules),
 * so this is the only window into it — and it is admin-gated.
 */
export const listModerationQueue = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const status = safeString(req.data?.status, "open");
  if (!["open", "removed", "dismissed", "warned", "resolved"].includes(status)) throw new HttpsError("invalid-argument", "Unknown queue status.");
  const type = safeString(req.data?.targetType);
  if (type && !Object.hasOwn(TARGET_COLLECTIONS, type)) throw new HttpsError("invalid-argument", "Unknown content type.");
  let query = status === "resolved" ? db.collection("moderationQueue").where("status", "in", ["removed", "dismissed", "warned"])
    : db.collection("moderationQueue").where("status", "==", status);
  if (type) query = query.where("targetType", "==", type);
  const page = await staffPage(query.orderBy("firstReportedAt", "asc"), "moderationQueue", req.data);
  const now = Date.now();
  await auditStaffRead(staff, "moderation:list", "moderationQueue", { status, targetType: type || null,
    ids: page.docs.map((d) => d.id), afterId: req.data?.afterId ?? null });
  return {
    nextCursor: page.nextCursor,
    items: await Promise.all(page.docs.map(async (d) => {
      const q = d.data();
      const collection = TARGET_COLLECTIONS[q.targetType as TargetType];
      const [target, reports, author] = await Promise.all([
        db.doc(`${collection}/${q.targetId}`).get(), db.collection("reports").where("queueId", "==", d.id).limit(100).get(),
        q.authorUid ? db.doc(`users/${q.authorUid}`).get() : Promise.resolve(null),
      ]);
      const fields = ["title", "description", "content", "placeName", "placeId", "displayName", "name", "authorID", "creatorID", "ownerUid", "organizerId", "location", "locationName", "website", "hidden", "removed", "suspended"];
      const context = Object.fromEntries(fields.filter((key) => key in (target.data() ?? {})).map((key) => [key, target.data()![key]]));
      const first = q.firstReportedAt?.toMillis?.() ?? now;
      return {
        queueId: d.id, targetType: q.targetType, targetId: q.targetId,
        status: q.status, content: context, originalContent: q.originalContent ?? null,
        author: author?.exists ? { displayName: safeText(author.data()?.displayName, 120),
          username: safeText(author.data()?.username, 60), suspended: author.data()?.suspended === true } : null,
        eventDateMs: target.data()?.date?.toMillis?.() ?? null,
        reports: reports.docs.map((r) => ({ reason: r.data().reason, details: r.data().details })),
        reportCount: q.reportCount, reasons: q.reasons ?? [], snapshot: q.snapshot ?? "",
        hidden: q.hidden === true,
        firstReportedAtMs: first, hoursSinceFirstReport: Math.max(0, (now - first) / 3_600_000),
        overdue20Hours: now - first > 20 * 3_600_000, resolution: q.resolution ?? null,
        reviewedAtMs: q.reviewedAt?.toMillis?.() ?? null, reviewedBy: q.reviewedBy ?? null,
        slaDeadlineMs: q.slaDeadline?.toMillis?.() ?? null,
      };
    })),
  };
});

/** Exposed for other modules (social feed, RSVP visibility). */
export { isBlockedEitherWay };

/**
 * One-time backfill for documents created before moderation flags existed.
 * The read rules now REQUIRE `hidden == false`, so a legacy post or event with
 * no flag would silently vanish from every feed. Idempotent; admin-only.
 */
export const backfillModerationFlags = onCall({ timeoutSeconds: 540 }, async (req) => {
  const staff = await requireAdmin(req.auth);
  const reason = req.data?.reason ? staffReason(req.data.reason) : "Backfill legacy moderation visibility flags";
  let updated = 0;
  for (const coll of ["posts", "events", "organizers"]) {
    const query = db.collection(coll).orderBy("__name__").select("hidden");
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await (cursor ? query.startAfter(cursor) : query).limit(200).get();
      const candidates = page.docs.filter((d) => typeof d.data().hidden !== "boolean");
      if (candidates.length) updated += await db.runTransaction(async (tx) => {
        const rows = await tx.getAll(...candidates.map((d) => d.ref));
        const changed = rows.filter((d) => d.exists && typeof d.data()?.hidden !== "boolean");
        for (const d of changed) tx.set(d.ref, { hidden: false }, { merge: true });
        if (changed.length) appendStaffAudit(tx, staff, "moderation:backfill", coll,
          changed.map((d) => ({ id: d.id, hidden: d.data()?.hidden ?? null })),
          changed.map((d) => ({ id: d.id, hidden: false })), reason);
        return changed.length;
      });
      if (page.size < 200) break;
      cursor = page.docs[page.size - 1];
    }
  }
  await auditStaffRead(staff, "moderation:backfill-summary", "moderation-flags", { updated });
  return { updated };
});
