/**
 * BiblioCommons — public library event calendars via the public gateway API.
 *
 * WHY THIS EXISTS. The South Bay's two library systems (San José Public Library
 * and Santa Clara County Library District) both run BiblioCommons, not LibCal.
 * Surveyed live 2026-09-13:
 *
 *   https://sjpl.bibliocommons.com/events/calendar.ics   → 404 (no iCal at all)
 *   https://gateway.bibliocommons.com/v2/libraries/sjpl/events  → 200, 6,485 events
 *   https://gateway.bibliocommons.com/v2/libraries/sccl/events  → 200, paginated
 *
 * So neither the .ics adapter nor the LibCal RSS adapter can read them, which is
 * why this is a third source rather than a config entry.
 *
 * ONE REAL ADVANTAGE OVER LIBCAL: branch coordinates come from the feed. Each
 * location carries `mapLocation.centrePoint {lat,lng}`, so there is no
 * hand-maintained venue table here and no branch silently missing coordinates —
 * the failure mode that forced the Cleveland config to leave three branches
 * uncoordinated.
 *
 * WHY WE DO NOT SIMPLY TRUST `isGeocoded`. The obvious rule — accept a
 * coordinate only when `mapLocation.isGeocoded === true` — was the first
 * implementation, and a live run showed why it is wrong: SJPL sets the flag,
 * Santa Clara County Library District does NOT set it on any branch, yet SCCLD's
 * coordinates are plainly correct (Cupertino Library at 37.3178,-122.0290 is the
 * actual building). That rule threw away good coordinates for 2,106 events and
 * silently disabled check-in proximity for an entire library system.
 *
 * The danger the flag was guarding against is real but specific: an ungeocoded
 * centre point can be a CITY CENTROID, which would put the 500 ft check-in gate
 * around the wrong building. A centroid has a signature, though — it is the
 * SAME point for every branch in the system. So the actual test is per-payload
 * and mechanical: trust `isGeocoded` outright, and otherwise accept a coordinate
 * only if it is distinct from the other branches' in the same response. A
 * shared point is discarded, exactly as before.
 *
 * SHAPE. The response is normalized-by-id: `entities.events` holds the event
 * records, `entities.locations` the branches, `entities.images` the artwork, and
 * `events.items` is the ordered id list. Each event's real payload sits under
 * `definition`, with `indexStart`/`indexEnd` carrying the resolved UTC instants
 * of that occurrence (recurring series are already expanded, one record per
 * occurrence) — so no timezone maths is needed, unlike the LibCal path.
 */

import { isInsideArea, type LaunchArea, type BiblioFeed } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, cleanCoord, classify, formatLocalTime } from "../normalize.js";

export interface BiblioItem {
  eventId: string;
  title: string;
  descriptionHtml: string;
  startISO: string;
  endISO?: string;
  branch: string;
  room: string;
  lat?: number;
  lng?: number;
  types: string[];
  audiences: string[];
  image?: string;
  link?: string;
  isFull: boolean;
}

interface GatewayPayload {
  events?: { items?: unknown[]; pagination?: { count?: number; pages?: number; page?: number } };
  entities?: Record<string, Record<string, any>>;
}

/**
 * Flatten the gateway's entity graph into plain items.
 *
 * Exported so the unit tests can run it against a captured fixture with no
 * network — the same pattern parseLibCalRss follows.
 */
