/** Organizer-written place stories. Ownership is verified by staff, never self-claimed. */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { db, requireAdmin, requireUid, enforceRateLimit, safeText } from "./common.js";
import { appendStaffAudit, auditStaffRead, staffReason } from "./staff-audit.js";
import { staffPage } from "./staff-page.js";
import { loadParkIndex, placeCatalogState } from "./parks/store.js";
import { storyContent, storyPlaceId, storyRevision, organizerStoryGate, authorStoryGate, storyIsPublic } from "./place-story-policy.js";

const guestReads = new Map<string, { start: number; count: number }>();
function guestReadBudget(ip: string) {
  const now = Date.now(), key = createHash("sha256").update(ip).digest("hex");
  if (guestReads.size >= 10_000) for (const [k, row] of guestReads) if (now - row.start >= 3_600_000) guestReads.delete(k);
  const old = guestReads.get(key), row = old && now - old.start < 3_600_000 ? old : { start: now, count: 0 };
  if (row.count >= 240 || (!old && guestReads.size >= 10_000)) throw new HttpsError("resource-exhausted", "Too many place requests. Try again later.");
  row.count++; guestReads.set(key, row);
}

function recordId(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 128 || value.includes("/"))
    throw new HttpsError("invalid-argument", "Choose an organizer.");
  return value;
}
function reference(value: unknown, label: string) {
  if (typeof value !== "string" || value.length > 1000 || value.trim().length < 3)
    throw new HttpsError("invalid-argument", `${label} is required.`);
  return value.trim();
}
function officialPlaceURL(value: unknown, id: string) {
  let url: URL;
  try { url = new URL(typeof value === "string" ? value : ""); } catch { throw new HttpsError("invalid-argument", "An official place link is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.href.length > 1000)
    throw new HttpsError("invalid-argument", "Use an HTTPS official place link.");
  const host = url.hostname.replace(/^www\./, "");
  const valid = id.startsWith("osm-") ? host === "openstreetmap.org" &&
    new RegExp(`^/(node|way|relation)/${id.slice(4)}/?$`).test(url.pathname)
    : id.startsWith("rec-") ? host === "recreation.gov"
    : id.startsWith("nps-") ? host === "nps.gov" : false;
  if (!valid) throw new HttpsError("invalid-argument", "Use the source's official listing for this place.");
  return url.href;
}

/** Only digest/eligibility metadata is client-readable; prose is callable-only. */
export function stageStoryStatus(tx: FirebaseFirestore.Transaction, placeId: string,
  ownership: FirebaseFirestore.DocumentData | undefined, story?: FirebaseFirestore.DocumentData) {
  tx.set(db.doc(`placeStoryStatus/${placeId}`), { revision: storyRevision(ownership, story) });
}
export function stageOrganizerStoryGate(tx: FirebaseFirestore.Transaction, id: string, data: FirebaseFirestore.DocumentData | undefined) {
  tx.set(db.doc(`organizerStoryStatus/${id}`), organizerStoryGate(data));
}
export function stageAuthorStoryGate(tx: FirebaseFirestore.Transaction, uid: string, data: FirebaseFirestore.DocumentData | undefined) {
  tx.set(db.doc(`storyAuthorStatus/${uid}`), authorStoryGate(data));
}

export const setPlaceStoryOwnership = onCall(async (req) => {
  const staff = await requireAdmin(req.auth), placeId = storyPlaceId(req.data?.placeId), reason = staffReason(req.data?.reason);
  if (typeof req.data?.active !== "boolean") throw new HttpsError("invalid-argument", "Choose whether ownership is active.");
  const ref = db.doc(`placeStoryOwnership/${placeId}`);
  if (req.data.active === false) return db.runTransaction(async (tx) => {
    const before = await tx.get(ref);
    if (!before.exists) throw new HttpsError("not-found", "No ownership has been verified for this place.");
    const story = await tx.get(db.doc(`placeStories/${before.data()!.storyId}`));
    const after = { ...before.data()!, active: false, updatedAt: Timestamp.now() };
    tx.set(ref, after); stageStoryStatus(tx, placeId, after, story.data());
    appendStaffAudit(tx, staff, "place-story:revoke-ownership", ref.path, before.data(), after, reason);
    return { placeId, active: false };
  });
  const organizerId = recordId(req.data?.organizerId), verificationReference = reference(req.data?.verificationReference, "Written ownership verification");
  let placeName: string, officialURL: string, generation: string | null = null;
  if (/^(city-parks|county-boundaries)_/.test(placeId)) {
    const state = await placeCatalogState();
    if (!state.generation) throw new HttpsError("unavailable", "The official park catalog is unavailable.");
    const park = (await loadParkIndex(state.generation)).find((p) => p.id === placeId);
    if (!park) throw new HttpsError("not-found", "Choose a park in the current official catalog.");
    placeName = park.name; officialURL = park.officialURL ?? ""; generation = state.generation;
  } else {
    placeName = reference(req.data?.placeName, "Place name");
    if (placeName.length > 200) throw new HttpsError("invalid-argument", "Place name is too long.");
    officialURL = officialPlaceURL(req.data?.officialURL, placeId);
  }
  return db.runTransaction(async (tx) => {
    const [before, org, state] = await Promise.all([tx.get(ref), tx.get(db.doc(`organizers/${organizerId}`)),
      generation ? tx.get(db.doc("parkCatalog/current")) : Promise.resolve(null)]);
    if (generation && state?.data()?.generation !== generation) throw new HttpsError("aborted", "Park data changed. Verify the place again.");
    const organizer = org.data();
    if (!organizerStoryGate(organizer).allowed) throw new HttpsError("failed-precondition", "Only approved, visible organizers can own a story.");
    const ownerUid = recordId(organizer?.ownerUid), author = await tx.get(db.doc(`users/${ownerUid}`));
    if (!authorStoryGate(author.data()).allowed) throw new HttpsError("failed-precondition", "The organizer account is unavailable or suspended.");
    // A different publisher receives a new immutable moderation target. Old
    // reports must never remove a successor organizer's new story.
    const samePublisher = before.data()?.organizerId === organizerId && before.data()?.ownerUid === ownerUid;
    const storyId = samePublisher ? before.data()!.storyId : db.collection("placeStories").doc().id;
    const story = samePublisher ? await tx.get(db.doc(`placeStories/${storyId}`)) : null;
    const after = { placeId, placeName, officialURL, organizerId, ownerUid, storyId, active: true, verificationReference,
      verifiedBy: staff, verifiedAt: Timestamp.now(), createdAt: before.data()?.createdAt ?? Timestamp.now(), updatedAt: Timestamp.now() };
    tx.set(ref, after); stageStoryStatus(tx, placeId, after, story?.data());
    stageOrganizerStoryGate(tx, organizerId, organizer); stageAuthorStoryGate(tx, ownerUid, author.data());
    appendStaffAudit(tx, staff, "place-story:verify-ownership", ref.path, before.data(), after, reason);
    return { placeId, active: true };
  });
});

export const listStaffStoryPlaces = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const page = await staffPage(db.collection("placeStoryOwnership").orderBy("__name__"), "placeStoryOwnership", req.data);
  await auditStaffRead(staff, "place-story:list-ownership", "placeStoryOwnership", { ids: page.docs.map((d) => d.id) });
  return { nextCursor: page.nextCursor, places: page.docs.map((d) => {
    const data = d.data();
    return { placeId: d.id, placeName: data.placeName, officialURL: data.officialURL, organizerId: data.organizerId,
      ownerUid: data.ownerUid, active: data.active, verificationReference: data.verificationReference,
      verifiedBy: data.verifiedBy, verifiedAtMs: data.verifiedAt?.toMillis?.() ?? null };
  }) };
});

