/**
 * RSS + per-event iCalendar (W4.5 / W4.4 proof host).
 *
 * Some WordPress event sites (uConnect career centres among them, e.g.
 * careercenter.sjsu.edu) publish no Events-Calendar REST route and no site
 * iCal, but they do publish:
 *   • an RSS feed of event pages at /events/feed/ (paged with ?paged=N), and
 *   • a per-event iCalendar export at <event page URL minus trailing slash>.ics/
 *
 * Both are feeds the site publishes for machines (the RSS is advertised with
 * a <link rel="alternate" type="application/rss+xml">, the .ics is the page's
 * own "Add to calendar" export), so the source passes the machine-readable
 * rule without parsing any HTML. The RSS gives the page list; the iCal gives
 * the real start/end/location; nothing is inferred from markup.
 *
 * Fails loudly like midpen.ts: a non-RSS body, an HTTP error on page 1 or an
 * iCal export that is not an iCalendar document throws. Pages beyond the first
 * that answer 404 end the feed (that is how WordPress signals the last page).
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { parseIcs } from "../ics.js";
import { mapIcsEvent } from "./icsfeed.js";
import { cleanText } from "../normalize.js";

export interface RssIcsFeed {
  name: string;
  /** The RSS feed URL, e.g. "https://careercenter.sjsu.edu/events/feed/". */
  feedUrl: string;
  /** Fetch at most this many RSS pages (default 6 ≈ 60 items). */
  maxPages?: number;
  tags?: string[];
}

const HORIZON_DAYS = 60;
const DEFAULT_MAX_PAGES = 6;
const UA = "Verdure-ingest/1.0 (+https://verdure-app.com)";

export interface RssItem { title: string; link: string; guid: string; description: string }

/** Items of an RSS 2.0 document (title, link, guid, description); throws when the body is not RSS. */
export function parseRssItems(xml: string): RssItem[] {
  if (!/<rss\b/i.test(xml.slice(0, 2000)) && !/<feed\b/i.test(xml.slice(0, 2000))) throw new Error("not an RSS document");
  const unwrap = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
  const field = (block: string, name: string) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(block); return m ? unwrap(m[1]) : ""; };
  const out: RssItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const block = m[2];
    const link = field(block, "link") || /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] || "";
    out.push({ title: cleanText(field(block, "title"), 200), link: link.trim(), guid: field(block, "guid") || link.trim(), description: field(block, "description") });
  }
  return out;
}

/** "https://host/events/2026/10/20/slug/" → "https://host/events/2026/10/20/slug.ics/" */
export const icsUrlForPage = (pageUrl: string): string => pageUrl.replace(/\/+$/, "") + ".ics/";

export const rssPageUrl = (feedUrl: string, page: number): string => page === 1 ? feedUrl : `${feedUrl}${feedUrl.includes("?") ? "&" : "?"}paged=${page}`;

export async function fetchRssIcs(area: LaunchArea, feed: RssIcsFeed, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<NormalizedEvent[]> {
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const maxPages = feed.maxPages ?? DEFAULT_MAX_PAGES;
  const get = (url: string, accept: string, timeout: number) => fetchImpl(url, { headers: { Accept: accept, "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
  const items: RssItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await get(rssPageUrl(feed.feedUrl, page), "application/rss+xml, application/xml, text/xml", 20_000);
    if (page > 1 && res.status === 404) break;                       // WordPress: past the last page
    if (!res.ok) throw new Error(`${feed.name} (RSS) HTTP ${res.status} on page ${page}`);
    const text = await res.text();
    let pageItems: RssItem[];
    try { pageItems = parseRssItems(text); } catch { throw new Error(`${feed.name} (RSS) page ${page} did not return an RSS document`); }
    if (!pageItems.length) break;
    items.push(...pageItems);
    if (pageItems.length < 10) break;
  }
  if (!items.length) throw new Error(`${feed.name} (RSS) feed lists no items`);
  const out: NormalizedEvent[] = [];
  let calendars = 0;
  const seen = new Set<string>();
  for (const item of items) {
    if (!/^https?:\/\//.test(item.link) || seen.has(item.link)) continue;
    seen.add(item.link);
    // The link encodes the date (/events/YYYY/MM/DD/slug/); skip pages already outside the horizon without a request.
    const dated = /\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(item.link);
    if (dated) {
      const day = Date.UTC(Number(dated[1]), Number(dated[2]) - 1, Number(dated[3]));
      if (day < now.getTime() - 2 * 86_400_000 || day > horizonEnd.getTime()) continue;
    }
    const res = await get(icsUrlForPage(item.link), "text/calendar", 20_000);
    if (!res.ok) continue;                                           // a page without an export is skipped, not fatal
    const ics = await res.text();
    if (!ics.includes("BEGIN:VCALENDAR")) continue;
    calendars++;
    const events = parseIcs(ics, { defaultTimeZone: area.timeZone, horizonEnd, notBefore: now });
    for (const e of events) {
      const mapped = mapIcsEvent({ ...e, url: e.url ?? item.link }, area, { name: feed.name, url: feed.feedUrl, tags: feed.tags }, "rss-ics");
      if (mapped) out.push({ ...mapped, website: mapped.website ?? item.link });
    }
  }
  if (calendars === 0) throw new Error(`${feed.name} (RSS) ${items.length} items carried no iCalendar export`);
  return out;
}