export function parseBiblioPayload(payload: unknown, host: string): BiblioItem[] {
  const p = (payload ?? {}) as GatewayPayload;
  const events = p.entities?.events ?? {};
  const locations = p.entities?.locations ?? {};

  // Which locations carry a coordinate we are willing to believe? See the
  // header: `isGeocoded` is trusted when present, and an unflagged point is
  // accepted only when it is not shared with another branch.
  const trustedLocationIds = trustedCoordinateIds(locations);
  const images = p.entities?.images ?? {};
  const types = p.entities?.eventTypes ?? {};
  const audiences = p.entities?.eventAudiences ?? {};

  // Preserve the server's ordering when it gives one; fall back to the map.
  const ids = Array.isArray(p.events?.items) && p.events!.items!.length
    ? p.events!.items!.map(String)
    : Object.keys(events);

  const out: BiblioItem[] = [];
  for (const id of ids) {
    const ev = events[id];
    const def = ev?.definition;
    if (!ev || !def || typeof def !== "object") continue;

    const locId = String(def.branchLocationId ?? "");
    const loc = locations[locId] ?? {};
    const centre = loc?.mapLocation?.centrePoint;
    const trusted = trustedLocationIds.has(locId);

    const img = images[String(def.featuredImageId ?? "")];

    out.push({
      eventId: String(ev.id ?? id),
      title: String(def.title ?? ""),
      descriptionHtml: String(def.description ?? ""),
      // indexStart/indexEnd are the resolved UTC instants for this occurrence.
      startISO: String(ev.indexStart ?? ""),
      endISO: ev.indexEnd ? String(ev.indexEnd) : undefined,
      branch: String(loc?.name ?? ""),
      room: String(def.locationDetails ?? ""),
      lat: trusted ? cleanCoord(centre?.lat, 90) : undefined,
      lng: trusted ? cleanCoord(centre?.lng, 180) : undefined,
      types: (Array.isArray(def.typeIds) ? def.typeIds : [])
        .map((t: unknown) => String(types[String(t)]?.name ?? "")).filter(Boolean),
      audiences: (Array.isArray(def.audienceIds) ? def.audienceIds : [])
        .map((a: unknown) => String(audiences[String(a)]?.name ?? "")).filter(Boolean),
      image: img?.url ? String(img.url) : undefined,
      link: `https://${host}/events/${ev.id ?? id}`,
      isFull: ev.isFull === true,
    });
  }
  return out;
}

/**
 * Location ids whose centre point may be used as a venue coordinate.
 *
 * Exported for the tests, which assert both halves: a flagged coordinate is
 * kept, and a point repeated across every branch (the city-centroid signature)
 * is dropped for all of them.
 */
