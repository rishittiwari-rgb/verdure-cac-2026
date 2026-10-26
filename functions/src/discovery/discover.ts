/**
 * Automatic discovery (W4.4), re-checks (W4.3 weekly), self-healing resume
 * (W4.7) and the organizer / model-list intake. No human approves anything.
 *
 * Five origins feed one candidate queue (/sourceCandidates/{areaId}_{host}):
 *   corpus-link   external hosts linked from events already in /events
 *   osm           every organisation in the area from OpenStreetMap (one
 *                 Overpass query a week, cached in /discoveryCache); used ONLY
 *                 to find websites — © OpenStreetMap contributors (ODbL)
 *   probe         feed-path probing of each candidate host is what inspectSource does
 *   organizer     the interest form's calendar URL (/sourceSubmissions, written
 *                 by sourceIntake) and the optional calendarUrl on organizer accounts
 *   model-url     URL lists from the team's web-search model: only ever URLs to
 *                 inspect, never events to ingest (functions/discovery/model-urls.json)
 *
 * Each candidate goes through inspectSource (W4.2) and decideSource (W4.3);
 * the outcome is a /sources document (active or rejected, with the decision
 * and inspection stored) or, when a rule could not be determined, a later
 * re-inspection. Limits: 300 inspections a day, one request per host per 10 s,
 * robots.txt cached 24 h, 12 s timeouts, size caps, the honest user agent —
 * all enforced in http.ts / inspect.ts and the counters here.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db, enforceRateLimit, requireAdmin, safeString, safeText, utcDayKey } from "../common.js";
import { LAUNCH_AREAS, areaById, isInsideArea, type LaunchArea } from "../ingest/areas.js";
import { loadAreaIndex, type AreaIndex } from "../ingest/store.js";
import { discoveredSourceId, isDeniedHost, loadSourcesByStatus, setSourceStatus, type SourceDoc, type SourceOrigin } from "../ingest/sources-registry.js";
import { auditedStaffJob, staffReason } from "../staff-audit.js";
import { DISCOVERY_USER_AGENT, HostThrottle, hostOf } from "./http.js";
import { inspectSource, validHost, type Inspection } from "./inspect.js";
import { decideSource, failingRules, isPublicInstitution, termsCheck, type Decision } from "./decide.js";
import { robotsVerdict } from "./robots.js";
import { discoveryFetch, PAGE_MAX_BYTES } from "./http.js";
import { activeEventsOf, isRemovedHost, normalizeHost } from "./removal.js";

export const DISCOVERY_LIMITS = {
  inspectionsPerDay: 300,
  /** One request per host per 10 seconds (HostThrottle default). */
  hostIntervalMs: 10_000,
  /** Inspections run concurrently across hosts; the per-host spacing is unchanged. */
  concurrency: 8,
  robotsCacheMs: 24 * 3_600_000,
  osmCacheMs: 7 * 86_400_000,
  /** A rejected-for-no-events candidate is re-inspected monthly; an undetermined one weekly. */
  reinspectNoEventsMs: 30 * 86_400_000,
  reinspectUnknownMs: 7 * 86_400_000,
  /** Hosts never worth inspecting: CDNs, social, generic platforms whose home page is not an organisation. */
  skipHostPattern: /(^|\.)(cloudfront\.net|azureedge\.net|amazonaws\.com|googleusercontent\.com|google\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|linkedin\.com|tiktok\.com|zoom\.us|bit\.ly|t\.co|wixsite\.com|squarespace\.com|godaddysites\.com|localist\.com|ticketmaster\.com|tmol\.io)$/i,
} as const;

export interface Candidate { host: string; areaId: string; origin: SourceOrigin; note: string; inArea: boolean; url?: string }

// ── Origin 1: corpus links ─────────────────────────────────────────────────

export function hostsFromCorpus(index: Pick<AreaIndex, "all">, areaId: string, area: LaunchArea): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const ev of index.all) {
    const d = ev.data;
    if (d.active !== true) continue;
    const urls = [d.website, ...((Array.isArray(d.sources) ? d.sources : []) as Array<{ url?: string | null }>).map((s) => s?.url)].filter((u): u is string => typeof u === "string");
    const inArea = typeof d.latitude === "number" && typeof d.longitude === "number" && isInsideArea(area, d.latitude, d.longitude, 0);
    for (const u of urls) {
      const host = normalizeHost(hostOf(u));
      if (!host || seen.has(host)) continue;
      seen.set(host, { host, areaId, origin: "corpus-link", note: `linked from event ${ev.id}`, inArea });
    }
  }
  return [...seen.values()];
}

