/** Account-bound, view-only snapshots. A preview stages exact bytes; chunks
 * cannot bypass entitlement, ownership, size, expiry or checksum checks. */
import { randomUUID, createHash } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, assertNotSuspended, plusActiveFrom, safeText, blockedSetFor, distanceMeters } from "../common.js";
import { areFriends } from "../friendships.js";
import { loadSurfacablePerks } from "../partners.js";
import { isProgram, programEligible } from "../programs.js";
import { catalog, parkFeature, validParkId, buildParkGuide, weekEvents, eventDTO, visibleParkEvent, coordinateInput } from "../parks/api.js";
import { boundaryDistanceMeters } from "../parks/guides.js";
import { containsPoint } from "../parks/geometry.js";
import type { Boundary, Position } from "../parks/types.js";
import { fetchThumbnail } from "./media.js";

export const MAX_PACK_BYTES = 50_000_000;
export const PACK_LIFETIME_MS = 7 * 86_400_000;
export const STAGING_LIFETIME_MS = 60 * 60_000;
const PART_BYTES = 150_000;
type Selection = { kind: "parks"; parkIds: string[] } | { kind: "area"; latitude: number; longitude: number; radiusMiles: number };
export function selectionInput(data: any): Selection {
  if (data?.kind === "parks") {
    if (!Array.isArray(data.parkIds) || data.parkIds.length < 1 || data.parkIds.length > 50) throw new HttpsError("invalid-argument", "Choose from one to 50 parks.");
    const parkIds = [...new Set<string>(data.parkIds.map(validParkId))].sort();
    return { kind: "parks", parkIds };
  }
  if (data?.kind === "area") {
    const p = coordinateInput(data), r = data.radiusMiles;
    if (typeof r !== "number" || !Number.isFinite(r) || r < 1 || r > 20) throw new HttpsError("invalid-argument", "Choose an area from 1 to 20 miles.");
    return { kind: "area", latitude: p[1], longitude: p[0], radiusMiles: r };
  }
  throw new HttpsError("invalid-argument", "Choose parks or an area.");
}
export function encodePack(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_PACK_BYTES) throw new HttpsError("resource-exhausted", "This pack exceeds 50 MB. Choose fewer parks or a smaller area.");
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += PART_BYTES) chunks.push(bytes.subarray(i, i + PART_BYTES).toString("base64"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const downloadBytes = chunks.reduce((total, data, index) => total + Buffer.byteLength(JSON.stringify({ result: { index, data, sha256 } })), 0);
  if (downloadBytes > MAX_PACK_BYTES) throw new HttpsError("resource-exhausted", "This download exceeds 50 MB. Choose fewer parks or a smaller area.");
  return { chunks, sha256, storedBytes: bytes.length, downloadBytes };
}
async function allRows(query: FirebaseFirestore.Query, max = 10_000) {
  const rows: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const ordered = query.orderBy(FieldPath.documentId());
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? ordered.startAfter(cursor) : ordered).limit(500).get();
    rows.push(...page.docs);
    if (rows.length > max) throw new HttpsError("resource-exhausted", "Too much data for one offline pack. Choose a smaller selection.");
    if (page.size < 500) return rows;
    cursor = page.docs.at(-1);
  }
}
function numericPoint(d: any): Position | null {
  return typeof d?.latitude === "number" && typeof d?.longitude === "number" && Number.isFinite(d.latitude) && Number.isFinite(d.longitude) &&
    Math.abs(d.latitude) <= 90 && Math.abs(d.longitude) <= 180 ? [d.longitude, d.latitude] : null;
}
function localPlaces(input: any, includes: (point: Position) => boolean) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 1000 || Buffer.byteLength(JSON.stringify(input)) > 1_000_000) throw new HttpsError("invalid-argument", "Too many local places for this pack.");
  const unique = new Map<string, object>();
  for (const d of input) {
    const id = safeText(d?.id, 160), p = numericPoint(d);
    if (!id || id.includes("/") || !p || !includes(p)) continue;
    // These are the app's existing provider results, not server-certified facts.
    // No point award, open status, rating or partner offer is inferred from them.
    unique.set(id, { id, name: safeText(d.name, 200), category: safeText(d.category, 40), description: safeText(d.description, 1000),
      latitude: p[1], longitude: p[0], hours: safeText(d.hours, 200) || null, source: safeText(d.source, 80),
      attribution: safeText(d.attribution, 300), fetchedAtMs: typeof d.fetchedAtMs === "number" && Number.isFinite(d.fetchedAtMs) ? d.fetchedAtMs : null,
      saved: d.saved === true });
  }
  return [...unique.values()];
}
async function memberPlans(uid: string, visibleEvents: Map<string, ReturnType<typeof eventDTO>>, getEvents: (ids: string[]) => Promise<void>, now: number) {
  const [sessions, groups] = await Promise.all([
    allRows(db.collection("eventPlanSessions").where("uid", "==", uid), 1000),
    allRows(db.collection("groupPlans").where("memberUIDs", "array-contains", uid), 1000),
  ]);
  const blocked = await blockedSetFor(uid);
  const plans: { id: string; title: string; eventIDs: string[]; kind: string }[] = [];
  for (const row of [...sessions, ...groups]) {
    const d = row.data(), group = row.ref.parent.id === "groupPlans";
    if (group && d.ownerUid !== uid && (blocked.has(d.ownerUid) || !await areFriends(uid, d.ownerUid))) continue;
    const ids = (group ? d.eventIDs : d.selectedIDs);
    if (!Array.isArray(ids) || ids.length > 50) continue;
    const valid = ids.filter((id): id is string => typeof id === "string" && id.length <= 200 && !id.includes("/"));
    await getEvents(valid);
    const eventIDs = valid.filter((id) => visibleEvents.has(id) && (visibleEvents.get(id)!.endMs ?? visibleEvents.get(id)!.startMs) > now);
    if (eventIDs.length) plans.push({ id: row.id, title: safeText(d.title, 100) || (group ? "A plan together" : "Your event plan"), eventIDs, kind: group ? "group" : "events" });
  }
  return plans;
}

