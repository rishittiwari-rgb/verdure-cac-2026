/**
 * SerpApi Google Events — Tier 2 gap-filler, server-side only, quota-capped.
 *
 * WHY DEMOTED. This is Google's own index. Three of five interviewees declined
 * to pay because they could "get the same result from Google", which is exactly
 * true while this is the primary source. It stays as a small fraction of the
 * corpus for coverage gaps, and every call is counted in /treasury so the free
 * tier (100 searches/month for the whole app) can never be exceeded by a
 * schedule that fires more often than expected. At the cap, ingestion simply
 * skips this source: previously ingested events remain, nothing is invented.
 *
 * The key lives ONLY in a function secret. It shipped in the app bundle before
 * this change — see Part 2 §1 — and must be rotated.
 */

import type { LaunchArea } from "../areas.js";
import type { NormalizedEvent } from "../types.js";
import { cleanText, cleanUrl, classify, formatLocalTime, stableHash, zonedToUtc } from "../normalize.js";

/** Hard monthly ceiling — 10 below the free tier so a manual re-run never trips it. */
export const SERPAPI_MONTHLY_CAP = 90;

interface SerpEvent {
  title: string;
  date?: { start_date?: string; when?: string };
  address?: string[];
  link?: string;
  description?: string;
  venue?: { name?: string; link?: string };
  thumbnail?: string;
  ticket_info?: { source?: string; link?: string; link_type?: string }[];
  event_location_map?: { link?: string };
}

/** Pure check used by the scheduler: may we spend one more call this month? */
export function serpApiBudgetAllows(callsThisMonth: number): boolean {
  return callsThisMonth < SERPAPI_MONTHLY_CAP;
}

export async function fetchSerpApi(area: LaunchArea, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<NormalizedEvent[]> {
  if (!apiKey) throw new Error("SERPAPI_KEY not configured");
  const q = new URLSearchParams({ engine: "google_events", q: (area as LaunchArea & { serpapi?: { query: string } }).serpapi?.query ?? `events in ${area.name}`, api_key: apiKey, hl: "en", gl: "us" });
  const res = await fetchImpl(`https://serpapi.com/search.json?${q}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const body = await res.json() as { events_results?: SerpEvent[] };
  return (body.events_results ?? []).map((e) => mapSerp(e, area)).filter((e): e is NormalizedEvent => e !== null);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Sat, Sep 12, 7 – 9 PM" / "Sep 12" / "Sep 12, 2026" — best effort, local zone. */
export function parseSerpDate(d: SerpEvent["date"], timeZone: string, now = new Date()): Date | null {
  if (!d) return null;
  const src = `${d.start_date ?? ""} ${d.when ?? ""}`;
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(src);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
  if (!month) return null;
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3]) : now.getUTCFullYear();
  // Time lives in `when` AFTER the date: "Sat, Sep 12, 7 – 9 PM" or "Sep 12, 7:30 PM".
  // In a range the meridiem often sits only on the END time; the start inherits
  // it unless that would put the start after the end ("11 – 1 PM" → 11 AM).
  const when = d.when ?? "";
  const dateInWhen = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(when);
  const afterDate = dateInWhen ? when.slice(dateInWhen.index + dateInWhen[0].length) : when;
  const range = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:[–—-]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(afterDate);
  const single = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(afterDate);
  let hh = 0, mm = 0;
  if (range) {
    const startH = Number(range[1]);
    const endH = Number(range[4]);
    let mer = (range[3] ?? range[6]).toUpperCase();
    if (!range[3] && mer === "PM" && startH > endH && startH !== 12) mer = "AM";
    hh = startH % 12 + (mer === "PM" ? 12 : 0);
    mm = Number(range[2] ?? 0);
  } else if (single) {
    hh = Number(single[1]) % 12 + (single[3].toUpperCase() === "PM" ? 12 : 0);
    mm = Number(single[2] ?? 0);
  }
  let date = zonedToUtc({ y: year, m: month, d: day, hh, mm, ss: 0 }, timeZone);
  // No year in the string and the date already passed → it's next year's.
  if (!m[3] && date.getTime() < now.getTime() - 86_400_000) {
    year += 1;
    date = zonedToUtc({ y: year, m: month, d: day, hh, mm, ss: 0 }, timeZone);
  }
  return date;
}

/** yyyy-mm-dd as it reads on a wall calendar in the area's timezone. */
function localDateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function mapSerp(e: SerpEvent, area: LaunchArea): NormalizedEvent | null {
  const title = cleanText(e.title, 120);
  if (!title) return null;
  const start = parseSerpDate(e.date, area.timeZone);
  if (!start) return null;
  const tickets = e.ticket_info ?? [];
  const sellsTickets = tickets.some((t) => /tickets?/i.test(t.link_type ?? ""));
  const venue = cleanText(e.venue?.name || e.address?.[0], 100);
  const link = cleanUrl(e.link) ?? cleanUrl(tickets[0]?.link);
  return {
    source: "serpapi",
    // Hash on the LOCAL calendar date, not the UTC one.
    //
    // SerpApi's `when` is optional: the same event can arrive once as
    // "Sat, Sep 20, 6 PM" and once as bare "Sep 20". Both are the same event and
    // must produce the same id. With a UTC date they only do so east of
    // Greenwich-ish — in America/Los_Angeles a 6 PM PDT start is 01:00Z the NEXT
    // day, so the two records hash differently and the event ingests twice.
    // This was invisible while the launch area was America/New_York (where a
    // 6 PM start is still 22:00Z the same day) and surfaced the moment it moved
    // to the West Coast.
    sourceEventId: stableHash(`${title}|${venue}|${localDateKey(start, area.timeZone)}`),
    areaId: area.id,
    title,
    description: cleanText(e.description, 400),
    organizer: venue || "Community",
    start,
    time: cleanText(e.date?.when, 60) || formatLocalTime(start, area.timeZone),
    locationName: venue || "Location TBA",
    category: classify(`${title} ${e.description ?? ""}`),
    isFree: sellsTickets ? false : /\bfree\b/i.test(`${title} ${e.description ?? ""}`) ? true : undefined,
    website: link,
    imageURL: cleanUrl(e.thumbnail),
    tags: ["google-events"],
  };
}