// ── Origin 2: OpenStreetMap ─────────────────────────────────────────────────

export interface OsmOrg { id: string; name: string; website: string; lat: number; lng: number; kind: string }

const MILE_M = 1609.344;
export function overpassQuery(area: LaunchArea): string {
  const r = Math.round(area.radiusMiles * MILE_M), c = `${area.center.lat},${area.center.lng}`;
  return `[out:json][timeout:90];(` +
    `nwr["amenity"~"^(library|theatre|community_centre|arts_centre|school|college|university|social_facility|events_venue|townhall|place_of_worship)$"]["website"](around:${r},${c});` +
    `nwr["amenity"~"^(library|theatre|community_centre|arts_centre|school|college|university|events_venue|townhall)$"]["contact:website"](around:${r},${c});` +
    `nwr["tourism"~"^(museum|gallery|zoo|aquarium|attraction)$"]["website"](around:${r},${c});` +
    `nwr["leisure"~"^(park|nature_reserve|sports_centre|stadium|garden|pitch|ice_rink|swimming_pool)$"]["website"](around:${r},${c});` +
    `nwr["club"]["website"](around:${r},${c});` +
    `nwr["office"~"^(ngo|association|charity|government)$"]["website"](around:${r},${c});` +
    `);out center tags;`;
}

export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export function parseOverpass(json: unknown): OsmOrg[] {
  const out: OsmOrg[] = [];
  const els = (json as { elements?: Array<Record<string, unknown>> })?.elements ?? [];
  for (const e of els) {
    const tags = (e.tags ?? {}) as Record<string, string>;
    const website = tags.website ?? tags["contact:website"] ?? tags.url ?? "";
    const center = (e.center ?? e) as { lat?: number; lon?: number };
    if (!website || typeof center.lat !== "number" || typeof center.lon !== "number") continue;
    const kind = tags.amenity ? `amenity=${tags.amenity}` : tags.tourism ? `tourism=${tags.tourism}` : tags.leisure ? `leisure=${tags.leisure}` : tags.club ? `club=${tags.club}` : tags.office ? `office=${tags.office}` : "other";
    out.push({ id: `${e.type}/${e.id}`, name: String(tags.name ?? "").slice(0, 120), website, lat: center.lat, lng: center.lon, kind });
  }
  return out;
}

/** One Overpass query a week per area, cached in /discoveryCache. */
export async function osmOrganizations(area: LaunchArea, deps: { fetchImpl?: typeof fetch; now?: Date; force?: boolean } = {}): Promise<{ orgs: OsmOrg[]; cached: boolean; fetchedAt: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch, now = deps.now ?? new Date();
  const ref = db.collection("discoveryCache").doc(`osm_${area.id}`);
  const snap = await ref.get();
  const cachedAt: number = snap.data()?.fetchedAt?.toMillis?.() ?? 0;
  if (!deps.force && snap.exists && now.getTime() - cachedAt < DISCOVERY_LIMITS.osmCacheMs) {
    return { orgs: (snap.data()?.orgs ?? []) as OsmOrg[], cached: true, fetchedAt: new Date(cachedAt).toISOString() };
  }
  let lastError = "";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": DISCOVERY_USER_AGENT }, body: "data=" + encodeURIComponent(overpassQuery(area)), signal: AbortSignal.timeout(120_000) });
      if (!res.ok) { lastError = `${endpoint} HTTP ${res.status}`; continue; }
      const orgs = parseOverpass(await res.json());
      await ref.set({ areaId: area.id, fetchedAt: Timestamp.fromDate(now), endpoint, count: orgs.length, orgs: orgs.slice(0, 3000), attribution: "© OpenStreetMap contributors (ODbL)" });
      return { orgs, cached: false, fetchedAt: now.toISOString() };
    } catch (e) { lastError = `${endpoint}: ${e instanceof Error ? e.message : String(e)}`; }
  }
  if (snap.exists) return { orgs: (snap.data()?.orgs ?? []) as OsmOrg[], cached: true, fetchedAt: new Date(cachedAt).toISOString() };
  throw new Error(`Overpass unavailable: ${lastError}`);
}

