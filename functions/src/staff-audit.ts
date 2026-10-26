/** Append-only staff audit records. Commit with the state change, never later. */
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import type { Transaction, WriteBatch } from "firebase-admin/firestore";
import { db, safeText } from "./common.js";

export function staffReason(value: unknown): string {
  const reason = safeText(value, 1000);
  if (reason.length < 3) throw new HttpsError("invalid-argument", "A reason of at least three characters is required.");
  return reason;
}

export function appendStaffAudit(writer: Transaction | WriteBatch, actor: string, action: string, target: string,
  before: unknown, after: unknown, reason: string) {
  const ref = db.collection("staffAudit").doc();
  writer.create(ref, { actor, action, target, time: Timestamp.now(), before: before ?? null, after: after ?? null, reason });
  return ref.id;
}

/** Read access is an admin action too. Record filters/IDs, not another copy of private content. */
export async function auditStaffRead(actor: string, action: string, target: string, context: unknown) {
  const batch = db.batch();
  appendStaffAudit(batch, actor, action, target, null, context, "Authorized staff read");
  await batch.commit();
}

/** Long jobs may span transactions/vendor calls. Persist intent BEFORE work,
 * then record completion/failure; a crash leaves a visible started job. */
export async function auditedStaffJob<T>(actor: string, action: string, target: string,
  before: unknown, reason: string, work: () => Promise<T>): Promise<T> {
  const ref = db.collection("staffJobs").doc(), startedAt = Timestamp.now();
  const started = { actor, action, target, reason, status: "started", startedAt };
  const start = db.batch(); start.create(ref, started);
  appendStaffAudit(start, actor, `${action}:requested`, target, before, { jobId: ref.id, status: "started" }, reason);
  await start.commit();
  try {
    const result = await work();
    const after = { ...started, status: "completed", completedAt: Timestamp.now(), result };
    const finish = db.batch(); finish.set(ref, after);
    appendStaffAudit(finish, actor, `${action}:completed`, target, before, { jobId: ref.id, result }, reason);
    await finish.commit(); return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Staff job failed";
    const fail = db.batch(); fail.set(ref, { ...started, status: "failed", completedAt: Timestamp.now(), error: message });
    appendStaffAudit(fail, actor, `${action}:failed`, target, before, { jobId: ref.id, error: message }, reason);
    await fail.commit(); throw error;
  }
}
