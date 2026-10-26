/**
 * Verdure+ entitlement — server-verified against Apple.
 *
 * WHAT THIS CLOSES.
 * `hasActivePlus()` reads `users/{uid}.plusExpiresAt`, and until now NOTHING
 * wrote it. Every Plus benefit was therefore inert: the 1.25x earn multiplier
 * never applied, and the Verdure+ early-access window on limited drops rejected
 * paying members exactly as it rejected everyone else. Meanwhile the app's own
 * `StoreService.isPlus` is pure client state — a value the device decides — so
 * it can never be the basis for handing out money. This module is the missing
 * writer, and it only ever writes what Apple cryptographically confirms.
 *
 * THE BINDING PROBLEM (the part that's actually hard).
 * Verifying "this subscription is real" is easy. Verifying "this subscription
 * belongs to THIS Verdure account" is the real work: `originalTransactionId` is
 * just a string, so if we granted Plus to whoever sends one, a single leaked id
 * would entitle every account that pasted it.
 *
 * Two defences, in order of strength:
 *   1. `appAccountToken` — a UUID the app attaches AT PURCHASE TIME, which Apple
 *      embeds in the signed transaction. We mint it per user and compare. An
 *      attacker can't forge it: changing it invalidates Apple's signature.
 *   2. First-claim binding, for purchases made before we started sending the
 *      token. The first uid to claim an originalTransactionId owns it, and it
 *      can never silently move to another account. A transfer needs a human.
 *
 * SETUP:
 *   firebase functions:secrets:set APPLE_IAP_PRIVATE_KEY   # the .p8 file CONTENTS
 *   firebase functions:secrets:set APPLE_IAP_KEY_ID
 *   firebase functions:secrets:set APPLE_IAP_ISSUER_ID
 * plus APPLE_BUNDLE_ID / APPLE_APP_APPLE_ID in the function env. The In-App
 * Purchase key comes from App Store Connect → Users and Access → Integrations →
 * In-App Purchase. Point App Store Server Notifications V2 at the
 * `appStoreNotifications` URL this file deploys.
 */

import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AppStoreServerAPIClient,
  SignedDataVerifier,
  Environment,
  Status,
  APIException,
} from "@apple/app-store-server-library";

const db = () => getFirestore();

const APPLE_IAP_PRIVATE_KEY = defineSecret("APPLE_IAP_PRIVATE_KEY");
const APPLE_IAP_KEY_ID = defineSecret("APPLE_IAP_KEY_ID");
const APPLE_IAP_ISSUER_ID = defineSecret("APPLE_IAP_ISSUER_ID");

const APPLE_BUNDLE_ID = defineString("APPLE_BUNDLE_ID", { default: "com.verdure-app.verdure" });
/** Numeric Apple ID of the app. Required by the verifier in PRODUCTION. */
const APPLE_APP_APPLE_ID = defineString("APPLE_APP_APPLE_ID", { default: "" });

export const PLUS_PRODUCT_IDS = new Set([
  "com.verdure-app.verdure.plus.monthly",
  "com.verdure-app.verdure.plus.yearly",
]);

/**
 * Apple's root CA, committed at functions/certs/AppleRootCA-G3.cer.
 *
 * It's bundled rather than fetched at runtime deliberately: downloading the
 * trust anchor you're about to validate against, over the network, at the
 * moment you need it, is not a trust anchor. It's also a hard dependency on
 * apple.com being up during every verification.
 */
function appleRootCAs(): Buffer[] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // lib/ at runtime, src/ in tests — certs/ sits beside both.
    for (const rel of ["../certs/AppleRootCA-G3.cer", "../../certs/AppleRootCA-G3.cer"]) {
      try {
        return [readFileSync(join(here, rel))];
      } catch { /* try the next candidate */ }
    }
  } catch { /* fall through */ }
  return [];
}

function environment(): Environment {
  return process.env.APPLE_IAP_ENVIRONMENT === "production"
    ? Environment.PRODUCTION
    : Environment.SANDBOX;
}