export async function buildOfflinePack(uid: string, selection: Selection, profile: FirebaseFirestore.DocumentData, placeInput: any, now = Date.now(),
  thumbnail: typeof fetchThumbnail = fetchThumbnail) {
  const { state, index } = await catalog();
  let parkIds: string[];
  if (selection.kind === "parks") parkIds = selection.parkIds;
  else {
    const point: Position = [selection.longitude, selection.latitude];
    const nearby: string[] = [];
    for (const park of index) {
      const pad = selection.radiusMiles * 1609.344 / 110_000;
      if (park.bounds.south > point[1] + pad || park.bounds.north < point[1] - pad) continue;
      if (boundaryDistanceMeters((await parkFeature(state.generation, park.id)).geometry as Boundary, point) <= selection.radiusMiles * 1609.344) nearby.push(park.id);
    }
    parkIds = nearby;
    if (parkIds.length > 50) throw new HttpsError("resource-exhausted", "This area contains more than 50 parks. Choose a smaller area.");
  }
  const week = await weekEvents(uid, now), guides: Awaited<ReturnType<typeof buildParkGuide>>[] = [];
  let guideBytes = 0;
  for (const id of parkIds) {
    const guide = await buildParkGuide(state, index, id, week, uid);
    guideBytes += Buffer.byteLength(JSON.stringify(guide));
    if (guideBytes > MAX_PACK_BYTES) throw new HttpsError("resource-exhausted", "These guides exceed 50 MB. Choose fewer parks.");
    guides.push(guide);
  }
  const includes = (point: Position) => selection.kind === "area"
    ? distanceMeters(selection.latitude, selection.longitude, point[1], point[0]) <= selection.radiusMiles * 1609.344
    : guides.some((g) => containsPoint(g.park.geometry as Boundary, point));
  const events = new Map(week.filter((e) => includes([e.longitude, e.latitude])).map((e) => [e.id, e]));
  const blocked = await blockedSetFor(uid);
  const following = new Set((await allRows(db.collection(`users/${uid}/following`), 10_000)).map((d) => d.id));
  const loaded = new Set(events.keys());
  async function getEvents(ids: string[]) {
    const missing = [...new Set(ids)].filter((id) => !loaded.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const rows = await db.getAll(...missing.slice(i, i + 200).map((id) => db.doc(`events/${id}`)));
      for (const row of rows) {
        loaded.add(row.id); const d = row.data();
        if (!d || !d.date?.toMillis || (d.endDate?.toMillis?.() ?? d.date.toMillis()) <= now) continue;
        const allowed = d.broadcast === true || d.creatorID === uid || following.has(d.organizerId);
        // The member may keep their own/followed private or virtual saved event;
        // it is never merged into public area/park discovery.
        const visible = isProgram(d) ? programEligible(d, profile, now) && !blocked.has(d.creatorID) && !blocked.has(d.organizerId)
          : visibleParkEvent({ ...d, broadcast: true, virtual: false }, profile, blocked, now);
        if (!allowed || !visible) continue;
        events.set(row.id, eventDTO(row.id, { ...d, latitude: numericPoint(d)?.[1] ?? null, longitude: numericPoint(d)?.[0] ?? null }));
      }
    }
  }
  const savedIDs = Array.isArray(profile.savedEventIDs) ? profile.savedEventIDs.filter((id): id is string => typeof id === "string" && id.length <= 200 && !id.includes("/")) : [];
  if (savedIDs.length > 2000) throw new HttpsError("resource-exhausted", "Too many saved events for one pack.");
  await getEvents(savedIDs);
  const plans = await memberPlans(uid, events, getEvents, now);
  if (events.size > 2000) throw new HttpsError("resource-exhausted", "More than 2,000 events fit this pack. Choose a smaller area.");
  const savedEventIDs = savedIDs.filter((id) => events.has(id));
  const adventurePlans = (await allRows(db.collection(`users/${uid}/adventurePlans`), 1000)).map((row) => {
    const d = row.data();
    const stops = Array.isArray(d.stops) ? d.stops.filter((s: any) => numericPoint(s)).map((s: any) => ({
      placeId: safeText(s.placeId, 160), name: safeText(s.name, 200), latitude: s.latitude, longitude: s.longitude,
      minutes: Number.isFinite(s.minutes) ? s.minutes : null, why: safeText(s.why, 1000), order: Number.isFinite(s.order) ? s.order : null,
    })) : [];
    return { id: row.id, kind: "places", title: safeText(d.title, 200), intro: safeText(d.intro, 1000), stops, eventIDs: [],
      generatedAtMs: Number.isFinite(d.generatedAtMs) ? d.generatedAtMs : null };
  }).filter((p) => p.stops.length > 0);
  const dismissals = new Set((await allRows(db.collection(`users/${uid}/dismissedPerks`))).map((r) => r.id));
  const perks = (await loadSurfacablePerks(true, now)).filter((p) => !dismissals.has(p.id) && numericPoint(p) && includes(numericPoint(p)!))
    .map((p) => ({ id: p.id, title: p.title, partner: p.partner, description: p.description, pointCost: p.pointCost,
      latitude: p.latitude, longitude: p.longitude, expiresAtMs: p.expiresAtMs, earlyAccessUntilMs: p.earlyAccessUntilMs ?? null, viewOnly: true }));
  // Separate thumbnails from event facts; no URL download is required offline.
  const thumbnails: Record<string, string> = {}; const unavailableThumbnails: string[] = [];
  const rows = [...events.values()]; let next = 0;
  // Four bounded workers must finish within the callable's overall deadline.
  // Preserve every event fact even when provider images are slow/unavailable.
  const thumbnailDeadline = Date.now() + 180_000;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < rows.length) {
      const event = rows[next++]; if (!event.imageURL) continue;
      if (Date.now() >= thumbnailDeadline) { unavailableThumbnails.push(event.id); continue; }
      try { const data = await thumbnail(event.imageURL); if (data) thumbnails[event.id] = data; else unavailableThumbnails.push(event.id); }
      catch { unavailableThumbnails.push(event.id); }
    }
  }));
  return { version: 1, ownerUid: uid, memberBirthYear: Number.isInteger(profile.birthYear) ? profile.birthYear : null, createdAtMs: now, expiresAtMs: now + PACK_LIFETIME_MS, selection,
    label: selection.kind === "area" ? "Your area" : guides.length === 1 ? guides[0].park.name : `${guides.length} parks`,
    guides, events: rows, savedEventIDs, plans: [...plans, ...adventurePlans], places: localPlaces(placeInput, includes), perks, thumbnails, unavailableThumbnails,
    mapImageryIncluded: false, actions: "Available when you're back online", checkInAllowed: false };
}

