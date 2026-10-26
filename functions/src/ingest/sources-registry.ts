/**
 * The /sources collection (W4.1): sources are data, not code.
 *
 *   /sources/{id}  type, areaId, name, host, url, params, status
 *                  (active | paused | rejected | removed), origin, decision,
 *                  inspection, etag, lastModified, failureStreak, …
 *
 * Ingestion reads ONLY documents whose status is "active"; ingestCivic picks
 * up a newly active source on its next run with no code change. Staff can
 * read the collection (rules); only server code writes it.
 *
 * THE DENY-LIST IS ABSOLUTE. Google Maps/Places, Meetup, Facebook, Instagram,
 * Eventbrite and ACTIVE Network are refused in code: a /sources document for
 * one of them is never loaded, whatever its status says, and discovery (W4)
 * refuses to inspect them. Nothing in Firestore can override this.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../common.js";
import type { SourceId } from "./types.js";
import { SOURCE_SEEDS, type SourceSeed, type SourceParams } from "./sources-config.js";

export type SourceStatus = "active" | "paused" | "rejected" | "removed";
export type SourceOrigin = "config" | "corpus-link" | "osm" | "probe" | "organizer" | "model-url" | "manual";

export interface SourceDoc {
  id: string;
  type: SourceId;
  areaId: string;
  name: string;
  host: string;
  url?: string | null;
  params: Record<string, unknown>;
  status: SourceStatus;
  origin: SourceOrigin;
  /** W4.3 decision record: every rule, its result and evidence. */
  decision?: Record<string, unknown> | null;
  /** W4.2 inspection record. */
  inspection?: Record<string, unknown> | null;
  etag?: string | null;
  lastModified?: string | null;
  failureStreak?: number;
  lastEventCount?: number | null;
  verified?: string;
}

// ── Deny-list (absolute) ────────────────────────────────────────────────────

/**
 * Hosts whose terms prohibit automated access, or whose use would invalidate
 * the product claim (Google). Matched on the host and every parent domain.
 */
export const DENIED_DOMAINS: readonly string[] = [
  // Google Maps / Places
  "maps.google.com", "maps.googleapis.com", "places.googleapis.com", "google.com/maps", "mapsplatform.google.com",
  // Meetup
  "meetup.com",
  // Facebook / Instagram
  "facebook.com", "fb.com", "fb.me", "instagram.com",
  // Eventbrite
  "eventbrite.com", "eventbriteapi.com", "eventbrite.co.uk", "eventbrite.ca",
  // ACTIVE Network
  "active.com", "activenetwork.com", "activecommunities.com", "apps.active.com",
];

