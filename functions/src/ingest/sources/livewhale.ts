/**
 * LiveWhale Calendar JSON v2. Verified against events.scu.edu on 2026-09-26.
 * The public /live/json/v2/events endpoint returns meta/data/links; a
 * Localist /api/2/events probe on the same host returns 403. The public feed is
 * documented for integrations by LiveWhale. We do not parse blocked HTML.
 *
 * /max/1000 is a total cap, not page size. /paginate/100 and ?page=N retrieve
 * every page inside the 60-day horizon. hide_repeats/true keeps each recurring
 * series to one upcoming record, per the sprint's supply/dedupe requirement.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanCoord, cleanText, cleanUrl, classify, formatLocalTime } from "../normalize.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DAYS = 60;

export interface LiveWhaleEvent {
  id?: number | string;
  title?: string;
  url?: string;
  date_iso?: string;
  date2_iso?: string | null;
  is_all_day?: number | boolean | null;
  is_canceled?: number | boolean | null;
  is_online?: number | boolean | null;
  summary?: string | null;
  description?: string | null;
  cost?: string | number | null;
  location?: string | null;
  location_title?: string | null;
  location_latitude?: number | string | null;
  location_longitude?: number | string | null;
  thumbnail?: string | null;
  event_types?: string[] | null;
  tags?: string[] | null;
  group_title?: string | null;
}

interface LiveWhalePage {
  meta?: { type?: string; page?: number; total_pages?: number; total_results?: number };
  data?: LiveWhaleEvent[];
}

/** One public occurrence per source id and start time. */
export function mapLiveWhale(e: LiveWhaleEvent, area: LaunchArea, host: string, name: string): NormalizedEvent | null {
  if (e?.id === undefined || !e.title || !e.date_iso || e.is_canceled) return null;
  const tags = [...(Array.isArray(e.event_types) ? e.event_types : []), ...(Array.isArray(e.tags) ? e.tags : [])]
    .map((t) => cleanText(t, 40)).filter(Boolean);
  if (tags.some((t) => /^(private|closed to the public|invitation only)$/i.test(t))) return null;
  const start = new Date(e.date_iso);
  if (Number.isNaN(start.getTime())) return null;
  const rawEnd = e.date2_iso ? new Date(e.date2_iso) : undefined;
  const end = rawEnd && !Number.isNaN(rawEnd.getTime()) ? rawEnd : undefined;
  const title = cleanText(e.title, 120);
  if (!title) return null;
  const desc = cleanText(e.summary || e.description || "", 600);
  const cost = typeof e.cost === "number" && Number.isFinite(e.cost) ? String(e.cost) : cleanText(e.cost, 120);
  const prices = [...cost.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
  if (!prices.length && typeof e.cost === "number" && Number.isFinite(e.cost)) prices.push(e.cost);
  const priceMin = prices.length ? Math.min(...prices) : undefined;
  const latitude = cleanCoord(e.location_latitude, 90);
  const longitude = cleanCoord(e.location_longitude, 180);
  const organizer = cleanText(e.group_title || name, 80) || name;
  const locationName = cleanText(e.location_title || e.location || (e.is_online ? "Online" : name), 100);
  return {
    source: "livewhale",
    sourceEventId: `${host}:${e.id}:${e.date_iso}`,
    areaId: area.id,
    title,
    description: desc,
    organizer,
    start,
    end,
    time: formatLocalTime(start, area.timeZone, !!e.is_all_day),
    locationName,
    latitude: latitude !== undefined && longitude !== undefined ? latitude : undefined,
    longitude: latitude !== undefined && longitude !== undefined ? longitude : undefined,
    category: classify(`${title} ${tags.join(" ")} ${desc.slice(0, 300)}`),
    eventTypes: (Array.isArray(e.event_types) ? e.event_types : [])
      .map((t) => cleanText(t, 80)).filter(Boolean).slice(0, 32),
    // Missing cost means unknown. A mixed-price listing stays paid even if one
    // audience (such as children under six) gets in free.
    isFree: priceMin !== undefined ? priceMin === 0
      : /\bfree\b/i.test(`${cost} ${title}`) ? true : undefined,
    priceMin,
    website: cleanUrl(e.url),
    imageURL: cleanUrl(e.thumbnail),
    tags: tags.slice(0, 8),
  };
}

export async function fetchLiveWhale(area: LaunchArea, host: string, name: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<NormalizedEvent[]> {
  const until = new Date(now.getTime() + DAYS * 86_400_000).toISOString().slice(0, 10);
  const path = `/live/json/v2/events/max/1000/paginate/${PAGE_SIZE}/hide_repeats/true/end_date/${until}/response_fields/location,event_types,tags,image,summary,group_title`;
  const out: NormalizedEvent[] = [];
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: area.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  let expectedPages = 1;
  for (let page = 1; page <= expectedPages; page++) {
    if (page > MAX_PAGES) throw new Error(`${name} (LiveWhale) exceeded ${MAX_PAGES} pages`);
    const res = await fetchImpl(`https://${host}${path}?page=${page}`, {
      headers: { Accept: "application/json", "User-Agent": "Verdure-ingest/1.0 (+https://verdure-app.com)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${name} (LiveWhale) HTTP ${res.status}`);
    const body = await res.json() as LiveWhalePage;
    if (body.meta?.type !== "events" || !Array.isArray(body.data) ||
        !Number.isInteger(body.meta.page) || body.meta.page !== page ||
        !Number.isInteger(body.meta.total_pages) || body.meta.total_pages! < 0) {
      throw new Error(`${name} (LiveWhale) response shape changed`);
    }
    if (page === 1) {
      if ((body.meta.total_results ?? 0) >= 1000) {
        throw new Error(`${name} (LiveWhale) reached the 1000-event cap; split the date window`);
      }
      expectedPages = body.meta.total_pages!;
    }
    else if (body.meta.total_pages! !== expectedPages) throw new Error(`${name} (LiveWhale) pagination changed mid-fetch`);
    if (body.data.length === 0 && expectedPages > 0) throw new Error(`${name} (LiveWhale) empty page ${page}`);
    for (const raw of body.data) {
      const event = mapLiveWhale(raw, area, host, name);
      if (!event) continue;
      const stillHappening = (event.end && event.end >= now) ||
        (!!raw.is_all_day && dayFormat.format(event.start) === dayFormat.format(now));
      if ((event.start >= now || stillHappening) && event.start <= new Date(now.getTime() + DAYS * 86_400_000)) out.push(event);
    }
  }
  if (expectedPages > 0 && out.length === 0) throw new Error(`${name} (LiveWhale) returned no public upcoming events`);
  return out;
}
