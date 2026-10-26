/**
 * Partner-aware surfacing.
 *
 * A partner perk may appear ALONGSIDE recommendations. It may never appear
 * INSIDE them, and it may never change them.
 *
 * THE TRUST RULES, which are not tunable and are enforced here rather than in
 * the UI, because a rule the client enforces is a rule the next client forgets:
 *
 *   1. A partner NEVER alters organic ranking. ranking.ts has no partner input
 *      and this module has no way to reach into it. The two produce separate
 *      lists; the caller renders them separately.
 *   2. Everything partner-sourced is LABELLED. `sponsored: true` is set here,
 *      not by the caller, and it is not optional in the payload shape.
 *   3. At most ONE per session. Not per screen, not per scroll — per session.
 *   4. Never in Friends Activity. That surface is other people's real
 *      behaviour; a paid placement inside it would make every genuine entry
 *      suspect, which is a cost that no partner revenue can repay.
 *   5. Dismissible, and the dismissal is remembered server-side.
 *   6. Free and Verdure+ members see IDENTICAL organic results. Membership
 *      changes which perks are claimable (early access) and nothing else.
 *
 * Rule 6 deserves the extra sentence: the moment a subscription can improve
 * what the ranker returns, every ranking becomes an upsell and the feed stops
 * being information. Early access changes the CLAIM window on a perk — never
 * its position, and never an event's.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import type { Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, safeText, distanceMeters } from "./common.js";
import { hasActivePlus } from "./common.js";
import { partnerHasAgreement, partnerStatus, perkStatus } from "./partner-status.js";
export { partnerHasAgreement } from "./partner-status.js";

/** Hard ceiling per session. See rule 3. */
export const MAX_SPONSORED_PER_SESSION = 1;

export type SurfaceId = "map" | "near_you" | "planner" | "rewards" | "event_detail";

/**
 * Surfaces a partner perk may appear on.
 *
 * `friends_activity` is deliberately ABSENT and there is no flag that adds it.
 * Rule 4 is enforced by the type, so putting a perk there is a compile error
 * rather than a config mistake.
 */
export const ALLOWED_SURFACES: readonly SurfaceId[] = [
  "map", "near_you", "planner", "rewards", "event_detail",
] as const;

export function isAllowedSurface(s: string): s is SurfaceId {
  return (ALLOWED_SURFACES as readonly string[]).includes(s);
}

export interface PerkContext {
  /** Category of what the user is looking at, if anything. */
  nearCategory?: string;
  /** Local hour 0-23, for time-appropriate offers (coffee at 9am, not 9pm). */
  localHour?: number;
  lat?: number;
  lng?: number;
}

interface SurfacablePerk {
  id: string;
  title: string;
  partner: string;
  description: string;
  kind: string;
  pointCost: number;
  categories: string[];
  /** Hours the offer makes sense, e.g. [6..11] for a coffee perk. Empty = any. */
  hours: number[];
  latitude?: number;
  longitude?: number;
  earlyAccessUntilMs?: number;
  claimable: boolean;
  partnerId?: string;
  partnerCategory?: string;
  days?: number[];
  expiresAtMs?: number;
  partnerRevision?: string;
  perkRevision?: string;
}

/** Walking-time estimates are straight-line estimates, not route guidance. */
export const WALKING_RADIUS_METERS = 800;

export function nearYouEligible(perk: SurfacablePerk, ctx: PerkContext, localDay: number): boolean {
  if (ctx.lat === undefined || ctx.lng === undefined || perk.latitude === undefined || perk.longitude === undefined) return false;
  if (![ctx.lat, ctx.lng, perk.latitude, perk.longitude].every(Number.isFinite) ||
      Math.abs(ctx.lat) > 90 || Math.abs(perk.latitude) > 90 || Math.abs(ctx.lng) > 180 || Math.abs(perk.longitude) > 180) return false;
  if (distanceMeters(ctx.lat, ctx.lng, perk.latitude, perk.longitude) > WALKING_RADIUS_METERS) return false;
  if (perk.days?.length && !perk.days.includes(localDay)) return false;
  if (perk.hours.length) return ctx.localHour !== undefined && perk.hours.includes(ctx.localHour);
  const category = (perk.partnerCategory ?? "").toLowerCase();
  if (/coffee|café|cafe/.test(category)) return ctx.localHour !== undefined && ctx.localHour >= 6 && ctx.localHour < 12;
  if (/food|restaurant/.test(category)) return ctx.localHour !== undefined &&
    ((ctx.localHour >= 11 && ctx.localHour < 15) || (ctx.localHour >= 17 && ctx.localHour < 21));
  if (/activit|recreation/.test(category)) return localDay === 0 || localDay === 6;
  return true;
}

