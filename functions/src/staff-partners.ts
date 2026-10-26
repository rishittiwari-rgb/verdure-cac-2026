/** Staff-managed, agreement-backed offers. Coupon codes are never returned here. */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldPath } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { db, requireAdmin, safeString, docIdFrom } from "./common.js";
import { partnerHasAgreement, writePartnerStatus, writePerkStatus } from "./partner-status.js";
import { appendStaffAudit, auditStaffRead, staffReason } from "./staff-audit.js";

export const PERK_MIN_COST = 500, PERK_MAX_COST = 2000;
export const CODE_IMPORT_BATCH_SIZE = 400;
const categories = ["coffee", "food", "retail", "activities", "other"];
function text(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    if (!required && (value === undefined || value === null)) return "";
    throw new HttpsError("invalid-argument", `${field} must be ${required ? "nonempty and " : ""}at most ${max} characters.`);
  }
  return value.trim();
}
function id(value: unknown, field: string): string {
  const result = text(value, field, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new HttpsError("invalid-argument", `${field} must be kebab-case.`);
  return result;
}
const localFixtures = () => process.env.FUNCTIONS_EMULATOR === "true" &&
  /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "");
export function geocodeFixtureId(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}
export function parseCensusGeocode(payload: unknown) {
  const matches = (payload as { result?: { addressMatches?: unknown[] } })?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) throw new HttpsError("failed-precondition", "Address lookup did not find one unique street address. Check the address and save again.");
  const match = matches[0] as { matchedAddress?: unknown; coordinates?: { x?: unknown; y?: unknown } };
  const latitude = match.coordinates?.y, longitude = match.coordinates?.x;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || typeof match.matchedAddress !== "string" || !match.matchedAddress.trim()) {
    throw new HttpsError("unavailable", "Address lookup returned invalid coordinates. No partner was saved.");
  }
  return { latitude, longitude, matchedAddress: match.matchedAddress, geocodeProvider: "US Census Public_AR_Current", geocodedAt: Timestamp.now() };
}
export async function geocode(address: string) {
  // Deterministic RAW provider responses can be installed by local test tooling,
  // never by clients. This branch cannot run in deployed Functions.
  if (localFixtures()) {
    const fixture = await db.doc(`qaGeocodes/${geocodeFixtureId(address)}`).get();
    if (fixture.exists) return { ...parseCensusGeocode(fixture.data()?.response), geocodeProvider: "Local Census response fixture" };
  }
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" }).toString();
  let payload: unknown;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "error" });
    if (!response.ok) throw new Error(`Geocoder HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 200000) throw new Error("Oversized geocoder response");
    payload = JSON.parse(body);
  } catch {
    throw new HttpsError("unavailable", "Address lookup is unavailable. No partner was saved; try again later.");
  }
  return parseCensusGeocode(payload);
}

export const savePartner = onCall({ timeoutSeconds: 30 }, async (req) => {
  const staff = await requireAdmin(req.auth), reason = staffReason(req.data?.reason);
  const partnerId = id(req.data?.partnerId, "partnerId"), name = text(req.data?.name, "Business name", 80);
  const category = safeString(req.data?.category);
  if (!categories.includes(category)) throw new HttpsError("invalid-argument", "Choose coffee, food, retail, activities or other.");
  const address = text(req.data?.address, "Street address", 100);
  const contactName = text(req.data?.contactName, "Contact name", 100), contactEmail = text(req.data?.contactEmail, "Contact email", 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpsError("invalid-argument", "A valid contact email is required.");
  const contactPhone = text(req.data?.contactPhone, "Contact phone", 40, false);
  if (req.data?.latitude !== undefined || req.data?.longitude !== undefined) throw new HttpsError("invalid-argument", "Coordinates come from address lookup, not the client.");
  const ref = db.doc(`partners/${partnerId}`), existing = await ref.get();
  const old = existing.data();
  const location = old?.address === address && old.geocodedAt && Number.isFinite(old.latitude) && Number.isFinite(old.longitude)
    ? { latitude: old.latitude, longitude: old.longitude, matchedAddress: old.matchedAddress,
      geocodeProvider: old.geocodeProvider, geocodedAt: old.geocodedAt } : await geocode(address);
  let agreement: FirebaseFirestore.DocumentData | null | undefined;
  if (req.data?.agreement === null) agreement = null;
  else if (req.data?.agreement !== undefined) {
    const raw = req.data.agreement;
    const agreedBy = text(raw?.agreedBy, "Who agreed", 100), reference = text(raw?.reference, "Written confirmation reference", 500);
    const ms = raw?.agreedAtMs;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0 || ms > Date.now()) throw new HttpsError("invalid-argument", "Agreement date must be a past or present time.");
    agreement = { agreedBy, reference, agreedAt: Timestamp.fromMillis(ms), recordedBy: staff };
  }
  if (req.data?.active !== undefined && typeof req.data.active !== "boolean") throw new HttpsError("invalid-argument", "active must be a boolean.");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), before = snap.data() ?? null, now = Timestamp.now();
    const active = req.data?.active ?? before?.active ?? false;
    const nextAgreement = agreement === undefined ? before?.agreement ?? null : agreement;
    if (active && !partnerHasAgreement({ active: true, agreement: nextAgreement })) {
      throw new HttpsError("failed-precondition", "Record who agreed, when, and the written confirmation before activating this partner.");
    }
    const after = { ...before, name, category, address, contactName, contactEmail, contactPhone, ...location,
      agreement: nextAgreement, active, hidden: false, createdAt: before?.createdAt ?? now, updatedAt: now };
    tx.set(ref, after);
    writePartnerStatus(tx, partnerId, after);
    appendStaffAudit(tx, staff, "partner:save", ref.path, before, after, reason);
    return { partnerId, active, latitude: after.latitude, longitude: after.longitude, matchedAddress: after.matchedAddress };
  });
});

export function validatePerkCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CODE_IMPORT_BATCH_SIZE) {
    throw new HttpsError("invalid-argument", `Load between 1 and ${CODE_IMPORT_BATCH_SIZE} codes per batch; split larger files into batches.`);
  }
  const codes = value.map((x) => text(x, "Code", 64));
  if (codes.some((x) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(x))) {
    throw new HttpsError("invalid-argument", "Codes must be 3–64 letters, numbers, dots, underscores, colons or hyphens, starting with a letter or number.");
  }
  if (new Set(codes.map((x) => x.toUpperCase())).size !== codes.length) throw new HttpsError("already-exists", "The upload contains duplicate codes (case insensitive). Nothing was loaded.");
  return codes;
}

/** One-column CSV with a code header; quoted fields, BOM and CRLF are accepted. */
export function parsePerkCodeCsv(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 65536) throw new HttpsError("invalid-argument", "CSV must be text and at most 64 KB per batch.");
  const input = value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closedQuote = false;
  for (let i = 0; i <= input.length; i++) {
    const ch = input[i] ?? "\n";
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closedQuote = true; }
      else if (i === input.length) throw new HttpsError("invalid-argument", "CSV has an unfinished quoted field.");
      else cell += ch;
    } else if (ch === '"') {
      if (cell.length || closedQuote) throw new HttpsError("invalid-argument", "CSV has a misplaced quote.");
      quoted = true;
    } else if (ch === "," || ch === "\n" || ch === "\r") {
      row.push(cell); cell = ""; closedQuote = false;
      if (ch !== ",") { if (row.some((x) => x.trim())) rows.push(row); row = []; }
    } else {
      if (closedQuote) throw new HttpsError("invalid-argument", "CSV has characters after a closing quote.");
      cell += ch;
    }
  }
  if (!rows.length || rows[0].length !== 1 || rows[0][0].trim().toLowerCase() !== "code" || rows.some((r) => r.length !== 1)) {
    throw new HttpsError("invalid-argument", "CSV must have exactly one column with the header code.");
  }
  return validatePerkCodes(rows.slice(1).map((r) => r[0]));
}

async function checkExistingCodes(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, codes: string[]) {
  // Includes already-claimed codes and old mixed-case document IDs, so an upload
  // can never reset a redeemed code. The perk write serializes parallel imports.
  const existing = await tx.get(ref.collection("codes"));
  const identities = new Set(existing.docs.map((d) => String(d.data().code ?? "").trim().toUpperCase()));
  if (codes.some((c) => identities.has(c.toUpperCase()))) throw new HttpsError("already-exists", "At least one code already exists in this perk, including redeemed codes. Nothing was loaded.");
  return existing.docs.filter((d) => d.data().claimedBy === null).length;
}
function addCodes(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, codes: string[], now: Timestamp) {
  for (const code of codes) tx.create(ref.collection("codes").doc(docIdFrom(code.toUpperCase())), { code, claimedBy: null, claimedAt: null, addedAt: now });
}

export const upsertPartnerPerk = onCall(async (req) => {
  const staff = await requireAdmin(req.auth), reason = staffReason(req.data?.reason);
  const perkId = id(req.data?.perkId, "perkId"), partnerId = id(req.data?.partnerId, "partnerId");
  const title = text(req.data?.title, "Title", 80), terms = text(req.data?.terms, "Terms", 1000);
  const description = text(req.data?.description, "Description", 400, false), kind = safeString(req.data?.kind, "local-offer");
  if (!["percent-off", "free-item", "local-offer"].includes(kind)) throw new HttpsError("invalid-argument", "Unknown perk kind.");
  const pointCost = req.data?.pointCost;
  if (!Number.isInteger(pointCost) || pointCost < PERK_MIN_COST || pointCost > PERK_MAX_COST) throw new HttpsError("invalid-argument", "Point cost must be an integer from 500 to 2,000.");
  const expiresMs = req.data?.expiresAtMs, earlyMs = req.data?.earlyAccessUntilMs;
  if (typeof expiresMs !== "number" || !Number.isFinite(expiresMs) || expiresMs <= Date.now() || expiresMs > 253402300799999) throw new HttpsError("invalid-argument", "A future expiry date is required.");
  if (earlyMs !== undefined && earlyMs !== null && (typeof earlyMs !== "number" || !Number.isFinite(earlyMs) || earlyMs <= 0 || earlyMs >= expiresMs)) throw new HttpsError("invalid-argument", "Early access must end before the perk expires.");
  const active = req.data?.active ?? true;
  if (typeof active !== "boolean") throw new HttpsError("invalid-argument", "active must be a boolean.");
  const codes = req.data?.codes === undefined ? [] : validatePerkCodes(req.data.codes);
  const ref = db.doc(`partnerPerks/${perkId}`);
  return db.runTransaction(async (tx) => {
    const [snap, partner] = await tx.getAll(ref, db.doc(`partners/${partnerId}`));
    if (!partner.exists) throw new HttpsError("not-found", "Create the partner first.");
    if (active && !partnerHasAgreement(partner.data())) throw new HttpsError("failed-precondition", "Activate the partner with an agreement on file before activating this perk.");
    const before = snap.data() ?? null;
    if (before && before.partnerId !== partnerId) throw new HttpsError("failed-precondition", "An existing perk cannot be transferred to another business.");
    const unused = codes.length ? await checkExistingCodes(tx, ref, codes) : Number(before?.codePoolCount) || 0;
    const now = Timestamp.now(), after = { ...before, partnerId, partner: partner.data()!.name, title, description, terms, kind, pointCost, active,
      earlyAccessUntil: earlyMs == null ? null : Timestamp.fromMillis(earlyMs), expiresAt: Timestamp.fromMillis(expiresMs),
      codePoolCount: unused + codes.length, redeemedCount: Number(before?.redeemedCount) || 0, hidden: false,
      createdAt: before?.createdAt ?? now, updatedAt: now };
    tx.set(ref, after); addCodes(tx, ref, codes, now);
    writePerkStatus(tx, perkId, after);
    appendStaffAudit(tx, staff, "perk:save", ref.path, before, { ...after, codesAdded: codes.length }, reason);
    return { perkId, codesAdded: codes.length, codesLeft: after.codePoolCount, lowStock: after.codePoolCount < 10 };
  });
});

export const importPartnerCodes = onCall(async (req) => {
  const staff = await requireAdmin(req.auth), reason = staffReason(req.data?.reason), perkId = id(req.data?.perkId, "perkId");
  const codes = parsePerkCodeCsv(req.data?.csv), ref = db.doc(`partnerPerks/${perkId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Create the perk first.");
    const unused = await checkExistingCodes(tx, ref, codes), now = Timestamp.now(), after = { codePoolCount: unused + codes.length, updatedAt: now };
    addCodes(tx, ref, codes, now); tx.update(ref, after);
    writePerkStatus(tx, perkId, { ...snap.data(), ...after });
    appendStaffAudit(tx, staff, "perk:import-codes", ref.path, { codePoolCount: snap.data()!.codePoolCount ?? 0 },
      { ...after, codesAdded: codes.length }, reason);
    return { perkId, codesAdded: codes.length, codesLeft: after.codePoolCount, lowStock: after.codePoolCount < 10 };
  });
});

