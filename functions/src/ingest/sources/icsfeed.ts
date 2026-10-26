/**
 * iCal feed sources — LibCal library calendars plus any city / parks /
 * community .ics. One fetcher, one parser, every civic calendar in every
 * future city.
 *
 * Verified 2026-09-06: Cleveland Public Library's LibCal subscription
 * (cpl.libcal.com, cid=8758) returns 500 VEVENTs with SUMMARY, DESCRIPTION,
 * LOCATION ("Branch Name - Room, Library Name"), ORGANIZER;CN=, CATEGORIES,
 * UID "LibCal-8758-<eventId>", URL, and both VALUE=DATE and local DATE-TIME
 * starts (X-WR-TIMEZONE:America/New_York).
 */

import type { IcsFeed, LaunchArea } from "../areas.js";
import type { NormalizedEvent, SourceId } from "../types.js";
import { parseIcs, type IcsEvent } from "../ics.js";
import { cleanText, cleanUrl, classify, formatLocalTime } from "../normalize.js";

const HORIZON_DAYS = 60;

export async function fetchIcsFeed(
  area: LaunchArea, feed: IcsFeed, source: SourceId, fetchImpl: typeof fetch = fetch,
): Promise<NormalizedEvent[]> {
  const res = await fetchImpl(feed.url, {
    headers: { "User-Agent": "Verdure-ingest/1.0 (+https://verdure-app.com)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error(`${feed.name} did not return an iCalendar document`);
  const now = new Date();
  const events = parseIcs(text, {
    defaultTimeZone: area.timeZone,
    horizonEnd: new Date(now.getTime() + HORIZON_DAYS * 86_400_000),
    notBefore: now,
  });
  return events.map((e) => mapIcsEvent(e, area, feed, source)).filter((e): e is NormalizedEvent => e !== null);
}

/** "Main 04 - 4th Floor - ForLit Gallery/Classroom, Main Library - Downtown" → branch first. */
function friendlyLocation(location: string, fallback: string): string {
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return fallback;
  // LibCal puts the library/branch LAST; lead with it so the card reads well.
  const branch = parts[parts.length - 1];
  const room = parts.length > 1 ? parts[0].replace(/^[A-Za-z]+ \d+ - /, "") : "";
  return room && room !== branch ? `${branch} · ${room}` : branch;
}

export function mapIcsEvent(e: IcsEvent, area: LaunchArea, feed: IcsFeed, source: SourceId): NormalizedEvent | null {
  const title = cleanText(e.summary, 120);
  if (!title) return null;
  const location = cleanText(e.location, 200);
  const venue = feed.venues
    ? Object.entries(feed.venues).find(([needle]) => location.includes(needle))?.[1]
    : undefined;
  const text = `${title} ${e.categories.join(" ")} ${e.description.slice(0, 300)}`;
  const sourceEventId = e.recurrenceId ? `${e.uid}@${e.recurrenceId}` : e.uid;

  return {
    source,
    sourceEventId,
    areaId: area.id,
    // iCal STATUS:CANCELLED is John's structured cancellation (port of ical.py); TENTATIVE/CONFIRMED stay scheduled.
    status: e.status === "CANCELLED" ? "cancelled" : "scheduled",
    title,
    description: cleanText(e.description, 600),
    organizer: cleanText(feed.name, 80),
    start: e.start,
    end: e.end,
    time: formatLocalTime(e.start, area.timeZone, e.allDay),
    locationName: cleanText(friendlyLocation(location, feed.name), 100),
    latitude: e.geo?.lat ?? venue?.lat,
    longitude: e.geo?.lng ?? venue?.lng,
    category: classify(text),
    // Public library and civic programming is free unless the feed says otherwise.
    isFree: !/\$\s?\d|ticket(s)? required|admission/i.test(e.description),
    website: cleanUrl(e.url),
    tags: [...(feed.tags ?? []), ...e.categories.map((c) => cleanText(c, 40))].filter(Boolean).slice(0, 8),
  };
}
