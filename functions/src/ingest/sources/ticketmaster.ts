/**
 * Ticketmaster Discovery API v2 — Tier 1, hourly.
 *
 * Verified 2026-09-06 against the live API for Cleveland: 990 events within 25
 * miles; `_embedded.events[]` with `dates.start.localDate/localTime`,
 * `_embedded.venues[0].location.{latitude,longitude}`, `priceRanges[]`,
 * `classifications[0].segment.name`. Free tier: 5,000 calls/day, 5 req/s,
 * size*page ≤ 1,000 — so one area is at most 5 pages of 200 per run.
 *
 * A ticketed concert is a thing to do. We LIST it with its price and a link;
 * we never sell tickets, and `isFree` lets the app filter paid events out.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent, EventCategory } from "../types.js";
import { cleanText, cleanUrl, cleanCoord, classify, formatLocalTime, zonedToUtc } from "../normalize.js";

const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const HORIZON_DAYS = 60;

interface TmEvent {
  id: string; name: string; url?: string; info?: string; pleaseNote?: string;
  images?: { url: string; width?: number; ratio?: string }[];
  dates?: { start?: { localDate?: string; localTime?: string; dateTime?: string }; end?: { dateTime?: string }; timezone?: string; status?: { code?: string } };
  classifications?: { segment?: { name?: string }; genre?: { name?: string }; subGenre?: { name?: string } }[];
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  _embedded?: { venues?: { name?: string; city?: { name?: string }; address?: { line1?: string }; location?: { latitude?: string; longitude?: string }; timezone?: string }[] };
}

/** Segment → our category. Genre/name refine "Miscellaneous". */
function categoryFor(ev: TmEvent): EventCategory {
  const c = ev.classifications?.[0];
  const segment = (c?.segment?.name ?? "").toLowerCase();
  const text = `${ev.name} ${c?.genre?.name ?? ""} ${c?.subGenre?.name ?? ""}`;
  switch (segment) {
    case "music": return "Festival";
    case "sports": return "Sports";
    case "arts & theatre": return "Festival";
    case "film": return "Social";
    default: return classify(text);
  }
}

export async function fetchTicketmaster(area: LaunchArea, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedEvent[]> {
  if (!apiKey) throw new Error("TICKETMASTER_KEY not configured");
  const out: NormalizedEvent[] = [];
  const startISO = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const endISO = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      apikey: apiKey,
      latlong: `${area.center.lat},${area.center.lng}`,
      radius: String(area.radiusMiles), unit: "miles",
      size: String(PAGE_SIZE), page: String(page),
      sort: "date,asc", startDateTime: startISO, endDateTime: endISO,
    });
    const res = await fetchImpl(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new Error("Ticketmaster rate limited (429)");
    if (!res.ok) throw new Error(`Ticketmaster HTTP ${res.status}`);
    const body = await res.json() as { _embedded?: { events?: TmEvent[] }; page?: { totalPages?: number } };
    const events = body._embedded?.events ?? [];
    out.push(...events.map((e) => mapTicketmaster(e, area)).filter((e): e is NormalizedEvent => e !== null));
    if (page + 1 >= (body.page?.totalPages ?? 0)) break;
    // 5 req/s ceiling — a short pause keeps a 5-page run polite.
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

export function mapTicketmaster(e: TmEvent, area: LaunchArea): NormalizedEvent | null {
  if (!e?.id || !e.name) return null;
  const venue = e._embedded?.venues?.[0];
  const tz = e.dates?.timezone || venue?.timezone || area.timeZone;
  let start: Date | null = null;
  if (e.dates?.start?.dateTime) {
    start = new Date(e.dates.start.dateTime);
  } else if (e.dates?.start?.localDate) {
    const [y, m, d] = e.dates.start.localDate.split("-").map(Number);
    const [hh, mm, ss] = (e.dates.start.localTime ?? "19:00:00").split(":").map(Number);
    // Local wall clock in the venue's zone.
    start = zonedToUtc({ y, m, d, hh: hh || 0, mm: mm || 0, ss: ss || 0 }, tz);
  }
  if (!start || Number.isNaN(start.getTime())) return null;

  const prices = (e.priceRanges ?? []).map((p) => p.min).filter((n): n is number => typeof n === "number");
  const priceMin = prices.length ? Math.min(...prices) : undefined;
  const isFree = priceMin === undefined ? undefined : priceMin === 0;
  const image = e.images?.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
  const locationParts = [venue?.name, venue?.city?.name].filter(Boolean).join(", ");

  // Port of ticketmaster.py: "cancelled" if status_code == "cancelled" else "postponed" if in (postponed, rescheduled) else "scheduled".
  const statusCode = String(e.dates?.status?.code ?? "").toLowerCase();
  const status = statusCode === "cancelled" || statusCode === "canceled" ? "cancelled" as const
    : statusCode === "postponed" || statusCode === "rescheduled" ? "postponed" as const : "scheduled" as const;
  return {
    source: "ticketmaster",
    sourceEventId: e.id,
    areaId: area.id,
    status,
    title: cleanText(e.name, 120),
    description: cleanText(e.info || e.pleaseNote || "", 600),
    organizer: cleanText(venue?.name || "Ticketmaster", 80),
    start,
    end: e.dates?.end?.dateTime ? new Date(e.dates.end.dateTime) : undefined,
    time: formatLocalTime(start, area.timeZone, !e.dates?.start?.localTime && !e.dates?.start?.dateTime),
    locationName: cleanText(locationParts || "See listing", 100),
    latitude: cleanCoord(venue?.location?.latitude, 90),
    longitude: cleanCoord(venue?.location?.longitude, 180),
    category: categoryFor(e),
    isFree,
    priceMin,
    website: cleanUrl(e.url),
    imageURL: cleanUrl(image),
    tags: [e.classifications?.[0]?.segment?.name, e.classifications?.[0]?.genre?.name]
      .filter((t): t is string => !!t).map((t) => cleanText(t, 40)),
  };
}
