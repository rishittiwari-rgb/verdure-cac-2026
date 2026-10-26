/**
 * Springshare LibCal — public library calendars via the LibCal RSS feed.
 *
 * WHY RSS AND NOT THE ICAL SUBSCRIPTION. Verified 2026-09-06 on Cleveland Public
 * Library: `ical_subscribe.php?cid=8758` returns a rolling window CAPPED AT 500
 * VEVENTs that starts a month in the past and, for a system this busy, ends
 * before today — every upcoming event is cut off. The RSS feed
 * (`rss.php?m=month&cid=<calendar>`) returns the coming month (300 items for
 * CPL) with structured `libcal:*` fields: date, start/end clock, branch
 * ("campus"), room ("location"), description (HTML), event id, audiences and a
 * featured image. That is the reliable public path, and it is what this file
 * reads. Feeds that publish a working .ics still go through ics.ts.
 *
 * Dependency-free XML extraction: LibCal's RSS is flat and regular, and a full
 * XML parser is another package to audit for six tags.
 */

import type { LaunchArea, LibCalFeed } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, classify, formatLocalTime, zonedToUtc } from "../normalize.js";

export interface LibCalItem {
  eventId: string;
  title: string;
  link?: string;
  date: string;          // yyyy-mm-dd
  start: string;         // HH:mm:ss
  end: string;           // HH:mm:ss
  descriptionHtml: string;
  branch: string;
  room: string;
  audiences: string[];
  image?: string;
  registrations: boolean;
}

const decodeXml = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decodeXml(m[1]).trim() : "";
}
function tags(block: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(decodeXml(m[1]).trim());
  return out.filter(Boolean);
}

/** Parse the whole RSS document into items. */
export function parseLibCalRss(xml: string): LibCalItem[] {
  const items: LibCalItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const eventId = tag(b, "libcal:eventid") || (tag(b, "guid").match(/\/event\/(\d+)/)?.[1] ?? "");
    const title = tag(b, "title");
    const date = tag(b, "libcal:date");
    if (!eventId || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    items.push({
      eventId, title,
      link: tag(b, "link") || undefined,
      date,
      start: tag(b, "libcal:start") || "00:00:00",
      end: tag(b, "libcal:end") || "",
      descriptionHtml: tag(b, "libcal:description") || tag(b, "description"),
      branch: tag(b, "libcal:campus"),
      room: tag(b, "libcal:location"),
      audiences: tags(b, "libcal:audience"),
      image: tag(b, "libcal:feat_image") || undefined,
      registrations: tag(b, "libcal:registrations") === "true",
    });
  }
  return items;
}

export async function fetchLibCal(area: LaunchArea, feed: LibCalFeed, fetchImpl: typeof fetch = fetch): Promise<NormalizedEvent[]> {
  const res = await fetchImpl(feed.rssUrl, {
    headers: { "User-Agent": "Verdure-ingest/1.0 (+https://verdure-app.com)", Accept: "application/rss+xml, application/xml" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<rss[\s>]/i.test(xml)) throw new Error(`${feed.name} did not return RSS`);
  return parseLibCalRss(xml).map((i) => mapLibCalItem(i, area, feed)).filter((e): e is NormalizedEvent => e !== null);
}

export function mapLibCalItem(i: LibCalItem, area: LaunchArea, feed: LibCalFeed): NormalizedEvent | null {
  const title = cleanText(i.title, 120);
  if (!title) return null;
  const [y, m, d] = i.date.split("-").map(Number);
  const [sh, sm, ss] = i.start.split(":").map(Number);
  const allDay = i.start === "00:00:00" && (i.end === "23:59:59" || i.end === "");
  const start = zonedToUtc({ y, m, d, hh: allDay ? 0 : sh || 0, mm: allDay ? 0 : sm || 0, ss: allDay ? 0 : ss || 0 }, area.timeZone);
  if (Number.isNaN(start.getTime())) return null;
  let end: Date | undefined;
  if (!allDay && /^\d{2}:\d{2}:\d{2}$/.test(i.end)) {
    const [eh, em, es] = i.end.split(":").map(Number);
    end = zonedToUtc({ y, m, d, hh: eh, mm: em, ss: es }, area.timeZone);
  }
  const description = cleanText(i.descriptionHtml, 600);
  const venue = feed.venues ? Object.entries(feed.venues).find(([needle]) => i.branch.includes(needle))?.[1] : undefined;
  const location = [cleanText(i.branch, 60), cleanText(i.room, 60)].filter(Boolean).join(" · ") || feed.name;
  const text = `${title} ${i.audiences.join(" ")} ${description.slice(0, 300)}`;
  return {
    source: "libcal",
    sourceEventId: `${feed.calendarId}-${i.eventId}`,
    areaId: area.id,
    title,
    description,
    organizer: cleanText(feed.name, 80),
    start,
    end,
    time: formatLocalTime(start, area.timeZone, allDay),
    locationName: cleanText(location, 100),
    latitude: venue?.lat,
    longitude: venue?.lng,
    category: classify(text),
    audiences: i.audiences.map((a) => cleanText(a, 80)).filter(Boolean).slice(0, 32),
    // Library programming is free unless the copy says otherwise.
    isFree: !/\$\s?\d|ticket(s)? required|admission fee/i.test(description),
    website: cleanUrl(i.link),
    imageURL: cleanUrl(i.image),
    tags: [...(feed.tags ?? []), ...i.audiences.map((a) => cleanText(a, 40))].filter(Boolean).slice(0, 8),
  };
}