export function hostsFromOsm(orgs: OsmOrg[], area: LaunchArea): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const o of orgs) {
    const host = normalizeHost(hostOf(/^https?:\/\//i.test(o.website) ? o.website : `https://${o.website}`));
    if (!host || seen.has(host)) continue;
    seen.set(host, { host, areaId: area.id, origin: "osm", note: `${o.kind} "${o.name}" (${o.id})`, inArea: isInsideArea(area, o.lat, o.lng, 0), url: o.website });
  }
  return [...seen.values()];
}

// ── Origin 4: organizer inputs ──────────────────────────────────────────────

export async function hostsFromOrganizers(area: LaunchArea): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const orgs = await db.collection("organizers").where("calendarUrl", ">", "").limit(500).get();
  for (const d of orgs.docs) {
    const url = String(d.data().calendarUrl ?? "");
    const host = normalizeHost(hostOf(url));
    if (host) out.push({ host, areaId: area.id, origin: "organizer", note: `organizer account ${d.id}`, inArea: true, url });
  }
  const subs = await db.collection("sourceSubmissions").where("areaId", "==", area.id).where("processedAt", "==", null).limit(200).get();
  for (const d of subs.docs) {
    const url = String(d.data().url ?? "");
    const host = normalizeHost(hostOf(url));
    if (host) out.push({ host, areaId: area.id, origin: d.data().origin === "model-url" ? "model-url" : "organizer", note: `${d.data().origin ?? "organizer"} submission ${d.id}`, inArea: true, url });
    await d.ref.set({ processedAt: Timestamp.now() }, { merge: true });
  }
  return out;
}

// ── Origin 5: model URL lists ───────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
export function modelUrlList(areaId: string, file = join(here, "..", "..", "discovery", "model-urls.json")): string[] {
  if (!existsSync(file)) return [];
  try { const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, string[]>; return Array.isArray(all[areaId]) ? all[areaId] : []; } catch { return []; }
}
export function hostsFromModelUrls(urls: string[], area: LaunchArea): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const u of urls) {
    const host = normalizeHost(hostOf(u));
    if (host && !seen.has(host)) seen.set(host, { host, areaId: area.id, origin: "model-url", note: `model URL list: ${u}`, inArea: true, url: u });
  }
  return [...seen.values()];
}

// ── Queue ───────────────────────────────────────────────────────────────────

export const candidateId = (areaId: string, host: string) => `${areaId}_${normalizeHost(host).replace(/[^a-z0-9.-]/g, "-")}`;

/**
 * Queue priority (W4.4). Candidates are inspected in nextInspectAt order, and a
 * single OpenStreetMap run lists thousands of organisations against a budget of
 * 300 inspections a day — so without a priority, a URL an organizer typed into
 * the form (or the model list named) would wait days behind "a…" and "b…" OSM
 * hosts. Explicit submissions are due first, then hosts the corpus already
 * links to, then the OSM sweep. The offsets are milliseconds: nothing is ever
 * inspected before it is due, only ordered.
 */
export const ORIGIN_PRIORITY_MS: Record<SourceOrigin, number> = { organizer: 3, "model-url": 3, "corpus-link": 2, osm: 1, probe: 0, manual: 0, config: 0 };

/** Add candidates; an existing candidate gains the origin, nothing else changes. Denied, invalid and skip-pattern hosts never enter. */
export async function enqueueCandidates(cands: Candidate[], now = new Date()): Promise<{ added: number; known: number; skipped: number }> {
  let added = 0, known = 0, skipped = 0;
  for (const c of cands) {
    if (!validHost(c.host) || isDeniedHost(c.host) || DISCOVERY_LIMITS.skipHostPattern.test(c.host)) { skipped++; continue; }
    const ref = db.collection("sourceCandidates").doc(candidateId(c.areaId, c.host));
    const snap = await ref.get();
    if (snap.exists) {
      known++;
      const origins: string[] = Array.isArray(snap.data()?.origins) ? snap.data()!.origins : [];
      if (!origins.includes(c.origin)) await ref.set({ origins: FieldValue.arrayUnion(c.origin), notes: FieldValue.arrayUnion(c.note.slice(0, 200)), inArea: snap.data()?.inArea === true || c.inArea, updatedAt: Timestamp.fromDate(now) }, { merge: true });
      continue;
    }
    const due = Timestamp.fromMillis(now.getTime() - (ORIGIN_PRIORITY_MS[c.origin] ?? 0));
    await ref.set({ host: c.host, areaId: c.areaId, origins: [c.origin], notes: [c.note.slice(0, 200)], inArea: c.inArea, url: c.url ?? null,
      status: "pending", discoveredAt: Timestamp.fromDate(now), inspectedAt: null, nextInspectAt: due, verdict: null, updatedAt: Timestamp.fromDate(now) });
    added++;
  }
  return { added, known, skipped };
}

