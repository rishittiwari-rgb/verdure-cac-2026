/**
 * Midpeninsula Regional Open Space District — guided hikes and volunteer projects.
 *
 * WHY THIS IS THE OUTDOOR SOURCE NOW. The Cleveland config had Cuyahoga Valley
 * National Park genuinely inside its radius, carrying the outdoor/nature supply.
 * No NPS unit is anywhere near San Jose — the nearest are Golden Gate (~50 mi)
 * and Pinnacles (~80 mi), both of which `isInsideArea` would discard — so
 * `nps.parkCodes` is empty for this area and this replaces it rather than
 * leaving the category thin. Every one of the 19 preserves below geocodes
 * INSIDE the radius, which Cuyahoga Valley was the only NPS unit ever to do.
 *
 * THIS ONE PARSES HTML, AND THAT IS A DELIBERATE, BOUNDED DECISION.
 *
 * Midpen publishes no events feed. Checked live 2026-09-13:
 *   /events/feed, /events/rss.xml, /events.ics, /api/events, /jsonapi → all 404
 *   /rss.xml → 200, but it is a site-wide "recent content" feed: 10 mixed items
 *             (newsletters, road notices), no start times, no locations.
 *
 * So the choice was HTML or nothing. Permission was checked before writing a
 * line of this, and both checks passed:
 *   • robots.txt allows /events (it disallows only /core, /profiles, /node/add,
 *     /comment/reply, /filter/tips, /media/oembed and a few READMEs).
 *   • Their terms page (/terms-use-privacy) contains NO prohibition on
 *     automated access — no mention of scraping, crawling, spiders, robots,
 *     harvesting or data mining. The single "commercial" clause governs
 *     user-submitted comments, not access.
 * This is a public agency publishing public programming on a page robots
 * explicitly permits. Compare Santa Clara County Parks, which is NOT here:
 * sccgov.org returns 403 to every request including robots.txt itself, so
 * their rules cannot even be read, and evading a WAF is not "parsing a public
 * page". They are a recruitment target instead. See docs/FEED-SURVEY-SAN-JOSE.md.
 *
 * IT WILL BREAK, AND IT WILL SAY SO. A feed has a contract; a page does not.
 * When Midpen redesigns, the selectors below stop matching. The failure mode
 * that must never happen is returning zero events quietly, because that reads
 * as "no events this week" and nobody investigates. So `fetchMidpen` THROWS
 * when the page loads but yields no parseable rows — the ingest runner records
 * a source error, existing events are left alone rather than marked stale, and
 * the failure is visible. A thrown error is a bug report; an empty array is a
 * silent outage.
 */

import type { LaunchArea, MidpenFeed } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, classify, formatLocalTime, zonedToUtc } from "../normalize.js";

export interface MidpenItem {
  slug: string;
  kind: string;        // "Guided Activity" | "Volunteer Project"
  title: string;
  dateText: string;    // "Saturday, Sep 12, 2026 6:00 pm"
  activity: string;    // "Hike", "Trail Maintenance", ...
  preserve: string;    // "Monte Bello Preserve"
  miles?: number;
  link: string;
}

/**
 * Preserve coordinates.
 *
 * Every entry was geocoded against OpenStreetMap (Nominatim) on 2026-09-13 and
 * checked to fall inside the launch radius. Keys match the preserve column
 * exactly. A preserve NOT listed here yields an event with no coordinates
 * rather than a guessed one — same rule as every other adapter, so the 500 ft
 * check-in gate stays off instead of surrounding the wrong hillside.
 */