/** True when `host` is on the deny-list or is a subdomain of a denied domain. Cannot be overridden by data. */
export function isDeniedHost(hostOrUrl: string): boolean {
  let host = String(hostOrUrl ?? "").trim().toLowerCase();
  let path = "";
  try {
    if (/^https?:\/\//.test(host)) { const u = new URL(host); host = u.hostname; path = u.pathname; }
  } catch { /* keep as host */ }
  host = host.replace(/^www\./, "");
  return DENIED_DOMAINS.some((d) => {
    if (d.includes("/")) { const [dh, dp] = d.split("/", 2); return (host === dh || host.endsWith(`.${dh}`)) && path.startsWith(`/${dp}`); }
    return host === d || host.endsWith(`.${d}`);
  });
}

// ── Reading ────────────────────────────────────────────────────────────────

const sourceFromDoc = (d: FirebaseFirestore.DocumentSnapshot): SourceDoc | null => {
  const x = d.data();
  if (!x || typeof x.type !== "string" || typeof x.areaId !== "string") return null;
  return {
    id: d.id, type: x.type as SourceId, areaId: x.areaId, name: String(x.name ?? d.id), host: String(x.host ?? ""),
    url: typeof x.url === "string" ? x.url : null, params: (x.params && typeof x.params === "object") ? x.params : {},
    status: (["active", "paused", "rejected", "removed"].includes(x.status) ? x.status : "paused") as SourceStatus,
    origin: (typeof x.origin === "string" ? x.origin : "manual") as SourceOrigin,
    decision: x.decision ?? null, inspection: x.inspection ?? null,
    etag: typeof x.etag === "string" ? x.etag : null, lastModified: typeof x.lastModified === "string" ? x.lastModified : null,
    failureStreak: Number(x.failureStreak) || 0, lastEventCount: typeof x.lastEventCount === "number" ? x.lastEventCount : null,
    verified: typeof x.verified === "string" ? x.verified : undefined,
  };
};

/**
 * Active sources of one adapter type for an area. A denied host is never
 * returned even if a document says "active" — and is logged, because that
 * document should not exist.
 */
export async function loadActiveSources(areaId: string, type?: SourceId): Promise<SourceDoc[]> {
  let query = db.collection("sources").where("areaId", "==", areaId).where("status", "==", "active");
  if (type) query = query.where("type", "==", type);
  const snap = await query.limit(500).get();
  const out: SourceDoc[] = [];
  for (const d of snap.docs) {
    const s = sourceFromDoc(d);
    if (!s) continue;
    if (isDeniedHost(s.host) || (s.url && isDeniedHost(s.url))) {
      console.error(`[sources] ${s.id} is on the deny-list and was skipped; it must not be active`);
      continue;
    }
    out.push(s);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Convert a seed into the document shape. Exported so the migration test can compare against it. */
export function sourceDocFromSeed(seed: SourceSeed): Omit<SourceDoc, "decision" | "inspection"> & { decision: null; inspection: null } {
  return {
    id: seed.id, type: seed.type, areaId: seed.areaId, name: (seed.params as { name: string }).name, host: seed.host,
    url: seedUrl(seed), params: seed.params as unknown as Record<string, unknown>, status: "active", origin: "config",
    decision: null, inspection: null, etag: null, lastModified: null, failureStreak: 0, lastEventCount: null, verified: seed.verified,
  };
}

function seedUrl(seed: SourceParams & { host: string }): string | null {
  switch (seed.type) {
    case "ics": return seed.params.url;
    case "libcal": return seed.params.rssUrl;
    case "bibliocommons": return `https://gateway.bibliocommons.com/v2/libraries/${seed.params.library}/events`;
    case "localist": return `https://${seed.params.host}/api/2/events`;
    case "livewhale": return `https://${seed.params.host}/live/json/v2/events`;
    case "legistar": return `https://webapi.legistar.com/v1/${seed.params.client}/events`;
    case "midpen": return "https://www.openspace.org/events";
    case "wordpress-tec": return `${seed.params.siteUrl.replace(/\/$/, "")}/wp-json/tribe/events/v1/events`;
    case "jsonld": return seed.params.sitemapUrl ?? `${seed.params.siteUrl.replace(/\/$/, "")}/sitemap.xml`;
    case "rss-ics": return seed.params.feedUrl;
    default: return null;
  }
}

// ── Discovery, self-healing and removal helpers (W4.3 / W4.6 / W4.7) ───────

/** Stable document id for a discovered source: one per area, adapter and host. */
export const discoveredSourceId = (areaId: string, type: SourceId, host: string): string =>
  `${areaId}_${type}_${host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "-")}`;

/** Every /sources document for one area with the given status (any adapter type). */
export async function loadSourcesByStatus(areaId: string, status: SourceStatus): Promise<SourceDoc[]> {
  const snap = await db.collection("sources").where("areaId", "==", areaId).where("status", "==", status).limit(500).get();
  return snap.docs.map(sourceFromDoc).filter((s): s is SourceDoc => s !== null).sort((a, b) => a.id.localeCompare(b.id));
}

/** Every /sources document whose feed host is `host` (any area, any status). */
export async function loadSourcesByHost(host: string): Promise<SourceDoc[]> {
  const h = host.toLowerCase().replace(/^www\./, "");
  const snap = await db.collection("sources").where("host", "in", [h, `www.${h}`]).limit(50).get();
  return snap.docs.map(sourceFromDoc).filter((s): s is SourceDoc => s !== null);
}

/** W4.7: three consecutive failures, or a drop to zero from a source that usually has events, pause the source. */
export const FAILURE_STREAK_TO_PAUSE = 3;
export const ZERO_DROP_MIN_USUAL = 5;
export function shouldPause(outcome: { ok: boolean; eventCount?: number }, before: { failureStreak?: number; lastEventCount?: number | null }): string | null {
  const streak = (before.failureStreak ?? 0) + (outcome.ok ? 0 : 1);
  if (!outcome.ok && streak >= FAILURE_STREAK_TO_PAUSE) return `${streak} consecutive failed runs`;
  const usual = before.lastEventCount ?? null;
  if (outcome.ok && outcome.eventCount === 0 && usual !== null && usual >= ZERO_DROP_MIN_USUAL) return `sudden drop to zero events (last run had ${usual})`;
  return null;
}

/**
 * Seed /sources from today's configuration. Idempotent: an existing document
 * keeps its status and decision (so a source paused by self-healing is not
 * silently reactivated by a redeploy); only missing documents are created.
 */
export async function seedSourcesFromConfig(seeds: SourceSeed[] = SOURCE_SEEDS): Promise<{ created: string[]; existing: string[]; denied: string[] }> {
  const created: string[] = [], existing: string[] = [], denied: string[] = [];
  for (const seed of seeds) {
    if (isDeniedHost(seed.host)) { denied.push(seed.id); continue; }   // the deny-list is absolute, config included
    const ref = db.collection("sources").doc(seed.id);
    const snap = await ref.get();
    if (snap.exists) { existing.push(seed.id); continue; }
    await ref.set({ ...sourceDocFromSeed(seed), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    created.push(seed.id);
  }
  return { created, existing, denied };
}

/** Server-side status change with an audit field; never callable from a client. */
export async function setSourceStatus(id: string, status: SourceStatus, reason: string, extra: Record<string, unknown> = {}): Promise<void> {
  await db.collection("sources").doc(id).set({ status, statusReason: reason.slice(0, 500), updatedAt: Timestamp.now(), ...extra }, { merge: true });
}

/** Record the outcome of one fetch for self-healing (W4.7) and conditional requests (W4.4). */
export async function recordSourceRun(id: string, outcome: { ok: boolean; eventCount?: number; etag?: string | null; lastModified?: string | null; error?: string }): Promise<void> {
  const ref = db.collection("sources").doc(id);
  await ref.set({
    lastRunAt: Timestamp.now(),
    // No count (a 304 Not Modified run) keeps the stored one: it is the baseline for the drop-to-zero pause.
    ...(outcome.ok ? { failureStreak: 0, ...(outcome.eventCount !== undefined ? { lastEventCount: outcome.eventCount } : {}), lastError: FieldValue.delete() }
      : { failureStreak: FieldValue.increment(1), lastError: (outcome.error ?? "failed").slice(0, 500), lastErrorAt: Timestamp.now() }),
    ...(outcome.etag !== undefined ? { etag: outcome.etag } : {}),
    ...(outcome.lastModified !== undefined ? { lastModified: outcome.lastModified } : {}),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}