export const savePlaceStory = onCall(async (req) => {
  const uid = requireUid(req.auth), placeId = storyPlaceId(req.data?.placeId), content = storyContent(req.data?.content);
  const expectedVersion = req.data?.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new HttpsError("invalid-argument", "Refresh the story before editing.");
  await enforceRateLimit(uid, "savePlaceStory");
  return db.runTransaction(async (tx) => {
    const assignment = await tx.get(db.doc(`placeStoryOwnership/${placeId}`)), ownership = assignment.data();
    if (!ownership || ownership.active !== true || ownership.ownerUid !== uid) throw new HttpsError("permission-denied", "Only this place's verified organizer can write its story.");
    const storyRef = db.doc(`placeStories/${ownership.storyId}`);
    const [org, author, before] = await Promise.all([tx.get(db.doc(`organizers/${ownership.organizerId}`)), tx.get(db.doc(`users/${uid}`)), tx.get(storyRef)]);
    if (org.data()?.ownerUid !== uid || !organizerStoryGate(org.data()).allowed || !authorStoryGate(author.data()).allowed)
      throw new HttpsError("permission-denied", "Your organizer must be approved and your account active to write a story.");
    if (before.data()?.hidden === true || before.data()?.removed === true) throw new HttpsError("failed-precondition", "Staff must review this moderated story before it can be edited.");
    if ((before.data()?.version ?? 0) !== expectedVersion) throw new HttpsError("aborted", "This story changed. Refresh before saving.");
    const now = Timestamp.now(), version = expectedVersion + 1;
    const after = { id: storyRef.id, placeId, placeName: ownership.placeName, ownerUid: uid, organizerId: ownership.organizerId,
      content, version, hidden: false, removed: false, createdAt: before.data()?.createdAt ?? now, updatedAt: now };
    tx.set(storyRef, after); stageStoryStatus(tx, placeId, ownership, after);
    stageOrganizerStoryGate(tx, ownership.organizerId, org.data()); stageAuthorStoryGate(tx, uid, author.data());
    return { saved: true, version };
  });
});

