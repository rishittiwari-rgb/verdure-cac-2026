/**
 * Event suggestion notifications.
 *
 * Replaces the `sendEventReminders` stub, which was an empty function body
 * behind a daily schedule — it had been "shipped" and did nothing.
 *
 * PUSH IS A NON-RECOVERABLE RESOURCE. A user who disables notifications almost
 * never re-enables them, and iOS gives you exactly one system prompt. So every
 * rule here errs toward sending FEWER messages, and each one is a hard gate
 * rather than a heuristic:
 *
 *   1. At most 2 per user per week. Counted server-side in a transaction.
 *   2. Nothing at all unless at least 5 events qualify. A digest of two is not
 *      worth a push, and the floor is what stops a thin week from producing a
 *      desperate-looking notification.
 *   3. Never about an event they already RSVP'd to, were already notified
 *      about, or explicitly dismissed.
 *   4. Quiet hours are respected in the USER'S timezone, and the default quiet
 *      window is 21:00–08:00 — opt-out, not opt-in.
 *   5. Blocks are honoured: a friend-activity push is never sent about someone
 *      either party has blocked.
 *   6. Preferences live on the server. A client-side toggle is not a setting,
 *      it is a suggestion — the fan-out happens here and must read it here.
 *
 * The candidate ordering comes from ranking.ts, deliberately. A separate
 * "what's worth a push" scorer would drift from what the feed shows, and then
 * the notification would advertise something the app does not surface.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import type { Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, safeText, safeBool, isBlockedEitherWay } from "./common.js";
import { notify } from "./social.js";
import { recommendEligibleFor as recommendFor } from "./program-feed.js";

/** Hard ceiling. Not a target — most weeks should send fewer. */
export const MAX_PUSH_PER_WEEK = 2;
/** Below this many qualifying events, send nothing at all. */
export const MIN_QUALIFYING_EVENTS = 5;
/** How far ahead a suggestion digest looks. */
export const SUGGESTION_HORIZON_DAYS = 10;

export interface NotificationPrefs {
  eventSuggestions: boolean;
  friendActivity: boolean;
  rsvpPartnerOffers: boolean;
  /** Local hour (0-23) quiet hours begin / end. Start may be > end (overnight). */
  quietStart: number;
  quietEnd: number;
  timeZone: string;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  eventSuggestions: true,
  friendActivity: true,
  rsvpPartnerOffers: false,
  quietStart: 21,
  quietEnd: 8,
  timeZone: "America/Los_Angeles",
};

export function readPrefs(data: FirebaseFirestore.DocumentData | undefined): NotificationPrefs {
  const p = (data?.notificationPrefs ?? {}) as Partial<NotificationPrefs>;
  const hour = (v: unknown, fallback: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback;
  };
  return {
    eventSuggestions: p.eventSuggestions !== false,
    friendActivity: p.friendActivity !== false,
    rsvpPartnerOffers: p.rsvpPartnerOffers === true,
    quietStart: hour(p.quietStart, DEFAULT_PREFS.quietStart),
    quietEnd: hour(p.quietEnd, DEFAULT_PREFS.quietEnd),
    timeZone: typeof p.timeZone === "string" && p.timeZone.length < 64 ? p.timeZone : DEFAULT_PREFS.timeZone,
  };
}

/** Local hour for an instant in a timezone. Falls back to UTC on a bad zone. */
export function localHour(atMs: number, timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", {
      timeZone, hour: "2-digit", hourCycle: "h23",
    }).format(new Date(atMs)));
  } catch {
    return new Date(atMs).getUTCHours();
  }
}

/**
 * Is this instant inside the user's quiet window?
 *
 * Handles the overnight case (21 -> 8 wraps midnight), which is the common one
 * and the one a naive `h >= start && h < end` gets exactly backwards.
 */
export function inQuietHours(atMs: number, prefs: NotificationPrefs): boolean {
  const h = localHour(atMs, prefs.timeZone);
  const { quietStart: s, quietEnd: e } = prefs;
  if (s === e) return false;              // no quiet window configured
  return s < e ? (h >= s && h < e) : (h >= s || h < e);
}

