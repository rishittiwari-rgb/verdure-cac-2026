/**
 * Annotation — two fields every stored event carries, computed once at write
 * time, right after the frozen classifier (`enrichEvent`) has run:
 *
 *   adultOnly   true when the listing mentions alcohol service or an age limit,
 *               or an alcohol brand presents it; never missing. Structured age
 *               fields from the feed take precedence over free text. The rule
 *               errs toward TRUE: a false positive only hides an event from
 *               teens, a false negative shows a bar crawl to a 15-year-old.
 *   topicTags   John's 19-label keyword inference (CATEGORY_KEYWORDS in
 *               reference/verdure-discovery/verdure/models.py), whole-word
 *               matching exactly as his v3 does. These are NOT the existing
 *               `tags` field (feed tags, which drive the Volunteering category)
 *               and NOT `categories` (frozen classifier output).
 *
 * The six frozen classifier files are not touched; this module is additive.
 * Nothing here is called "enrich": enrichEvent already exists in classify.ts.
 *
 * Word boundaries are Unicode-aware (\p{L}\p{N}_), matching Python's default
 * `\b` in John's patterns, so "artística" never matches "art" and "Thai" never
 * matches "ai" — in any script.
 */

import type { NormalizedEvent } from "./types.js";
import type { EnrichedEvent } from "./classify.js";

export interface AnnotatedEvent extends EnrichedEvent {
  adultOnly: boolean;
  adultOnlyReason: AdultOnlyReason | null;
  topicTags: TopicTag[];
}

/** Python-style word boundaries: letters, digits and underscore in any script are word characters. */
const B_START = "(?<![\\p{L}\\p{N}_])";
const B_END = "(?![\\p{L}\\p{N}_])";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── adultOnly ───────────────────────────────────────────────────────────────

/**
 * Alcohol service or drinking-venue language. Each term is matched as a whole
 * word (Unicode boundaries). The exclusions keep children's and library
 * programming out: root/ginger/birch beer, mocktails, "cocktail attire",
 * "Happy Hour Storytime", "Homework Happy Hour".
 */
export const ALCOHOL_TERMS: readonly string[] = [
  // service and the drinks themselves
  "alcohol(?:ic)?", "(?<!root[\\s-]*|ginger[\\s-]*|birch[\\s-]*)beers?", "wines?", "winer(?:y|ies)", "winemakers?", "wine tasting", "wine bars?", "vineyards?", "sommeliers?",
  "brewer(?:y|ies)", "brewing", "brewpubs?", "brews", "craft brews?", "brewfest", "beerfest", "oktoberfest", "biergartens?", "beer gardens?",
  "taprooms?", "tap room", "tasting rooms?", "distiller(?:y|ies)", "cideries", "cidery", "hard ciders?", "cider releases?",
  "ales?", "lagers?", "ipas?", "stouts?", "pilsners?", "sake tasting", "sake bar", "champagne", "prosecco", "mimosas?", "bottomless mimosas?", "sangria",
  "tequila", "mezcal", "whisk(?:e)?y", "whiskies", "vodka", "bourbon", "gin tasting", "rum tasting", "margaritas?", "liquor", "spirits tasting",
  "(?<!mock)cocktails?(?![\\s-]*(?:attire|dress))", "hard seltzers?",
  // bars and service wording
  "cash bar", "open bar", "no[\\s-]host bar", "full bar", "wine (?:and|&) beer", "beer (?:and|&) wine", "drink tickets?", "drink specials?", "sports bars?",
  "cocktail bars?", "pubs?", "pub crawls?", "bar crawls?", "byob", "boozy", "booze", "sip (?:&|and) paint", "wine (?:&|and) paint",
  "(?<!homework[\\s-]*|kids[\\s-]*|teens?[\\s-]*|family[\\s-]*)happy hours?(?![\\s-]*(?:storytime|story time|homework|crafts?|kids|teens?|family))",
];
const wholeWord = (term: string) => `${B_START}(?:${term})${B_END}`;
const ALCOHOL_WORDS = ALCOHOL_TERMS.map((w) => new RegExp(wholeWord(w), "iu"));
export const ALCOHOL_PATTERN = new RegExp(ALCOHOL_TERMS.map(wholeWord).join("|"), "iu");