export function trustedCoordinateIds(locations: Record<string, any>): Set<string> {
  const entries = Object.entries(locations);
  const counts = new Map<string, number>();
  for (const [, loc] of entries) {
    const c = loc?.mapLocation?.centrePoint;
    if (typeof c?.lat !== "number" || typeof c?.lng !== "number") continue;
    const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const trusted = new Set<string>();
  for (const [id, loc] of entries) {
    const c = loc?.mapLocation?.centrePoint;
    if (typeof c?.lat !== "number" || typeof c?.lng !== "number") continue;
    if (loc?.mapLocation?.isGeocoded === true) { trusted.add(id); continue; }
    // Unflagged: believable only if no other branch claims the same point.
    const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
    if ((counts.get(key) ?? 0) === 1) trusted.add(id);
  }
  return trusted;
}

export function mapBiblioItem(i: BiblioItem, area: LaunchArea, feed: BiblioFeed): NormalizedEvent | null {
  const title = cleanText(i.title, 120);
  if (!title) return null;
  // Closures and canceled sessions are calendar administration, not things a
  // person can attend. Keep this at the adapter boundary so backfill and feed
  // ranking never see them as candidate events.
  if (/^(?:cancell?ed|closed|closure)\s*:/i.test(title) ||
      i.types.some((type) => /\blibrary closures?\b/i.test(type))) return null;

  const start = new Date(i.startISO);
  if (Number.isNaN(start.getTime())) return null;
  if (feed.requireInAreaCoordinates &&
      (i.lat === undefined || i.lng === undefined || !isInsideArea(area, i.lat, i.lng))) return null;
  const end = i.endISO ? new Date(i.endISO) : undefined;

  const description = cleanText(i.descriptionHtml, 600);
  const location = [cleanText(i.branch, 60), cleanText(i.room, 60)].filter(Boolean).join(" · ") || feed.name;
  const text = `${title} ${i.types.join(" ")} ${i.audiences.join(" ")} ${description.slice(0, 300)}`;

  return {
    source: "bibliocommons",
    sourceEventId: `${feed.library}-${i.eventId}`,
    areaId: area.id,
    title,
    description,
    organizer: cleanText(feed.name, 80),
    start,
    end: end && !Number.isNaN(end.getTime()) ? end : undefined,
    time: formatLocalTime(start, area.timeZone),
    locationName: cleanText(location, 100),
    latitude: i.lat,
    longitude: i.lng,
    category: classify(text),
    eventTypes: i.types.map((t) => cleanText(t, 80)).filter(Boolean).slice(0, 32),
    audiences: i.audiences.map((a) => cleanText(a, 80)).filter(Boolean).slice(0, 32),
    // Library programming is free unless the copy says otherwise. Same rule as
    // the LibCal path, same regex, deliberately — these are the same kind of
    // institution and should not disagree about what "free" means.
    isFree: !/\$\s?\d|ticket(s)? required|admission fee/i.test(description),
    website: cleanUrl(i.link),
    imageURL: cleanUrl(i.image),
    tags: [...(feed.tags ?? []), ...i.types.map((t) => cleanText(t, 40)),
           ...i.audiences.map((a) => cleanText(a, 40))].filter(Boolean).slice(0, 8),
  };
}

// The gateway is not sorted by start time: near-term events appear even on its
// last page. A four-page cap silently drops them. 150 is accepted by the
// configured systems (Palo Alto returns HTTP 500 at 200); 50 pages covers
// SJPL's current 6,020 rows.
const MAX_PAGES = 50;
const DEFAULT_PAGE_SIZE = 150;

export async function fetchBiblioCommons(
  area: LaunchArea,
  feed: BiblioFeed,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedEvent[]> {
  const host = feed.host ?? `${feed.library}.bibliocommons.com`;
  const pageSize = feed.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 50 || pageSize > 150) {
    throw new Error(`${feed.name} has an invalid BiblioCommons page size`);
  }
  const out: NormalizedEvent[] = [];
  let expectedPages = 1;

  for (let page = 1; page <= expectedPages; page++) {
    if (page > MAX_PAGES) throw new Error(`${feed.name} exceeds ${MAX_PAGES} BiblioCommons pages`);
    const url = `https://gateway.bibliocommons.com/v2/libraries/${encodeURIComponent(feed.library)}` +
                `/events?limit=${pageSize}&page=${page}`;
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "Verdure/1.0 (events ingest)" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok || (res.status < 500 && res.status !== 429)) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
    if (!res) throw new Error(`${feed.name} page ${page} returned no response`);
    if (!res.ok) throw new Error(`${feed.name} page ${page} returned ${res.status}`);
    const payload = await res.json() as GatewayPayload;
    if (!Array.isArray(payload.events?.items) || !payload.entities?.events ||
        !Number.isInteger(payload.events?.pagination?.pages)) {
      throw new Error(`${feed.name} BiblioCommons response shape changed on page ${page}`);
    }
    if (page === 1) expectedPages = payload.events.pagination!.pages!;
    if (expectedPages > MAX_PAGES) throw new Error(`${feed.name} exceeds ${MAX_PAGES} BiblioCommons pages`);
    if (payload.events.items.length === 0 && expectedPages > 0) {
      throw new Error(`${feed.name} BiblioCommons returned an empty page ${page}`);
    }
    const items = parseBiblioPayload(payload, host);
    if (items.length === 0 && payload.events.items.length > 0) {
      throw new Error(`${feed.name} BiblioCommons yielded no parseable rows on page ${page}`);
    }

    for (const i of items) {
      const mapped = mapBiblioItem(i, area, feed);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