/** ISO week key, e.g. "2026-W37". The budget resets on this boundary. */
export function weekKey(atMs: number): string {
  const d = new Date(atMs);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;            // Monday = 0
  t.setUTCDate(t.getUTCDate() - dayNum + 3);         // nearest Thursday
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Claim one slot of this week's push budget, transactionally.
 *
 * Returns false if the budget is spent. This is a claim, not a check: two
 * concurrent scheduled runs (a retry overlapping the original, which Cloud
 * Scheduler does do) must not both decide there is room for the second push.
 */
export async function claimPushSlot(uid: string, atMs: number): Promise<boolean> {
  const ref = db.collection("users").doc(uid);
  const wk = weekKey(atMs);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const budget = snap.data()?.notifyBudget ?? {};
    const sent = budget.week === wk ? (Number(budget.sent) || 0) : 0;
    if (sent >= MAX_PUSH_PER_WEEK) return false;
    tx.set(ref, { notifyBudget: { week: wk, sent: sent + 1 } }, { merge: true });
    return true;
  });
}

// ---------------------------------------------------------------------------
// C1 — the suggestion digest
// ---------------------------------------------------------------------------

/**
 * Build one user's digest. Exported (and side-effect free) so the tests can
 * assert the gates without a scheduler, an emulator, or a push.
 */
export interface DigestDecision {
  send: boolean;
  reason: string;
  eventIds: string[];
}

export function decideDigest(opts: {
  prefs: NotificationPrefs;
  atMs: number;
  qualifying: string[];
  budgetAvailable: boolean;
}): DigestDecision {
  if (!opts.prefs.eventSuggestions) return { send: false, reason: "prefs_off", eventIds: [] };
  if (inQuietHours(opts.atMs, opts.prefs)) return { send: false, reason: "quiet_hours", eventIds: [] };
  if (!opts.budgetAvailable) return { send: false, reason: "weekly_cap", eventIds: [] };
  if (opts.qualifying.length < MIN_QUALIFYING_EVENTS) {
    return { send: false, reason: "below_floor", eventIds: [] };
  }
  return { send: true, reason: "ok", eventIds: opts.qualifying.slice(0, 3) };
}

/** Everything the user must not be pinged about again. */
async function suppressedFor(uid: string, userData: FirebaseFirestore.DocumentData | undefined): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of (Array.isArray(userData?.rsvpEventIDs) ? userData!.rsvpEventIDs : [])) out.add(String(id));
  for (const id of (Array.isArray(userData?.checkedInEventIDs) ? userData!.checkedInEventIDs : [])) out.add(String(id));
  const seen = await db.collection(`users/${uid}/suggestedEvents`).limit(500).get();
  for (const d of seen.docs) out.add(d.id);
  return out;
}

export async function runSuggestionDigest(nowMs = Date.now()): Promise<{ considered: number; sent: number; skipped: Record<string, number> }> {
  const skipped: Record<string, number> = {};
  const bump = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };

  // Only users with a push token can receive anything; everyone else is work
  // we would do and throw away.
  const users = await db.collection("users").where("fcmTokens", "!=", null).limit(2000).get();
  let sent = 0;

  for (const u of users.docs) {
    const uid = u.id;
    const data = u.data();
    if (data?.suspended === true) { bump("suspended"); continue; }
    const prefs = readPrefs(data);

    if (!prefs.eventSuggestions) { bump("prefs_off"); continue; }
    if (inQuietHours(nowMs, prefs)) { bump("quiet_hours"); continue; }

    const areaId = safeText(data?.areaId, 60) || "san-jose-ca";
    const lat = typeof data?.lastLat === "number" ? data.lastLat : undefined;
    const lng = typeof data?.lastLng === "number" ? data.lastLng : undefined;

    // Same ordering the feed uses — see ranking.ts.
    const ranked = await recommendFor(uid, areaId, lat, lng, 40, nowMs);
    const suppressed = await suppressedFor(uid, data);
    const horizonMs = nowMs + SUGGESTION_HORIZON_DAYS * 86_400_000;

    const qualifying: string[] = [];
    for (const r of ranked) {
      if (suppressed.has(r.id)) continue;
      // W3.8: under ranking v2 John's eligibility rule decides (score ≥ 0.70, starts within 4 days,
      // not saved) — "not already notified" is the suppressed set above. The weekly cap, quiet hours
      // and preferences below are unchanged; his max_per_user_per_day is deliberately not ported.
      if (r.version === "v2" && r.notify !== true) continue;
      const ev = await db.collection("events").doc(r.id).get();
      if (ev.data()?.category === "Program" || ev.data()?.opportunitySubtype === "program") continue;
      if (ev.data()?.adultOnly === true && data?.ageBand !== "adult") continue;   // minor protection (W2)
      const startMs = (ev.data()?.date as Timestamp)?.toMillis?.() ?? 0;
      if (startMs < nowMs || startMs > horizonMs) continue;
      qualifying.push(r.id);
      if (qualifying.length >= 12) break;
    }

    if (qualifying.length < MIN_QUALIFYING_EVENTS) { bump("below_floor"); continue; }
    if (!(await claimPushSlot(uid, nowMs))) { bump("weekly_cap"); continue; }

    const lead = await db.collection("events").doc(qualifying[0]).get();
    const title = safeText(lead.data()?.title, 80) || "Something near you";
    await notify(uid, {
      kind: "event_suggestions",
      title: `${qualifying.length} things to do near you`,
      body: `Starting with ${title}.`,
      eventId: qualifying[0],
      extra: { eventIds: qualifying.slice(0, 5), deepLink: `verdure://events/${qualifying[0]}` },
    });

    // Remember what we pushed so the next run cannot repeat it.
    const batch = db.batch();
    for (const id of qualifying.slice(0, 5)) {
      batch.set(db.doc(`users/${uid}/suggestedEvents/${id}`),
        { notifiedAt: FieldValue.serverTimestamp(), dismissed: false }, { merge: true });
    }
    await batch.commit();
    sent++;
  }

  return { considered: users.size, sent, skipped };
}