/**
 * Relevance for a perk in a context. Note what this does NOT do: it never
 * returns a value that is combined with an event score. Perks are ranked only
 * against other perks.
 */
export function perkRelevance(perk: SurfacablePerk, ctx: PerkContext): number {
  let score = 0.3;                                    // baseline: it's a real offer
  if (ctx.nearCategory && perk.categories.includes(ctx.nearCategory)) score += 0.4;
  if (perk.hours.length === 0) score += 0.1;          // always-appropriate
  else if (ctx.localHour !== undefined && perk.hours.includes(ctx.localHour)) score += 0.3;
  else if (ctx.localHour !== undefined) score -= 0.25; // wrong time of day
  if (ctx.lat !== undefined && perk.latitude !== undefined && ctx.lng !== undefined && perk.longitude !== undefined) {
    const miles = haversineMiles(ctx.lat, ctx.lng, perk.latitude, perk.longitude);
    score += miles < 2 ? 0.2 : miles < 6 ? 0.1 : 0;
  }
  return Math.max(0, Math.min(1, score));
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h))) / 1609.344;
}

export interface SponsoredPlacement {
  perkId: string;
  title: string;
  partner: string;
  description: string;
  pointCost: number;
  /** Always true. Part of the shape so it cannot be forgotten at a call site. */
  sponsored: true;
  /** Why it was shown — surfaced to the user on request, and to us in QA. */
  reason: string;
  claimable: boolean;
}

/**
 * Choose at most one perk to surface.
 *
 * Returns null far more often than not, and that is the intended behaviour: no
 * relevant perk means no placement, never a filler one.
 */
export function choosePlacement(
  perks: SurfacablePerk[], ctx: PerkContext, dismissed: Set<string>, alreadyShown: number,
): SponsoredPlacement | null {
  if (alreadyShown >= MAX_SPONSORED_PER_SESSION) return null;

  const eligible = perks
    .filter((p) => !dismissed.has(p.id))
    .map((p) => ({ p, r: perkRelevance(p, ctx) }))
    // A weak match is worse than nothing. An irrelevant ad is what teaches
    // people to distrust the surface it appeared on.
    .filter((x) => x.r >= 0.5)
    .sort((a, b) => b.r - a.r || a.p.id.localeCompare(b.p.id));

  const top = eligible[0];
  if (!top) return null;

  return {
    perkId: top.p.id,
    title: top.p.title,
    partner: top.p.partner,
    description: top.p.description,
    pointCost: top.p.pointCost,
    sponsored: true,
    reason: ctx.nearCategory && top.p.categories.includes(ctx.nearCategory)
      ? `Because you're looking at ${ctx.nearCategory.toLowerCase()} events`
      : "A local offer near you",
    claimable: top.p.claimable,
  };
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

/** Page through the entire active catalogue; document IDs give a stable cursor. */
export async function loadActivePartnerPerks(): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[] }> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const query = db.collection("partnerPerks").where("active", "==", true).orderBy(FieldPath.documentId());
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    docs.push(...page.docs);
    if (page.size < 500) return { docs };
    cursor = page.docs[page.size - 1];
  }
}

