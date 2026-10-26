/**
 * National Park Service Events API — free, uncapped, on-brand; thin for an
 * urban launch area, so a secondary source.
 *
 * Verified 2026-09-06 for parkCode=cuva: 39 events, fields `title`,
 * `datestart`, `dates[]` (every occurrence of a recurring event), `times[0]
 * .{timestart,timeend}` ("09:00 AM"), `location`, `latitude`/`longitude`
 * (strings, often empty), `isfree` ("true"), `infourl`, `category`, `tags[]`,
 * `description` (HTML), `isallday`.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, cleanCoord, classify, formatLocalTime, zonedToUtc } from "../normalize.js";

const HORIZON_DAYS = 60;

interface NpsEvent {
  id: string; title: string; description?: string; location?: string;
  latitude?: string; longitude?: string; isfree?: string | boolean; isallday?: string | boolean;
  infourl?: string; regresurl?: string; category?: string; tags?: string[]; types?: string[];
  datestart?: string; dates?: string[];
  times?: { timestart?: string; timeend?: string }[];
  parkfullname?: string; organizationname?: string;
  images?: { url?: string }[];
}

export async function fetchNps(area: LaunchArea, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedEvent[]> {
  if (!apiKey) throw new Error("NPS_API_KEY not configured");
  const out: NormalizedEvent[] = [];
  for (const parkCode of (area as LaunchArea & { nps?: { parkCodes: string[] } }).nps?.parkCodes ?? []) {
    const q = new URLSearchParams({ parkCode, pageSize: "100", api_key: apiKey });
    const res = await fetchImpl(`https://developer.nps.gov/api/v1/events?${q}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`NPS HTTP ${res.status} (${parkCode})`);
    const body = await res.json() as { data?: NpsEvent[] };
    for (const e of body.data ?? []) out.push(...mapNps(e, area));
  }
  return out;
}

function parseClock(s: string | undefined): { hh: number; mm: number } | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(s.trim());
  if (!m) return null;
  let hh = Number(m[1]); const mm = Number(m[2]);
  const ap = (m[3] ?? "").toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return { hh, mm };
}

/** One record per listed date within the horizon. */
export function mapNps(e: NpsEvent, area: LaunchArea): NormalizedEvent[] {
  if (!e?.id || !e.title) return [];
  const title = cleanText(e.title, 120);
  const dates = (e.dates && e.dates.length ? e.dates : [e.datestart]).filter((d): d is string => !!d);
  const allDay = String(e.isallday) === "true";
  const clock = parseClock(e.times?.[0]?.timestart);
  const horizon = Date.now() + HORIZON_DAYS * 86_400_000;
  const text = `${title} ${e.category ?? ""} ${(e.tags ?? []).join(" ")} ${(e.types ?? []).join(" ")}`;
  const organizer = cleanText(e.parkfullname || e.organizationname || "National Park Service", 80);
  const out: NormalizedEvent[] = [];
  for (const d of dates.slice(0, 40)) {
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) continue;
    const start = zonedToUtc({ y, m, d: day, hh: allDay || !clock ? 0 : clock.hh, mm: allDay || !clock ? 0 : clock.mm, ss: 0 }, area.timeZone);
    if (start.getTime() < Date.now() - 86_400_000 || start.getTime() > horizon) continue;
    out.push({
      source: "nps",
      sourceEventId: `${e.id}:${d}`,
      areaId: area.id,
      title,
      description: cleanText(e.description, 600),
      organizer,
      start,
      time: formatLocalTime(start, area.timeZone, allDay || !clock),
      locationName: cleanText(e.location || e.parkfullname || "National Park", 100),
      latitude: cleanCoord(e.latitude, 90),
      longitude: cleanCoord(e.longitude, 180),
      category: /volunteer|stewardship|service/i.test(text) ? "Volunteer" : classify(text),
      isFree: String(e.isfree) === "true" ? true : String(e.isfree) === "false" ? false : undefined,
      website: cleanUrl(e.infourl || e.regresurl),
      imageURL: cleanUrl(e.images?.[0]?.url),
      tags: [e.category, ...(e.tags ?? [])].filter((t): t is string => !!t).map((t) => cleanText(t, 40)).slice(0, 8),
    });
  }
  return out;
}