export const deactivatePartnerOffer = onCall(async (req) => {
  const staff = await requireAdmin(req.auth), reason = staffReason(req.data?.reason), targetId = id(req.data?.targetId, "targetId");
  const kind = req.data?.kind;
  if (kind !== "partner" && kind !== "perk") throw new HttpsError("invalid-argument", "Choose partner or perk.");
  const ref = db.doc(`${kind === "partner" ? "partners" : "partnerPerks"}/${targetId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "No such partner or perk.");
    const change = { active: false, deactivatedAt: Timestamp.now(), deactivatedBy: staff, deactivationReason: reason };
    tx.update(ref, change);
    if (kind === "partner") writePartnerStatus(tx, targetId, { ...snap.data(), ...change });
    else writePerkStatus(tx, targetId, { ...snap.data(), ...change });
    appendStaffAudit(tx, staff, `${kind}:deactivate`, ref.path, snap.data(), { ...snap.data(), ...change }, reason);
    return { targetId, active: false };
  });
});

export const listStaffPartners = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  const kind = req.data?.kind ?? "partners";
  if (kind !== "partners" && kind !== "perks") throw new HttpsError("invalid-argument", "Choose partners or perks.");
  let query: FirebaseFirestore.Query = db.collection(kind === "partners" ? "partners" : "partnerPerks");
  if (kind === "perks" && req.data?.partnerId) query = query.where("partnerId", "==", id(req.data.partnerId, "partnerId"));
  query = query.orderBy(FieldPath.documentId());
  if (req.data?.afterId) query = query.startAfter(id(req.data.afterId, "afterId"));
  const target = req.data?.targetId ? await db.doc(`${kind === "partners" ? "partners" : "partnerPerks"}/${id(req.data.targetId, "targetId")}`).get() : null;
  const rows = target ? null : await query.limit(101).get();
  const page = target ? (target.exists ? [target] : []) : rows!.docs.slice(0, 100);
  await auditStaffRead(staff, "partner:list", kind === "partners" ? "partners" : "partnerPerks", {
    kind, partnerId: req.data?.partnerId ?? null, afterId: req.data?.afterId ?? null, ids: page.map((d) => d.id) });
  const items = page.map((d) => {
    const data = d.data() ?? {};
    return { id: d.id, ...data, createdAtMs: data.createdAt?.toMillis?.() ?? null, updatedAtMs: data.updatedAt?.toMillis?.() ?? null,
      ...(kind === "partners" ? { agreement: data.agreement ? { ...data.agreement, agreedAtMs: data.agreement.agreedAt?.toMillis?.() ?? null } : null }
        : { earlyAccessUntilMs: data.earlyAccessUntil?.toMillis?.() ?? null, expiresAtMs: data.expiresAt?.toMillis?.() ?? null,
          codesLeft: Number(data.codePoolCount) || 0, lowStock: (Number(data.codePoolCount) || 0) < 10 }) };
  });
  return { items, nextCursor: rows && rows.size > 100 ? rows.docs[99].id : null };
});

export const SEED_PERKS = [
  { perkId: "placeholder-coffee-20", title: "20% off any drink", partner: "Placeholder Coffee Co.", category: "coffee", kind: "percent-off", pointCost: 500 },
  { perkId: "placeholder-trail-shop-10", title: "$10 off trail gear", partner: "Placeholder Outfitters", category: "retail", kind: "local-offer", pointCost: 1200 },
  { perkId: "placeholder-free-scoop", title: "Free scoop", partner: "Placeholder Creamery", category: "food", kind: "free-item", pointCost: 800 },
];
export const seedPartnerPerks = onCall(async (req) => {
  const staff = await requireAdmin(req.auth);
  if (!localFixtures()) throw new HttpsError("failed-precondition", "Placeholder offers are allowed only in the local emulator.");
  let added = 0;
  for (const p of SEED_PERKS) {
    added += await db.runTransaction(async (tx) => {
      const ref = db.doc(`partnerPerks/${p.perkId}`), partnerId = `${p.perkId}-partner`, partnerRef = db.doc(`partners/${partnerId}`);
      const [perk, oldPartner] = await tx.getAll(ref, partnerRef);
      if (perk.exists) return 0;
      const now = Timestamp.now(), partner = { name: p.partner, category: p.category, active: true, latitude: 37.335, longitude: -121.89,
        address: "Local fixture only", agreement: { agreedBy: "Fictional fixture", agreedAt: now, reference: "Local fixture only; no real business agreement" } };
      const after = { ...p, partnerId, active: true, description: "Local fixture offer", terms: "Placeholder partner — replace before launch.",
        earlyAccessUntil: null, expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000), codePoolCount: 5, redeemedCount: 0, hidden: false, updatedAt: now };
      tx.set(partnerRef, partner); tx.create(ref, after);
      writePartnerStatus(tx, partnerId, partner); writePerkStatus(tx, p.perkId, after);
      addCodes(tx, ref, Array.from({ length: 5 }, (_, i) => `${p.perkId.toUpperCase().slice(0, 8)}-${String(i + 1).padStart(3, "0")}`), now);
      appendStaffAudit(tx, staff, "partner:seed-local", partnerRef.path, oldPartner.data(), partner, "Seed fictional local fixture");
      appendStaffAudit(tx, staff, "perk:seed-local", ref.path, null, after, "Seed fictional local fixture");
      return 1;
    });
  }
  return { added };
});