/** Canonical read: approval, ownership, moderation, suspension and blocks are
 * checked in the same transaction. Public guides do not require a subscription. */
export async function readPlaceStoryState(placeId: string, viewerUid?: string) {
  return db.runTransaction(async (tx) => {
    const ownership = (await tx.get(db.doc(`placeStoryOwnership/${placeId}`))).data();
    if (!ownership) return { story: null, placeRevision: storyRevision(undefined) };
    const [story, org, author] = await Promise.all([tx.get(db.doc(`placeStories/${ownership.storyId}`)),
      tx.get(db.doc(`organizers/${ownership.organizerId}`)), tx.get(db.doc(`users/${ownership.ownerUid}`))]);
    const data = story.data();
    const placeRevision = storyRevision(ownership, data);
    if (!storyIsPublic(ownership, data, org.data(), author.data())) return { story: null, placeRevision };
    if (viewerUid && viewerUid !== ownership.ownerUid) {
      const blocks = await tx.getAll(db.doc(`users/${viewerUid}/blocks/${ownership.ownerUid}`),
        db.doc(`users/${ownership.ownerUid}/blocks/${viewerUid}`), db.doc(`users/${viewerUid}/blocks/${ownership.organizerId}`));
      if (blocks.some((s) => s.exists)) return { story: null, placeRevision };
    }
    return { placeRevision, story: { id: story.id, placeId, placeName: ownership.placeName, organizerId: ownership.organizerId,
      organizerName: safeText(org.data()?.displayName, 80), ownerUid: ownership.ownerUid, content: data!.content,
      version: data!.version, updatedAtMs: data!.updatedAt.toMillis(), placeRevision } };
  });
}
export async function readPlaceStory(placeId: string, viewerUid?: string) {
  return (await readPlaceStoryState(placeId, viewerUid)).story;
}
export const getPlaceStory = onCall(async (req) => {
  const placeId = storyPlaceId(req.data?.placeId);
  if (req.auth) await enforceRateLimit(req.auth.uid, "getPlaceStory");
  else guestReadBudget(req.rawRequest.ip ?? "unknown");
  return readPlaceStoryState(placeId, req.auth?.uid);
});