/**
 * Age limits a minor cannot meet: any stated minimum of 18 or above.
 *   "18+", "(21+)", "Comedy Night 18+", "open to ages 18+", "Adults (21+)"  — but not "20+ carnival games" or "Ages 18+ months"
 *   "21 and over", "18 & up", "adults aged 18 and older", "ages 21 or older", "21 years of age and over"
 *   "must be 21", "must be over 18", "minimum age 21", "over 21 only", "ages 25-35"
 *   "no one under 21", "no children under 18", "under 21 not admitted"
 *   "adults only", "adults-only"
 * The library systems' structured audience labels ("Adults, ages 18+", "Seniors, ages 65+") are exactly this.
 * Bare "ID required" is NOT an age limit (student ID, photo ID for a tour).
 */
const ADULT_AGE = "(?:1[89]|[2-9][0-9])";
export const AGE_LIMIT_PATTERN = new RegExp([
  // "N+" with an age cue before it — never before a counted noun ("20+ vendors") or "months"
  `(?:${B_START}(?:ages?|adults?,?\\s*(?:ages?)?|seniors?,?\\s*(?:ages?)?)\\s*|[(\\[]\\s*)${ADULT_AGE}\\s*\\+(?!\\s*(?:months?|years?|yrs))`,
  // "N+" at the end of a phrase or before an event noun
  `(?<![0-9])${ADULT_AGE}\\s*\\+(?=\\s*(?:$|[.,;:!?)\\]|]|only|event|show|night|party|crowd|audience|welcome|please|w\\/|with|and|&|to attend|to enter))(?!\\s*(?:months?|years?|yrs))`,
  // "N and over / up / older", with or without an age cue
  `(?<![0-9$])${ADULT_AGE}\\b(?:\\s*years?(?:\\s*of age)?)?\\s*(?:and|&|or|\\+)\\s*(?:up|over|older)${B_END}`,
  // "must be 21", "must be over 18", "must be at least 21", "minimum age 21"
  `${B_START}(?:must be(?: at least| over)?|minimum age(?: of| is)?|age minimum(?: of| is)?)\\s*${ADULT_AGE}${B_END}`,
  // "over 21 only", "over 21 to attend/enter"
  `${B_START}over\\s*${ADULT_AGE}\\s*(?:only|to attend|to enter|to drink|with (?:valid )?id)${B_END}`,
  // "no one under 21", "no children under 18", "under 21 not admitted"
  `${B_START}no (?:one|minors?|guests?|children|kids|persons?|patrons?) under\\s*(?:the age of\\s*)?${ADULT_AGE}${B_END}`,
  `${B_START}under\\s*${ADULT_AGE}\\s*(?:are\\s*)?(?:not admitted|will not be admitted|not permitted|are not permitted|not allowed)${B_END}`,
  // explicit adult-only wording
  `${B_START}adults?[\\s-]*only${B_END}`,
  // an age range that starts at 18 or above ("ages 25-35", "for ages 18 to 25")
  `${B_START}(?:for\\s*)?ages?\\s*${ADULT_AGE}\\s*(?:-|–|—|to)\\s*[2-9][0-9]${B_END}`,
].join("|"), "iu");

/**
 * Brands that present or sponsor drinking events. Counted ONLY when they are
 * the organizer or appear in a "presented / sponsored / brought to you by …"
 * phrase (the spec's "an alcohol brand presenting the event"). A bare title
 * mention is not evidence: "Sierra Nevada" is a mountain range, "Corona" a
 * town, "Blue Moon" an idiom, "Guinness" a book of records.
 */
export const ALCOHOL_BRANDS: readonly string[] = [
  "modelo", "budweiser", "bud light", "coors", "miller lite", "miller high life", "heineken", "corona extra", "stella artois",
  "michelob", "pacifico", "dos equis", "lagunitas", "sierra nevada brewing", "anchor steam", "firestone walker", "ballast point",
  "jack daniel's", "jack daniels", "jameson irish whiskey", "tito's", "titos handmade", "smirnoff", "absolut", "grey goose", "bacardi",
  "captain morgan", "jose cuervo", "patrón tequila", "patron tequila", "don julio", "hennessy", "jägermeister", "jagermeister",
  "white claw", "truly hard seltzer", "barefoot wine", "kendall-jackson", "josh cellars", "la crema", "robert mondavi",
  "high noon hard seltzer", "cutwater spirits", "guinness brewery", "blue moon brewing", "new belgium", "gordon biersch", "21st amendment brewery",
];
const BRAND_PATTERNS = ALCOHOL_BRANDS.map((b) => new RegExp(wholeWord(escapeRegExp(b)), "iu"));
const PRESENTER_PATTERN = /\b(?:presented|sponsored|hosted|brought to you|powered)\s+by\s+([^.;\n]{2,80})/giu;

