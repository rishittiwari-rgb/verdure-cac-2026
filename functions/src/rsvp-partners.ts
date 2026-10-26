/** Venue-based RSVP alerts. No device/background location is used or stored. */
import { createHash } from "node:crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, safeText, hasActivePlus, plusActiveFrom, distanceMeters } from "./common.js";
import { loadSurfacablePerks, nearYouEligible, partnerHasAgreement } from "./partners.js";
import { readPrefs, inQuietHours, weekKey, MAX_PUSH_PER_WEEK } from "./notifications.js";
import { notify } from "./social.js";

export function rsvpAlertRef(uid: string, eventId: string) {
  const id = createHash("sha256").update(JSON.stringify([uid, eventId])).digest("hex");
  return db.doc(`rsvpPartnerAlerts/${id}`);
}

export function rsvpAlertDueAt(startMs: number, nowMs: number): number {
  return Math.max(nowMs, startMs - 3_600_000);
}

/**
 * Both the weekly slot and the sole in-app alert are committed with the job.
 * Concurrent/retried schedulers cannot send a second alert for that RSVP.
 * Push is attempted once after commit: FCM has no exactly-once primitive.
 * A process failure at that boundary may miss delivery; it cannot resend it.
 */
export async function runRsvpPartnerAlerts(nowMs = Date.now()) {
  const due = await db.collection("rsvpPartnerAlerts").where("status", "==", "queued")
    .where("dueAt", "<=", Timestamp.fromMillis(nowMs)).orderBy("dueAt").limit(200).get();
  const result = { considered: due.size, sent: 0, deferred: 0, expired: 0 };
  for (const job of due.docs) {
    const { uid, eventId } = job.data();
    if (typeof uid !== "string" || typeof eventId !== "string" || uid.includes("/") || eventId.includes("/")) {
      await job.ref.update({ status: "invalid" }); continue;
    }
    const userRef = db.doc(`users/${uid}`), eventRef = db.doc(`events/${eventId}`);
    const [user, event, dismissals] = await Promise.all([
      userRef.get(), eventRef.get(), db.collection(`users/${uid}/dismissedPerks`).get(),
    ]);
    const ev = event.data();
    const startMs = ev?.date?.toMillis?.() ?? 0;
    if (startMs <= nowMs || !ev || ev.active !== true || ev.hidden === true || ev.broadcast !== true ||
        !user.data()?.rsvpEventIDs?.includes(eventId) || user.data()?.suspended === true) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(job.ref);
        if (current.data()?.status === "queued") tx.update(job.ref, { status: "expired" });
      });
      result.expired++; continue;
    }
    const prefs = readPrefs(user.data());
    let perk: Awaited<ReturnType<typeof loadSurfacablePerks>>[number] | undefined;
    if (prefs.rsvpPartnerOffers && !inQuietHours(nowMs, prefs)) {
      const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(nowMs));
      const localHour = Number(clock.find((p) => p.type === "hour")?.value);
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(clock.find((p) => p.type === "weekday")?.value ?? "");
      const dismissed = new Set(dismissals.docs.map((d) => d.id));
      const candidates = await loadSurfacablePerks(await hasActivePlus(uid), nowMs);
      perk = candidates.filter((p) => p.claimable && !dismissed.has(p.id) &&
        nearYouEligible(p, { lat: ev.latitude, lng: ev.longitude, localHour }, day))
        .sort((a, b) => distanceMeters(ev.latitude, ev.longitude, a.latitude!, a.longitude!) -
          distanceMeters(ev.latitude, ev.longitude, b.latitude!, b.longitude!) || a.id.localeCompare(b.id))[0];
    }
    if (!perk?.partnerId) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(job.ref);
        if (current.data()?.status === "queued") tx.update(job.ref,
          { dueAt: Timestamp.fromMillis(nowMs + 15 * 60_000) });
      });
      result.deferred++; continue;
    }
    const chosen = perk;
    const payload = {
      kind: "rsvp-partner", eventId, title: "An offer near your event",
      body: `Going to ${safeText(ev.title, 80)}? ${chosen.partner} is a short walk away — ${chosen.title}.`,
      extra: { perkId: chosen.id, sponsored: true, deepLink: `verdure://events/${eventId}` },
    };
    const committed = await db.runTransaction(async (tx) => {
      const [current, freshUser, freshEvent, freshPerk, partner, dismissal] = await Promise.all([
        tx.get(job.ref), tx.get(userRef), tx.get(eventRef), tx.get(db.doc(`partnerPerks/${chosen.id}`)),
        tx.get(db.doc(`partners/${chosen.partnerId}`)), tx.get(db.doc(`users/${uid}/dismissedPerks/${chosen.id}`)),
      ]);
      const data = freshUser.data(), eventData = freshEvent.data(), offer = freshPerk.data();
      const currentPrefs = readPrefs(data), wk = weekKey(nowMs);
      const budget = data?.notifyBudget ?? {};
      const sent = budget.week === wk ? Number(budget.sent) || 0 : 0;
      const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(nowMs));
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(clock.find((p) => p.type === "weekday")?.value ?? "");
      const eligibleNow = nearYouEligible({ ...chosen, latitude: partner.data()?.latitude, longitude: partner.data()?.longitude,
        partnerCategory: partner.data()?.category, hours: offer?.hours ?? [], days: offer?.days ?? [] },
        { lat: eventData?.latitude, lng: eventData?.longitude, localHour: Number(clock.find((p) => p.type === "hour")?.value) }, day);
      if (current.data()?.status !== "queued" || !data?.rsvpEventIDs?.includes(eventId) || data.suspended ||
          !currentPrefs.rsvpPartnerOffers || inQuietHours(nowMs, currentPrefs) ||
          sent >= MAX_PUSH_PER_WEEK || !partnerHasAgreement(partner.data()) || dismissal.exists ||
          offer?.active !== true || offer.hidden === true || !(Number(offer.codePoolCount) > 0) ||
          !eligibleNow || ((offer.earlyAccessUntil?.toMillis?.() ?? 0) > nowMs && !plusActiveFrom(data, nowMs)) ||
          (offer.expiresAt?.toMillis?.() ?? 0) <= nowMs || eventData?.active !== true || eventData.hidden === true ||
          eventData.broadcast !== true || (eventData.date?.toMillis?.() ?? 0) <= nowMs) return false;
      tx.set(userRef, { notifyBudget: { week: wk, sent: sent + 1 } }, { merge: true });
      tx.update(job.ref, { status: "sent", perkId: chosen.id, sentAt: Timestamp.fromMillis(nowMs) });
      tx.set(db.doc(`users/${uid}/notifications/${job.id}`), {
        ...payload, ...payload.extra, actorUid: null, read: false, createdAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (committed) {
      await notify(uid, payload, { notificationId: job.id, alreadyStored: true });
      result.sent++;
    } else {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(job.ref);
        if (current.data()?.status === "queued") tx.update(job.ref, { dueAt: Timestamp.fromMillis(nowMs + 15 * 60_000) });
      });
      result.deferred++;
    }
  }
  return result;
}

export const sendRsvpPartnerAlerts = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Los_Angeles" },
  async () => { await runRsvpPartnerAlerts(); },
);
