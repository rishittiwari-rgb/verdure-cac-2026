/**
 * The reward economy — catalog, spend controls, partner perks, treasury.
 *
 * THE NUMBERS AND WHERE THEY COME FROM (revised 2026-08-22, keep in sync with
 * AppStore/LISTING.md and Verdure/Verdure/Models/RewardCatalog.swift):
 *
 *   Verdure+ is $4.99/month ($49.99/year). Apple keeps 15% under the Small
 *   Business Program, so net revenue is $4.24/month ($42.49/year). The reward
 *   budget is fixed at roughly 25% of net revenue — the budget is the constant,
 *   the points→dollar rate is the dial that hits it.
 *
 *   A realistically active member earns ~200 points/day; with the 1.25x member
 *   multiplier that is 250/day ≈ 7,500 points/month. At POINTS_PER_DOLLAR = 7,000
 *   that is ≈ $1.07/month of cash liability — about 25% of $4.24.
 *
 *   A member farming DAILY_POINT_CAP (600 × 1.25 = 750/day × 30.5 days ≈
 *   22,900 points) costs ≈ $3.27/month against $4.24 of net revenue: the cap is
 *   an abuse CEILING now that the rate is fixed (at the old 1,200:1 rate the same
 *   behaviour cost $19/month, which is why the cap alone never protected us).
 *
 *   ROLLING_12MO_CASH_CEILING_USD = 25 gives ~2x headroom over a normal member's
 *   ≈ $12.86/year and clears comfortably under $42.49 of net annual revenue.
 *   Worst case — cap-farming to the ceiling all year — still nets
 *   $42.49 − $25.00 − $7.20 infrastructure = $10.29. The economy is positive
 *   across the whole distribution.
 *
 *   If the Small Business Program enrolment lapses (30% commission): net monthly
 *   $3.49, net yearly $34.99 — both still positive against the $25 ceiling. The
 *   model no longer breaks if enrolment lapses.
 *
 * STRUCTURE THAT KEEPS IT SAFE. Free members earn PARTNER PERKS (partner-funded,
 * zero marginal cost). Only Verdure+ members can redeem CASH gift cards, so cash
 * liability scales with paying members and can never outrun revenue. Cash cards
 * arrive every 4–9 months at the sustainable rate; perks arrive every week or two
 * and are the everyday reward loop.
 *
 * THREE SPEND CONTROLS, all inside the same transaction as the points debit:
 *   1. per-member rolling 12-month cash ceiling  (users/{uid}.redemptionBudget)
 *   2. global monthly treasury cap + kill switch (treasury/{yyyy-mm})
 *   3. eligibility: cash requires a server-verified Verdure+ entitlement
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { appendStaffAudit, auditedStaffJob, staffReason } from "./staff-audit.js";
import { loadSurfacablePerks, loadActivePartnerPerks, partnerHasAgreement } from "./partners.js";
import { writePerkStatus } from "./partner-status.js";
import { PERK_MIN_COST, PERK_MAX_COST } from "./staff-partners.js";
export { PERK_MIN_COST, PERK_MAX_COST, upsertPartnerPerk, seedPartnerPerks, SEED_PERKS } from "./staff-partners.js";
import {
  db, requireUid, requireAdmin, enforceRateLimit, assertNotSuspended,
  safeString, safeText, plusActiveFrom, utcMonthKey, docIdFrom,
} from "./common.js";

// ── Constants (see the derivation above) ────────────────────────────────────

export const POINTS_PER_DOLLAR = 7000;
export const DAILY_POINT_CAP = 600;
export const PLUS_POINT_MULTIPLIER = 1.25;
export const ROLLING_12MO_CASH_CEILING_USD = 25;
export const GLOBAL_MONTHLY_TREASURY_CAP_USD = 200;
const ROLLING_WINDOW_MS = 365 * 86_400_000;

export interface CashReward { usd: number; cost: number; name: string; active: boolean; }

/** Cash gift cards. Cost = usd × POINTS_PER_DOLLAR. Verdure+ only. */
export const CASH_CATALOG: Record<string, CashReward> = {
  "starbucks-5":  { usd: 5,  cost: 5 * POINTS_PER_DOLLAR,  name: "Starbucks $5",  active: true },
  "dunkin-5":     { usd: 5,  cost: 5 * POINTS_PER_DOLLAR,  name: "Dunkin' $5",    active: true },
  "amazon-10":    { usd: 10, cost: 10 * POINTS_PER_DOLLAR, name: "Amazon $10",    active: true },
  "target-10":    { usd: 10, cost: 10 * POINTS_PER_DOLLAR, name: "Target $10",    active: true },
  "chipotle-10":  { usd: 10, cost: 10 * POINTS_PER_DOLLAR, name: "Chipotle $10",  active: true },
  // Retired from the ACTIVE catalog: at the sustainable earn rate these are
  // two- to four-year goals, and a reward nobody can realistically reach is a
  // fake reward (honest-copy policy). Kept as inactive records so partner-funded
  // versions can be switched on later without a schema change.
  "amazon-25":           { usd: 25, cost: 25 * POINTS_PER_DOLLAR, name: "Amazon $25",  active: false },
  "nike-25":             { usd: 25, cost: 25 * POINTS_PER_DOLLAR, name: "Nike $25",    active: false },
  "apple-50":            { usd: 50, cost: 50 * POINTS_PER_DOLLAR, name: "Apple $50",   active: false },
  "rei-50":              { usd: 50, cost: 50 * POINTS_PER_DOLLAR, name: "REI $50",     active: false },
  "rei-15-trail-season": { usd: 15, cost: 15 * POINTS_PER_DOLLAR, name: "REI $15 — Trail Season", active: false },
  "patagonia-30-earth":  { usd: 30, cost: 30 * POINTS_PER_DOLLAR, name: "Patagonia $30 — For Earth", active: false },
};

