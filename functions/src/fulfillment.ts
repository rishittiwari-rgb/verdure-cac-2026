/**
 * Gift-card fulfilment — Tremendous.
 *
 * WHAT THIS CLOSES.
 * `redeemReward` debits points and writes a durable row to /fulfillments, but
 * nothing ever read that queue: `vendor` stayed null forever. Every redemption
 * so far has taken value from a user and given nothing back. This module is the
 * other half — it reads the queue and actually sends the card.
 *
 * DESIGN RULES (each one exists because the alternative loses real money):
 *
 *  1. NEVER send twice. Tremendous dedupes on `external_id`, and we pass the
 *     fulfilment document id — which `redeemReward` derives from `uid_rewardId`.
 *     So a retry, a double trigger, or a redeploy mid-flight all collapse onto
 *     the same order. We ALSO claim the row (pending → sending) in a transaction
 *     before calling out, so two concurrent workers don't both hit the API.
 *
 *  2. Distinguish retryable from permanent. A 5xx or a network blip must be
 *     retried; a 400 validation error never will succeed and must not spin
 *     forever. 402 (insufficient funds) is retryable — it means TOP UP THE
 *     ACCOUNT, not "this redemption is invalid".
 *
 *  3. A permanent failure REFUNDS the user. They spent points and got nothing;
 *     silently marking the row "failed" would keep the points and the card. The
 *     refund also clears the reward from `redeemedRewardIDs` so they can try
 *     again. This is the only place points are ever credited back.
 *
 *  4. Money never moves on a client's say-so. This is a Firestore trigger plus a
 *     scheduled sweeper — there is no callable a client can invoke to make us
 *     buy a gift card. The only path to /fulfillments is `redeemReward`, which
 *     already debited the points inside a transaction.
 *
 *  5. Big-ticket cards can require a human. `FULFILMENT_APPROVAL_THRESHOLD`
 *     holds anything at or above it in `awaiting_approval` until someone flips
 *     the row to `approved`. Points are already debited, so the user isn't
 *     double-charged by the wait.
 *
 * SETUP (nothing sends until all three are done):
 *   firebase functions:secrets:set TREMENDOUS_API_KEY
 *   firebase functions:secrets:set TREMENDOUS_FUNDING_SOURCE_ID
 *   firebase functions:secrets:set TREMENDOUS_CATALOG     # optional, see below
 * Set TREMENDOUS_ENV=production in the function env to leave the sandbox.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { recordDollarsFulfilled, releaseCashCommitment } from "./economy.js";
import { requireAdmin } from "./common.js";
import { appendStaffAudit, auditedStaffJob, staffReason } from "./staff-audit.js";

const db = () => getFirestore();

// Secrets are BOUND, not just set. A secret written with `functions:secrets:set`
// is not visible to a function that doesn't declare it — `process.env.FOO` is
// simply undefined at runtime. Declaring them here is what mounts them.
const TREMENDOUS_API_KEY = defineSecret("TREMENDOUS_API_KEY");
const TREMENDOUS_FUNDING_SOURCE_ID = defineSecret("TREMENDOUS_FUNDING_SOURCE_ID");
/**
 * Optional JSON map of rewardId → Tremendous product id, e.g.
 *   {"starbucks-5":"ABC123","amazon-10":"DEF456"}
 * Product ids are per-account, so they can't be hardcoded here. When a reward
 * has no product id we fall back to CAMPAIGN_ID and the recipient picks a brand.
 */
const TREMENDOUS_CATALOG = defineSecret("TREMENDOUS_CATALOG");

const TREMENDOUS_ENV = defineString("TREMENDOUS_ENV", { default: "sandbox" });
const TREMENDOUS_CAMPAIGN_ID = defineString("TREMENDOUS_CAMPAIGN_ID", { default: "" });

const SANDBOX_BASE = "https://testflight.tremendous.com/api/v2";
const PRODUCTION_BASE = "https://api.tremendous.com/api/v2";

/** Cards worth this much or more wait for a human before sending. */
const FULFILMENT_APPROVAL_THRESHOLD_USD = 25;

/**
 * Dollar value of each reward, and the display name we put in the email.
 *
 * The denomination is stated explicitly rather than parsed out of the id.
 * "amazon-10" happening to end in 10 is a naming convention, not a contract —
 * and a convention that silently controls how much money we send is a
 * typo away from mailing $50 cards for a 1000-point reward.
 */