/** Structured feed fields that carry an age limit: minimumAge, audiences, event types, tags. */
function structuredAgeLimit(rec: NormalizedEvent & { minimumAge?: number | null }): boolean | null {
  if (typeof rec.minimumAge === "number") return rec.minimumAge >= 18;
  const structured = [...(rec.audiences ?? []), ...(rec.eventTypes ?? []), ...(rec.tags ?? [])].join(" | ");
  if (!structured.trim()) return null;
  if (AGE_LIMIT_PATTERN.test(structured)) return true;
  return null;
}

export function mentionsAlcohol(text: string): boolean {
  const t = String(text ?? "");
  return ALCOHOL_WORDS.some((w) => w.test(t));
}

/** A brand presents the event: it is the organizer, or named in a "presented by" phrase (which may also name a brewery or winery). */
export function alcoholBrandPresents(rec: NormalizedEvent): boolean {
  const organizer = String(rec.organizer ?? "");
  if (BRAND_PATTERNS.some((p) => p.test(organizer))) return true;
  const text = `${rec.title ?? ""} ${rec.description ?? ""}`;
  for (const m of text.matchAll(PRESENTER_PATTERN)) {
    if (BRAND_PATTERNS.some((p) => p.test(m[1])) || mentionsAlcohol(m[1])) return true;
  }
  return false;
}

export type AdultOnlyReason = "structured-age-limit" | "age-limit" | "alcohol" | "alcohol-venue" | "alcohol-brand";

/**
 * Why a listing is adult-only, or null. Structured age fields win; otherwise
 * age-limit language, alcohol service in the text, a drinking venue or brewery
 * as organizer/location, or an alcohol brand presenting the event. Stored
 * alongside the flag so the share per source can be explained and so a reason
 * line can say "21+ event" rather than "adult only".
 */
export function adultOnlyReason(rec: NormalizedEvent & { minimumAge?: number | null }): AdultOnlyReason | null {
  if (structuredAgeLimit(rec) === true) return "structured-age-limit";
  const text = `${rec.title ?? ""} ${rec.description ?? ""}`;
  if (AGE_LIMIT_PATTERN.test(text)) return "age-limit";
  if (mentionsAlcohol(text)) return "alcohol";
  if (mentionsAlcohol(`${rec.organizer ?? ""} · ${rec.locationName ?? ""}`)) return "alcohol-venue";
  if (alcoholBrandPresents(rec)) return "alcohol-brand";
  return null;
}

/** The adultOnly decision. Always a boolean so the client's `adultOnly == false` filter can match every document. */
export function inferAdultOnly(rec: NormalizedEvent & { minimumAge?: number | null }): boolean {
  return adultOnlyReason(rec) !== null;
}

// ── topicTags — port of models.py: CATEGORY_KEYWORDS / infer_categories() ───

export type TopicTag =
  | "family" | "kids" | "music" | "arts" | "education" | "outdoors" | "volunteer" | "sports" | "fitness"
  | "food" | "community" | "campus" | "tech" | "social" | "film" | "theater" | "workshop" | "civic" | "other";

/** Port of models.py: CATEGORIES */
export const TOPIC_TAGS: readonly TopicTag[] = [
  "family", "kids", "music", "arts", "education", "outdoors", "volunteer", "sports", "fitness",
  "food", "community", "campus", "tech", "social", "film", "theater", "workshop", "civic", "other",
];

/** Port of models.py: CATEGORY_KEYWORDS (verbatim). */
export const CATEGORY_KEYWORDS: Record<Exclude<TopicTag, "community" | "campus" | "other">, string[]> = {
  kids: ["storytime", "story time", "toddler", "preschool", "children", "kids", "baby"],
  family: ["family", "all ages", "parents"],
  music: ["concert", "music", "band", "live music", "jazz", "orchestra", "dj", "choir"],
  arts: ["art", "gallery", "exhibit", "painting", "craft"],
  outdoors: ["hike", "walk", "preserve", "trail", "nature", "naturalist", "birding", "park"],
  volunteer: ["volunteer", "cleanup", "clean-up", "restoration"],
  education: ["lecture", "talk", "class", "seminar", "tutoring", "lesson"],
  workshop: ["workshop", "hands-on"],
  sports: ["game", "match", "tournament", "basketball", "soccer", "baseball"],
  fitness: ["yoga", "run", "running", "5k", "fitness", "workout", "climbing"],
  food: ["farmers market", "food", "tasting", "cooking"],
  tech: ["hackathon", "coding", "tech", "technology", "robotics", "ai", "programming"],
  film: ["film", "movie", "screening"],
  theater: ["theater", "theatre", "play", "musical"],
  civic: ["city council", "town hall", "public meeting", "civic"],
  social: ["meetup", "mixer", "social", "networking"],
};

