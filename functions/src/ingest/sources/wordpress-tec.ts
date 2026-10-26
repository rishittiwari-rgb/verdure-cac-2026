/**
 * WordPress — "The Events Calendar" (W4.5).
 *
 * Primary: the plugin's public REST API,
 *   GET /wp-json/tribe/events/v1/events?start_date=YYYY-MM-DD&end_date=…&per_page=50&page=N
 * which returns { events: [...], total, total_pages, rest_url }. Each event
 * carries utc_start_date / utc_end_date, venue {address, city, geo_lat,
 * geo_lng}, organizer[], cost, categories[], tags[], website, image.url.
 *
 * Fallback: the same sites publish `?ical=1` (the plugin's iCalendar export).
 * Used only when the REST route answers 404/401 (plugin REST disabled);
 * parsed with the shared iCal parser, so it stays a machine-readable feed.
 *
 * Fails loudly like midpen.ts: an HTTP error, a changed response shape or a
 * non-iCalendar fallback body throws, so a silent outage can never read as
 * "no events this week".
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { parseIcs } from "../ics.js";
import { mapIcsEvent } from "./icsfeed.js";
import { cleanText, cleanUrl, classify, formatLocalTime } from "../normalize.js";
import { isInsideArea } from "../areas.js";

export interface WordPressTecFeed {
  name: string;
  /** Site origin, e.g. "https://www.example.org" (the REST route is appended). */
  siteUrl: string;
  tags?: string[];
}

const HORIZON_DAYS = 60;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const UA = "Verdure-ingest/1.0 (+https://verdure-app.com)";

export interface TecVenue { venue?: string; address?: string; city?: string; geo_lat?: number | string; geo_lng?: number | string; url?: string }
export interface TecEvent {
  id: number | string; title?: string; description?: string; excerpt?: string; url?: string; website?: string;
  utc_start_date?: string; utc_end_date?: string; start_date?: string; end_date?: string; all_day?: boolean; timezone?: string;
  cost?: string; cost_details?: { values?: Array<string | number> };
  image?: { url?: string } | false; venue?: TecVenue | TecVenue[]; organizer?: Array<{ organizer?: string }>;
  categories?: Array<{ name?: string }>; tags?: Array<{ name?: string }>; status?: string;
}
export interface TecPage { events?: TecEvent[]; total?: number; total_pages?: number }

export const tecRestUrl = (siteUrl: string, from: Date, to: Date, page: number, perPage = PAGE_SIZE): string =>
  `${siteUrl.replace(/\/$/, "")}/wp-json/tribe/events/v1/events?${new URLSearchParams({ start_date: from.toISOString().slice(0, 10), end_date: to.toISOString().slice(0, 10), per_page: String(perPage), page: String(page), status: "publish" })}`;
export const tecIcalUrl = (siteUrl: string): string => `${siteUrl.replace(/\/$/, "")}/events/?ical=1`;