interface CardSpec { usd: number; name: string; }

export const CARD_CATALOG: Record<string, CardSpec> = {
  "starbucks-5": { usd: 5, name: "Starbucks $5" },
  "dunkin-5": { usd: 5, name: "Dunkin' $5" },
  "amazon-10": { usd: 10, name: "Amazon $10" },
  "target-10": { usd: 10, name: "Target $10" },
  "chipotle-10": { usd: 10, name: "Chipotle $10" },
  "amazon-25": { usd: 25, name: "Amazon $25" },
  "nike-25": { usd: 25, name: "Nike $25" },
  "apple-50": { usd: 50, name: "Apple $50" },
  "rei-50": { usd: 50, name: "REI $50" },
  "rei-15-trail-season": { usd: 15, name: "REI $15 — Trail Season" },
  "patagonia-30-earth": { usd: 30, name: "Patagonia $30 — For Earth" },
};

type Outcome =
  | { kind: "sent"; orderId: string; rewardId: string | null }
  | { kind: "retry"; reason: string }
  | { kind: "permanent"; reason: string };

/** Send one card. Pure-ish: decides an outcome, writes nothing. */
async function placeOrder(args: {
  fulfilmentId: string;
  rewardId: string;
  email: string;
  apiKey: string;
  fundingSourceId: string;
  catalog: Record<string, string>;
  campaignId: string;
  baseUrl: string;
}): Promise<Outcome> {
  const spec = CARD_CATALOG[args.rewardId];
  if (!spec) return { kind: "permanent", reason: `Unknown reward ${args.rewardId}` };

  const productId = args.catalog[args.rewardId];
  if (!productId && !args.campaignId) {
    // Retryable on purpose: this is a CONFIGURATION gap, not a bad redemption.
    // Once the catalog secret or a campaign id is set, the sweeper picks it up.
    return { kind: "retry", reason: "No Tremendous product id or campaign configured" };
  }

  const reward: Record<string, unknown> = {
    value: { denomination: spec.usd, currency_code: "USD" },
    delivery: {
      method: "EMAIL",
      meta: {
        sender_name: "Verdure",
        subject_line: `Your ${spec.name} gift card from Verdure`,
        message: "Thanks for getting outside with Verdure. Enjoy your reward!",
      },
    },
    recipient: { email: args.email, name: "Verdure member" },
  };
  if (productId) reward.products = [productId];
  else reward.campaign_id = args.campaignId;

  let res: Response;
  try {
    res = await fetch(`${args.baseUrl}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      // external_id is the whole idempotency story — see rule 1 above.
      body: JSON.stringify({
        external_id: args.fulfilmentId,
        payment: { funding_source_id: args.fundingSourceId },
        reward,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { kind: "retry", reason: `Network error: ${(e as Error).message}` };
  }

  const text = await res.text();

  // 200 = created, 201 = idempotent replay of an order we already placed.
  // Both mean "the card is on its way" and must be treated identically.
  if (res.status === 200 || res.status === 201) {
    try {
      const body = JSON.parse(text);
      return {
        kind: "sent",
        orderId: String(body?.order?.id ?? ""),
        rewardId: body?.order?.rewards?.[0]?.id ?? null,
      };
    } catch {
      return { kind: "retry", reason: "Unparseable success response" };
    }
  }

  // 409 means this external_id exists with DIFFERENT parameters. Retrying sends
  // the same conflicting payload forever, so it needs a human.
  if (res.status === 409) {
    return { kind: "permanent", reason: `Conflicting order for this id: ${text.slice(0, 300)}` };
  }
  // Bad request / unauthorized: the payload or the key is wrong. More attempts
  // won't fix either, and 401 in particular should page someone loudly.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { kind: "permanent", reason: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  }
  // 402 = out of money in the Tremendous account. Absolutely retryable: the fix
  // is topping up, and failing the user's redemption for our accounting problem
  // would be backwards.
  return { kind: "retry", reason: `HTTP ${res.status}: ${text.slice(0, 300)}` };
}

/** Give the points back and let the user redeem again. */
async function refund(uid: string, rewardId: string, points: number): Promise<void> {
  const userRef = db().collection("users").doc(uid);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    tx.set(userRef, {
      pointsBalance: (Number(data.pointsBalance) || 0) + points,
      redeemedRewardIDs: FieldValue.arrayRemove(rewardId),
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

const MAX_ATTEMPTS = 6;

/**
 * Process a single fulfilment row. Safe to call repeatedly — it claims the row
 * first and no-ops on anything already terminal or already in flight.
 */
async function processFulfilment(fulfilmentId: string): Promise<void> {
  const ref = db().collection("fulfillments").doc(fulfilmentId);

  // CLAIM. Two workers (trigger + sweeper) can fire on the same row at once;
  // whoever loses the transaction backs off. Without this both call Tremendous,
  // and we'd be relying on external_id alone to save us.
  const claim = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() ?? {};

    if (d.status === "sent" || d.status === "failed") return null;
    if (d.status === "awaiting_approval") return null;
    // A row stuck in "sending" for over 10 minutes is a crashed attempt, not a
    // live one — reclaim it rather than stranding the user's points forever.
    if (d.status === "sending") {
      const startedMs = d.sendingSince?.toMillis?.() ?? 0;
      if (Date.now() - startedMs < 10 * 60 * 1000) return null;
    }

    const spec = CARD_CATALOG[String(d.rewardId)];
    if (spec && spec.usd >= FULFILMENT_APPROVAL_THRESHOLD_USD && d.status !== "approved") {
      tx.set(ref, {
        status: "awaiting_approval",
        approvalReason: `$${spec.usd} is at or above the $${FULFILMENT_APPROVAL_THRESHOLD_USD} manual-review threshold`,
      }, { merge: true });
      return null;
    }

    tx.set(ref, {
      status: "sending",
      sendingSince: FieldValue.serverTimestamp(),
      attempts: (Number(d.attempts) || 0) + 1,
    }, { merge: true });
    return {
      uid: String(d.uid ?? ""),
      rewardId: String(d.rewardId ?? ""),
      email: typeof d.deliverToEmail === "string" ? d.deliverToEmail : "",
      pointsSpent: Number(d.pointsSpent) || 0,
      attempts: (Number(d.attempts) || 0) + 1,
      requestedAt: d.requestedAt?.toMillis ? (d.requestedAt as Timestamp) : undefined,
    };
  });

  if (!claim) return;

  // No email means EMAIL delivery cannot work. Park it for a human rather than
  // burning retries — and don't refund, because the redemption itself is valid.
  if (!claim.email) {
    await ref.set({
      status: "awaiting_approval",
      approvalReason: "No delivery email on the account — needs a manual address",
      lastError: null,
    }, { merge: true });
    return;
  }

  let catalog: Record<string, string> = {};
  try {
    const raw = TREMENDOUS_CATALOG.value();
    if (raw) catalog = JSON.parse(raw);
  } catch {
    catalog = {};
  }

  const apiKey = TREMENDOUS_API_KEY.value();
  const fundingSourceId = TREMENDOUS_FUNDING_SOURCE_ID.value();
  if (!apiKey || !fundingSourceId) {
    // Unconfigured is retryable — the queue holds until the secrets are set.
    await ref.set({
      status: "pending",
      lastError: "Tremendous secrets not configured",
      sendingSince: null,
    }, { merge: true });
    return;
  }

  const outcome = await placeOrder({
    fulfilmentId,
    rewardId: claim.rewardId,
    email: claim.email,
    apiKey,
    fundingSourceId,
    catalog,
    campaignId: TREMENDOUS_CAMPAIGN_ID.value(),
    baseUrl: TREMENDOUS_ENV.value() === "production" ? PRODUCTION_BASE : SANDBOX_BASE,
  });

  if (outcome.kind === "sent") {
    await ref.set({
      status: "sent",
      vendor: "tremendous",
      vendorOrderId: outcome.orderId,
      vendorRewardId: outcome.rewardId,
      sentAt: FieldValue.serverTimestamp(),
      sendingSince: null,
      lastError: null,
    }, { merge: true });
    // Treasury: dollars actually delivered (committed → fulfilled).
    await recordDollarsFulfilled(claim.rewardId, claim.requestedAt);
    return;
  }

  const permanent =
    outcome.kind === "permanent" || claim.attempts >= MAX_ATTEMPTS;

  if (permanent) {
    // The user paid and gets nothing — so give the points back. This is the
    // only automatic credit in the system, and it exists so a vendor outage
    // can never quietly pocket someone's balance.
    await refund(claim.uid, claim.rewardId, claim.pointsSpent);
    // The card never went out: release the committed dollars and the member's
    // slice of the rolling ceiling along with the points.
    await releaseCashCommitment(claim.uid, claim.rewardId, claim.requestedAt);
    await ref.set({
      status: "failed",
      sendingSince: null,
      refunded: true,
      refundedPoints: claim.pointsSpent,
      lastError: outcome.reason,
      failedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  await ref.set({
    status: "pending",
    sendingSince: null,
    lastError: outcome.reason,
  }, { merge: true });
}

// The Firestore emulator rejects v2 eventarc trigger registration (the same
// tools/jar skew that makes onPostCreated emulator-only), so the trigger is
// skipped there. The E2E suite exercises processFulfilment through the callable
// below instead, which is the same code path.
const inEmulator = process.env.FUNCTIONS_EMULATOR === "true";

/** Fire as soon as a redemption lands, and on every status change. */
export const onFulfilmentWritten: unknown = inEmulator ? undefined
  : onDocumentWritten(
    {
      document: "fulfillments/{id}",
      secrets: [TREMENDOUS_API_KEY, TREMENDOUS_FUNDING_SOURCE_ID, TREMENDOUS_CATALOG],
    },
    async (event) => {
      const after = event.data?.after?.data();
      if (!after) return;
      if (after.status !== "pending" && after.status !== "approved") return;
      await processFulfilment(event.params.id as string);
    }
  );

/**
 * Retry sweeper. The trigger handles the happy path; this catches everything
 * that failed retryably — vendor outages, an unfunded account, secrets that
 * weren't set yet — without anyone having to notice.
 */
export const sweepFulfilments = onSchedule(
  {
    schedule: "every 30 minutes",
    secrets: [TREMENDOUS_API_KEY, TREMENDOUS_FUNDING_SOURCE_ID, TREMENDOUS_CATALOG],
  },
  async () => {
    const snap = await db().collection("fulfillments")
      .where("status", "in", ["pending", "approved", "sending"])
      .limit(100)
      .get();
    for (const doc of snap.docs) {
      await processFulfilment(doc.id);
    }
  }
);

/**
 * Admin-only manual driver: approve a held card, or push a stuck row through.
 *
 * Gated on a custom claim, not a uid allowlist — `admin` is set with the Admin
 * SDK and can't be self-assigned, whereas an allowlist in source drifts and
 * leaks who the admins are.
 */
export const runFulfilment = onCall(
  { secrets: [TREMENDOUS_API_KEY, TREMENDOUS_FUNDING_SOURCE_ID, TREMENDOUS_CATALOG] },
  async (req) => {
    const staff = await requireAdmin(req.auth);
    const id = typeof req.data?.fulfilmentId === "string" ? req.data.fulfilmentId : "";
    if (!id || id.includes("/") || id.length > 1000) throw new HttpsError("invalid-argument", "Missing fulfilmentId.");
    const ref = db().collection("fulfillments").doc(id), before = await ref.get();
    if (!before.exists) throw new HttpsError("not-found", "No such fulfilment.");
    const reason = req.data?.reason ? staffReason(req.data.reason) : "Manual fulfilment review/retry by staff";

    return auditedStaffJob(staff, "fulfilment:run", ref.path, before.data(), reason, async () => {
      if (req.data?.approve === true) await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "No such fulfilment.");
        if (snap.data()?.status === "approved") return;
        if (snap.data()?.status !== "awaiting_approval") throw new HttpsError("failed-precondition", "Only a held card can be approved.");
        const change = { status: "approved", approvedBy: staff, approvedAt: Timestamp.now() };
        tx.set(ref, change, { merge: true });
        appendStaffAudit(tx, staff, "fulfilment:approve", ref.path, snap.data(), { ...snap.data(), ...change }, reason);
      });
      await processFulfilment(id);
      const after = await ref.get();
      return { status: after.data()?.status ?? "unknown", fulfilment: after.data() ?? null };
    });
  }
);

/** Exported for the E2E suite, which drives it directly against the emulator. */
export const __testing = { processFulfilment, placeOrder };