/** Candidates due for inspection, oldest first. */
export async function dueCandidates(areaId: string, now: Date, limit: number): Promise<Array<{ id: string; data: FirebaseFirestore.DocumentData }>> {
  const snap = await db.collection("sourceCandidates").where("areaId", "==", areaId).where("status", "==", "pending").where("nextInspectAt", "<=", Timestamp.fromDate(now)).orderBy("nextInspectAt").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

// ── One inspection + decision → a /sources document ─────────────────────────

export interface CandidateOutcome { host: string; verdict: Decision["verdict"] | "skipped"; sourceId?: string; adapter?: string | null; failed: string[]; evidence: Record<string, string>; requests: number }

/** Hosts that already have a /sources document, or were removed, are never re-inspected by discovery. */
async function alreadyKnownHost(host: string): Promise<string | null> {
  if (await isRemovedHost(host)) return "removed on request";
  const snap = await db.collection("sources").where("host", "in", [host, `www.${host}`]).limit(1).get();
  return snap.empty ? null : `already a source (${snap.docs[0].id}, ${snap.docs[0].data().status})`;
}

export async function inspectAndDecide(cand: { id: string; data: FirebaseFirestore.DocumentData }, area: LaunchArea, deps: { fetchImpl: typeof fetch; throttle: HostThrottle; now: Date }): Promise<CandidateOutcome> {
  const host = String(cand.data.host);
  const known = await alreadyKnownHost(host);
  if (known) {
    await db.collection("sourceCandidates").doc(cand.id).set({ status: "done", verdict: "skipped", skipReason: known, inspectedAt: Timestamp.fromDate(deps.now), updatedAt: Timestamp.fromDate(deps.now) }, { merge: true });
    return { host, verdict: "skipped", failed: [], evidence: { skip: known }, requests: 0 };
  }
  const inspection = await inspectSource(host, { area, fetchImpl: deps.fetchImpl, throttle: deps.throttle, now: deps.now });
  const decision = await decideSource(inspection, { area, fetchImpl: deps.fetchImpl, throttle: deps.throttle, now: deps.now, originInArea: cand.data.inArea === true, originNote: (cand.data.notes ?? [])[0] });
  const evidence = Object.fromEntries(Object.entries(decision.rules).map(([k, v]) => [k, v.evidence]));
  const type = inspection.adapter;
  let sourceId: string | undefined;
  if (decision.verdict !== "unknown" && type) {
    sourceId = discoveredSourceId(area.id, type, host);
    await db.collection("sources").doc(sourceId).set({
      id: sourceId, type, areaId: area.id, name: String(inspection.params?.name ?? host), host, url: inspection.feedUrl, params: inspection.params ?? {},
      status: decision.verdict, origin: (cand.data.origins ?? ["probe"])[0], decision, inspection: slimInspection(inspection),
      etag: null, lastModified: null, failureStreak: 0, lastEventCount: null, verified: `automatic decision ${decision.decidedAt}`,
      createdAt: Timestamp.fromDate(deps.now), updatedAt: Timestamp.fromDate(deps.now), statusReason: decision.verdict === "active" ? "every rule passed" : `failed: ${decision.failed.join(", ")}`,
    });
  } else if (decision.verdict === "rejected") {
    // No adapter at all: record the rejection on the candidate (there is nothing to ingest, so no /sources row).
  }
  const noEvents = decision.failed.length === 1 && decision.failed[0] === "realEvents";
  const next = decision.verdict === "unknown" ? DISCOVERY_LIMITS.reinspectUnknownMs : noEvents ? DISCOVERY_LIMITS.reinspectNoEventsMs : null;
  await db.collection("sourceCandidates").doc(cand.id).set({
    status: next ? "pending" : "done", verdict: decision.verdict, sourceId: sourceId ?? null, adapter: type, platform: inspection.platform, failed: decision.failed, undetermined: decision.undetermined,
    evidence, inspectedAt: Timestamp.fromDate(deps.now), nextInspectAt: next ? Timestamp.fromMillis(deps.now.getTime() + next) : null, requests: inspection.requests, updatedAt: Timestamp.fromDate(deps.now),
  }, { merge: true });
  return { host, verdict: decision.verdict, sourceId, adapter: type, failed: decision.failed, evidence, requests: inspection.requests };
}

/** The inspection without the robots body (kept to 2 KB) so the document stays small. */
const slimInspection = (i: Inspection) => ({ ...i, robots: { status: i.robots.status, text: i.robots.text.slice(0, 2_000) } });

// ── The daily job ───────────────────────────────────────────────────────────

export interface DiscoveryReport {
  areaId: string; startedAt: string; finishedAt: string;
  origins: Record<string, number>; queued: { added: number; known: number; skipped: number };
  inspected: number; activated: string[]; rejected: Array<{ host: string; failed: string[]; evidence: Record<string, string> }>; unknown: string[]; skipped: string[];
  budget: { perDay: number; usedToday: number };
  osm: { count: number; cached: boolean; fetchedAt: string } | null; osmError?: string;
}

async function reserveInspections(now: Date, wanted: number): Promise<{ granted: number; usedToday: number }> {
  const ref = db.collection("discoveryRuns").doc(utcDayKey(now));
  return db.runTransaction(async (tx) => {
    const used = Number((await tx.get(ref)).data()?.inspections) || 0;
    const granted = Math.max(0, Math.min(wanted, DISCOVERY_LIMITS.inspectionsPerDay - used));
    tx.set(ref, { day: utcDayKey(now), inspections: used + granted, updatedAt: Timestamp.fromDate(now) }, { merge: true });
    return { granted, usedToday: used + granted };
  });
}

export interface DiscoveryDeps { fetchImpl?: typeof fetch; throttle?: HostThrottle; now?: Date; maxInspections?: number; modelUrls?: string[]; origins?: Array<"corpus-link" | "osm" | "organizer" | "model-url">; concurrency?: number }

export async function runDiscovery(area: LaunchArea, deps: DiscoveryDeps = {}): Promise<DiscoveryReport> {
  const fetchImpl = deps.fetchImpl ?? fetch, throttle = deps.throttle ?? new HostThrottle(), now = deps.now ?? new Date();
  const origins = deps.origins ?? ["corpus-link", "osm", "organizer", "model-url"];
  const report: DiscoveryReport = { areaId: area.id, startedAt: now.toISOString(), finishedAt: "", origins: {}, queued: { added: 0, known: 0, skipped: 0 }, inspected: 0, activated: [], rejected: [], unknown: [], skipped: [], budget: { perDay: DISCOVERY_LIMITS.inspectionsPerDay, usedToday: 0 }, osm: null };
  const cands: Candidate[] = [];
  if (origins.includes("corpus-link")) { const c = hostsFromCorpus(await loadAreaIndex(area, now), area.id, area); report.origins["corpus-link"] = c.length; cands.push(...c); }
  if (origins.includes("osm")) {
    try { const o = await osmOrganizations(area, { fetchImpl, now }); report.osm = { count: o.orgs.length, cached: o.cached, fetchedAt: o.fetchedAt }; const c = hostsFromOsm(o.orgs, area); report.origins.osm = c.length; cands.push(...c); }
    catch (e) { report.osmError = e instanceof Error ? e.message : String(e); console.error("[discovery] OSM:", report.osmError); }
  }
  if (origins.includes("organizer")) { const c = await hostsFromOrganizers(area); report.origins.organizer = c.length; cands.push(...c); }
  if (origins.includes("model-url")) { const c = hostsFromModelUrls(deps.modelUrls ?? modelUrlList(area.id), area); report.origins["model-url"] = c.length; cands.push(...c); }
  report.queued = await enqueueCandidates(cands, now);
  const { granted, usedToday } = await reserveInspections(now, deps.maxInspections ?? DISCOVERY_LIMITS.inspectionsPerDay);
  report.budget.usedToday = usedToday;
  const due = await dueCandidates(area.id, now, granted);
  const queue = [...due];
  const worker = async () => {
    for (;;) {
      const cand = queue.shift();
      if (!cand) return;
      try {
        const out = await inspectAndDecide(cand, area, { fetchImpl, throttle, now });
        if (out.verdict === "skipped") report.skipped.push(`${out.host}: ${out.evidence.skip}`);
        else { report.inspected++; if (out.verdict === "active") report.activated.push(out.sourceId!); else if (out.verdict === "rejected") report.rejected.push({ host: out.host, failed: out.failed, evidence: out.evidence }); else report.unknown.push(out.host); }
      } catch (e) {
        report.inspected++; report.unknown.push(`${cand.data.host}: ${e instanceof Error ? e.message : String(e)}`);
        await db.collection("sourceCandidates").doc(cand.id).set({ lastError: String(e instanceof Error ? e.message : e).slice(0, 500), nextInspectAt: Timestamp.fromMillis(now.getTime() + DISCOVERY_LIMITS.reinspectUnknownMs), updatedAt: Timestamp.fromDate(now) }, { merge: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? DISCOVERY_LIMITS.concurrency) }, worker));
  // Give back the unused part of the reservation (and skipped, uninspected candidates) so a short queue does not burn the day's budget.
  const unused = granted - due.length + report.skipped.length;
  if (unused > 0) await db.collection("discoveryRuns").doc(utcDayKey(now)).set({ inspections: FieldValue.increment(-unused) }, { merge: true });
  report.budget.usedToday -= Math.max(0, unused);
  report.finishedAt = new Date().toISOString();
  await db.collection("discoveryRuns").doc(utcDayKey(now)).collection("areas").doc(area.id).set({ ...report, runAt: Timestamp.fromDate(now) });
  return report;
}

export const discoverSources = onSchedule({ schedule: "every 24 hours", timeoutSeconds: 540, memory: "512MiB" }, async () => {
  for (const area of LAUNCH_AREAS) await runDiscovery(area);
});

// ── Weekly re-check (W4.3) and self-healing resume (W4.7) ───────────────────

/** Adapters whose access is governed by developer terms accepted with an API key, not by the host's robots.txt or web terms. */
export const API_KEY_SOURCES: ReadonlySet<string> = new Set(["ticketmaster", "nps", "serpapi"]);

export interface Recheck { checkedAt: string; robots: { pass: boolean | null; evidence: string }; terms: { pass: boolean | null; evidence: string; basis: string; url: string | null }; tightened: boolean }

/** Re-read robots.txt and the terms page for one source. Pure of Firestore. */
export async function recheckSource(s: Pick<SourceDoc, "type" | "host" | "url">, deps: { fetchImpl: typeof fetch; throttle: HostThrottle; now: Date }): Promise<Recheck> {
  const checkedAt = deps.now.toISOString();
  if (API_KEY_SOURCES.has(s.type)) {
    const evidence = `${s.type}: access under the developer terms accepted with the API key; robots.txt and web terms do not govern it`;
    return { checkedAt, robots: { pass: true, evidence }, terms: { pass: true, evidence, basis: "api-key", url: null }, tightened: false };
  }
  const host = normalizeHost(s.host), site = `https://${host}`;
  await deps.throttle.wait(host);
  const robots = await discoveryFetch(`${site}/robots.txt`, { maxBytes: 60_000 }, deps.fetchImpl);
  let path = "/"; try { path = new URL(s.url ?? site).pathname; } catch { /* keep */ }
  const rv = robotsVerdict(robots.status, robots.text, path);
  await deps.throttle.wait(host);
  const home = await discoveryFetch(site, { maxBytes: PAGE_MAX_BYTES }, deps.fetchImpl);
  const terms = await termsCheck(host, site, home.status === 200 ? home.text : "", deps);
  const robotsPass = rv.outcome === "allowed" ? true : rv.outcome === "unknown" ? null : false;
  return { checkedAt, robots: { pass: robotsPass, evidence: rv.evidence }, terms: { pass: terms.pass, evidence: terms.evidence, basis: terms.basis, url: terms.url }, tightened: robotsPass === false || terms.pass === false };
}

/** A decision record for a source that was never auto-discovered (config origin), from the re-check plus what ingestion knows. */
export function decisionFromRecheck(s: SourceDoc, r: Recheck): Decision {
  const apiKey = API_KEY_SOURCES.has(s.type);
  const rules: Decision["rules"] = {
    notDenied: { pass: !isDeniedHost(s.host), evidence: isDeniedHost(s.host) ? `${s.host} is on the deny-list` : `${s.host} is not on the deny-list` },
    robotsAllow: r.robots,
    machineReadable: { pass: s.type !== "midpen", evidence: s.type === "midpen" ? "HTML listing (no feed exists); permission recorded in sources/midpen.ts and the survey — the one standing exception, never a discovery outcome" : `${s.type} adapter reads a feed or API` },
    termsAllow: { pass: r.terms.pass, evidence: r.terms.evidence },
    realEvents: s.lastEventCount === null || s.lastEventCount === undefined ? { pass: null, evidence: "no ingest run recorded yet" }
      : s.lastEventCount > 0 ? { pass: true, evidence: `last run fetched ${s.lastEventCount} events` }
      : s.type === "nps" ? { pass: true, evidence: "no park inside the radius; the source carries no park codes by design" }
      : apiKey ? { pass: true, evidence: `${s.type}: 0 events because no API key is configured in this environment — not a sourcing-rule failure` }
      : { pass: false, evidence: "last run fetched 0 events" },
    notAdultContent: { pass: true, evidence: apiKey ? "curated API" : `name "${s.name}" carries no adult-content signal` },
  };
  if (s.type === "midpen") rules.machineReadable = { pass: true, evidence: rules.machineReadable.evidence };
  const failed = (Object.keys(rules) as Array<keyof typeof rules>).filter((k) => rules[k].pass === false);
  const undetermined = (Object.keys(rules) as Array<keyof typeof rules>).filter((k) => rules[k].pass === null);
  return { decidedAt: r.checkedAt, verdict: failed.length ? "rejected" : undetermined.length ? "unknown" : "active", rules, terms: { url: r.terms.url, clause: null, basis: r.terms.basis, candidates: [] }, failed, undetermined };
}

export interface RecheckReport { areaId: string; checked: number; paused: string[]; resumed: string[]; stillPaused: string[]; errors: string[] }

/**
 * Weekly: every active source is re-checked (robots + terms) and PAUSED if
 * either tightened; every paused source is re-inspected and RESUMED when it
 * passes every rule again. A paused source's events are kept until normal
 * staleness removes them; a resumed source is read by the next ingest run.
 */
export async function recheckSources(area: LaunchArea, deps: { fetchImpl?: typeof fetch; throttle?: HostThrottle; now?: Date } = {}): Promise<RecheckReport> {
  const fetchImpl = deps.fetchImpl ?? fetch, throttle = deps.throttle ?? new HostThrottle(), now = deps.now ?? new Date();
  const report: RecheckReport = { areaId: area.id, checked: 0, paused: [], resumed: [], stillPaused: [], errors: [] };
  // A config source that has only ever ingested through payload mode (tests, the migration) has no run count; its
  // stored events say what it supplies.
  let index: AreaIndex | null = null;
  const eventCountFor = async (s: SourceDoc): Promise<number | null> => {
    if (typeof s.lastEventCount === "number") return s.lastEventCount;
    index ??= await loadAreaIndex(area, now);
    return activeEventsOf(index, [s]).length;
  };
  for (const s of await loadSourcesByStatus(area.id, "active")) {
    try {
      const r = await recheckSource(s, { fetchImpl, throttle, now });
      report.checked++;
      const decision = s.origin === "config" ? decisionFromRecheck({ ...s, lastEventCount: await eventCountFor(s) }, r) : mergeRecheck(s.decision as Decision | null, r);
      const patch: Record<string, unknown> = { recheck: r, decision, updatedAt: Timestamp.fromDate(now) };
      if (r.tightened) { await setSourceStatus(s.id, "paused", `re-check: ${r.robots.pass === false ? `robots.txt now disallows (${r.robots.evidence})` : `terms now restrict (${r.terms.evidence})`}`, { ...patch, pausedAt: Timestamp.fromDate(now), pausedBy: "recheck" }); report.paused.push(s.id); }
      else await db.collection("sources").doc(s.id).set(patch, { merge: true });
    } catch (e) { report.errors.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  for (const s of await loadSourcesByStatus(area.id, "paused")) {
    try {
      let decision: Decision;
      if (s.origin === "config") decision = decisionFromRecheck({ ...s, lastEventCount: s.lastEventCount ?? 1 }, await recheckSource(s, { fetchImpl, throttle, now }));
      else {
        const inspection = await inspectSource(s.host, { area, fetchImpl, throttle, now });
        decision = await decideSource(inspection, { area, fetchImpl, throttle, now, originInArea: true, originNote: "previously active source" });
        if (inspection.adapter !== s.type) decision = { ...decision, verdict: "rejected", failed: [...decision.failed, "machineReadable"], rules: { ...decision.rules, machineReadable: { pass: false, evidence: `adapter changed from ${s.type} to ${inspection.adapter ?? "none"}` } } };
      }
      report.checked++;
      if (decision.verdict === "active") { await setSourceStatus(s.id, "active", "re-inspection passed every rule; resumed", { decision, failureStreak: 0, resumedAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) }); report.resumed.push(s.id); }
      else { await db.collection("sources").doc(s.id).set({ decision, lastRecheckAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) }, { merge: true }); report.stillPaused.push(s.id); }
    } catch (e) { report.errors.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`); report.stillPaused.push(s.id); }
  }
  await db.collection("discoveryRuns").doc(utcDayKey(now)).collection("rechecks").doc(area.id).set({ ...report, runAt: Timestamp.fromDate(now) });
  return report;
}

function mergeRecheck(d: Decision | null, r: Recheck): Decision {
  const base: Decision = d ?? { decidedAt: r.checkedAt, verdict: "unknown", rules: {} as Decision["rules"], terms: { url: null, clause: null, basis: "", candidates: [] }, failed: [], undetermined: [] };
  const rules = { ...base.rules, robotsAllow: r.robots, termsAllow: { pass: r.terms.pass, evidence: r.terms.evidence } };
  const failed = failingRules({ ...base, rules }).filter((k) => rules[k]?.pass === false);
  const undetermined = failingRules({ ...base, rules }).filter((k) => rules[k]?.pass !== false);
  return { ...base, decidedAt: r.checkedAt, rules, terms: { ...base.terms, url: r.terms.url, basis: r.terms.basis }, verdict: failed.length ? "rejected" : undetermined.length ? "unknown" : "active", failed, undetermined };
}

export const recheckSourcesWeekly = onSchedule({ schedule: "every monday 06:00", timeoutSeconds: 540, memory: "512MiB" }, async () => {
  for (const area of LAUNCH_AREAS) await recheckSources(area);
});

/** Audit: active sources that fail any rule — must be empty. */
export async function auditActiveSources(areaId: string): Promise<Array<{ id: string; failing: string[] }>> {
  const out: Array<{ id: string; failing: string[] }> = [];
  for (const s of await loadSourcesByStatus(areaId, "active")) {
    const failing = failingRules(s.decision as Decision | null);
    if (failing.length) out.push({ id: s.id, failing });
  }
  return out;
}

// ── Staff: run now ──────────────────────────────────────────────────────────

export const runDiscoveryNow = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async (req) => {
  const staff = await requireAdmin(req.auth);
  const area = areaById(safeString(req.data?.areaId, LAUNCH_AREAS[0].id));
  if (!area) throw new HttpsError("invalid-argument", "Unknown launch area.");
  const reason = req.data?.reason ? staffReason(req.data.reason) : "Manual discovery run requested by staff";
  const mode = safeString(req.data?.mode, "discover");
  return auditedStaffJob(staff, `discovery:${mode}`, area.id, null, reason, async () => mode === "recheck" ? recheckSources(area) : mode === "audit" ? auditActiveSources(area.id) : runDiscovery(area));
});

// ── Intake: a URL to inspect (never an event to ingest) ─────────────────────

const requesterKey = (req: Request): string => "ip:" + createHash("sha256").update(String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "unknown").digest("hex").slice(0, 24);
const cors = (res: Response) => { res.set("Access-Control-Allow-Origin", "*"); res.set("Access-Control-Allow-Methods", "POST, OPTIONS"); res.set("Access-Control-Allow-Headers", "content-type"); res.set("Cache-Control", "no-store"); };

/** Record a calendar URL for automatic inspection. Pure of transport so the website form and tests share it. */
export async function recordSourceSubmission(urlRaw: unknown, origin: "organizer" | "model-url", requester: string, areaId = LAUNCH_AREAS[0].id): Promise<{ accepted: boolean; host: string; reason?: string }> {
  let url: URL;
  try { url = new URL(String(urlRaw ?? "").trim()); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { return { accepted: false, host: "", reason: "Enter a calendar URL starting with https://." }; }
  const host = normalizeHost(url.hostname);
  if (!validHost(host)) return { accepted: false, host, reason: "That host name is not valid." };
  // The deny-list has path-qualified entries (google.com/maps): check the whole URL as well as the host, or a
  // Google Maps link slips past on its hostname alone (red team, 2026-10-22).
  if (isDeniedHost(host) || isDeniedHost(url.href)) return { accepted: false, host, reason: `${host}${isDeniedHost(host) ? "" : url.pathname.split("/").slice(0, 2).join("/")} cannot be used as a source (deny-list).` };
  if (await isRemovedHost(host)) return { accepted: false, host, reason: `${host} asked to be removed and will not be re-added.` };
  await db.collection("sourceSubmissions").doc(candidateId(areaId, host)).set({ url: url.href.slice(0, 1000), host, areaId, origin, requester, submittedAt: Timestamp.now(), processedAt: null }, { merge: true });
  return { accepted: true, host };
}

export const sourceIntake = onRequest({ cors: false }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST a JSON body { url }." }); return; }
  try {
    const requester = requesterKey(req);
    await enforceRateLimit(requester, "sourceIntake");
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const out = await recordSourceSubmission(body.url, "organizer", requester, safeText(body.areaId, 60) || LAUNCH_AREAS[0].id);
    res.status(out.accepted ? 200 : 400).json(out);
  } catch (e) {
    if (e instanceof HttpsError) { res.status(e.code === "resource-exhausted" ? 429 : 400).json({ error: e.message }); return; }
    console.error("[intake]", e); res.status(500).json({ error: "The request could not be processed." });
  }
});

export { isPublicInstitution };
