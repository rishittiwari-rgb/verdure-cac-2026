/**
 * Automatic removal on request (W4.6). No human review anywhere in this file.
 *
 *   POST requestSourceRemoval { host, contact?, reason? }
 *     • most hosts are removed immediately: every /sources document for the
 *       host becomes "removed", the host goes on /removedHosts so discovery
 *       never inspects it again, and its events are hidden on the next ingest
 *       cycle (applyRemovals, run first by ingestCivic).
 *     • abuse guard: a host with more than LARGE_SOURCE_EVENTS active events
 *       must publish its issued token at /.well-known/verdure-remove.txt or as
 *       <meta name="verdure-remove" content="…">. The server checks it itself,
 *       so a stranger cannot delete a library's 6,000 events, and nobody has
 *       to look at a ticket.
 *     • rate-limited per requester address; every request is logged to
 *       /removalRequests with its outcome.
 *   GET removalToken?host=…  → the token the host must publish (if it must).
 *
 * The token is derived from the host name alone (sha256), like a site
 * verification file: knowing it proves nothing, PUBLISHING it on the host
 * proves control of the host. No secret is needed, so this works in the
 * emulator and in production identically.
 */

import { createHash } from "node:crypto";
import { onRequest, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type { Request, Response } from "express";
import { db, enforceRateLimit, safeText } from "../common.js";
import { LAUNCH_AREAS, type LaunchArea } from "../ingest/areas.js";
import { loadAreaIndex, type AreaIndex } from "../ingest/store.js";
import { loadSourcesByHost, loadSourcesByStatus, setSourceStatus, type SourceDoc } from "../ingest/sources-registry.js";
import { discoveryFetch, hostOf } from "./http.js";
import { validHost } from "./inspect.js";

export const LARGE_SOURCE_EVENTS = 100;

export const normalizeHost = (raw: unknown): string => {
  let host = String(raw ?? "").trim().toLowerCase();
  try { if (/^https?:\/\//.test(host)) host = new URL(host).hostname; } catch { /* keep */ }
  return host.replace(/^www\./, "").replace(/\.$/, "");
};

/** The token a host must publish to prove control (W4.6 abuse guard). */
export const removalTokenFor = (host: string): string => "verdure-remove-" + createHash("sha256").update(`verdure-remove:${normalizeHost(host)}`).digest("hex").slice(0, 32);

/** Does this stored event come from `source`? Host of its URLs, or the feed name it was ingested under. */
export function eventBelongsToSource(data: FirebaseFirestore.DocumentData, source: Pick<SourceDoc, "type" | "host" | "name">): boolean {
  if (data.source !== source.type) return false;
  const host = normalizeHost(source.host);
  const hosts = [data.website, ...((Array.isArray(data.sources) ? data.sources : []) as Array<{ url?: string | null }>).map((s) => s?.url)]
    .filter((u): u is string => typeof u === "string").map((u) => normalizeHost(hostOf(u)));
  if (hosts.some((h) => h === host || h.endsWith(`.${host}`))) return true;
  return typeof data.organizer === "string" && data.organizer === source.name;
}

export function activeEventsOf(index: Pick<AreaIndex, "all">, sources: SourceDoc[]): string[] {
  const ids: string[] = [];
  for (const ev of index.all) if (ev.data.active === true && sources.some((s) => eventBelongsToSource(ev.data, s))) ids.push(ev.id);
  return ids;
}

/** Active events for the host across every launch area (the abuse-guard threshold). */
export async function countActiveEventsForHost(host: string, sources: SourceDoc[]): Promise<number> {
  let n = 0;
  for (const area of LAUNCH_AREAS) {
    const own = sources.filter((s) => s.areaId === area.id);
    if (!own.length) continue;
    n += activeEventsOf(await loadAreaIndex(area), own).length;
  }
  return n;
}

/** Fetch the host's published token: /.well-known/verdure-remove.txt first, then a meta tag on the home page. */
export async function publishedToken(host: string, fetchImpl: typeof fetch = fetch): Promise<{ found: string | null; where: string }> {
  const wk = await discoveryFetch(`https://${host}/.well-known/verdure-remove.txt`, { maxBytes: 4_000 }, fetchImpl);
  if (wk.status === 200) { const m = /verdure-remove-[a-f0-9]{32}/i.exec(wk.text); if (m) return { found: m[0].toLowerCase(), where: ".well-known/verdure-remove.txt" }; }
  const home = await discoveryFetch(`https://${host}/`, { maxBytes: 200_000 }, fetchImpl);
  const meta = /<meta\b[^>]*name=["']verdure-remove["'][^>]*content=["']([^"']+)["']/i.exec(home.text) ?? /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']verdure-remove["']/i.exec(home.text);
  if (meta) return { found: meta[1].trim().toLowerCase(), where: "meta tag" };
  return { found: null, where: "" };
}

export interface RemovalOutcome {
  host: string; removed: boolean; sources: number; activeEvents: number;
  requiresToken: boolean; token?: string; tokenVerified?: boolean; tokenWhere?: string; message: string;
}

/** The whole removal decision, pure of transport so the E2E can call it directly. */
export async function processRemoval(hostRaw: unknown, requester: string, extra: { contact?: string; reason?: string } = {}, fetchImpl: typeof fetch = fetch): Promise<RemovalOutcome> {
  const host = normalizeHost(hostRaw);
  if (!validHost(host)) throw new HttpsError("invalid-argument", "Enter the host name of the site, like events.example.org.");
  const sources = await loadSourcesByHost(host);
  const live = sources.filter((s) => s.status !== "removed");
  const activeEvents = await countActiveEventsForHost(host, live);
  const requiresToken = activeEvents > LARGE_SOURCE_EVENTS;
  const token = removalTokenFor(host);
  const log: Record<string, unknown> = { host, requester, contact: safeText(extra.contact, 200) || null, reason: safeText(extra.reason, 1000) || null,
    sources: live.map((s) => s.id), activeEvents, requiresToken, requestedAt: Timestamp.now() };
  if (requiresToken) {
    const pub = await publishedToken(host, fetchImpl);
    if (pub.found !== token) {
      await db.collection("removalRequests").add({ ...log, outcome: "token-required", tokenFound: pub.found });
      return { host, removed: false, sources: live.length, activeEvents, requiresToken: true, token, tokenVerified: false,
        message: `${host} has ${activeEvents} active listings on Verdure. To prove you control the site, publish the token at https://${host}/.well-known/verdure-remove.txt (or as <meta name="verdure-remove" content="…">) and submit again. Removal is then automatic.` };
    }
    log.tokenWhere = pub.where;
  }
  for (const s of live) await setSourceStatus(s.id, "removed", `removal requested by ${requester}`, { removedAt: Timestamp.now(), removalAppliedAt: null });
  await db.collection("removedHosts").doc(host).set({ host, removedAt: Timestamp.now(), requester, sources: live.map((s) => s.id), activeEventsAtRemoval: activeEvents }, { merge: true });
  await db.collection("removalRequests").add({ ...log, outcome: "removed" });
  return { host, removed: true, sources: live.length, activeEvents, requiresToken, token: requiresToken ? token : undefined, tokenVerified: requiresToken ? true : undefined, tokenWhere: typeof log.tokenWhere === "string" ? log.tokenWhere : undefined,
    message: live.length ? `${host} is removed. Its ${activeEvents} listings are hidden on the next ingest cycle (within 24 hours) and the site will not be rediscovered.` : `${host} was not a Verdure source. It is now on the never-discover list, so it will not be added automatically.` };
}

/** A host on /removedHosts is never inspected, discovered or re-activated. */
export async function isRemovedHost(host: string): Promise<boolean> {
  return (await db.collection("removedHosts").doc(normalizeHost(host)).get()).exists;
}

/**
 * Hide the events of every removed source in the area (run first by
 * ingestCivic). Idempotent: a source is swept once (removalAppliedAt), and the
 * ingest loop never reads a removed source again, so nothing re-creates them.
 */
export async function applyRemovals(area: LaunchArea, now = new Date()): Promise<{ sources: number; hidden: number }> {
  const removed = (await loadSourcesByStatus(area.id, "removed")).filter((s) => !(s as unknown as { removalAppliedAt?: unknown }).removalAppliedAt);
  const pending = await Promise.all(removed.map(async (s) => ({ s, applied: (await db.collection("sources").doc(s.id).get()).data()?.removalAppliedAt ?? null })));
  const todo = pending.filter((p) => !p.applied).map((p) => p.s);
  if (!todo.length) return { sources: 0, hidden: 0 };
  const index = await loadAreaIndex(area, now);
  const ids = activeEventsOf(index, todo);
  let batch = db.batch(), n = 0;
  for (const id of ids) {
    batch.set(db.collection("events").doc(id), { active: false, inactiveAt: Timestamp.fromDate(now), removedAt: Timestamp.fromDate(now), removalReason: "source removed on request" }, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  for (const s of todo) batch.set(db.collection("sources").doc(s.id), { removalAppliedAt: Timestamp.fromDate(now), eventsHidden: ids.length, updatedAt: Timestamp.now() }, { merge: true });
  await batch.commit();
  return { sources: todo.length, hidden: ids.length };
}

// ── HTTP transport ──────────────────────────────────────────────────────────

const requesterKey = (req: Request): string => {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const ip = fwd || req.ip || "unknown";
  return "ip:" + createHash("sha256").update(ip).digest("hex").slice(0, 24);
};
const cors = (res: Response) => { res.set("Access-Control-Allow-Origin", "*"); res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.set("Access-Control-Allow-Headers", "content-type"); res.set("Cache-Control", "no-store"); };
const fail = (res: Response, e: unknown) => {
  if (e instanceof HttpsError) { res.status(e.code === "resource-exhausted" ? 429 : e.code === "invalid-argument" ? 400 : 500).json({ error: e.message }); return; }
  console.error("[removal]", e); res.status(500).json({ error: "The request could not be processed." });
};

export const requestSourceRemoval = onRequest({ cors: false, timeoutSeconds: 120 }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST a JSON body { host, contact?, reason? }." }); return; }
  try {
    const requester = requesterKey(req);
    await enforceRateLimit(requester, "requestSourceRemoval");
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const out = await processRemoval(body.host, requester, { contact: typeof body.contact === "string" ? body.contact : undefined, reason: typeof body.reason === "string" ? body.reason : undefined });
    res.status(out.removed ? 200 : 403).json(out);
  } catch (e) { fail(res, e); }
});

export const removalToken = onRequest({ cors: false }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    await enforceRateLimit(requesterKey(req), "removalToken");
    const host = normalizeHost(req.query.host);
    if (!validHost(host)) { res.status(400).json({ error: "Enter a host name like events.example.org." }); return; }
    const sources = (await loadSourcesByHost(host)).filter((s) => s.status !== "removed");
    const activeEvents = await countActiveEventsForHost(host, sources);
    res.json({ host, isSource: sources.length > 0, activeEvents, requiresToken: activeEvents > LARGE_SOURCE_EVENTS, token: removalTokenFor(host), path: `https://${host}/.well-known/verdure-remove.txt` });
  } catch (e) { fail(res, e); }
});