// ── Partner perks ───────────────────────────────────────────────────────────
//
// /partnerPerks/{perkId}
//   title, partner, description, kind: percent-off | free-item | local-offer,
//   pointCost (500–2,000), active, earlyAccessUntil?: Timestamp (Verdure+ only
//   until then, everyone after), terms, expiresAt?, codePoolCount, redeemedCount
// /partnerPerks/{perkId}/codes/{codeId}   { code, claimedBy: uid|null, claimedAt }
//
// Fulfilment issues a code from the pre-loaded pool inside the redemption
// transaction — no vendor call, no dollars committed. The partner funds the
// perk; our cost is zero.

interface PerkDoc {
  title: string; partner: string; partnerId?: string; hidden?: boolean; description: string; kind: string; pointCost: number;
  active: boolean; earlyAccessUntil?: Timestamp | null; terms?: string; expiresAt?: Timestamp | null;
  codePoolCount?: number; redeemedCount?: number;
}

function perkVisibleTo(perk: PerkDoc, isPlus: boolean, now = Date.now()): boolean {
  if (perk.active !== true) return false;
  if (perk.expiresAt && perk.expiresAt.toMillis() <= now) return false;
  if (perk.earlyAccessUntil && perk.earlyAccessUntil.toMillis() > now && !isPlus) return false;
  return true;
}

// ── Treasury ────────────────────────────────────────────────────────────────
//
// /treasury/{yyyy-mm} — one document per month, merged into by every earn,
// redemption, planner call and ingestion run:
//   pointsIssued, pointsBurned, dollarsCommitted (cash cards queued),
//   dollarsFulfilled (cards actually sent), perksRedeemed, plannerCalls,
//   plannerCostUsd, serpApiCalls, earnersCount (distinct earners this month),
//   killSwitch (true once the monthly cap is hit — redemption halts cleanly)
// Cost per active user = (dollarsFulfilled + plannerCostUsd) / earnersCount.

export function treasuryRef(month = utcMonthKey()) {
  return db.collection("treasury").doc(month);
}

/**
 * Record issued points — called from the earn callables.
 *
 * Returns the fields to merge into the user document, so the caller's existing
 * transaction writes them atomically with the points themselves. A separate
 * write would let a crash between the two leave a balance the monthly total
 * disagrees with.
 *
 * `monthlyEarnPoints` is RESET rather than incremented on the first earn of a
 * new month. Storing it alongside `lastEarnMonth` means there is no cron to
 * miss: a stale month is simply ignored by every reader, so a user who does not
 * open the app for three months still reads 0 for the current one instead of
 * last-seen-month's total.
 */