export const myStoryPlaces = onCall(async (req) => {
  const uid = requireUid(req.auth); await enforceRateLimit(uid, "getPlaceStory");
  const page = await staffPage(db.collection("placeStoryOwnership").where("ownerUid", "==", uid).orderBy("__name__"), "placeStoryOwnership", req.data);
  return { nextCursor: page.nextCursor, places: await Promise.all(page.docs.map(async (d) => {
    // Re-read each assignment transactionally. A transfer after pagination must
    // not leak the successor organizer's private draft to its previous owner.
    return db.runTransaction(async (tx) => {
      const current = (await tx.get(d.ref)).data();
      if (!current || current.ownerUid !== uid) return null;
      const [story, org, author] = await Promise.all([tx.get(db.doc(`placeStories/${current.storyId}`)),
        tx.get(db.doc(`organizers/${current.organizerId}`)), tx.get(db.doc(`users/${uid}`))]);
      const moderated = story.data()?.hidden === true || story.data()?.removed === true;
      return { placeId: d.id, placeName: current.placeName, officialURL: current.officialURL, content: story.data()?.content ?? "",
        version: story.data()?.version ?? 0, moderated, active: current.active === true,
        canEdit: current.active === true && !moderated && org.data()?.ownerUid === uid && organizerStoryGate(org.data()).allowed && authorStoryGate(author.data()).allowed };
    });
  })).then((rows) => rows.filter(Boolean)) };
});

// Publishers have many stories. A shared minimal gate invalidates every open
// story without fan-out writes. Read CURRENT state transactionally so delayed
// or reordered Firestore triggers cannot restore an older approval/suspension.
export const updateOrganizerStoryStatus = onDocumentWritten("organizers/{organizerId}", async (event) => {
  const id = event.params.organizerId;
  await db.runTransaction(async (tx) => { const current = await tx.get(db.doc(`organizers/${id}`)); stageOrganizerStoryGate(tx, id, current.data()); });
});
export const updateStoryAuthorStatus = onDocumentWritten("users/{uid}", async (event) => {
  const before = event.data?.before, after = event.data?.after;
  if (before?.exists === after?.exists && before?.data()?.suspended === after?.data()?.suspended) return;
  const uid = event.params.uid;
  await db.runTransaction(async (tx) => { const current = await tx.get(db.doc(`users/${uid}`)); stageAuthorStoryGate(tx, uid, current.data()); });
});

/** First-party, opt-in telemetry, including guest readers. No prose/GPS/IP is stored.
 * One row per exposure and stage, so retries and body reevaluation do not inflate counts. */
export const recordStoryEngagement = onCall(async (req) => {
  const placeId = storyPlaceId(req.data?.placeId), stage = req.data?.stage;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!["shown", "expanded", "read_through"].includes(stage) || req.data?.consent !== true ||
      !uuid.test(req.data?.installID ?? "") || !uuid.test(req.data?.exposureID ?? ""))
    throw new HttpsError("invalid-argument", "Invalid story engagement.");
  if (req.auth) await enforceRateLimit(req.auth.uid, "recordStoryEngagement");
  else guestReadBudget(req.rawRequest.ip ?? "unknown");
  const story = await readPlaceStory(placeId, req.auth?.uid);
  if (!story || story.id !== req.data?.storyId || story.version !== req.data?.version) return { recorded: false };
  const day = new Date().toISOString().slice(0, 10);
  const key = createHash("sha256").update(JSON.stringify([req.auth?.uid ?? null, req.data.installID,
    req.data.exposureID, story.id, story.version, stage])).digest("hex");
  // The document ID is independent of day: retries across midnight remain idempotent.
  const ref = db.doc(`storyEngagementKeys/${key}`);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { recorded: false };
    tx.set(ref, { uid: req.auth?.uid ?? null, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000) });
    tx.set(db.doc(`analytics/${day}/events/story-${key}`), { event: `story_${stage}`,
      installID: req.data.installID, uid: req.auth?.uid ?? null, ts: Timestamp.now(),
      params: { placeId, storyId: story.id, version: story.version } });
    return { recorded: true };
  });
});