function apiClient(env: Environment): AppStoreServerAPIClient {
  return new AppStoreServerAPIClient(
    APPLE_IAP_PRIVATE_KEY.value(),
    APPLE_IAP_KEY_ID.value(),
    APPLE_IAP_ISSUER_ID.value(),
    APPLE_BUNDLE_ID.value(),
    env
  );
}

function verifier(env: Environment): SignedDataVerifier {
  const appleId = Number(APPLE_APP_APPLE_ID.value());
  return new SignedDataVerifier(
    appleRootCAs(),
    /* enableOnlineChecks */ true,
    env,
    APPLE_BUNDLE_ID.value(),
    Number.isFinite(appleId) && appleId > 0 ? appleId : undefined
  );
}

/**
 * The UUID the app attaches to a purchase so Apple can tell us who bought it.
 *
 * Derived from the uid (RFC 4122 v5, SHA-1 over a fixed namespace) rather than
 * random-and-stored, which matters more than it looks:
 *
 *  - There is no `appAccountToken` field on the user document, so there is no
 *    field a client can overwrite to impersonate another buyer. The expected
 *    value is recomputed from `request.auth.uid` on every check.
 *  - It does NOT need to be secret. The test is
 *    `transaction.appAccountToken == token(caller_uid)`. Someone replaying a
 *    victim's transaction id still computes their OWN token, which won't match
 *    the one Apple signed into the victim's transaction. Predictability buys an
 *    attacker nothing, so there's no salt to manage or rotate.
 *  - It's stable across reinstalls and devices, so restoring a purchase on a new
 *    phone re-derives the same token and still verifies.
 */
export function appAccountTokenFor(uid: string): string {
  // Fixed namespace UUID for Verdure account tokens (any constant works; it
  // only has to never change, or every existing purchase stops matching).
  const NAMESPACE = "3f2b7c48-9a1d-4e6f-8b52-0c9d7a4e1b63";
  const nsBytes = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([nsBytes, Buffer.from(uid, "utf8")]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;   // version 5
  b[8] = (b[8] & 0x3f) | 0x80;   // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * getAppAccountToken — the app asks for its token before starting a purchase
 * and passes it to StoreKit as `Product.PurchaseOption.appAccountToken`.
 */
export const getAppAccountToken = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return { appAccountToken: appAccountTokenFor(uid) };
});

/** What Apple says about one subscription, after signature verification. */
interface VerifiedEntitlement {
  originalTransactionId: string;
  productId: string;
  expiresAtMs: number;
  active: boolean;
  appAccountToken?: string;
  status: number;
}

/**
 * Ask Apple about a transaction and return the verified entitlement.
 *
 * Tries production first and falls back to sandbox. That order matters: a real
 * subscriber's id is unknown to sandbox, and TestFlight/dev ids are unknown to
 * production, so checking only one environment makes half the world unverifiable.
 */
async function fetchEntitlement(anyTransactionId: string): Promise<VerifiedEntitlement | null> {
  const environments = environment() === Environment.PRODUCTION
    ? [Environment.PRODUCTION, Environment.SANDBOX]
    : [Environment.SANDBOX, Environment.PRODUCTION];

  for (const env of environments) {
    try {
      const statuses = await apiClient(env).getAllSubscriptionStatuses(anyTransactionId);
      const v = verifier(env);

      for (const group of statuses.data ?? []) {
        for (const item of group.lastTransactions ?? []) {
          if (!item.signedTransactionInfo) continue;
          // The signature check is the whole point — the decoded payload is only
          // trustworthy because verifyAndDecodeTransaction validated the chain
          // back to Apple's root CA above.
          const tx = await v.verifyAndDecodeTransaction(item.signedTransactionInfo);
          const productId = tx.productId ?? "";
          if (!PLUS_PRODUCT_IDS.has(productId)) continue;

          const expiresAtMs = Number(tx.expiresDate ?? 0);
          const revoked = tx.revocationDate != null;
          const status = Number(item.status ?? 0);
          // BILLING_GRACE_PERIOD still entitles the user — Apple is retrying the
          // charge and the member keeps access meanwhile. Revocation (refund)
          // does not, regardless of the expiry date.
          const active = !revoked &&
            (status === Status.ACTIVE || status === Status.BILLING_GRACE_PERIOD) &&
            expiresAtMs > Date.now();

          return {
            originalTransactionId: String(tx.originalTransactionId ?? anyTransactionId),
            productId,
            expiresAtMs,
            active,
            appAccountToken: tx.appAccountToken,
            status,
          };
        }
      }
      return null;
    } catch (e) {
      // 4040010 = transaction id not found in THIS environment; try the other.
      if (e instanceof APIException && e.apiError === 4040010) continue;
      throw e;
    }
  }
  return null;
}

