/**
 * One schema for every event source.
 *
 * Every fetcher (Ticketmaster, LibCal/.ics, Localist, NPS, SerpApi, organizer
 * accounts) produces `NormalizedEvent`s and nothing else. The store never sees
 * a vendor payload, so dedupe, staleness and the client all reason about one
 * shape. Field names match what the iOS `Event` model and the Firestore rules
 * already expect for community events, plus the provenance fields.
 */

export type SourceId =
  | "ticketmaster"
  | "libcal"
  | "bibliocommons"
  | "midpen"
  | "localist"
  | "livewhale"
  | "legistar"
  | "nps"
  | "ics"
  | "serpapi"
  /** W4.5: WordPress "The Events Calendar" REST API (with ?ical=1 fallback). */
  | "wordpress-tec"
  /** W4.5: schema.org Event JSON-LD on sitemap-listed event pages. */
  | "jsonld"
  /** W4.5: an RSS feed of event pages whose items each link a per-event iCalendar export (WordPress/uConnect). */
  | "rss-ics"
  | "organizer"
  | "community";

/** Mirrors EventCategory in the iOS app and CATEGORY_MAX_POINTS on the server. */
export type EventCategory =
  | "Cleanup" | "Sports" | "Social" | "Workshop" | "Market"
  | "Festival" | "Hackathon" | "Meetup" | "Volunteer" | "Program";

export interface NormalizedEvent {
  /** Which feed produced this record. */
  source: SourceId;
  /** The feed's own id for the event (stable across cycles). */
  sourceEventId: string;
  /** Launch area the record was ingested for. */
  areaId: string;

  title: string;
  description: string;
  organizer: string;
  /** Start, UTC. */
  start: Date;
  /** End, UTC, when the feed says. */
  end?: Date;
  /** Human time string for the card, e.g. "7:00 PM" or "All day". */
  time: string;
  locationName: string;
  latitude?: number;
  longitude?: number;
  category: EventCategory;
  /** Tri-state: true/free, false/paid, absent/unknown. */
  isFree?: boolean;
  /** Lowest listed price in USD, when known. */
  priceMin?: number;
  website?: string;
  imageURL?: string;
  /** Feed-provided tags, kept for search + the Volunteering category. */
  tags: string[];
  /** Activity metadata kept separate from audiences/topics and search tag caps. */
  eventTypes?: string[];
  audiences?: string[];
  /** John's Event.status, when the feed says (Ticketmaster dates.status.code, iCal STATUS). "postponed" is NOT blocking. */
  status?: "scheduled" | "cancelled" | "postponed";
  /** John's format == "online", when the feed says so structurally. */
  virtual?: boolean;
}

/** What one ingest run did, per source. */
export interface IngestResult {
  source: SourceId;
  areaId: string;
  fetched: number;
  created: number;
  updated: number;
  merged: number;
  /** Cross-source merges divided by new unique candidates in this cycle. */
  mergeRate: number;
  /** Heuristic audit of active documents that still look duplicated. */
  suspectedDuplicates: number;
  suspectedDuplicateRate: number;
  markedStale: number;
  deactivated: number;
  skipped: number;
  /** W1.4: sightings that needed no write (unchanged hash, missedCycles 0, lastSeenAt fresh). */
  unchanged: number;
  /** W1.3: merges found only by John's fuzzy rule. */
  fuzzyMerged: number;
  /** W1.2: listings that failed a blocking rule, written to /rejectedListings. */
  rejected: number;
  rejectedByReason: Record<string, number>;
  /** Document writes this run issued (upsertBatch + markStale), the number the free-tier budget is measured in. */
  writes: number;
  /** W4.4: feeds of this type that answered 304 Not Modified — a successful run that read nothing new. */
  notModified: number;
  errors: string[];
  durationMs: number;
}

/** Points ceiling per category — mirrors CATEGORY_MAX_POINTS in index.ts. */
export const CATEGORY_POINTS: Record<EventCategory, number> = {
  Cleanup: 200, Sports: 150, Social: 100, Workshop: 150, Market: 75,
  Festival: 250, Hackathon: 200, Meetup: 100, Volunteer: 200, Program: 100,
};

/** SF Symbol per category — mirrors EventCategory.icon in the app. */
export const CATEGORY_ICON: Record<EventCategory, string> = {
  Cleanup: "sparkles", Sports: "figure.run", Social: "cup.and.saucer.fill",
  Workshop: "hammer.fill", Market: "bag.fill", Festival: "party.popper.fill",
  Hackathon: "laptopcomputer", Meetup: "person.3.fill", Volunteer: "heart.fill", Program: "graduationcap.fill",
};