const options = { timeoutSeconds: 540 as const, memory: "1GiB" as const, maxInstances: 3 };
export const offlinePack = onCall(options, async (req) => {
  const uid = requireUid(req.auth), action = req.data?.action;
  const collection = db.collection(`users/${uid}/offlinePacks`);
  if (action === "cancel") {
    await enforceRateLimit(uid, "offlinePackControl");
    const id = packID(req.data?.packId); await db.recursiveDelete(collection.doc(id)); return { deleted: true };
  }
  await assertNotSuspended(uid);
  const profile = (await db.doc(`users/${uid}`).get()).data() ?? {};
  if (!plusActiveFrom(profile)) throw new HttpsError("permission-denied", "Offline park and place packs require an active server-verified Verdure+ membership.");
  if (action === "preview") {
    const selection = selectionInput(req.data?.selection); await enforceRateLimit(uid, "offlinePackGenerate");
    const root = collection.doc(randomUUID()), now = Date.now();
    const stageExpiresAt = Timestamp.fromMillis(now + STAGING_LIFETIME_MS);
    // The reservation precedes expensive assembly, so concurrent previews
    // cannot bypass the per-account staging/storage bound.
    await db.runTransaction(async (tx) => {
      const rows = await tx.get(collection);
      if (rows.docs.filter((r) => (r.data().stageExpiresAt?.toMillis?.() ?? 0) > now).length >= 3) throw new HttpsError("resource-exhausted", "Finish or cancel an existing download first.");
      tx.create(root, { status: "building", stageExpiresAt, ownerUid: uid });
    });
    try {
      const pack = await buildOfflinePack(uid, selection, profile, req.data?.places, now);
      if (!plusActiveFrom((await db.doc(`users/${uid}`).get()).data())) throw new HttpsError("permission-denied", "Your membership expired while preparing this pack.");
      const encoded = encodePack(pack);
      for (let i = 0; i < encoded.chunks.length; i += 50) {
        const batch = db.batch(); encoded.chunks.slice(i, i + 50).forEach((data, j) => batch.create(root.collection("chunks").doc(String(i + j)), { data }));
        await batch.commit();
      }
      await root.update({ status: "ready", sha256: encoded.sha256, parts: encoded.chunks.length, storedBytes: encoded.storedBytes,
        downloadBytes: encoded.downloadBytes, createdAtMs: pack.createdAtMs, expiresAtMs: pack.expiresAtMs, label: pack.label, selection });
      return { packId: root.id, sha256: encoded.sha256, parts: encoded.chunks.length, storedBytes: encoded.storedBytes,
        downloadBytes: encoded.downloadBytes, createdAtMs: pack.createdAtMs, expiresAtMs: pack.expiresAtMs, label: pack.label,
        counts: { parks: pack.guides.length, events: pack.events.length, savedEvents: pack.savedEventIDs.length, plans: pack.plans.length, places: pack.places.length, perks: pack.perks.length, thumbnails: Object.keys(pack.thumbnails).length },
        unavailableThumbnails: pack.unavailableThumbnails.length, stageExpiresAtMs: stageExpiresAt.toMillis() };
    } catch (e) { await db.recursiveDelete(root); throw e; }
  }
  if (action === "chunk") {
    await enforceRateLimit(uid, "offlinePackRead");
    const id = packID(req.data?.packId), index = req.data?.index;
    const root = collection.doc(id), d = (await root.get()).data();
    if (!d || d.status !== "ready" || d.ownerUid !== uid) throw new HttpsError("not-found", "Download not found.");
    if ((d.stageExpiresAt?.toMillis?.() ?? 0) <= Date.now() || d.expiresAtMs <= Date.now()) throw new HttpsError("failed-precondition", "This preview expired. Prepare a fresh pack.");
    if (d.downloadBytes > MAX_PACK_BYTES || d.storedBytes > MAX_PACK_BYTES) throw new HttpsError("resource-exhausted", "Pack exceeds the download limit.");
    if (!Number.isSafeInteger(index) || index < 0 || index >= d.parts) throw new HttpsError("invalid-argument", "Invalid download part.");
    const part = (await root.collection("chunks").doc(String(index)).get()).data();
    if (!part || typeof part.data !== "string" || part.data.length > 200_000) throw new HttpsError("unavailable", "Download part is unavailable. Prepare a fresh pack.");
    return { index, data: part.data, sha256: d.sha256 };
  }
  throw new HttpsError("invalid-argument", "Choose preview, chunk or cancel.");
});
function packID(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) throw new HttpsError("invalid-argument", "Invalid download.");
  return value;
}
export async function cleanupExpiredPackStages(now = Date.now()) {
  const query = db.collectionGroup("offlinePacks").where("stageExpiresAt", "<=", Timestamp.fromMillis(now)).orderBy("stageExpiresAt");
  const deadline = Date.now() + 480_000;
  let deleted = 0;
  // Delete and re-query bounded pages. A large backlog must make progress,
  // rather than failing the full-catalog 10,000-row safety limit every hour.
  while (Date.now() < deadline) {
    const page = await query.limit(100).get();
    if (page.empty) return deleted;
    for (let i = 0; i < page.docs.length; i += 4) {
      await Promise.all(page.docs.slice(i, i + 4).map(row => db.recursiveDelete(row.ref)));
      deleted += Math.min(4, page.docs.length - i);
      if (Date.now() >= deadline) break;
    }
  }
  console.log(`Offline staging cleanup removed ${deleted} expired downloads; next scheduled run continues the backlog.`);
  return deleted;
}
export const expireOfflinePackStages = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540, memory: "512MiB" }, async () => {
  await cleanupExpiredPackStages();
});
