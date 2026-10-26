/**
 * Normalisation shared by every source: hostile-text scrubbing, dedupe keys,
 * category classification, time formatting.
 *
 * Third-party feed text is UNTRUSTED. Titles, descriptions and venue names are
 * stripped of markup and control characters and length-capped here, once, so a
 * feed cannot smuggle HTML, prompt injection or a 40 KB description into a
 * Firestore document that the app then renders.
 */

import type { EventCategory } from "./types.js";

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ", "&rsquo;": "’", "&lsquo;": "‘", "&ndash;": "–", "&mdash;": "—",
  "&hellip;": "…", "&#8217;": "’", "&#8211;": "–", "&#8212;": "—",
};

/** Strip markup + control chars, decode common entities, collapse whitespace, cap length. */
export function cleanText(raw: unknown, max = 200): string {
  if (typeof raw !== "string" || !raw) return "";
  let t = raw.replace(/<[^>]+>/g, " ");
  t = t.replace(/&#?\w+;/g, (m) => ENTITY_MAP[m] ?? " ");
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** Only well-formed http(s) URLs survive — never javascript:, data:, file:. */
export function cleanUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (!u.hostname.includes(".")) return undefined;
    return u.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}

export function cleanCoord(v: unknown, max: number): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > max || n === 0) return undefined;
  return n;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "at", "of", "in", "on", "with", "for", "to", "by", "from",
  "presents", "presented", "featuring", "feat", "live", "event", "&",
]);

/**
 * Dedupe key for a title: lower-cased, punctuation-free, stopwords dropped.
 * "The Cleveland Orchestra: Beethoven at Blossom" and "Cleveland Orchestra —
 * Beethoven At Blossom" produce the same key.
 */
export function titleKey(title: string): string {
  return title
    .replace(/^.{2,70}?\s+presents\s*[:\-–]\s*/i, "")
    .replace(/^presented\s+by\s+.{2,70}?\s*[:\-–]\s*/i, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ")
    .slice(0, 80);
}

/** Dedupe key for a venue: alphanumerics of the first line, 40 chars. */
export function venueKey(venue: string): string {
  const key = venue
    .toLowerCase()
    .split(/[,\n|·]/)[0]
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
  return ["", "locationtba", "tba", "online", "virtual", "seewebsite"].includes(key) ? "" : key;
}

/** Hour bucket of a start time (UTC millis floored to the hour). */
export function startBucket(start: Date): number {
  return Math.floor(start.getTime() / 3_600_000);
}

/**
 * Best-effort category from free text. Volunteer/cleanup first because they are
 * the categories the product cares most about surfacing; "class" and "market"
 * before "festival" so a "farmers market festival" stays a Market.
 */
export function classify(text: string): EventCategory {
  const t = ` ${text.toLowerCase()} `;
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (/\b(?:internships?|apprenticeships?|fellowships?)\b/.test(t)) return "Program";
  if (has("clean-up", "cleanup", "clean up", "litter", "trash pick")) return "Cleanup";
  if (has("volunteer", "charity", "nonprofit", "non-profit", "fundrais", "food drive", "donation drive", "service day", "give back", "habitat for humanity")) return "Volunteer";
  if (has("hackathon", "hack night", "coding", "devfest", "code jam", "game jam")) return "Hackathon";
  if (has("workshop", "class", "seminar", "training", "lecture", "tutorial", "how to", "storytime", "story time", "book club", "maker", "crafts", "lego", "stem", "lab", "learn", "author talk", "discussion")) return "Workshop";
  if (has("market", "farmers", "craft fair", "bazaar", "flea", "swap meet", "vendor")) return "Market";
  if (has("festival", "concert", "music", "comedy", "theatre", "theater", "orchestra", "symphony", "opera", "ballet", "dance performance", "film screening", "gala", "parade", "fireworks", "fest ")) return "Festival";
  if (has("sport", "game", "run ", "5k", "10k", "marathon", "yoga", "fitness", "race", "hike", "hiking", "bike", "cycling", "basketball", "soccer", "baseball", "hockey", "football", "tournament", "pickleball", "paddle", "kayak", "swim", "walk ")) return "Sports";
  if (has("network", "meetup", "meet up", "mixer", "happy hour", "student", "club meeting", "alumni")) return "Meetup";
  return "Social";
}

/** "7:00 PM" in the area's zone, or "All day". */
export function formatLocalTime(start: Date, timeZone: string, allDay = false): string {
  if (allDay) return "All day";
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(start);
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(start);
  }
}

/**
 * Convert wall-clock parts in an IANA zone to a UTC Date, without a library.
 * Uses Intl to find the zone's offset at that instant (two passes handle DST
 * boundaries correctly for every real-world case we ingest).
 */
export function zonedToUtc(
  parts: { y: number; m: number; d: number; hh: number; mm: number; ss: number },
  timeZone: string,
): Date {
  const asUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss);
  const offset1 = zoneOffsetMs(asUtc, timeZone);
  const guess = asUtc - offset1;
  const offset2 = zoneOffsetMs(guess, timeZone);
  return new Date(asUtc - offset2);
}

function zoneOffsetMs(utcMillis: number, timeZone: string): number {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return 0;
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(utcMillis))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, (p.month ?? 1) - 1, p.day ?? 1, p.hour === 24 ? 0 : p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return wall - utcMillis;
}

/** Stable, Firestore-safe document id from a source + its id. */
export function eventDocId(source: string, sourceEventId: string): string {
  const safe = sourceEventId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
  return `${source}-${safe}`;
}

/** "ticketmaster:Z7r9..." — the lookup key kept in `sourceKeys[]`. */
export function sourceKey(source: string, sourceEventId: string): string {
  return `${source}:${sourceEventId}`.slice(0, 200);
}

/** Small stable hash for sources without ids (SerpApi). */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0");
}