export const MIDPEN_PRESERVES: Record<string, { lat: number; lng: number }> = {
  "Sierra Azul Preserve": { lat: 37.1571, lng: -121.8723 },
  "Skyline Ridge Preserve": { lat: 37.3028, lng: -122.1747 },
  "Bear Creek Redwoods Preserve": { lat: 37.1749, lng: -122.0164 },
  "El Corte de Madera Creek Preserve": { lat: 37.3996, lng: -122.3147 },
  "Rancho San Antonio Preserve": { lat: 37.3353, lng: -122.1189 },
  "Pulgas Ridge Preserve": { lat: 37.4794, lng: -122.2930 },
  "Russian Ridge Preserve": { lat: 37.3215, lng: -122.2293 },
  "Monte Bello Preserve": { lat: 37.3069, lng: -122.1500 },
  "Saratoga Gap Preserve": { lat: 37.2615, lng: -122.1101 },
  "Windy Hill Preserve": { lat: 37.3608, lng: -122.2366 },
  "Purisima Creek Redwoods Preserve": { lat: 37.4297, lng: -122.3372 },
  "Los Trancos Preserve": { lat: 37.3337, lng: -122.1797 },
  "Long Ridge Preserve": { lat: 37.2702, lng: -122.1620 },
  "Thornewood Preserve": { lat: 37.3925, lng: -122.2518 },
  "Picchetti Ranch Preserve": { lat: 37.2879, lng: -122.0845 },
  "Fremont Older Preserve": { lat: 37.2893, lng: -122.0615 },
  "La Honda Creek Preserve": { lat: 37.3529, lng: -122.2771 },
  "Ravenswood Preserve": { lat: 37.4816, lng: -122.1264 },
  "Teague Hill Preserve": { lat: 37.4229, lng: -122.2904 },
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const stripTags = (s: string) =>
  s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ");

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");

const cellText = (s: string) => decode(stripTags(s)).replace(/\s+/g, " ").trim();

/**
 * "Saturday, Sep 12, 2026 6:00 pm" → parts, or null.
 *
 * Returns null rather than guessing on anything it does not recognise; an
 * unparseable date must drop the row, never default to "now".
 */
export function parseMidpenDate(text: string):
  { y: number; m: number; d: number; hh: number; mm: number } | null {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)?/i.exec(text);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  let hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;
  if (m[6]) {
    const pm = m[6].toLowerCase() === "p";
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  return { y: Number(m[3]), m: month, d: Number(m[2]), hh, mm };
}

/**
 * Parse one listing page's Views table.
 *
 * Exported so the tests can run it against a captured fixture with no network,
 * and so a structure change is caught by a unit test rather than in production.
 */
export function parseMidpenListing(htmlText: string): MidpenItem[] {
  const out: MidpenItem[] = [];
  const rows = htmlText.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1]));
    if (cells.length < 5) continue;                       // header / layout rows

    const link = /href="(\/events\/[^"]+)"/i.exec(row)?.[1];
    if (!link) continue;

    const title = cells[1];
    const dateText = cells[2];
    if (!title || !dateText) continue;

    const milesRaw = cells[5] ? Number(cells[5]) : NaN;
    out.push({
      slug: link.split("/").filter(Boolean).pop() ?? link,
      kind: cells[0],
      title,
      dateText,
      // The activity cell carries a leading "Image" from the icon's alt text.
      activity: cells[3].replace(/^Image\s*/i, "").trim(),
      preserve: cells[4],
      miles: Number.isFinite(milesRaw) ? milesRaw : undefined,
      link: `https://www.openspace.org${link}`,
    });
  }
  return out;
}

export function mapMidpenItem(i: MidpenItem, area: LaunchArea, feed: MidpenFeed): NormalizedEvent | null {
  const title = cleanText(i.title, 120);
  if (!title) return null;

  const parts = parseMidpenDate(i.dateText);
  if (!parts) return null;
  const start = zonedToUtc({ y: parts.y, m: parts.m, d: parts.d, hh: parts.hh, mm: parts.mm, ss: 0 }, area.timeZone);
  if (Number.isNaN(start.getTime())) return null;

  const venue = MIDPEN_PRESERVES[i.preserve];
  const location = cleanText(i.preserve, 80) || feed.name;

  // Volunteer projects are volunteering regardless of what the title says; the
  // district's own categorisation is better evidence than keyword matching.
  const isVolunteer = /volunteer/i.test(i.kind);
  const text = `${title} ${i.activity} ${i.kind}`;

  return {
    source: "midpen",
    sourceEventId: i.slug,
    areaId: area.id,
    title,
    description: cleanText(
      [i.activity, i.miles !== undefined ? `About ${i.miles} miles.` : ""].filter(Boolean).join(" · "), 300),
    organizer: cleanText(feed.name, 80),
    start,
    time: formatLocalTime(start, area.timeZone),
    locationName: cleanText(location, 100),
    latitude: venue?.lat,
    longitude: venue?.lng,
    category: isVolunteer ? "Volunteer" : classify(text),
    // Midpen programming is free; registration is required for some activities
    // but no activity on this calendar charges admission.
    isFree: true,
    website: cleanUrl(i.link),
    tags: [...(feed.tags ?? []), cleanText(i.activity, 40)].filter(Boolean).slice(0, 8),
  };
}

/** Listing pages are walked until one comes back empty. The site publishes about four
 * months ahead (116 rows over 8 pages on 2026-10-23); a fixed 4-page walk dropped half of
 * them. The cap only stops a runaway loop if the site ever ignores ?page=. */
export const MIDPEN_PAGE_CAP = 20;

export async function fetchMidpen(
  area: LaunchArea,
  feed: MidpenFeed,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedEvent[]> {
  const out: NormalizedEvent[] = [];
  let rowsSeen = 0;

  for (let page = 0; page < MIDPEN_PAGE_CAP; page++) {
    const res = await fetchImpl(`https://www.openspace.org/events?page=${page}`, {
      headers: { "user-agent": "Verdure/1.0 (events ingest; support@verdure-app.com)" },
    });
    if (!res.ok) {
      if (page === 0) throw new Error(`${feed.name} returned ${res.status}`);
      break;
    }
    const items = parseMidpenListing(await res.text());
    if (items.length === 0) break;
    rowsSeen += items.length;
    for (const i of items) {
      const mapped = mapMidpenItem(i, area, feed);
      if (mapped) out.push(mapped);
    }
  }

  // THE LOUD FAILURE. The page answered 200 and we understood none of it —
  // which is what a redesign looks like. Throwing marks the source as errored
  // and leaves existing events untouched; returning [] would mark them stale
  // and silently drain the outdoor category over three cycles.
  if (rowsSeen === 0) {
    throw new Error(
      `${feed.name}: page loaded but no event rows parsed — the listing markup has probably changed`);
  }
  return out;
}