export function recordPointsIssued(
  tx: FirebaseFirestore.Transaction, userData: FirebaseFirestore.DocumentData | undefined, points: number,
): { lastEarnMonth: string; monthlyEarnPoints: number } {
  const month = utcMonthKey();
  const firstThisMonth = userData?.lastEarnMonth !== month;
  tx.set(treasuryRef(month), {
    pointsIssued: FieldValue.increment(points),
    ...(firstThisMonth ? { earnersCount: FieldValue.increment(1) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const priorThisMonth = firstThisMonth ? 0 : (Number(userData?.monthlyEarnPoints) || 0);
  return { lastEarnMonth: month, monthlyEarnPoints: priorThisMonth + points };
}

/** Called by fulfillment when a card is actually delivered. */
export async function recordDollarsFulfilled(rewardId: string, requestedAt?: Timestamp): Promise<void> {
  const spec = CASH_CATALOG[rewardId];
  if (!spec) return;
  const month = utcMonthKey(requestedAt ? requestedAt.toDate() : new Date());
  await treasuryRef(month).set({ dollarsFulfilled: FieldValue.increment(spec.usd), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Called by fulfillment on a permanent failure: the commitment and the member's budget are released. */
export async function releaseCashCommitment(uid: string, rewardId: string, requestedAt?: Timestamp): Promise<void> {
  const spec = CASH_CATALOG[rewardId];
  if (!spec) return;
  const month = utcMonthKey(requestedAt ? requestedAt.toDate() : new Date());
  await treasuryRef(month).set({ dollarsCommitted: FieldValue.increment(-spec.usd), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const entries: Array<{ usd: number; at: Timestamp; rewardId?: string }> = snap.data()?.redemptionBudget?.entries ?? [];
    const idx = entries.findIndex((e) => e.rewardId === rewardId);
    if (idx >= 0) {
      entries.splice(idx, 1);
      tx.set(userRef, { redemptionBudget: { entries, updatedAt: Timestamp.now() } }, { merge: true });
    }
  });
}

// ── Rolling 12-month budget ─────────────────────────────────────────────────

interface BudgetEntry { usd: number; at: Timestamp; rewardId: string; }

function liveEntries(userData: FirebaseFirestore.DocumentData | undefined, now: number): BudgetEntry[] {
  const raw: BudgetEntry[] = userData?.redemptionBudget?.entries ?? [];
  return raw.filter((e) => e?.at?.toMillis && now - e.at.toMillis() < ROLLING_WINDOW_MS);
}

export function rollingSpendUsd(userData: FirebaseFirestore.DocumentData | undefined, now = Date.now()): number {
  return liveEntries(userData, now).reduce((s, e) => s + (Number(e.usd) || 0), 0);
}

/** When the oldest live entry drops out of the window (for the "frees up on …" message). */
function nextReleaseDate(userData: FirebaseFirestore.DocumentData | undefined, now: number): Date | null {
  const live = liveEntries(userData, now);
  if (!live.length) return null;
  const oldest = Math.min(...live.map((e) => e.at.toMillis()));
  return new Date(oldest + ROLLING_WINDOW_MS);
}

// ── redeemReward ────────────────────────────────────────────────────────────

/**
 * redeemReward — one callable for cash cards AND partner perks (same points
 * currency, same redemption UI). Everything that decides whether value leaves
 * the system happens inside ONE transaction on the user doc + the treasury doc,
 * so two concurrent calls cannot both slip under a ceiling.
 */
export const redeemReward = onCall(async (req) => {
  const uid = requireUid(req.auth, "Sign in to redeem.");
  await enforceRateLimit(uid, "redeemReward");
  await assertNotSuspended(uid);

  const rewardId = safeText(req.data?.rewardId, 100);
  if (!rewardId || rewardId.includes("/")) throw new HttpsError("invalid-argument", "Unknown reward.");

  const cash = CASH_CATALOG[rewardId];
  const perkRef = db.collection("partnerPerks").doc(rewardId);
  const perkSnap = cash ? null : await perkRef.get();
  if (!cash && !perkSnap?.exists) throw new HttpsError("invalid-argument", "Unknown reward.");

  const userRef = db.collection("users").doc(uid);
  const month = utcMonthKey();
  const tRef = treasuryRef(month);
  const now = Date.now();

  // A transaction that throws is rolled back — including any write it made. So
  // the kill switch is flipped OUTSIDE the transaction, after the abort.
  class TreasuryCapHit extends Error {}
  try {
    return await runRedeemTransaction();
  } catch (e) {
    if (e instanceof TreasuryCapHit) {
      await tRef.set({ killSwitch: true, killSwitchAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      throw new HttpsError("unavailable",
        "Gift-card redemptions are paused for the rest of this month while we review the reward budget. Your points are safe and partner perks are still available.");
    }
    throw e;
  }

  async function runRedeemTransaction() {
  return db.runTransaction(async (tx) => {
    const [userSnap, tSnap] = await Promise.all([tx.get(userRef), tx.get(tRef)]);
    const user = userSnap.data() ?? {};
    if (user.suspended === true) throw new HttpsError("permission-denied", "This account is suspended.");
    const treasury = tSnap.data() ?? {};
    const isPlus = plusActiveFrom(user, now);
    const redeemed: string[] = user.redeemedRewardIDs ?? [];
    const balance = Number(user.pointsBalance) || 0;

    // ── Cash gift card ──
    if (cash) {
      if (!cash.active) {
        throw new HttpsError("failed-precondition", `${cash.name} isn't in the catalog right now.`);
      }
      if (!isPlus) {
        throw new HttpsError("permission-denied",
          "Cash gift cards are a Verdure+ benefit. Free members redeem partner perks — or join Verdure+.");
      }
      if (redeemed.includes(rewardId)) throw new HttpsError("already-exists", "Already redeemed.");
      if (balance < cash.cost) throw new HttpsError("failed-precondition", "Not enough points.");

      // 2. Global monthly treasury cap — a bug or exploit can't drain the account.
      const committed = Number(treasury.dollarsCommitted) || 0;
      if (treasury.killSwitch === true || committed + cash.usd > GLOBAL_MONTHLY_TREASURY_CAP_USD) {
        throw new TreasuryCapHit();
      }

      // 1. Per-member rolling 12-month ceiling.
      const spent = rollingSpendUsd(user, now);
      if (spent + cash.usd > ROLLING_12MO_CASH_CEILING_USD) {
        const frees = nextReleaseDate(user, now);
        const when = frees ? ` It frees up on ${frees.toISOString().slice(0, 10)}.` : "";
        throw new HttpsError("failed-precondition",
          `You've reached the $${ROLLING_12MO_CASH_CEILING_USD} gift-card limit for a rolling 12 months.${when} Partner perks are still available.`);
      }

      const entries = [...liveEntries(user, now), { usd: cash.usd, at: Timestamp.now(), rewardId }];
      tx.set(userRef, {
        redeemedRewardIDs: FieldValue.arrayUnion(rewardId),
        pointsBalance: balance - cash.cost,
        redemptionBudget: { entries, updatedAt: Timestamp.now() },
        lastUpdated: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Durable fulfilment request in the SAME transaction (fulfillment.ts drains it).
      const fulfilmentRef = db.collection("fulfillments").doc(docIdFrom(uid, rewardId));
      tx.set(fulfilmentRef, {
        uid, rewardId, pointsSpent: cash.cost, usd: cash.usd,
        status: "pending", requestedAt: FieldValue.serverTimestamp(),
        deliverToEmail: req.auth?.token?.email ?? null,
        vendor: null, vendorOrderId: null, month,
      }, { merge: true });

      tx.set(tRef, {
        pointsBurned: FieldValue.increment(cash.cost),
        dollarsCommitted: FieldValue.increment(cash.usd),
        cashRedemptions: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        redeemed: true, kind: "cash", remaining: balance - cash.cost,
        rollingSpentUsd: spent + cash.usd, rollingCeilingUsd: ROLLING_12MO_CASH_CEILING_USD,
      };
    }

    // ── Partner perk ──
    const currentPerk = await tx.get(perkRef);
    if (!currentPerk.exists) throw new HttpsError("failed-precondition", "This perk is no longer available.");
    const perk = currentPerk.data() as PerkDoc;
    if (!perk.partnerId || perk.partnerId.includes("/")) throw new HttpsError("failed-precondition", "This offer has no verified partner.");
    const partner = await tx.get(db.doc(`partners/${perk.partnerId}`));
    if (!partnerHasAgreement(partner.data()) || perk.hidden === true || !perk.expiresAt || perk.expiresAt.toMillis() <= now ||
        !Number.isInteger(perk.pointCost) || perk.pointCost < PERK_MIN_COST || perk.pointCost > PERK_MAX_COST) {
      throw new HttpsError("failed-precondition", "This partner offer isn't available right now.");
    }
    if (!perkVisibleTo(perk, isPlus, now)) {
      throw new HttpsError(perk.active && perk.earlyAccessUntil && perk.earlyAccessUntil.toMillis() > now
        ? "permission-denied" : "failed-precondition",
        perk.active && perk.earlyAccessUntil && perk.earlyAccessUntil.toMillis() > now
          ? "Verdure+ early access — this perk opens to everyone soon."
          : "This perk isn't available right now.");
    }
    if (redeemed.includes(rewardId)) throw new HttpsError("already-exists", "Already redeemed.");
    const cost = perk.pointCost;
    if (balance < cost) throw new HttpsError("failed-precondition", "Not enough points.");

    // Claim one unclaimed code from the pool. The pool is server-only.
    const codes = await tx.get(perkRef.collection("codes").where("claimedBy", "==", null).limit(1));
    if (codes.empty) throw new HttpsError("resource-exhausted", "This perk is out of codes for now — check back soon.");
    const codeDoc = codes.docs[0];
    const code = safeString(codeDoc.data().code);

    tx.set(codeDoc.ref, { claimedBy: uid, claimedAt: Timestamp.now() }, { merge: true });
    tx.set(perkRef, { redeemedCount: FieldValue.increment(1), codePoolCount: FieldValue.increment(-1) }, { merge: true });
    writePerkStatus(tx, rewardId, { ...perk, codePoolCount: (Number(perk.codePoolCount) || 0) - 1 });
    tx.set(userRef, {
      redeemedRewardIDs: FieldValue.arrayUnion(rewardId),
      pointsBalance: balance - cost,
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
    // The member's copy of the code (owner-readable); the master stays server-only.
    tx.set(userRef.collection("perkCodes").doc(rewardId), {
      perkId: rewardId, title: perk.title, partner: partner.data()!.name, code,
      terms: perk.terms ?? null, expiresAt: perk.expiresAt ?? null, redeemedAt: Timestamp.now(),
    });
    tx.set(tRef, {
      pointsBurned: FieldValue.increment(cost),
      perksRedeemed: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { redeemed: true, kind: "perk", remaining: balance - cost, code, title: perk.title, partner: partner.data()!.name };
  });
  }
});

// ── Catalog for the app ─────────────────────────────────────────────────────

/**
 * listRewardsCatalog — everything the Rewards screen needs, with the CALLER's
 * eligibility already decided server-side: which perks they may see (early
 * access), whether cash is open to them (Plus), how much of their rolling
 * ceiling is left, and whether the treasury kill switch is on. The client
 * renders honest states from this instead of guessing.
 */
export const listRewardsCatalog = onCall(async (req) => {
  const uid = requireUid(req.auth);
  const now = Date.now();
  const [userSnap, perksSnap, tSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    loadActivePartnerPerks(),
    treasuryRef().get(),
  ]);
  const user = userSnap.data() ?? {};
  const isPlus = plusActiveFrom(user, now);
  const trustedOffers = new Map((await loadSurfacablePerks(isPlus, now, perksSnap, false)).map((p) => [p.id, p]));
  const perks = perksSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as PerkDoc) }))
    .filter((p) => trustedOffers.has(p.id))
    .filter((p) => perkVisibleTo(p, isPlus, now) || (p.active && p.earlyAccessUntil && p.earlyAccessUntil.toMillis() > now))
    .map((p) => ({
      id: p.id, title: p.title, partner: trustedOffers.get(p.id)!.partner, description: p.description, kind: p.kind,
      pointCost: Math.min(PERK_MAX_COST, Math.max(PERK_MIN_COST, Number(p.pointCost) || PERK_MIN_COST)),
      earlyAccessUntilMs: p.earlyAccessUntil ? p.earlyAccessUntil.toMillis() : null,
      plusOnlyUntilOpens: !!(!isPlus && p.earlyAccessUntil && p.earlyAccessUntil.toMillis() > now),
      redeemable: perkVisibleTo(p, isPlus, now) && (Number(p.codePoolCount) || 0) > 0,
      codesLeft: Number(p.codePoolCount) || 0,
      terms: p.terms ?? null,
      expiresAtMs: p.expiresAt ? p.expiresAt.toMillis() : null,
      latitude: trustedOffers.get(p.id)?.latitude ?? null,
      longitude: trustedOffers.get(p.id)?.longitude ?? null,
      partnerId: trustedOffers.get(p.id)!.partnerId,
      partnerRevision: trustedOffers.get(p.id)!.partnerRevision,
      perkRevision: trustedOffers.get(p.id)!.perkRevision,
    }));
  const cash = Object.entries(CASH_CATALOG).map(([id, c]) => ({ id, name: c.name, usd: c.usd, cost: c.cost, active: c.active }));
  const spent = rollingSpendUsd(user, now);
  return {
    isPlus,
    pointsPerDollar: POINTS_PER_DOLLAR,
    perks,
    cash,
    cashEligible: isPlus,
    rollingSpentUsd: spent,
    rollingCeilingUsd: ROLLING_12MO_CASH_CEILING_USD,
    rollingRemainingUsd: Math.max(0, ROLLING_12MO_CASH_CEILING_USD - spent),
    treasuryPaused: tSnap.data()?.killSwitch === true,
  };
});

// ── Staff: perks + treasury ─────────────────────────────────────────────────

/**
 * reconcileTreasury — the month's treasury against /fulfillments. Sums what was
 * actually SENT and what is still committed, compares to the running counters,
 * and writes the result back so drift is visible, never silent.
 */
export async function reconcile(month: string) {
  const rows = await db.collection("fulfillments").where("month", "==", month).get();
  let sentUsd = 0, committedUsd = 0, pending = 0, failed = 0, sent = 0;
  rows.forEach((d) => {
    const x = d.data();
    const usd = Number(x.usd) || CASH_CATALOG[String(x.rewardId)]?.usd || 0;
    if (x.status === "sent") { sentUsd += usd; sent++; committedUsd += usd; }
    else if (x.status === "failed") { failed++; }
    else { pending++; committedUsd += usd; }
  });
  const tSnap = await treasuryRef(month).get();
  const t = tSnap.data() ?? {};
  const report = {
    month,
    fulfillments: { sent, pending, failed, sentUsd, committedUsd },
    treasury: {
      dollarsFulfilled: Number(t.dollarsFulfilled) || 0,
      dollarsCommitted: Number(t.dollarsCommitted) || 0,
      pointsIssued: Number(t.pointsIssued) || 0,
      pointsBurned: Number(t.pointsBurned) || 0,
      perksRedeemed: Number(t.perksRedeemed) || 0,
      earnersCount: Number(t.earnersCount) || 0,
      plannerCalls: Number(t.plannerCalls) || 0,
      plannerCostUsd: Number(t.plannerCostUsd) || 0,
      serpApiCalls: Number(t.serpApiCalls) || 0,
      killSwitch: t.killSwitch === true,
    },
    reconciled: (Number(t.dollarsFulfilled) || 0) === sentUsd && (Number(t.dollarsCommitted) || 0) === committedUsd,
    costPerActiveUser: (Number(t.earnersCount) || 0) > 0
      ? Number((((Number(t.dollarsFulfilled) || 0) + (Number(t.plannerCostUsd) || 0)) / Number(t.earnersCount)).toFixed(4))
      : null,
    computedAt: new Date().toISOString(),
  };
  await treasuryRef(month).set({ reconciliation: report, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return report;
}

export const reconcileTreasury = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const month = /^\d{4}-\d{2}$/.test(safeString(req.data?.month)) ? safeString(req.data?.month) : utcMonthKey();
  return auditedStaffJob(staff, "treasury:reconcile", treasuryRef(month).path, (await treasuryRef(month).get()).data() ?? null,
    req.data?.reason ? staffReason(req.data.reason) : "Manual treasury reconciliation", () => reconcile(month));
});

/** Staff: lift the kill switch after review (it never lifts itself within the month). */
export const resetTreasuryKillSwitch = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const month = /^\d{4}-\d{2}$/.test(safeString(req.data?.month)) ? safeString(req.data?.month) : utcMonthKey();
  const reason = req.data?.reason ? staffReason(req.data.reason) : "Staff reviewed and reset treasury kill switch";
  await db.runTransaction(async (tx) => {
    const ref = treasuryRef(month), snap = await tx.get(ref), before = snap.data() ?? {};
    const change = { killSwitch: false, killSwitchResetBy: staff, killSwitchResetAt: Timestamp.now() };
    tx.set(ref, change, { merge: true });
    appendStaffAudit(tx, staff, "treasury:reset", ref.path, before, { ...before, ...change }, reason);
  });
  return { month, killSwitch: false };
});
