/**
 * schema.org Event JSON-LD (W4.5).
 *
 * Many venue and organization sites publish no feed but mark every event page
 * up with <script type="application/ld+json"> {"@type": "Event", ...} for
 * search engines. That is structured data the site publishes for machines, so
 * it passes the machine-readable rule. Pages are found through sitemap.xml
 * (and sitemap indexes), bounded per host, and only URLs that look like event
 * pages are fetched.
 *
 * Fails loudly: a sitemap that cannot be read, or event pages that yield no
 * Event objects at all, throw. Pages that simply carry no Event are skipped.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, classify, formatLocalTime } from "../normalize.js";
import { isInsideArea } from "../areas.js";

export interface JsonLdFeed {
  name: string;
  /** Site origin, e.g. "https://www.example.org". */
  siteUrl: string;
  /** Sitemap URL; defaults to <siteUrl>/sitemap.xml. */
  sitemapUrl?: string;
  /** Fetch at most this many event pages per run (default 60). */
  maxPages?: number;
  tags?: string[];
}

const HORIZON_DAYS = 60;
const DEFAULT_MAX_PAGES = 60;
const MAX_SITEMAP_URLS = 5_000;
const UA = "Verdure-ingest/1.0 (+https://verdure-app.com)";
const EVENT_URL = /\/(events?|calendar|whats-on|happenings|programs?|shows?|performances?|exhibitions?)\b[^?#]*[a-z0-9]/i;

export interface LdPlace { "@type"?: string; name?: string; address?: string | { streetAddress?: string; addressLocality?: string; addressRegion?: string }; geo?: { latitude?: number | string; longitude?: number | string }; url?: string }
export interface LdEvent {
  "@type"?: string | string[]; "@id"?: string; name?: string; description?: string; url?: string; image?: string | string[] | { url?: string };
  startDate?: string; endDate?: string; eventStatus?: string; eventAttendanceMode?: string; location?: LdPlace | LdPlace[] | { "@type"?: string; url?: string };
  organizer?: { name?: string } | Array<{ name?: string }>; offers?: { price?: number | string; lowPrice?: number | string } | Array<{ price?: number | string; lowPrice?: number | string }>;
  typicalAgeRange?: string; keywords?: string | string[];
}

/** Every JSON-LD object in a page whose @type is (or includes) Event or a subtype. */
export function extractEvents(html: string): LdEvent[] {
  const out: LdEvent[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (types.some((t) => /Event$/.test(t))) out.push(o as LdEvent);
    for (const k of ["@graph", "mainEntity", "itemListElement", "item", "subEvent", "hasPart"]) if (o[k] !== undefined) visit(o[k]);
  };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim().replace(/^<!--|-->$/g, "").trim();
    if (!raw) continue;
    try { visit(JSON.parse(raw)); } catch { /* malformed block: skip, other blocks may be fine */ }
  }
  return out;
}

/** <loc> entries of a sitemap or sitemap index (flat list; indexes are followed one level). */
export function sitemapLocs(xml: string): { urls: string[]; sitemaps: string[] } {
  const urls: string[] = [], sitemaps: string[] = [];
  const isIndex = /<sitemapindex\b/i.test(xml);
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) (isIndex ? sitemaps : urls).push(m[1].trim());
  return { urls: urls.slice(0, MAX_SITEMAP_URLS), sitemaps: sitemaps.slice(0, 50) };
}

const parseDate = (s?: string) => { if (!s) return undefined; const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d; };
const first = <T,>(v: T | T[] | undefined): T | undefined => Array.isArray(v) ? v[0] : v;

