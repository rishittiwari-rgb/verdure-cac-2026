/** Public invalidation metadata only: never copy contacts, agreements or codes. */
import { createHash } from "node:crypto";
import { db, safeText } from "./common.js";
import type { Transaction } from "firebase-admin/firestore";

export function partnerHasAgreement(partner: FirebaseFirestore.DocumentData | undefined): boolean {
  return !!partner && partner.active === true && partner.hidden !== true && partner.removed !== true &&
    safeText(partner.agreement?.agreedBy, 200).length > 0 && safeText(partner.agreement?.reference, 1000).length > 0 &&
    typeof partner.agreement?.agreedAt?.toMillis === "function" && partner.agreement.agreedAt.toMillis() > 0;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function partnerStatus(data: FirebaseFirestore.DocumentData | undefined) {
  const available = partnerHasAgreement(data);
  return { available, revision: digest([available, data?.name ?? null, data?.category ?? null,
    data?.latitude ?? null, data?.longitude ?? null]) };
}
export function perkStatus(data: FirebaseFirestore.DocumentData | undefined) {
  const expiresAtMs = data?.expiresAt?.toMillis?.() ?? 0;
  const visible = data?.active === true && data?.hidden !== true && data?.removed !== true &&
    Number.isInteger(data?.pointCost) && data!.pointCost >= 500 && data!.pointCost <= 2000;
  const stock = Number(data?.codePoolCount) || 0;
  const available = visible && stock > 0;
  // Expiry is a timestamp, rather than a clock-dependent revision. Clients
  // can expire an already downloaded offer without another server write.
  return { visible, available, expiresAtMs, revisionVersion: 2, revision: digest([visible, available, stock, expiresAtMs, data?.title ?? null, data?.description ?? null,
    data?.terms ?? null, data?.pointCost ?? null, data?.earlyAccessUntil?.toMillis?.() ?? null,
    data?.categories ?? [], data?.hours ?? [], data?.days ?? []]) };
}
export function writePartnerStatus(tx: Transaction, id: string, data: FirebaseFirestore.DocumentData) {
  tx.set(db.doc(`partnerStatus/${id}`), partnerStatus(data));
}
export function writePerkStatus(tx: Transaction, id: string, data: FirebaseFirestore.DocumentData) {
  tx.set(db.doc(`perkStatus/${id}`), perkStatus(data));
}
