/**
 * Today's per-area source configuration, as DATA (W4.1).
 *
 * Until this sprint these entries lived inside `LaunchArea` in areas.ts and
 * ingestion read them straight from code. They are now the SEED for the
 * Firestore /sources collection: `scripts/migrate-sources.mjs` writes one
 * /sources/{id} document per entry below, ingestion reads only /sources
 * documents whose status is "active", and automatic discovery (W4) adds to the
 * same collection. areas.ts keeps the area geometry and the sourcing policy.
 *
 * Every URL and host below was fetched live and returned data on the date
 * noted against it in docs/FEED-SURVEY-SAN-JOSE.md. Nothing here is a
 * permission to parse HTML: the Midpen adapter's own header records that check.
 */

import type { SourceId } from "./types.js";

/** Per-type adapter parameters. Each shape is exactly what the adapter already takes. */
export interface IcsSeed { name: string; url: string; venues?: Record<string, { lat: number; lng: number }>; tags?: string[] }
export interface LibCalSeed { name: string; calendarId: string; rssUrl: string; venues?: Record<string, { lat: number; lng: number }>; tags?: string[] }
export interface BiblioSeed { name: string; library: string; host?: string; requireInAreaCoordinates?: boolean; pageSize?: number; tags?: string[] }
export interface MidpenSeed { name: string; tags?: string[] }
export interface HostSeed { host: string; name: string }
export interface LegistarSeed { client: string; name: string }
export interface TicketmasterSeed { name: string; enabled: boolean }
export interface NpsSeed { name: string; parkCodes: string[] }
export interface SerpApiSeed { name: string; enabled: boolean; query: string }
/** W4.5 — discovered sources only; nothing in SOURCE_SEEDS uses these. */
export interface WordPressTecSeed { name: string; siteUrl: string; tags?: string[] }
export interface JsonLdSeed { name: string; siteUrl: string; sitemapUrl?: string; maxPages?: number; tags?: string[] }
export interface RssIcsSeed { name: string; feedUrl: string; maxPages?: number; tags?: string[] }

export type SourceParams =
  | { type: "ics"; params: IcsSeed }
  | { type: "libcal"; params: LibCalSeed }
  | { type: "bibliocommons"; params: BiblioSeed }
  | { type: "midpen"; params: MidpenSeed }
  | { type: "localist"; params: HostSeed }
  | { type: "livewhale"; params: HostSeed }
  | { type: "legistar"; params: LegistarSeed }
  | { type: "ticketmaster"; params: TicketmasterSeed }
  | { type: "nps"; params: NpsSeed }
  | { type: "serpapi"; params: SerpApiSeed }
  | { type: "wordpress-tec"; params: WordPressTecSeed }
  | { type: "jsonld"; params: JsonLdSeed }
  | { type: "rss-ics"; params: RssIcsSeed };

export type SourceSeed = SourceParams & {
  /** Stable document id in /sources. */
  id: string;
  areaId: string;
  /** The host the feed is read from; the deny-list and robots/terms checks key on it. */
  host: string;
  /** Verification note carried over from areas.ts. */
  verified: string;
};