export function mapJsonLdEvent(e: LdEvent, pageUrl: string, area: LaunchArea, feed: JsonLdFeed): NormalizedEvent | null {
  const title = cleanText(e.name, 120);
  const start = parseDate(e.startDate);
  if (!title || !start) return null;
  const loc = first(e.location as LdPlace | LdPlace[] | undefined);
  const online = /OnlineEventAttendanceMode/.test(e.eventAttendanceMode ?? "") || (loc && /VirtualLocation/.test(String(loc["@type"] ?? "")));
  const lat = Number(loc?.geo?.latitude), lng = Number(loc?.geo?.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  if (hasCoords && !isInsideArea(area, lat, lng)) return null;
  const address = typeof loc?.address === "string" ? loc.address : [loc?.address?.streetAddress, loc?.address?.addressLocality].filter(Boolean).join(", ");
  const offer = first(e.offers as { price?: number | string; lowPrice?: number | string } | Array<{ price?: number | string; lowPrice?: number | string }> | undefined);
  const price = offer ? Number(offer.lowPrice ?? offer.price) : NaN;
  const description = cleanText(String(e.description ?? "").replace(/<[^>]+>/g, " "), 600);
  const keywords = ([] as string[]).concat(e.keywords ?? []).flatMap((k) => String(k).split(",")).map((k) => cleanText(k, 40)).filter(Boolean);
  const image = typeof e.image === "string" ? e.image : Array.isArray(e.image) ? e.image[0] : e.image?.url;
  const ageMatch = /^(\d{1,2})\s*[-–]\s*(\d{1,3})$|^(\d{1,2})\+?$/.exec(String(e.typicalAgeRange ?? "").trim());
  const audiences = ageMatch ? [`Ages ${String(e.typicalAgeRange).trim()}`] : undefined;
  return {
    source: "jsonld",
    sourceEventId: cleanText(e["@id"] ?? e.url ?? pageUrl, 200) + (e.startDate ? `@${start.toISOString().slice(0, 16)}` : ""),
    areaId: area.id,
    status: /EventCancelled/.test(e.eventStatus ?? "") ? "cancelled" : /EventPostponed|EventRescheduled/.test(e.eventStatus ?? "") ? "postponed" : "scheduled",
    virtual: online ? true : undefined,
    title, description,
    organizer: cleanText(first(e.organizer as { name?: string } | Array<{ name?: string }> | undefined)?.name ?? feed.name, 80) || feed.name,
    start, end: parseDate(e.endDate),
    time: formatLocalTime(start, area.timeZone, /^\d{4}-\d{2}-\d{2}$/.test(String(e.startDate))),
    locationName: cleanText(online ? "Online" : [loc?.name, address].filter(Boolean).join(", "), 100) || feed.name,
    latitude: hasCoords ? lat : undefined, longitude: hasCoords ? lng : undefined,
    category: classify(`${title} ${keywords.join(" ")} ${description.slice(0, 300)}`),
    isFree: Number.isFinite(price) ? price === 0 : undefined,
    priceMin: Number.isFinite(price) && price > 0 ? price : undefined,
    website: cleanUrl(e.url) ?? cleanUrl(pageUrl),
    imageURL: cleanUrl(image),
    tags: [...(feed.tags ?? []), ...keywords].slice(0, 12),
    audiences,
  };
}

export async function fetchJsonLd(area: LaunchArea, feed: JsonLdFeed, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<NormalizedEvent[]> {
  const sitemapUrl = feed.sitemapUrl ?? `${feed.siteUrl.replace(/\/$/, "")}/sitemap.xml`;
  const get = async (url: string, accept: string) => fetchImpl(url, { headers: { Accept: accept, "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  const res = await get(sitemapUrl, "application/xml,text/xml");
  if (!res.ok) throw new Error(`${feed.name} (JSON-LD) sitemap HTTP ${res.status}`);
  let { urls, sitemaps } = sitemapLocs(await res.text());
  for (const sm of sitemaps.filter((u) => EVENT_URL.test(u) || /event/i.test(u)).slice(0, 5)) {
    const r = await get(sm, "application/xml,text/xml");
    if (r.ok) urls = urls.concat(sitemapLocs(await r.text()).urls);
  }
  const host = new URL(feed.siteUrl).hostname.replace(/^www\./, "");
  const pages = [...new Set(urls)].filter((u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === host && EVENT_URL.test(x.pathname); } catch { return false; } })
    .slice(0, feed.maxPages ?? DEFAULT_MAX_PAGES);
  if (!pages.length) throw new Error(`${feed.name} (JSON-LD) sitemap lists no event pages`);
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const out: NormalizedEvent[] = [];
  let pagesWithEvents = 0;
  for (const url of pages) {
    const r = await get(url, "text/html");
    if (!r.ok) continue;
    const events = extractEvents(await r.text());
    if (events.length) pagesWithEvents++;
    for (const e of events) { const m = mapJsonLdEvent(e, url, area, feed); if (m && m.start <= horizon && (m.end ?? m.start) >= now) out.push(m); }
  }
  if (pagesWithEvents === 0) throw new Error(`${feed.name} (JSON-LD) ${pages.length} event pages carried no schema.org Event`);
  return out;
}
