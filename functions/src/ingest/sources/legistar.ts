/**
 * Legistar's documented public Web API. San José uses it for council and
 * advisory-body meetings, a small civic source independent of the City WAF.
 * Only public, upcoming meetings are indexed; closed sessions and canceled
 * meetings are not invitations to attend.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, formatLocalTime, zonedToUtc } from "../normalize.js";

export interface LegistarEvent {
  EventId?: number;
  EventBodyName?: string | null;
  EventDate?: string | null;
  EventTime?: string | null;
  EventLocation?: string | null;
  EventInSiteURL?: string | null;
  EventAgendaStatusName?: string | null;
  EventComment?: string | null;
}

/** EventDate is a local calendar date at midnight, without a timezone. */
export function mapLegistar(
  item: LegistarEvent, area: LaunchArea, client: string, name: string,
): NormalizedEvent | null {
  if (!Number.isInteger(item.EventId) || !item.EventBodyName || !item.EventDate) return null;
  const body = cleanText(item.EventBodyName, 90);
  if (!body || /closed session/i.test(body) || /cancel(?:led|ed)/i.test(item.EventAgendaStatusName ?? "")) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(item.EventDate);
  const clock = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(item.EventTime?.trim() ?? "");
  if (!date || !clock) return null;
  const hour = Number(clock[1]) % 12 + (clock[3].toUpperCase() === "PM" ? 12 : 0);
  const start = zonedToUtc({ y: Number(date[1]), m: Number(date[2]), d: Number(date[3]),
    hh: hour, mm: Number(clock[2]), ss: 0 }, area.timeZone);
  if (Number.isNaN(start.getTime())) return null;

  // The location can contain a Zoom URL. Show the room name without exposing a
  // long URL in a card; the meeting's official page remains the action link.
  const location = cleanText((item.EventLocation ?? "").split(/https?:\/\//i)[0]
    .replace(/[;,\s-]+$/, ""), 100) || name;
  return {
    source: "legistar",
    sourceEventId: `${client}-${item.EventId}`,
    areaId: area.id,
    title: `${body} public meeting`,
    description: cleanText(item.EventComment, 600) || `Public meeting of the ${body}. Check the official agenda before attending.`,
    organizer: name,
    start,
    time: formatLocalTime(start, area.timeZone),
    locationName: location,
    category: "Meetup",
    isFree: true,
    website: cleanUrl(item.EventInSiteURL),
    tags: ["civic", "public meeting"],
  };
}

export async function fetchLegistar(
  area: LaunchArea, client: string, name: string, fetchImpl: typeof fetch = fetch,
): Promise<NormalizedEvent[]> {
  if (!/^[a-z0-9-]+$/.test(client)) throw new Error("Invalid Legistar client");
  const from = new Date();
  const through = new Date(from.getTime() + 120 * 86_400_000);
  const q = new URLSearchParams({
    "$filter": `EventDate ge datetime'${from.toISOString().slice(0, 10)}' and EventDate le datetime'${through.toISOString().slice(0, 10)}'`,
    "$orderby": "EventDate asc",
    "$top": "500",
  });
  const res = await fetchImpl(`https://webapi.legistar.com/v1/${client}/events?${q}`, {
    headers: { Accept: "application/json", "User-Agent": "Verdure-ingest/1.0 (+https://verdure-app.com)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${name} Legistar HTTP ${res.status}`);
  const payload: unknown = await res.json();
  if (!Array.isArray(payload)) throw new Error(`${name} Legistar response shape changed`);
  if (payload.length === 500) throw new Error(`${name} Legistar hit page cap; paging is required`);
  return payload.map((item) => mapLegistar(item as LegistarEvent, area, client, name))
    .filter((item): item is NormalizedEvent => item !== null);
}
