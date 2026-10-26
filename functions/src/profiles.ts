/** Verdure+ interest profiles and saved filters. The server verifies the
 * subscription; StoreKit state on a device controls presentation only. */
import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, requireUid, enforceRateLimit, plusActiveFrom, safeText } from "./common.js";

export interface InterestProfile {
  name: string;
  interests: string[];
  radiusMiles: number;
  categories: string[];
  exclusions: string[];
  distancePreset: "close" | "balanced" | "drive";
}

const cleanStrings = (value: unknown, max: number, length: number): string[] =>
  Array.isArray(value) ? Array.from(new Set(value.filter((v): v is string => typeof v === "string")
    .map((v) => safeText(v, length)).filter(Boolean))).slice(0, max) : [];

function cleanProfile(raw: unknown): InterestProfile {
  const value = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const name = safeText(value.name, 40);
  if (name.length < 2) throw new HttpsError("invalid-argument", "Name the profile.");
  const radius = Number(value.radiusMiles);
  if (!Number.isFinite(radius) || radius < 1 || radius > 100) {
    throw new HttpsError("invalid-argument", "Radius must be from 1 to 100 miles.");
  }
  const preset = ["close", "balanced", "drive"].includes(String(value.distancePreset))
    ? value.distancePreset as InterestProfile["distancePreset"] : "balanced";
  return { name, interests: cleanStrings(value.interests, 20, 40), radiusMiles: radius,
    categories: cleanStrings(value.categories, 20, 50),
    exclusions: cleanStrings(value.exclusions, 20, 50), distancePreset: preset };
}

export const manageInterestProfiles = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "manageInterestProfiles");
  const action = safeText(req.data?.action, 12);
  if (!["list", "save", "switch", "delete", "saveFilter", "deleteFilter"].includes(action)) {
    throw new HttpsError("invalid-argument", "Unknown profile action.");
  }
  const ref = db.collection("users").doc(uid);
  if (action === "list") {
    const user = (await ref.get()).data();
    const plus = plusActiveFrom(user);
    return { plus, activeProfileId: plus ? user?.activeProfileId ?? null : null,
      profiles: plus ? user?.interestProfiles ?? {} : {},
      savedFilters: plus ? user?.savedFilterSets ?? {} : {} };
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!plusActiveFrom(data)) throw new HttpsError("permission-denied", "Verdure+ is required for extra profiles.");
    const profiles: Record<string, InterestProfile> = { ...(data?.interestProfiles ?? {}) };
    const savedFilters: Record<string, unknown> = { ...(data?.savedFilterSets ?? {}) };
    const id = safeText(req.data?.id, 64);
    if (id && !/^[a-zA-Z0-9_-]+$/.test(id)) throw new HttpsError("invalid-argument", "Invalid profile ID.");
    let active = safeText(data?.activeProfileId, 64);
    if (action === "save") {
      if (id && !profiles[id]) throw new HttpsError("not-found", "Profile not found.");
      if (!id && Object.keys(profiles).length >= 5) throw new HttpsError("resource-exhausted", "Five profiles maximum.");
      const savedId = id || randomBytes(9).toString("base64url");
      profiles[savedId] = cleanProfile(req.data?.profile);
      if (!active) active = savedId;
      tx.set(ref, { interestProfiles: profiles, activeProfileId: active }, { merge: true });
      return { id: savedId, activeProfileId: active };
    }
    if (action === "switch") {
      if (!profiles[id]) throw new HttpsError("not-found", "Profile not found.");
      tx.set(ref, { activeProfileId: id }, { merge: true });
      return { activeProfileId: id };
    }
    if (action === "delete") {
      if (!profiles[id]) throw new HttpsError("not-found", "Profile not found.");
      delete profiles[id];
      active = active === id ? Object.keys(profiles)[0] ?? "" : active;
      tx.set(ref, { interestProfiles: profiles, activeProfileId: active }, { merge: true });
      return { deleted: true, activeProfileId: active || null };
    }
    if (action === "saveFilter") {
      if (id && !savedFilters[id]) throw new HttpsError("not-found", "Filter set not found.");
      if (!id && Object.keys(savedFilters).length >= 10) throw new HttpsError("resource-exhausted", "Ten saved filters maximum.");
      const name = safeText(req.data?.name, 40);
      if (name.length < 2) throw new HttpsError("invalid-argument", "Name the filter set.");
      const savedId = id || randomBytes(9).toString("base64url");
      savedFilters[savedId] = { name, categories: cleanStrings(req.data?.categories, 20, 50),
        radiusMiles: Math.min(100, Math.max(1, Number(req.data?.radiusMiles) || 25)),
        cost: ["any", "free", "under20"].includes(req.data?.cost) ? req.data.cost : "any",
        dateRange: ["any", "week", "weekend", "month"].includes(req.data?.dateRange) ? req.data.dateRange : "any" };
      tx.set(ref, { savedFilterSets: savedFilters }, { merge: true });
      return { id: savedId };
    }
    if (!savedFilters[id]) throw new HttpsError("not-found", "Filter set not found.");
    delete savedFilters[id];
    tx.set(ref, { savedFilterSets: savedFilters }, { merge: true });
    return { deleted: true };
  });
});