export async function loadSurfacablePerks(isPlus: boolean, nowMs: number,
  existing?: { docs: FirebaseFirestore.QueryDocumentSnapshot[] }, requireStock = true): Promise<SurfacablePerk[]> {
  const snap = existing ?? await loadActivePartnerPerks();
  const partnerIds = [...new Set(snap.docs.map((d) => d.data().partnerId).filter((id): id is string =>
    typeof id === "string" && id.length > 0 && !id.includes("/")))];
  const partners = new Map<string, FirebaseFirestore.DocumentData | undefined>();
  for (let start = 0; start < partnerIds.length; start += 200) {
    const batch = await db.getAll(...partnerIds.slice(start, start + 200).map((id) => db.doc(`partners/${id}`)));
    for (const d of batch) partners.set(d.id, d.data());
  }
  return snap.docs.flatMap((d) => {
    const x = d.data();
    const partner = partners.get(x.partnerId);
    if (!partnerHasAgreement(partner) || x.active !== true || x.hidden === true || x.removed === true ||
        !Number.isInteger(x.pointCost) || x.pointCost < 500 || x.pointCost > 2000 ||
        (x.expiresAt?.toMillis?.() ?? 0) <= nowMs || (requireStock && !(Number(x.codePoolCount) > 0))) return [];
    const earlyMs = (x.earlyAccessUntil as Timestamp | undefined)?.toMillis?.();
    return [{
      id: d.id,
      partnerId: x.partnerId,
      partnerCategory: safeText(partner?.category, 60),
      title: safeText(x.title, 80),
      partner: safeText(partner?.name, 60),
      description: safeText(x.description, 200),
      kind: safeText(x.kind, 40),
      pointCost: Number(x.pointCost) || 0,
      categories: Array.isArray(x.categories) ? x.categories.map((c: unknown) => safeText(c, 40)) : [],
      hours: Array.isArray(x.hours) ? x.hours.map(Number).filter((h: number) => h >= 0 && h <= 23) : [],
      days: Array.isArray(x.days) ? x.days.filter((v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 6) : [],
      latitude: typeof partner?.latitude === "number" ? partner.latitude : undefined,
      longitude: typeof partner?.longitude === "number" ? partner.longitude : undefined,
      earlyAccessUntilMs: earlyMs,
      expiresAtMs: x.expiresAt.toMillis(),
      partnerRevision: partnerStatus(partner).revision,
      perkRevision: perkStatus(x).revision,
      // Early access changes whether it can be CLAIMED. It never changes
      // whether it is shown, or where — see rule 6. A free member sees the
      // perk and is told when it opens.
      claimable: !(earlyMs && earlyMs > nowMs && !isPlus),
    }];
  });
}

/** Dedicated map/near-you payloads never share the organic event query/array. */
export const nearbyPartners = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "sponsoredPlacement");
  const { lat, lng } = req.data ?? {};
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpsError("invalid-argument", "Valid location required.");
  const surface = req.data?.surface;
  if (surface !== "map" && surface !== "near_you") throw new HttpsError("invalid-argument", "Use a partner location surface.");
  const now = Date.now();
  const [user, dismissedSnap] = await Promise.all([db.doc(`users/${uid}`).get(), db.collection(`users/${uid}/dismissedPerks`).get()]);
  if (user.data()?.suspended) throw new HttpsError("permission-denied", "Account suspended.");
  const dismissed = new Set(dismissedSnap.docs.map((d) => d.id));
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(now));
  const localHour = Number(time.find((p) => p.type === "hour")?.value);
  const localDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(time.find((p) => p.type === "weekday")?.value ?? "");
  const perks = (await loadSurfacablePerks(await hasActivePlus(uid), now))
    .filter((p) => !dismissed.has(p.id) && p.latitude !== undefined && p.longitude !== undefined)
    .map((p) => ({ ...p, distanceMeters: distanceMeters(lat, lng, p.latitude!, p.longitude!) }))
    .filter((p) => p.distanceMeters <= (surface === "near_you" ? WALKING_RADIUS_METERS : 40_233.6))
    .filter((p) => surface === "map" || nearYouEligible(p, { lat, lng, localHour }, localDay))
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  const byPartner = new Map<string, (typeof perks)[number]>();
  for (const p of perks) if (p.partnerId && !byPartner.has(p.partnerId)) byPartner.set(p.partnerId, p);
  const unique = [...byPartner.values()];
  let selected = surface === "near_you" ? unique.slice(0, 1) : unique;
  if (surface === "near_you" && selected.length) {
    const sessionId = safeText(req.data?.sessionId, 64);
    if (!/^[A-Za-z0-9-]+$/.test(sessionId)) throw new HttpsError("invalid-argument", "Session required.");
    const ref = db.doc(`users/${uid}/adSessions/${sessionId}`);
    const claimed = await db.runTransaction(async (tx) => {
      const session = await tx.get(ref);
      if ((session.data()?.shown ?? 0) >= MAX_SPONSORED_PER_SESSION) return false;
      tx.set(ref, { shown: 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) selected = [];
  }
  return { validUntilMs: (Math.floor(now / 3_600_000) + 1) * 3_600_000, offers: selected.map((p) => ({ perkId: p.id, partnerId: p.partnerId, title: p.title,
    partner: p.partner, description: p.description, pointCost: p.pointCost, claimable: p.claimable,
    earlyAccessUntilMs: p.earlyAccessUntilMs ?? null,
    expiresAtMs: p.expiresAtMs, partnerRevision: p.partnerRevision, perkRevision: p.perkRevision,
    latitude: p.latitude, longitude: p.longitude, distanceMeters: p.distanceMeters,
    walkingMinutes: Math.max(1, Math.round(p.distanceMeters / 80)), sponsored: true })) };
});

export const sponsoredPlacement = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "sponsoredPlacement");

  const surface = safeText(req.data?.surface, 40);
  if (!isAllowedSurface(surface)) {
    // Includes any attempt to request one for Friends Activity. Rule 4.
    throw new HttpsError("invalid-argument", "Not a surface that can carry a partner placement.");
  }

  const sessionId = safeText(req.data?.sessionId, 64);
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) throw new HttpsError("invalid-argument", "A valid session id is required.");

  const nowMs = Date.now();
  const isPlus = await hasActivePlus(uid);

  const [dismissedSnap, sessionSnap] = await Promise.all([
    db.collection(`users/${uid}/dismissedPerks`).get(),
    db.doc(`users/${uid}/adSessions/${sessionId}`).get(),
  ]);
  const dismissed = new Set(dismissedSnap.docs.map((d) => d.id));
  const alreadyShown = Number(sessionSnap.data()?.shown) || 0;

  const ctx: PerkContext = {
    nearCategory: safeText(req.data?.nearCategory, 40) || undefined,
    localHour: Number.isFinite(Number(req.data?.localHour)) ? Number(req.data.localHour) : undefined,
    lat: Number.isFinite(Number(req.data?.lat)) ? Number(req.data.lat) : undefined,
    lng: Number.isFinite(Number(req.data?.lng)) ? Number(req.data.lng) : undefined,
  };

  const user = await db.doc(`users/${uid}`).get();
  if (user.data()?.suspended) throw new HttpsError("permission-denied", "Account suspended.");
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(nowMs));
  ctx.localHour = Number(clock.find((p) => p.type === "hour")?.value);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(clock.find((p) => p.type === "weekday")?.value ?? "");
  const locationValid = typeof req.data?.lat === "number" && typeof req.data?.lng === "number" &&
    Number.isFinite(ctx.lat) && Number.isFinite(ctx.lng) && Math.abs(ctx.lat!) <= 90 && Math.abs(ctx.lng!) <= 180;
  if ((surface === "map" || surface === "near_you") && !locationValid)
    throw new HttpsError("invalid-argument", "Valid location required.");
  const perks = (await loadSurfacablePerks(isPlus, nowMs)).filter((p) =>
    surface !== "near_you" || nearYouEligible(p, ctx, day));
  const placement = choosePlacement(perks, ctx, dismissed, alreadyShown);
  if (!placement) return { placement: null };

  // E3 — attribution. Impression counted where the decision is made, so the
  // count cannot drift from what was actually returned.
  const claimed = await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}/adSessions/${sessionId}`);
    const session = await tx.get(ref);
    if ((Number(session.data()?.shown) || 0) >= MAX_SPONSORED_PER_SESSION) return false;
    tx.set(ref, { shown: MAX_SPONSORED_PER_SESSION, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.doc(`partnerPerks/${placement.perkId}`), { impressions: FieldValue.increment(1) }, { merge: true });
    tx.set(db.doc(`partnerAttribution/${placement.perkId}`),
      { [`impressions_${surface}`]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  if (!claimed) return { placement: null };

  return { placement, surface };
});

export const dismissPerk = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "dismissPerk");
  const perkId = safeText(req.data?.perkId, 200);
  if (!perkId || perkId.includes("/")) throw new HttpsError("invalid-argument", "A perk id is required.");

  await Promise.all([
    db.doc(`users/${uid}/dismissedPerks/${perkId}`).set(
      { dismissedAt: FieldValue.serverTimestamp() }, { merge: true }),
    db.doc(`partnerAttribution/${perkId}`).set(
      { dismissals: FieldValue.increment(1) }, { merge: true }),
  ]);
  return { dismissed: true };
});

/** E3 — a tap on a placement. Separate from redemption, which economy.ts owns. */
export const recordPerkTap = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "recordPerkTap");
  const perkId = safeText(req.data?.perkId, 200);
  const surface = safeText(req.data?.surface, 40);
  if (!perkId || perkId.includes("/") || !isAllowedSurface(surface)) {
    throw new HttpsError("invalid-argument", "A perk id and a valid surface are required.");
  }
  await db.doc(`partnerAttribution/${perkId}`).set(
    { [`taps_${surface}`]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
    { merge: true });
  return { recorded: true };
});
