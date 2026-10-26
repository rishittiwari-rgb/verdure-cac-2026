/** Staff-curated application listings. Eligibility is a policy gate, not a ranking signal. */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, requireAdmin, requireUid, safeText, enforceRateLimit, blockedSetFor } from "./common.js";
import { appendStaffAudit, auditStaffRead, staffReason } from "./staff-audit.js";
import { staffPage } from "./staff-page.js";
import { geocode } from "./staff-partners.js";
import { LAUNCH_AREAS, isInsideArea } from "./ingest/areas.js";
import { haversineMiles } from "./ranking.js";
import { inferTopicTags } from "./ingest/annotate.js";

export const isProgram = (d: FirebaseFirestore.DocumentData) => d.category === "Program" || d.opportunitySubtype === "program";
export function programEligible(d: FirebaseFirestore.DocumentData, profile: FirebaseFirestore.DocumentData, now = Date.now()): boolean {
  if (!isProgram(d)) return true;
  const deadline = d.applicationDeadline instanceof Timestamp ? d.applicationDeadline.toMillis() : 0;
  const year = new Date(now).getUTCFullYear(), birth = profile.birthYear;
  const age = Number.isInteger(birth) && birth >= year - 110 && birth <= year - 13 ? year - birth : null;
  return d.active === true && d.hidden === false && d.broadcast === true && d.removed !== true && deadline > now &&
    Number.isInteger(d.minimumAge) && Number.isInteger(d.maximumAge) && d.minimumAge >= 13 && d.maximumAge <= 110 &&
    d.minimumAge <= d.maximumAge && age !== null && age >= d.minimumAge && age <= d.maximumAge &&
    (profile.ageBand === "adult" || d.minimumAge < 18);
}
function text(v: unknown, name: string, max: number) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max || /[\u0000-\u0008]/.test(v))
    throw new HttpsError("invalid-argument", `${name} is required, up to ${max} characters.`);
  return safeText(v, max);
}
export function validateProgram(raw: any, now = Date.now()) {
  const title = text(raw?.title, "Title", 120), organizer = text(raw?.organization, "Organization", 100);
  const input = text(raw?.officialURL, "Official listing link", 1000);
  let website: string;
  try { const u = new URL(input); if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || u.hash ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname.includes(":")) throw new Error(); website = u.href; }
  catch { throw new HttpsError("invalid-argument", "Use a public HTTPS link to the organization's official listing."); }
  const deadlineMs = raw?.deadlineMs, minimumAge = raw?.minimumAge, maximumAge = raw?.maximumAge, priceMin = raw?.cost;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= now || deadlineMs > now + 2 * 366 * 86400000)
    throw new HttpsError("invalid-argument", "Deadline must be in the future, within two years.");
  if (!Number.isInteger(minimumAge) || !Number.isInteger(maximumAge) || minimumAge < 13 || maximumAge > 110 || maximumAge < minimumAge)
    throw new HttpsError("invalid-argument", "Minimum and maximum age are required, from 13 to 110, in ascending order.");
  if (typeof priceMin !== "number" || !Number.isFinite(priceMin) || priceMin < 0 || priceMin > 100000)
    throw new HttpsError("invalid-argument", "Enter the published cost in USD; zero means free.");
  if (!["in-person", "virtual"].includes(raw?.format)) throw new HttpsError("invalid-argument", "Choose in-person or virtual.");
  const address = text(raw?.address, raw?.format === "virtual" ? "Organization's local address" : "Venue address", 100);
  if (raw?.latitude !== undefined || raw?.longitude !== undefined) throw new HttpsError("invalid-argument", "Coordinates come from address lookup.");
  if (typeof raw?.active !== "boolean") throw new HttpsError("invalid-argument", "Choose whether the listing is active.");
  return { title, organizer, website, deadlineMs, minimumAge, maximumAge, priceMin, address, virtual: raw.format === "virtual", active: raw.active };
}
function programId(v: unknown) { const id = text(v, "Program ID", 100); if (!/^program-[a-z0-9-]+$/.test(id)) throw new HttpsError("invalid-argument", "Invalid program ID."); return id; }
export const saveProgram = onCall({ timeoutSeconds: 30 }, async (req) => {
  const actor = await requireAdmin(req.auth), reason = staffReason(req.data?.reason), id = programId(req.data?.programId);
  const input = validateProgram(req.data), ref = db.doc(`events/${id}`), location = await geocode(input.address);
  const area = LAUNCH_AREAS.find(a => isInsideArea(a, location.latitude, location.longitude, 0));
  if (!area) throw new HttpsError("failed-precondition", "This address is outside Verdure's launch areas.");
  return db.runTransaction(async tx => {
    const before = (await tx.get(ref)).data() ?? null;
    if (before && before.source !== "staff-program") throw new HttpsError("failed-precondition", "This is not a staff-curated program.");
    const now = Timestamp.now(), deadline = Timestamp.fromMillis(input.deadlineMs);
    if (deadline.toMillis() <= now.toMillis()) throw new HttpsError("invalid-argument", "Deadline has passed. Nothing was saved.");
    const after = { title: input.title, organizer: input.organizer, website: input.website, date: deadline, applicationDeadline: deadline,
      time: "Application deadline", locationName: input.virtual ? `Virtual · ${input.address}` : input.address,
      address: input.address, latitude: location.latitude, longitude: location.longitude, geocodeProvider: location.geocodeProvider,
      virtual: input.virtual, minimumAge: input.minimumAge, maximumAge: input.maximumAge, priceMin: input.priceMin, isFree: input.priceMin === 0,
      active: input.active, broadcast: true, hidden: before?.hidden ?? false, removed: before?.removed ?? false,
      category: "Program", opportunitySubtype: "program", source: "staff-program", areaId: area.id,
      adultOnly: input.minimumAge >= 18, adultOnlyReason: input.minimumAge >= 18 ? "structured-age-limit" : null,
      topicTags: inferTopicTags(input.title, "", "education"),
      creatorID: "verdure-programs", pointValue: 0, attendeeCount: 0, createdAt: before?.createdAt ?? now, updatedAt: now };
    tx.set(ref, after); tx.delete(db.doc(`feedCaches/${area.id}`));
    appendStaffAudit(tx, actor, "program:save", ref.path, before, after, reason);
    return { programId: id, active: input.active, latitude: after.latitude, longitude: after.longitude };
  });
});
export const deactivateProgram = onCall(async req => {
  const actor = await requireAdmin(req.auth), reason = staffReason(req.data?.reason), id = programId(req.data?.programId), ref = db.doc(`events/${id}`);
  return db.runTransaction(async tx => {
    const before = (await tx.get(ref)).data();
    if (!before || before.source !== "staff-program") throw new HttpsError("not-found", "Program not found.");
    const after = { ...before, active: false, updatedAt: Timestamp.now() };
    tx.set(ref, after); tx.delete(db.doc(`feedCaches/${before.areaId}`));
    appendStaffAudit(tx, actor, "program:deactivate", ref.path, before, after, reason); return { programId: id, active: false };
  });
});
export const listStaffPrograms = onCall(async req => {
  const actor = await requireAdmin(req.auth);
  const { docs, nextCursor } = await staffPage(db.collection("events").where("source", "==", "staff-program").orderBy("applicationDeadline"), "events", req.data);
  const items = docs.map(doc => { const d = doc.data(); return { programId: doc.id, title: d.title, organization: d.organizer, officialURL: d.website,
    deadlineMs: d.applicationDeadline.toMillis(), minimumAge: d.minimumAge, maximumAge: d.maximumAge, cost: d.priceMin,
    format: d.virtual ? "virtual" : "in-person", address: d.address, active: d.active, hidden: d.hidden, expired: d.applicationDeadline.toMillis() <= Date.now() }; });
  await auditStaffRead(actor, "program:list", "events", { afterId: req.data?.afterId ?? null, ids: items.map(i => i.programId) });
  return { items, nextCursor };
});
export const programListings = onCall(async req => {
  const uid = requireUid(req.auth); await enforceRateLimit(uid, "programListings");
  const lat = req.data?.lat, lng = req.data?.lng, radius = req.data?.radiusMiles;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
    typeof radius !== "number" || !Number.isFinite(radius) || radius < 1 || radius > 50) throw new HttpsError("invalid-argument", "A location and radius from 1 to 50 miles are required.");
  const now = Date.now(), [profile, blocked] = await Promise.all([db.doc(`users/${uid}`).get(), blockedSetFor(uid)]);
  const query = db.collection("events").where("category", "==", "Program").where("active", "==", true)
    .where("applicationDeadline", ">", Timestamp.fromMillis(now)).orderBy("applicationDeadline");
  const rows: FirebaseFirestore.QueryDocumentSnapshot[] = []; let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) { const page = await (cursor ? query.startAfter(cursor) : query).limit(200).get(); rows.push(...page.docs);
    if (rows.length > 2000) throw new HttpsError("resource-exhausted", "Program supply exceeds this view's bound. No partial count was returned.");
    if (page.size < 200) break; cursor = page.docs.at(-1); }
  const items = rows.filter(doc => { const d = doc.data(); return programEligible(d, profile.data() ?? {}, now) && !blocked.has(d.creatorID) &&
    typeof d.latitude === "number" && typeof d.longitude === "number" && haversineMiles(lat, lng, d.latitude, d.longitude) <= radius; }).map(doc => {
      const d = doc.data(); return { id: doc.id, title: d.title, organizer: d.organizer, locationName: d.locationName, category: "Program", time: "Application deadline",
        dateMs: d.applicationDeadline.toMillis(), deadlineMs: d.applicationDeadline.toMillis(), minimumAge: d.minimumAge, maximumAge: d.maximumAge,
        latitude: d.latitude, longitude: d.longitude, website: d.website, isFree: d.isFree, priceMin: d.priceMin, source: d.source, virtual: d.virtual, pointValue: 0 };
    });
  return { items, currentInRadius: items.length, chipVisible: items.length >= 10 };
});
/** Deadlines are also checked at every read, so schedule latency never shows an expired listing. */
export async function expirePrograms(now = Date.now()) {
  let changed = 0;
  for (;;) {
    const page = await db.collection("events").where("category", "==", "Program").where("active", "==", true)
      .where("applicationDeadline", "<=", Timestamp.fromMillis(now)).orderBy("applicationDeadline").limit(100).get();
    if (page.empty) return changed;
    await Promise.all(page.docs.map(doc => db.runTransaction(async tx => {
      const before = (await tx.get(doc.ref)).data();
      if (!before || before.active !== true || !(before.applicationDeadline instanceof Timestamp) || before.applicationDeadline.toMillis() > now) return;
      const after = { ...before, active: false, expiredAt: Timestamp.fromMillis(now) };
      tx.set(doc.ref, after); tx.delete(db.doc(`feedCaches/${before.areaId || "san-jose-ca"}`));
      appendStaffAudit(tx, "system:program-expiry", "program:expire", doc.ref.path, before, after, "Application deadline passed"); changed++;
    })));
  }
}
export const expireProgramListings = onSchedule({ schedule: "every 15 minutes", timeoutSeconds: 540 }, () => expirePrograms().then(() => {}));