/**
 * Port of models.py: _CATEGORY_PATTERNS — `\b(?:w1|w2)s?\b` per category.
 * Python's `\b` is Unicode-aware; the JS equivalent uses lookarounds on
 * \p{L}\p{N}_ so "art" never matches "start", "party" or "artística" and "ai"
 * never matches "Thai".
 */
export const CATEGORY_PATTERNS: Record<string, RegExp> = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([cat, words]) => [cat, new RegExp(`${B_START}(?:${words.map(escapeRegExp).join("|")})s?${B_END}`, "iu")]),
);
/** Port of models.py: _DESCRIPTION_IGNORED — a "Coding Club" that mentions building small games is not a sports event. */
export const DESCRIPTION_IGNORED: ReadonlySet<string> = new Set(["sports", "theater"]);

/** Port of models.py: infer_categories(title, description, default). A source's own category labels go in with the TITLE (strong signal), not the description. */
export function inferTopicTags(title: string, description: string, fallback?: TopicTag): TopicTag[] {
  const titleL = String(title ?? "").toLowerCase();
  const descL = String(description ?? "").toLowerCase();
  const found: TopicTag[] = [];
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) if (pattern.test(titleL)) found.push(cat as TopicTag);
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (!found.includes(cat as TopicTag) && !DESCRIPTION_IGNORED.has(cat) && pattern.test(descL)) found.push(cat as TopicTag);
  }
  if (!found.length && fallback) found.push(fallback);
  return found.length ? found : ["other"];
}

/** Port of config.yaml `default_category` per source: John uses campus for the universities and community for library iCal feeds. */
export const SOURCE_DEFAULT_TOPIC: Partial<Record<string, TopicTag>> = {
  localist: "campus", livewhale: "campus", bibliocommons: "community", libcal: "community", ics: "community",
  midpen: "outdoors", legistar: "civic",
};

/**
 * John's 19 labels mapped onto the app's interest vocabulary (the keys of
 * INTEREST_TO_CATEGORY in ranking.ts). Kept in code, never stored: it is a
 * product decision, not data. Several labels fold into one interest.
 */
export const TOPIC_TO_INTEREST: Record<TopicTag, string[]> = {
  kids: ["family"], family: ["family"], music: ["music"], arts: ["arts"], theater: ["arts"], film: ["arts"],
  education: ["learning"], workshop: ["learning"], campus: ["learning"], tech: ["tech"],
  outdoors: ["outdoors"], volunteer: ["volunteering"], sports: ["fitness"], fitness: ["fitness"],
  food: ["food"], community: ["community"], civic: ["community"], social: ["community"], other: [],
};

/** App interests a tag list speaks to, deduplicated and ordered by first appearance. */
export function interestsForTopics(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) for (const interest of TOPIC_TO_INTEREST[tag as TopicTag] ?? []) if (!out.includes(interest)) out.push(interest);
  return out;
}

/** The structured labels that join the title as John's "source's own category labels". */
function structuredLabels(rec: NormalizedEvent): string {
  return [...(rec.eventTypes ?? []), ...(rec.tags ?? []).filter((t) => !/^(library|google-events)$/i.test(t))].join(" ");
}

// ── The one call upsertBatch makes ──────────────────────────────────────────

/** Add adultOnly and topicTags to an enriched event. Pure; identical for fresh ingest and backfill. */
export function annotateEvent(rec: EnrichedEvent & { minimumAge?: number | null }): AnnotatedEvent {
  const fallback = SOURCE_DEFAULT_TOPIC[rec.source];
  const topicTags = inferTopicTags(`${rec.title ?? ""} ${structuredLabels(rec)}`, rec.description ?? "", fallback);
  const reason = adultOnlyReason(rec);
  return { ...rec, adultOnly: reason !== null, adultOnlyReason: reason, topicTags };
}
