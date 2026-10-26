/**
 * Localist API v2 — city and university calendars.
 *
 * Verified 2026-09-06 against events.tri-c.edu: `/api/2/events?near=&within=
 * &units=mi&days=&pp=&page=` returns `{ events: [{ event: {...} }], page: {
 * total, current, size } }` with `event_instances[0].event_instance.start`
 * (ISO with offset), `geo.{latitude,longitude}` (strings), `free`,
 * `ticket_cost`, `localist_url`, `filters.event_types[]`, `description_text`.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, cleanCoord, classify, formatLocalTime } from "../normalize.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const DAYS = 60;

interface LocalistEvent {
  id: number | string; title: string; description_text?: string; description?: string;
  location_name?: string; location?: string; address?: string; room_number?: string;
  localist_url?: string; url?: string; free?: boolean; ticket_cost?: string; ticket_url?: string;
  photo_url?: string; geo?: { latitude?: string; longitude?: string };
  event_instances?: { event_instance: { start: string; end?: string | null; all_day?: boolean } }[];
  filters?: Record<string, { name: string }[]>;
  keywords?: string[]; tags?: string[];
}

export async function fetchLocalist(area: LaunchArea, host: string, name: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedEvent[]> {
  const out: NormalizedEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      days: String(DAYS), pp: String(PAGE_SIZE), page: String(page),
      near: `${area.center.lat},${area.center.lng}`, within: String(area.radiusMiles), units: "mi",
    });
    const res = await fetchImpl(`https://${host}/api/2/events?${q}`, {
      headers: { Accept: "application/json", "User-Agent": "Verdure-ingest/1.0 (+https://verdure-app.com)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${name} (Localist) HTTP ${res.status}`);
    const body = await res.json() as { events?: { event: LocalistEvent }[]; page?: { total?: number; size?: number } };
    const wrappers = body.events ?? [];
    for (const w of wrappers) {
      const mapped = mapLocalist(w.event, area, host, name);
      if (mapped) out.push(...mapped);
    }
    const total = body.page?.total ?? 0;
    if (page * PAGE_SIZE >= total || wrappers.length === 0) break;
  }
  return out;
}

/** One record per instance (Localist repeats a recurring event as instances). */
export function mapLocalist(e: LocalistEvent, area: LaunchArea, host: string, name: string): NormalizedEvent[] | null {
  if (!e?.id || !e.title) return null;
  const instances = (e.event_instances ?? []).slice(0, 30);
  if (!instances.length) return null;
  const title = cleanText(e.title, 120);
  const desc = cleanText(e.description_text || e.description || "", 600);
  const types = Object.values(e.filters ?? {}).flat().map((f) => f.name);
  const eventTypes = (e.filters?.event_types ?? []).map((f) => cleanText(f.name, 80)).filter(Boolean).slice(0, 32);
  const audiences = Object.entries(e.filters ?? {}).filter(([key]) => /audience/i.test(key))
    .flatMap(([, values]) => values.map((f) => cleanText(f.name, 80))).filter(Boolean).slice(0, 32);
  const text = `${title} ${types.join(" ")} ${desc.slice(0, 300)}`;
  const cost = cleanText(e.ticket_cost, 40);
  const priceMatch = /\$\s?(\d+(\.\d{2})?)/.exec(cost);
  const isFree = e.free === true || /^free$/i.test(cost) ? true
    : priceMatch ? false : undefined;

  const out: NormalizedEvent[] = [];
  for (const { event_instance: inst } of instances) {
    const start = new Date(inst.start);
    if (Number.isNaN(start.getTime())) continue;
    out.push({
      source: "localist",
      sourceEventId: `${host}:${e.id}:${inst.start}`,
      areaId: area.id,
      title,
      description: desc,
      organizer: cleanText(name, 80),
      start,
      end: inst.end ? new Date(inst.end) : undefined,
      time: formatLocalTime(start, area.timeZone, inst.all_day === true),
      locationName: cleanText([e.location_name || e.location, e.room_number].filter(Boolean).join(" · ") || name, 100),
      latitude: cleanCoord(e.geo?.latitude, 90),
      longitude: cleanCoord(e.geo?.longitude, 180),
      category: classify(text),
      eventTypes,
      audiences,
      isFree,
      priceMin: priceMatch ? Number(priceMatch[1]) : undefined,
      website: cleanUrl(e.localist_url || e.url),
      imageURL: cleanUrl(e.photo_url),
      tags: [...new Set([...eventTypes, ...types.map((t) => cleanText(t, 40))])].slice(0, 8),
    });
  }
  return out;
}
