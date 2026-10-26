/**
 * Launch areas — the ONLY geography we ingest for.
 *
 * Ingestion is scoped to configured areas, never national: every scheduled job
 * loops over this list, and every fetcher receives one area. Adding a city is a
 * config change here plus a verification pass on its feeds.
 *
 * Every URL and host below was fetched live and returned data on the date noted
 * against it. Re-verify before relying on any of them — feeds change silently.
 *
 * ── WHAT WE MAY INGEST FROM ──────────────────────────────────────────────────
 *
 * Parse public feeds and open data freely. Do NOT scrape any source whose terms
 * prohibit it.
 *
 * This supersedes an earlier, stricter rule ("APIs and public feeds only"),
 * which was broader than the facts support and would have cost real supply for
 * no benefit. City calendars, library systems and parks departments are fair
 * game and always were. Where a source publishes a public HTML calendar and no
 * feed, parsing it is acceptable PROVIDED its terms do not forbid automated
 * access — checked per source, before the adapter is written, with the evidence
 * recorded in the adapter's header and in docs/FEED-SURVEY-<area>.md.
 *
 * Two standing exceptions, off-limits regardless of how useful they look:
 *   • Google Maps / Places — prohibited by their terms, AND strategically
 *     self-defeating: the premise of this corpus is events Google does not
 *     have, so seeding it from Google would invalidate coverage-check.mjs
 *     along with the product claim.
 *   • Meetup — prohibited by their terms.
 *
 * A 403 is not a licence to try harder. If a source blocks automated requests
 * outright — especially if it blocks robots.txt itself, so its rules cannot
 * even be read — it is a RECRUITMENT target, not a parsing target. Santa Clara
 * County Parks is the worked example; see the survey doc.
 *
 * Launch area: SAN JOSE / SOUTH BAY, CA.
 *
 * This replaced Cleveland, OH on 2026-09-13. Cleveland was never a decision —
 * it was a placeholder that survived into config. Verdure launches where its
 * operators and first users are, and that is the South Bay.
 *
 * The civic layer is denser here than it was in Cleveland, but it is reached
 * DIFFERENTLY, and that difference cost a new adapter. Surveyed live 2026-09-13
 * (full write-up and every probe in docs/FEED-SURVEY-SAN-JOSE.md):
 *
 *   San José Public Library      BiblioCommons   6,477 events   ✅ sources/bibliocommons.ts
 *   Santa Clara County Library   BiblioCommons   2,106 events   ✅ same adapter
 *   San José State University    Localist          100+/30d     ✅ with coordinates
 *   Stanford University          Localist          100+/30d     ✅ (~17 mi, inside radius)
 *   Ticketmaster Discovery       API                  —         ✅ SAP Center et al.
 *   Santa Clara University       LiveWhale        JSON v2 200   ✅ sources/livewhale.ts
 *   City of San José             Legistar API       14 public meetings (2026-09-26 read)
 *   Mountain View Library        LibCal RSS         64 events (2026-09-26 read)
 *
 * NEITHER library system runs LibCal, and neither publishes iCal — SJPL's
 * /events/calendar.ics is a hard 404. The existing .ics and LibCal adapters
 * could not read either one, which is why sources/bibliocommons.ts exists.
 * Unlike LibCal, BiblioCommons ships branch coordinates in the feed
 * (mapLocation.centrePoint, isGeocoded), so there is no hand-kept venue table
 * below and no branch silently missing coordinates.
 */

/**
 * W4.1 — SOURCES ARE DATA. The per-area feed entries that used to live here
 * (libcal, bibliocommons, midpen, localist, livewhale, legistar, nps, ics,
 * ticketmaster, serpapi) are now documents in Firestore /sources/{id}, seeded
 * from functions/src/ingest/sources-config.ts by scripts/migrate-sources.mjs
 * and extended by automatic discovery (W4). Ingestion reads only sources whose
 * status is "active". This file keeps the area geometry and the policy above.
 * The adapter parameter shapes (IcsFeed, LibCalFeed, …) stay here because the
 * frozen adapters import them.
 */

export interface IcsFeed {
  /** Shown as the organizer when the feed has no ORGANIZER line. */
  name: string;
  url: string;
  /** Known venue coordinates keyed by an exact LOCATION substring. */
  venues?: Record<string, { lat: number; lng: number }>;
  /** Default tags to attach (e.g. "library"). */
  tags?: string[];
}

/** A Springshare LibCal calendar, read through its public RSS feed (see sources/libcal.ts). */
export interface LibCalFeed {
  name: string;
  /** LibCal calendar id (`cid`); prefixes source event ids so systems never collide. */
  calendarId: string;
  /** `https://<inst>.libcal.com/rss.php?m=month&cid=<calendarId>` */
  rssUrl: string;
  /** Known branch coordinates keyed by an exact `libcal:campus` substring. */
  venues?: Record<string, { lat: number; lng: number }>;
  tags?: string[];
}

/**
 * A BiblioCommons library system, read through the public gateway API
 * (see sources/bibliocommons.ts). No venue table: the feed geocodes branches.
 */
export interface BiblioFeed {
  name: string;
  /** Gateway library slug, e.g. "sjpl" — prefixes source ids so systems never collide. */
  library: string;
  /** Public site host, used to build event links. Defaults to `<library>.bibliocommons.com`. */
  host?: string;
  /** For systems extending beyond the launch radius, only keep geolocated in-area events. */
  requireInAreaCoordinates?: boolean;
  /** Lower when a system's gateway fails on large late pages. */
  pageSize?: number;
  tags?: string[];
}

/**
 * Midpeninsula Regional Open Space District. Parsed from their events listing —
 * they publish no feed. See sources/midpen.ts for the permission check that
 * precedes that decision, and docs/FEED-SURVEY-SAN-JOSE.md for the evidence.
 */
export interface MidpenFeed {
  name: string;
  tags?: string[];
}

export interface LaunchArea {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  timeZone: string;
}

export const SAN_JOSE: LaunchArea = {
  id: "san-jose-ca",
  name: "San Jose, CA",
  // Downtown San José (City Hall). 25 miles reaches Palo Alto and Stanford to
  // the north-west, Gilroy to the south, and Fremont across the bay.
  center: { lat: 37.3382, lng: -121.8863 },
  radiusMiles: 25,
  timeZone: "America/Los_Angeles",
};

export const LAUNCH_AREAS: LaunchArea[] = [SAN_JOSE];

export function areaById(id: string | undefined): LaunchArea | undefined {
  return LAUNCH_AREAS.find((a) => a.id === id);
}

const MILE_M = 1609.344;

/** Is a coordinate inside the area's radius (plus a small tolerance)? */
export function isInsideArea(area: LaunchArea, lat: number, lng: number, toleranceMiles = 5): boolean {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - area.center.lat);
  const dLng = toRad(lng - area.center.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(area.center.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(a));
  return d <= (area.radiusMiles + toleranceMiles) * MILE_M;
}