/**
 * Write the entitlement onto the user, and index the transaction back to them.
 *
 * `plusExpiresAt` is denied to clients by the Firestore rules, so this Admin-SDK
 * write is the only way it can ever change.
 */
async function grant(uid: string, ent: VerifiedEntitlement): Promise<void> {
  const batch = db().batch();
  batch.set(db().collection("users").doc(uid), {
    plusExpiresAt: ent.active ? Timestamp.fromMillis(ent.expiresAtMs) : null,
    plusProductId: ent.active ? ent.productId : null,
    plusOriginalTransactionId: ent.originalTransactionId,
    plusStatus: ent.status,
    plusUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db().collection("subscriptions").doc(ent.originalTransactionId), {
    uid,
    productId: ent.productId,
    expiresAtMs: ent.expiresAtMs,
    active: ent.active,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
}

/**
 * linkSubscription — the client says "I bought Plus, here's the transaction".
 *
 * The client is not believed about the SUBSCRIPTION (we ask Apple) or about the
 * OWNERSHIP (we check appAccountToken, or first-claim). It's only trusted to
 * point us at which transaction to look up.
 */
export const linkSubscription = onCall(
  { secrets: [APPLE_IAP_PRIVATE_KEY, APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID] },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

    const transactionId = typeof req.data?.transactionId === "string"
      ? req.data.transactionId.slice(0, 100) : "";
    if (!transactionId) throw new HttpsError("invalid-argument", "Missing transactionId.");

    let ent: VerifiedEntitlement | null;
    try {
      ent = await fetchEntitlement(transactionId);
    } catch (e) {
      console.error("[linkSubscription] Apple lookup failed", e);
      throw new HttpsError("unavailable", "Couldn't reach the App Store. Try again shortly.");
    }
    if (!ent) throw new HttpsError("not-found", "No Verdure+ subscription found for that purchase.");

    // ── Ownership ──
    if (ent.appAccountToken) {
      // Strong path: Apple signed the token the app attached at purchase, and
      // the expected value is RECOMPUTED from the caller's uid rather than read
      // from a stored field. There is nothing here for an attacker to overwrite.
      if (ent.appAccountToken.toLowerCase() !== appAccountTokenFor(uid)) {
        throw new HttpsError("permission-denied",
          "That subscription belongs to a different Verdure account.");
      }
    }

    // Weak path / belt-and-braces: never let an active binding move accounts on
    // its own. Someone sharing a transaction id can't lift Plus off its owner.
    const existing = await db().collection("subscriptions").doc(ent.originalTransactionId).get();
    const boundUid = existing.data()?.uid;
    if (typeof boundUid === "string" && boundUid !== uid) {
      throw new HttpsError("permission-denied",
        "That subscription is already linked to another Verdure account.");
    }

    await grant(uid, ent);
    return {
      plus: ent.active,
      productId: ent.productId,
      expiresAt: ent.active ? ent.expiresAtMs : null,
    };
  }
);

/**
 * appStoreNotifications — App Store Server Notifications V2 webhook.
 *
 * Without this, an entitlement is only as fresh as the last time the app
 * happened to call linkSubscription: a cancelled or refunded subscription would
 * keep earning 1.25x until its original expiry. Apple pushes the state change
 * here instead, so renewals extend and refunds revoke within seconds — even if
 * the user never opens the app again.
 *
 * Unauthenticated by necessity (Apple calls it), but not untrusted: the payload
 * is a JWS whose chain is verified to Apple's root CA. Anything that fails
 * verification is rejected before a single field is read.
 */
export const appStoreNotifications = onRequest(
  { secrets: [APPLE_IAP_PRIVATE_KEY, APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID] },
  async (request, response) => {
    if (request.method !== "POST") { response.status(405).send("Method not allowed"); return; }

    const signedPayload = request.body?.signedPayload;
    if (typeof signedPayload !== "string") { response.status(400).send("Missing signedPayload"); return; }

    let decoded;
    try {
      decoded = await verifier(environment()).verifyAndDecodeNotification(signedPayload);
    } catch (e) {
      // Try the other environment before giving up — sandbox notifications
      // arrive at the same URL as production ones.
      try {
        const other = environment() === Environment.PRODUCTION
          ? Environment.SANDBOX : Environment.PRODUCTION;
        decoded = await verifier(other).verifyAndDecodeNotification(signedPayload);
      } catch {
        console.warn("[appStoreNotifications] signature verification failed", e);
        response.status(401).send("Invalid signature");
        return;
      }
    }

    try {
      // Every notification we care about carries a signed transaction; the ones
      // that don't (TEST, and the external-purchase family) have no user to
      // update, so there's nothing to do but acknowledge them.
      const signedTx = decoded?.data?.signedTransactionInfo;
      if (!signedTx) {
        console.info(`[appStoreNotifications] no transaction on ${decoded?.notificationType}`);
        response.status(200).send("OK");
        return;
      }

      const tx = await verifier(environment()).verifyAndDecodeTransaction(signedTx)
        .catch(async () => {
          const other = environment() === Environment.PRODUCTION
            ? Environment.SANDBOX : Environment.PRODUCTION;
          return verifier(other).verifyAndDecodeTransaction(signedTx);
        });
      const txId = tx.originalTransactionId;

      if (txId) {
        const bound = await db().collection("subscriptions").doc(txId).get();
        const uid = bound.data()?.uid;
        if (typeof uid === "string") {
          // Re-query Apple rather than trusting the notification body alone:
          // one authoritative code path for "what is this user entitled to".
          const ent = await fetchEntitlement(txId);
          if (ent) await grant(uid, ent);
        } else {
          console.info(`[appStoreNotifications] ${decoded?.notificationType} for unlinked tx ${txId}`);
        }
      }
    } catch (e) {
      // 200 anyway on internal failure: Apple retries on non-2xx, and a bug in
      // our handler shouldn't turn into a retry storm. The log is the alarm.
      console.error("[appStoreNotifications] handling failed", e);
    }

    response.status(200).send("OK");
  }
);

/**
 * refreshMySubscription — re-check the caller's own entitlement on demand.
 * Used by the app at launch so a renewal that happened while it was closed is
 * reflected without waiting for a notification.
 */
export const refreshMySubscription = onCall(
  { secrets: [APPLE_IAP_PRIVATE_KEY, APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID] },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const snap = await db().collection("users").doc(uid).get();
    const txId = snap.data()?.plusOriginalTransactionId;
    if (typeof txId !== "string" || !txId) return { plus: false };

    const ent = await fetchEntitlement(txId);
    if (!ent) return { plus: false };
    await grant(uid, ent);
    return { plus: ent.active, expiresAt: ent.active ? ent.expiresAtMs : null };
  }
);

// NOTE: no `__testing` export here on purpose. `fetchEntitlement` and `grant`
// can't be exercised without live Apple credentials, so exporting them would be
// scaffolding for a test that can't exist. `appAccountTokenFor` — the one piece
// that IS pure and worth pinning — is exported directly above and covered by
// scripts/subscription-unit.mjs.