const decodeEntities = (s: string) => s.replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "–").replace(/&amp;/g, "&").replace(/&#038;/g, "&").replace(/&quot;/g, "\"").replace(/&#039;/g, "'").replace(/&nbsp;/g, " ");
const utc = (s?: string) => { if (!s) return undefined; const d = new Date(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")); return Number.isNaN(d.getTime()) ? undefined : d; };

export function mapTecEvent(e: TecEvent, area: LaunchArea, feed: WordPressTecFeed): NormalizedEvent | null {
  const title = cleanText(decodeEntities(String(e.title ?? "")), 120);
  const start = utc(e.utc_start_date) ?? utc(e.start_date);
  if (!title || !start) return null;
  const end = utc(e.utc_end_date) ?? utc(e.end_date);
  const venue = Array.isArray(e.venue) ? e.venue[0] : e.venue;
  const lat = venue?.geo_lat !== undefined ? Number(venue.geo_lat) : NaN;
  const lng = venue?.geo_lng !== undefined ? Number(venue.geo_lng) : NaN;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  if (hasCoords && !isInsideArea(area, lat, lng)) return null;
  const costText = String(e.cost ?? "").trim();
  const costValues = (e.cost_details?.values ?? []).map(Number).filter((n) => Number.isFinite(n));
  const isFree = /^free$/i.test(costText) || costValues.length > 0 && costValues.every((n) => n === 0) ? true : costValues.some((n) => n > 0) ? false : undefined;
  const priceMin = costValues.length && costValues.some((n) => n > 0) ? Math.min(...costValues.filter((n) => n > 0)) : undefined;
  const description = cleanText(decodeEntities(String(e.description ?? e.excerpt ?? "").replace(/<[^>]+>/g, " ")), 600);
  const categories = (e.categories ?? []).map((c) => cleanText(c.name, 40)).filter(Boolean);
  const tags = [...(feed.tags ?? []), ...categories, ...(e.tags ?? []).map((t) => cleanText(t.name, 40)).filter(Boolean)].slice(0, 12);
  const locationName = cleanText([venue?.venue, venue?.address, venue?.city].filter(Boolean).join(", "), 100) || feed.name;
  return {
    source: "wordpress-tec",
    sourceEventId: String(e.id),
    areaId: area.id,
    status: e.status === "cancelled" || e.status === "canceled" ? "cancelled" : "scheduled",
    title,
    description,
    organizer: cleanText(e.organizer?.[0]?.organizer ?? feed.name, 80) || feed.name,
    start, end,
    time: formatLocalTime(start, area.timeZone, e.all_day === true),
    locationName,
    latitude: hasCoords ? lat : undefined,
    longitude: hasCoords ? lng : undefined,
    category: classify(`${title} ${categories.join(" ")} ${description.slice(0, 300)}`),
    isFree, priceMin,
    website: cleanUrl(e.website) ?? cleanUrl(e.url),
    imageURL: e.image && typeof e.image === "object" ? cleanUrl(e.image.url) : undefined,
    tags,
  };
}

export async function fetchWordPressTec(area: LaunchArea, feed: WordPressTecFeed, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<NormalizedEvent[]> {
  const to = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const out: NormalizedEvent[] = [];
  let expectedPages = 1;
  for (let page = 1; page <= expectedPages; page++) {
    if (page > MAX_PAGES) throw new Error(`${feed.name} (WordPress TEC) exceeded ${MAX_PAGES} pages`);
    const res = await fetchImpl(tecRestUrl(feed.siteUrl, now, to, page), { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (page === 1 && (res.status === 404 || res.status === 401 || res.status === 403)) return fetchWordPressTecIcal(area, feed, fetchImpl, now, res.status);
    if (!res.ok) throw new Error(`${feed.name} (WordPress TEC) HTTP ${res.status}`);
    const body = await res.json() as TecPage;
    if (!Array.isArray(body.events)) throw new Error(`${feed.name} (WordPress TEC) response shape changed`);
    if (page === 1) expectedPages = Math.max(1, Number(body.total_pages) || 1);
    for (const e of body.events) { const m = mapTecEvent(e, area, feed); if (m && m.start <= to && (m.end ?? m.start) >= now) out.push(m); }
    if (body.events.length < PAGE_SIZE) break;
  }
  return out;
}

/** `?ical=1` fallback: the plugin's iCalendar export, through the shared parser. */
export async function fetchWordPressTecIcal(area: LaunchArea, feed: WordPressTecFeed, fetchImpl: typeof fetch = fetch, now = new Date(), restStatus?: number): Promise<NormalizedEvent[]> {
  const res = await fetchImpl(tecIcalUrl(feed.siteUrl), { headers: { Accept: "text/calendar", "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${feed.name} (WordPress TEC) REST ${restStatus ?? "unavailable"} and ?ical=1 HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error(`${feed.name} (WordPress TEC) ?ical=1 did not return an iCalendar document`);
  const events = parseIcs(text, { defaultTimeZone: area.timeZone, horizonEnd: new Date(now.getTime() + HORIZON_DAYS * 86_400_000), notBefore: now });
  return events.map((e) => mapIcsEvent(e, area, { name: feed.name, url: tecIcalUrl(feed.siteUrl), tags: feed.tags }, "wordpress-tec")).filter((e): e is NormalizedEvent => e !== null);
}