/**
 * Runs twice a week, not daily.
 *
 * The budget is 2/week, so a daily schedule would spend it on Monday and
 * Tuesday and then do nothing but burn reads for five days. Tuesday and Friday
 * at 17:00 America/Los_Angeles puts the digest in front of people when they are
 * deciding what to do with an evening or a weekend.
 */
export const sendEventSuggestions = onSchedule(
  { schedule: "0 17 * * 2,5", timeZone: "America/Los_Angeles" },
  async () => { await runSuggestionDigest(); },
);

// ---------------------------------------------------------------------------
// C2 — a friend RSVP'd to something you saved
// ---------------------------------------------------------------------------

/**
 * The gate every discretionary push must pass.
 *
 * C2 (a friend RSVP'd to something you saved) was ALREADY implemented in
 * social.ts, and correctly — it checks blocks, mutual follows and RSVP
 * visibility. What it did not have was preferences, quiet hours or the weekly
 * cap, because none of those existed. Writing a second fan-out here would have
 * duplicated the privacy logic and the two copies would disagree within a
 * sprint, so instead that path calls this and keeps its own privacy rules.
 *
 * Returns false — and claims nothing — unless the push should actually go out.
 * A `true` result HAS SPENT a slot of the weekly budget; callers must send.
 */
export async function mayPush(
  uid: string,
  kind: "event_suggestions" | "friend_activity",
  nowMs = Date.now(),
): Promise<boolean> {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data();
  if (!data || data.suspended === true) return false;

  const prefs = readPrefs(data);
  if (kind === "event_suggestions" && !prefs.eventSuggestions) return false;
  if (kind === "friend_activity" && !prefs.friendActivity) return false;
  if (inQuietHours(nowMs, prefs)) return false;

  return claimPushSlot(uid, nowMs);
}

// ---------------------------------------------------------------------------
// C4 — preferences, owned by the server
// ---------------------------------------------------------------------------

export const setNotificationPrefs = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "setNotificationPrefs");

  const current = readPrefs((await db.collection("users").doc(uid).get()).data());
  const d = req.data ?? {};
  const hour = (v: unknown, fallback: number) => {
    if (v === undefined || v === null) return fallback;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 23) throw new HttpsError("invalid-argument", "Quiet hours must be 0-23.");
    return n;
  };
  const next: NotificationPrefs = {
    eventSuggestions: d.eventSuggestions === undefined ? current.eventSuggestions : safeBool(d.eventSuggestions),
    friendActivity: d.friendActivity === undefined ? current.friendActivity : safeBool(d.friendActivity),
    rsvpPartnerOffers: d.rsvpPartnerOffers === undefined ? current.rsvpPartnerOffers : safeBool(d.rsvpPartnerOffers),
    quietStart: hour(d.quietStart, current.quietStart),
    quietEnd: hour(d.quietEnd, current.quietEnd),
    timeZone: safeText(d.timeZone, 60) || current.timeZone,
  };
  await db.collection("users").doc(uid).set({ notificationPrefs: next }, { merge: true });
  return next;
});

export const getNotificationPrefs = onCall(async (req) => {
  const uid = requireUid(req.auth);
  return readPrefs((await db.collection("users").doc(uid).get()).data());
});

/** "Stop suggesting this one." Recorded so no later run can resurrect it. */
export const dismissSuggestion = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "dismissSuggestion");
  const eventId = safeText(req.data?.eventId, 200);
  if (!eventId || eventId.includes("/")) throw new HttpsError("invalid-argument", "An event id is required.");
  await db.doc(`users/${uid}/suggestedEvents/${eventId}`).set(
    { dismissed: true, dismissedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { dismissed: true };
});