export const SOURCE_SEEDS: SourceSeed[] = [
  { id: "san-jose-ca_ticketmaster", areaId: "san-jose-ca", type: "ticketmaster", host: "app.ticketmaster.com",
    params: { name: "Ticketmaster Discovery", enabled: true }, verified: "2026-09-13: SAP Center et al." },
  // Mountain View Library's public RSS calendar, distinct from its bookmobile.
  { id: "san-jose-ca_libcal_mountainview-8800", areaId: "san-jose-ca", type: "libcal", host: "mountainview.libcal.com",
    params: { name: "Mountain View Public Library", calendarId: "8800", rssUrl: "https://mountainview.libcal.com/rss.php?m=month&cid=8800", tags: ["library"] },
    verified: "2026-09-26: 64 events" },
  { id: "san-jose-ca_bibliocommons_sjpl", areaId: "san-jose-ca", type: "bibliocommons", host: "sjpl.bibliocommons.com",
    params: { name: "San José Public Library", library: "sjpl", host: "sjpl.bibliocommons.com", tags: ["library"] },
    verified: "2026-09-13: gateway reports 6,477 events; calendar.ics → 404" },
  { id: "san-jose-ca_bibliocommons_sccl", areaId: "san-jose-ca", type: "bibliocommons", host: "sccl.bibliocommons.com",
    // Page 13 at 150 returns HTTP 500; pages of 100 work through the same range.
    params: { name: "Santa Clara County Library District", library: "sccl", host: "sccl.bibliocommons.com", pageSize: 100, tags: ["library"] },
    verified: "2026-09-13: gateway reports 2,106 events" },
  { id: "san-jose-ca_bibliocommons_paloalto", areaId: "san-jose-ca", type: "bibliocommons", host: "paloalto.bibliocommons.com",
    params: { name: "Palo Alto City Library", library: "paloalto", host: "paloalto.bibliocommons.com", tags: ["library"] },
    verified: "2026-09-26: public gateway reports 457 upcoming records" },
  // Fremont, Newark, Centerville and Union City are inside the radius; other Alameda County branches are not.
  { id: "san-jose-ca_bibliocommons_aclibrary", areaId: "san-jose-ca", type: "bibliocommons", host: "aclibrary.bibliocommons.com",
    params: { name: "Alameda County Library", library: "aclibrary", host: "aclibrary.bibliocommons.com", requireInAreaCoordinates: true, tags: ["library"] },
    verified: "2026-09-26: 1,116 records with trusted coordinates inside the radius" },
  // Eastern San Mateo County branches reach the area, western ones do not.
  { id: "san-jose-ca_bibliocommons_smcl", areaId: "san-jose-ca", type: "bibliocommons", host: "smcl.bibliocommons.com",
    params: { name: "San Mateo County Libraries", library: "smcl", host: "smcl.bibliocommons.com", requireInAreaCoordinates: true, tags: ["library"] },
    verified: "2026-09-26: 2,057 records with trusted coordinates inside the radius" },
  { id: "san-jose-ca_localist_events.sjsu.edu", areaId: "san-jose-ca", type: "localist", host: "events.sjsu.edu",
    params: { host: "events.sjsu.edu", name: "San José State University" }, verified: "2026-09-13: /api/2/events returns a full page with geo" },
  // Palo Alto is ~17 mi from centre, inside the radius.
  { id: "san-jose-ca_localist_events.stanford.edu", areaId: "san-jose-ca", type: "localist", host: "events.stanford.edu",
    params: { host: "events.stanford.edu", name: "Stanford University" }, verified: "2026-09-13" },
  // The old Localist probe was a platform mismatch, not proof of no feed.
  { id: "san-jose-ca_livewhale_events.scu.edu", areaId: "san-jose-ca", type: "livewhale", host: "events.scu.edu",
    params: { host: "events.scu.edu", name: "Santa Clara University" }, verified: "2026-09-26: public JSON v2 returns ~520 events/60 days" },
  { id: "san-jose-ca_legistar_sanjose", areaId: "san-jose-ca", type: "legistar", host: "webapi.legistar.com",
    params: { client: "sanjose", name: "City of San José" }, verified: "2026-09-26: 14 public meetings" },
  // 64 events across 22 preserves, 19 of which geocode INSIDE the radius. Replaces NPS for this area.
  { id: "san-jose-ca_midpen", areaId: "san-jose-ca", type: "midpen", host: "www.openspace.org",
    params: { name: "Midpeninsula Regional Open Space District", tags: ["outdoors", "parks"] }, verified: "2026-09-13: robots allow /events; terms contain no prohibition" },
  // No NPS unit sits inside the radius. The adapter stays; the source carries no park codes and fetches nothing.
  { id: "san-jose-ca_nps", areaId: "san-jose-ca", type: "nps", host: "developer.nps.gov",
    params: { name: "National Park Service", parkCodes: [] }, verified: "2026-09-13: no unit inside 25 miles" },
  // SerpApi (Google Events) — gap-filler only, quota-capped in code.
  { id: "san-jose-ca_serpapi", areaId: "san-jose-ca", type: "serpapi", host: "serpapi.com",
    params: { name: "SerpApi Google Events", enabled: true, query: "events in San Jose, CA" }, verified: "quota-capped gap filler" },
];

/** Seeds of one adapter type, optionally for one area. */
export function seedsOfType<T extends SourceId>(type: T, areaId?: string): Array<Extract<SourceSeed, { type: T }>> {
  return SOURCE_SEEDS.filter((s): s is Extract<SourceSeed, { type: T }> => s.type === type && (!areaId || s.areaId === areaId));
}
