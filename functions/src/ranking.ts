/**
 * Personalized event ranking.
 *
 * Nothing read user interests before this file existed. They were collected at
 * onboarding, written to users/{uid}.interests, and then used by no query on
 * either side — the personalization the product promises was a stored field and
 * nothing else.
 *
 * THE ONE RULE: RANK, NEVER FILTER.
 *
 * Every signal below is a weighted term added to a score. Not one of them can
 * remove an event from the result. This is deliberate and it is the difference
 * between a recommender and a cage:
 *
 *   - Interests are a guess made once, at onboarding, before the user had seen
 *     anything. Hard-filtering on them means someone who tapped "Sports" can
 *     never discover the cleanup two blocks away, and nothing in the product
 *     would ever tell them it existed.
 *   - Interest and distance are the two strongest terms (0.20 each since the
 *     CAC 2026 fix; distance alone led before). A direct interest match orders
 *     above a non-match (see rankEvents), but a genuinely special event 20
 *     miles out is still in the list — it just has to be better to win its group.
 *   - A cold-start user (no interests, no follows, no history) gets every
 *     signal at its neutral value and falls back to "soon and nearby", which is
 *     a defensible default, not an empty screen.
 *
 * So the worst case for any event is that it ranks last. The worst case for a
 * filter is that a user never learns the event happened.
 *
 * WEIGHTS. Tuned by hand, documented, and summing to 1.0 so a score reads as a
 * percentage and a weight change is obviously a product decision rather than a
 * hidden one. Every component returns 0..1.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, safeText, blockedSetFor, utcMonthKey, plusActiveFrom } from "./common.js";
import type { InterestProfile } from "./profiles.js";
import { friendIds } from "./friendships.js";
import { createFeedSession } from "./feedTelemetry.js";
import { rankEventsV2, reasonsForV1, constraintsFromFilters, applyFeedback, coerceRankingConfig, EXCLUDING_ACTIONS, ACTION_WEIGHTS,
  type V2Constraints, type AffinityState, type RankingVersion, type RankingConfig, type ClientFilterInput } from "./ranking-v2.js";
import { matchInterests, directMatch, interestTerms, retrievalTopics, retrievalCategories, DIRECT_MATCH_MIN, INTEREST_TO_CATEGORY } from "./interests.js";

/**
 * CAC 2026 (1.1 cause 3) — before → after.
 *   interest 0.16 → 0.20, distance 0.24 → 0.20; the other five terms unchanged.
 * Before this change a direct interest match was worth 0.16 of a point while a
 * two-mile difference in distance was worth about 0.09, so a stated interest
 * could be outvoted by proximity plus a complete listing. Distance still
 * decides the order among events that match (see rankEvents: a direct match
 * always ranks above a non-match, then the full score orders each group).
 */
export const WEIGHTS = {
  /** Does it match what they said they liked, or what they've actually attended? */
  interest: 0.20,
  /** Can they get there? The single best predictor of whether someone goes. */
  distance: 0.20,
  /** A friend is going. The one signal no search engine can produce. */
  social: 0.16,
  /** Soon enough to act on, far enough away to plan. */
  timing: 0.13,
  /** Haven't seen this organizer/category lately — keeps the feed from ossifying. */
  novelty: 0.07,
  /** Complete, well-sourced listings matter most for a cold account. */
  quality: 0.14,
  /** Saved, viewed and explicit feedback, with negative feedback decaying. */
  feedback: 0.10,
} as const;

/** Sanity: the weights must sum to 1. A typo here silently reweights the feed. */
export const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Interest term → the frozen classifier's SPECIFIC categories that are a direct
 * match on their own. Defined in interests.ts next to the phrase lexicon so the
 * two cannot drift; re-exported here because ranking v2 and the tests import
 * it from this module. Catch-all categories (Workshop, Social, Meetup) are
 * deliberately absent: "Social" at a library is a board-game afternoon.
 */
export { INTEREST_TO_CATEGORY };

/**
 * Word-level aliases kept ONLY for ranking v2's port of John's engine
 * (matchedInterests). v1 no longer uses them: it matches through
 * interests.ts, which strips venue names and uses multi-word phrases. The
 * bare words that produced false matches ("park" → Mitchell Park Library,
 * "garden" → Greenhouse Community Room, "walk" → walk-in, "social",
 * "community", "volunteer" in a description) are gone from this table too.
 */
export const INTEREST_SYNONYMS: Record<string, string[]> = {
  outdoors: ["trail", "nature walk", "birding", "wildflower", "hike", "hiking", "open space", "nature preserve"],
  hiking: ["trail", "nature walk", "birding", "wildflower", "ramble", "guided walk", "hike"],
  gardening: ["community garden", "garden tour", "gardening", "native plant", "plant sale", "composting"],
  waterfront: ["creek", "shoreline", "kayak", "paddle", "tide pool", "wetland", "marsh", "baylands"],
  scenic: ["sunset", "stargazing", "viewpoint", "full moon", "astronomy", "photography walk"],
  fitness: ["running club", "fun run", "yoga", "bike ride", "cycling", "dance fitness", "walking group", "tai chi", "pickleball"],
  volunteering: ["volunteers needed", "service day", "stewardship", "habitat restoration", "cleanup", "tree planting"],
  arts: ["art", "painting", "drawing", "gallery", "exhibition", "craft", "ceramics"],
  music: ["music", "concert", "jazz", "choir", "orchestra", "live band"],
  food: ["food", "cooking", "farmers market", "tasting", "baking"],
  tech: ["coding", "robotics", "computer", "maker", "hackathon", "technology"],
  learning: ["workshop", "class", "lecture", "lesson", "clinic", "lab", "learn"],
  community: ["community meeting", "neighborhood", "town hall", "block party", "potluck", "meetup", "mixer"],
  family: ["family", "kids", "children", "storytime", "all ages"],
};

export interface RankableEvent {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  organizer?: string;
  latitude?: number;
  longitude?: number;
  startMs: number;
  tags?: string[];
  qualityScore?: number;
  ageSuitability?: string;
  minimumAge?: number;
  endMs?: number;
  accessibilityFeatures?: string[];
  /** Server-annotated at ingest (W1). Excluded for every viewer who is not a recorded adult. */
  adultOnly?: boolean;
  // Fields ranking v2 (ranking-v2.ts) reads; all optional so v1 candidates stay valid.
  source?: string;
  titleKey?: string;
  venueKey?: string;
  locationName?: string;
  virtual?: boolean;
  indoorOutdoor?: string;
  isFree?: boolean;
  priceMin?: number;
  topicTags?: string[];
  maximumAge?: number;
}

export interface RankingContext {
  interests: string[];
  studentStatus?: boolean;
  school?: string;
  householdYoungestAge?: number;
  accessibilityNeeds?: string[];
  transportMode?: "walk" | "transit" | "drive";
  preferredCategories?: string[];
  excludedCategories?: string[];
  radiusMiles?: number;
  distancePreset?: "close" | "balanced" | "drive";
  /** Categories the user has actually attended — behaviour beats stated preference. */
  attendedCategories: Record<string, number>;
  /** eventId -> number of followed accounts going. */
  friendsGoing: Record<string, number>;
  /** Organizers seen recently in this user's feed, for the novelty term. */
  recentOrganizers: Record<string, number>;
  savedEventIDs?: string[];
  eventFeedback?: Record<string, { category?: string; organizer?: string; kind: string; atMs: number }>;
  attendedOrganizers?: Record<string, number>;
  weekendAttendanceRatio?: number;
  lat?: number;
  lng?: number;
  nowMs: number;
  /** registerAgeBand recorded this account as an adult. Unknown age is treated as a minor. */
  viewerIsAdult?: boolean;
  // W3: fields ranking v2 reads (all optional; v1 ignores them).
  /** John's hard constraints, mapped from the app's existing filters (W3.5). */
  constraints?: V2Constraints;
  /** Precomputed per-user affinity state (W3.6). */
  affinity?: AffinityState;
  /** Per-user "first shown" map for novelty (W3.6), capped at 500. */
  firstShown?: Record<string, number>;
  /** Events the user hid or reported: never shown again. */
  hiddenEventIDs?: string[];
  rsvpEventIDs?: string[];
  /** Events the digest already pushed (notification eligibility). */
  notifiedEventIDs?: string[];
}

const MILE_M = 1609.344;

export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h))) / MILE_M;
}

/**
 * Stated interests, plus what they've actually done.
 *
 * Attendance outranks the onboarding tap: someone who selected "tech" but has
 * been to four cleanups is telling us something truer than their first-run
 * answer. Neutral 0.5 when we know nothing — NOT 0, which would push every
 * event below the midpoint for a brand-new user and make the whole feed look
 * like a rejection.
 */
/**
 * The stated-interest match, 0..1, from the user's own picks (app labels or
 * server terms — interests.ts normalises both). 1 for a title phrase or a
 * specific category, 0.9 for a stricter description phrase, 0 otherwise. A
 * Verdure+ profile's explicit category list counts as a direct match too.
 * Exported so the tiering in rankEvents, the reasons and the exploration slot
 * all read the same number.
 */
export function statedInterestMatch(ev: RankableEvent, ctx: RankingContext): number {
  if (!ctx.interests.length && !(ctx.preferredCategories ?? []).length) return 0;
  if ((ctx.preferredCategories ?? []).includes(ev.category ?? "")) return 1;
  return matchInterests(ev, ctx.interests)[0]?.strength ?? 0;
}

export function interestScore(ev: RankableEvent, ctx: RankingContext): number {
  const cat = ev.category ?? "";
  const opportunity = cat === "Workshop" || cat === "Volunteer" || (ev.tags ?? []).includes("Opportunity");
  const sameSchool = !!ctx.school && (ev.organizer ?? "").toLowerCase().includes(ctx.school.toLowerCase());
  const studentFloor = ctx.studentStatus && opportunity ? (sameSchool ? 0.9 : 0.75) : 0;
  const childAge = ctx.householdYoungestAge;
  const familyFloor = childAge !== undefined && childAge < 13 &&
    (ev.ageSuitability === "children" || ev.ageSuitability === "all") &&
    (ev.minimumAge === undefined || ev.minimumAge <= childAge) ? 0.85 : 0;
  const access = ctx.accessibilityNeeds ?? [];
  const accessibilityFloor = access.length > 0 &&
    access.every((need) => (ev.accessibilityFeatures ?? []).includes(need)) ? 0.85 : 0;
  const hasStated = ctx.interests.length > 0;
  const attendedTotal = Object.values(ctx.attendedCategories).reduce((a, b) => a + b, 0);
  if (!hasStated && attendedTotal === 0) return Math.max(0.5, studentFloor, familyFloor, accessibilityFloor);

  const stated = hasStated ? statedInterestMatch(ev, ctx) : 0;

  let behavioural = 0;
  if (attendedTotal > 0) {
    behavioural = Math.min(1, (ctx.attendedCategories[cat] ?? 0) / Math.max(1, attendedTotal / 2));
  }

  if (!hasStated) return Math.max(behavioural, studentFloor, familyFloor, accessibilityFloor);
  if (attendedTotal === 0) return Math.max(stated, studentFloor, familyFloor, accessibilityFloor);
  return Math.max(0.4 * stated + 0.6 * behavioural, studentFloor, familyFloor, accessibilityFloor);
}

/**
 * Distance decay. 0 mi -> 1, ~5 mi -> 0.5, 25 mi -> ~0.17, and never 0: a
 * distant event keeps a small positive score so it can still be surfaced by
 * being outstanding on every other axis.
 */
export function distanceScore(ev: RankableEvent, ctx: RankingContext): number {
  if (ctx.lat === undefined || ctx.lng === undefined) return 0.5;
  if (ev.latitude === undefined || ev.longitude === undefined) return 0.4;   // unknown, mildly penalised
  const miles = haversineMiles(ctx.lat, ctx.lng, ev.latitude, ev.longitude);
  const radiusBase = ctx.radiusMiles ? Math.max(1, ctx.radiusMiles / 5) : 5;
  const bias = ctx.distancePreset === "close" ? 0.6 : ctx.distancePreset === "drive" ? 1.8 :
    ctx.transportMode === "walk" ? 0.45 : ctx.transportMode === "transit" ? 0.8 :
    ctx.transportMode === "drive" ? 1.2 : 1;
  return 1 / (1 + miles / (radiusBase * bias));
}

/**
 * Friends going. Saturating, not linear: the jump from nobody to one friend is
 * the whole effect, and three friends is not three times as persuasive.
 */
export function socialScore(ev: RankableEvent, ctx: RankingContext): number {
  const n = ctx.friendsGoing[ev.id] ?? 0;
  if (n <= 0) return 0;
  return Math.min(1, 0.7 + 0.15 * Math.min(2, n - 1));
}

/**
 * Timing. Peaks 2–7 days out: far enough to plan, near enough to feel real.
 * Tonight scores well but not best; six weeks out is nearly weightless.
 */
export function timingScore(ev: RankableEvent, ctx: RankingContext): number {
  const days = (ev.startMs - ctx.nowMs) / 86_400_000;
  if (days < 0) return 0;              // past; ranking cannot resurrect it
  if (days < 1 / 24 && ctx.lat !== undefined && ctx.lng !== undefined &&
      ev.latitude !== undefined && ev.longitude !== undefined &&
      haversineMiles(ctx.lat, ctx.lng, ev.latitude, ev.longitude) > 10) return 0.05;
  if (days < 0.5) return 0.55;         // today — good, but hard to act on
  if (days <= 1) return 0.8;
  if (days <= 7) {
    const ratio = ctx.weekendAttendanceRatio;
    const day = new Date(ev.startMs).getUTCDay();
    if (ratio !== undefined && ratio >= 0.75 && day !== 0 && day !== 6) return 0.8;
    return 1;
  }
  if (days <= 14) return 0.7;
  if (days <= 30) return 0.4;
  return 0.15;
}

/**
 * Novelty / diversity. An organizer the user has already seen a lot of this
 * session is damped, so one prolific library does not own the whole feed. This
 * is a demotion, never a removal — the fourth library event still ranks, just
 * below the first cleanup.
 */
export function noveltyScore(ev: RankableEvent, ctx: RankingContext): number {
  const seen = ctx.recentOrganizers[ev.organizer ?? ""] ?? 0;
  return 1 / (1 + seen * 0.6);
}

export function qualityScore(ev: RankableEvent): number {
  return typeof ev.qualityScore === "number" && Number.isFinite(ev.qualityScore)
    ? Math.max(0, Math.min(1, ev.qualityScore)) : 0.35;
}

/** Behaviour is bounded to 0..1 and never excludes a listing. A dismissal
 * returns to neutral over 90 days; permanent exclusions are a separate Plus
 * control. A venue/organizer that earned two check-ins gets a strong lift. */
export function feedbackScore(ev: RankableEvent, ctx: RankingContext): number {
  const rows = Object.entries(ctx.eventFeedback ?? {});
  let score = 0.5;
  if (ctx.savedEventIDs?.includes(ev.id)) score += 0.2;
  if ((ctx.attendedOrganizers?.[ev.organizer ?? ""] ?? 0) >= 2) score += 0.25;
  for (const [id, row] of rows) {
    const sameCategory = !!row.category && row.category === ev.category;
    const sameOrganizer = !!row.organizer && row.organizer === ev.organizer;
    if (!sameCategory && !sameOrganizer && id !== ev.id) continue;
    const age = Math.max(0, ctx.nowMs - row.atMs);
    if (row.kind === "less") score -= 0.4 * Math.max(0, 1 - age / (90 * 86_400_000));
    if (row.kind === "more") score += 0.2;
    if (row.kind === "view") score += 0.03;
  }
  return Math.max(0, Math.min(1, score));
}

export interface ScoredEvent {
  id: string; score: number; parts: Record<string, number>;
  /** Up to three plain-language reasons, each backed by a component value (W5). */
  reasons?: string[];
  /** Later dates of a collapsed recurring series (ISO), v2 only. */
  moreDates?: string[];
  /** John's notification eligibility (v2 only); delivery stays inside MAX_PUSH_PER_WEEK. */
  notify?: boolean;
  version?: RankingVersion;
}

/** Score one event. Exported so tests can assert a single term in isolation. */
export function scoreEvent(ev: RankableEvent, ctx: RankingContext): ScoredEvent {
  const parts: Record<string, number> = {
    interest: interestScore(ev, ctx),
    distance: distanceScore(ev, ctx),
    social: socialScore(ev, ctx),
    timing: timingScore(ev, ctx),
    novelty: noveltyScore(ev, ctx),
    quality: qualityScore(ev),
    feedback: feedbackScore(ev, ctx),
    // 1 when the user's STATED picks match this listing directly (not a floor,
    // not behaviour). rankEvents tiers on it; reasons and the exploration slot read it.
    interestMatch: ctx.interests.length && statedInterestMatch(ev, ctx) >= DIRECT_MATCH_MIN ? 1 : 0,
    // 1 when the direct match is the pick's PRIMARY meaning (hiking for Trails,
    // waterfront for Waterfront): those lead the outdoors matches every outdoor pick shares.
    interestPrimary: ctx.interests.length && (directMatch(ev, ctx.interests)?.primary || (ctx.preferredCategories ?? []).includes(ev.category ?? "")) ? 1 : 0,
  };
  const score =
    parts.interest * WEIGHTS.interest +
    parts.distance * WEIGHTS.distance +
    parts.social * WEIGHTS.social +
    parts.timing * WEIGHTS.timing +
    parts.novelty * WEIGHTS.novelty +
    parts.quality * WEIGHTS.quality +
    parts.feedback * WEIGHTS.feedback;
  return { id: ev.id, score, parts };
}

/**
 * Rank a whole list.
 *
 * Category diversity is applied HERE rather than as a per-event term, because
 * it is a property of the result set, not of any event: walk the sorted list
 * and damp each repeat of a category already used higher up. The top result is
 * never touched, so the best event always leads.
 *
 * Output length always equals input length. This function cannot drop an event.
 */
/** The exploration card's reason. The client shows it on the card, so the one off-interest pick is labelled as such. */
export const EXPLORATION_REASON = "Something different — outside your picks";

/**
 * A direct interest match ranks above every non-match (CAC 2026, 1.1).
 *
 * This is an ORDER, not a filter: the comparator sorts matches first and the
 * full score second, so every event is still returned, distance still decides
 * the order inside each group, and a user with three matching events sees
 * them first and then the ordinary soon-and-nearby feed. Without this rule no
 * weight setting could keep "a direct match always beats the student floor"
 * true for every household: the student floor alone is worth 0.75 of the
 * interest term, and distance + timing + quality can add up to more than the
 * whole term. A user with no stated interests has interestMatch 0 everywhere
 * and the order is the pure score, as before.
 */
const byMatchThenScore = (a: ScoredEvent, b: ScoredEvent) =>
  (b.parts.interestMatch ?? 0) - (a.parts.interestMatch ?? 0) || (b.parts.interestPrimary ?? 0) - (a.parts.interestPrimary ?? 0) ||
  b.score - a.score || a.id.localeCompare(b.id);

/** How many later dates of a series ride along on the kept card (the client shows "Repeats — N more dates"). */
export const MAX_MORE_DATES_V1 = 5;

/** The series a listing belongs to: same source, title and venue (the fields v2's seriesKey uses). */
function seriesKeyV1(ev: RankableEvent | undefined, fallback: string): string {
  const title = (ev?.titleKey ?? ev?.title ?? "").trim().toLowerCase();
  const venue = (ev?.venueKey ?? ev?.locationName ?? "").trim().toLowerCase();
  // A listing with no title or no venue is nobody's series: it keeps its own place.
  if (!ev || !title || !venue) return fallback;
  return `${ev.source ?? ""}|${title}|${venue}`;
}

/**
 * Series collapse for v1 (the same contract v2 ships and the client already
 * renders): the next occurrence of a recurring listing takes the series' best
 * position and carries the later dates in `moreDates`; the later occurrences
 * move to the END of the list rather than disappearing, so output length still
 * equals input length and a card is never a third copy of the one above it.
 */
export function collapseSeriesV1(ranked: ScoredEvent[], byId: Map<string, RankableEvent>): ScoredEvent[] {
  const groups = new Map<string, ScoredEvent[]>();
  const keyOf = new Map<string, string>();
  for (const r of ranked) {
    const key = seriesKeyV1(byId.get(r.id), r.id);
    keyOf.set(r.id, key);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  if ([...groups.values()].every((items) => items.length < 2)) return ranked;
  const startOf = (id: string) => byId.get(id)?.startMs ?? 0;
  const keptFor = new Map<string, ScoredEvent>();   // series key → the row that represents it
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    const soonest = [...items].sort((a, b) => startOf(a.id) - startOf(b.id) || a.id.localeCompare(b.id))[0];
    const later = items.filter((r) => r !== soonest);
    keptFor.set(key, { ...soonest, moreDates: later.map((r) => new Date(startOf(r.id)).toISOString()).sort().slice(0, MAX_MORE_DATES_V1) });
  }
  const head: ScoredEvent[] = [];
  const tail: ScoredEvent[] = [];
  const placedSeries = new Set<string>();
  for (const r of ranked) {
    const key = keyOf.get(r.id)!;
    const kept = keptFor.get(key);
    if (!kept) { head.push(r); continue; }
    if (!placedSeries.has(key)) { placedSeries.add(key); head.push(kept); }
    if (r.id !== kept.id) tail.push(r);
  }
  return [...head, ...tail];
}

export function rankEvents(events: RankableEvent[], ctx: RankingContext): ScoredEvent[] {
  const scored = events.map((e) => scoreEvent(e, ctx));
  scored.sort(byMatchThenScore);

  const byId = new Map(events.map((e) => [e.id, e]));
  const usedCategory: Record<string, number> = {};
  const diversified: ScoredEvent[] = scored.map((s) => {
    const cat = byId.get(s.id)?.category ?? "";
    const seen = usedCategory[cat] ?? 0;
    usedCategory[cat] = seen + 1;
    // 1st of a category untouched, 2nd x0.93, 3rd x0.87, floor 0.7.
    const damp = Math.max(0.7, 1 - seen * 0.07);
    return { ...s, score: s.score * damp, parts: { ...s.parts, diversity: damp } };
  });
  diversified.sort(byMatchThenScore);
  const collapsed = collapseSeriesV1(diversified, byId);
  // One quality-led exploration pick in a full ten-card page: slot 10 is the
  // ONLY off-interest card by design. The pick must not match the user's
  // picks; it is labelled in `parts` for instrumentation and carries its own
  // reason so the card says what it is.
  if (collapsed.length >= 10 && ctx.interests.length > 0) {
    const pick = collapsed.slice(9).filter((s) => {
      const ev = byId.get(s.id);
      return !!ev && (s.parts.interestMatch ?? 0) === 0 && qualityScore(ev) >= 0.7;
    }).sort((a, b) => (qualityScore(byId.get(b.id)!) - qualityScore(byId.get(a.id)!)) || b.score - a.score || a.id.localeCompare(b.id))[0];
    if (pick) {
      const from = collapsed.findIndex((s) => s.id === pick.id);
      collapsed.splice(from, 1);
      collapsed.splice(9, 0, { ...pick, parts: { ...pick.parts, exploration: 1 }, reasons: [EXPLORATION_REASON] });
    }
  }
  return collapsed;
}

// ---------------------------------------------------------------------------
// Server plumbing
// ---------------------------------------------------------------------------

const MAX_CANDIDATES = 400;
const CACHE_MS = 5 * 60_000;
const DIVERSITY_CATEGORIES = ["Cleanup", "Sports", "Social", "Workshop", "Market", "Festival", "Hackathon", "Meetup", "Volunteer", "Program"];

export function rankableFromDoc(d: FirebaseFirestore.DocumentSnapshot): RankableEvent | null {
  const x = d.data();
  if (!x || x.hidden === true || x.broadcast !== true || x.active !== true) return null;
  // Partners never organic (W3.4): anything carrying partner fields is not a candidate, whatever collection it came from.
  if (x.partnerId !== undefined || x.sponsored !== undefined || x.perkId !== undefined || x.kind === "perk" || x.pointCost !== undefined) return null;
  return {
    id: d.id, title: x.title, description: x.description,
    category: x.category, organizer: x.organizer,
    latitude: typeof x.latitude === "number" ? x.latitude : undefined,
    longitude: typeof x.longitude === "number" ? x.longitude : undefined,
    startMs: x.date instanceof Timestamp ? x.date.toMillis() : 0,
    tags: Array.isArray(x.tags) ? x.tags : [],
    qualityScore: typeof x.qualityScore === "number" ? x.qualityScore : undefined,
    ageSuitability: safeText(x.ageSuitability, 20),
    minimumAge: typeof x.minimumAge === "number" ? x.minimumAge : undefined,
    endMs: x.endDate instanceof Timestamp ? x.endDate.toMillis() : undefined,
    accessibilityFeatures: Array.isArray(x.accessibilityFeatures)
      ? x.accessibilityFeatures.filter((v: unknown): v is string => typeof v === "string").slice(0, 10) : [],
    // A document missing the flag (pre-W1) is treated as adult-only: fail closed.
    adultOnly: x.adultOnly !== false,
    source: safeText(x.source, 40) || undefined,
    titleKey: safeText(x.titleKey, 80) || undefined,
    venueKey: safeText(x.venueKey, 40) || undefined,
    locationName: safeText(x.locationName, 120) || undefined,
    virtual: typeof x.virtual === "boolean" ? x.virtual : undefined,
    indoorOutdoor: safeText(x.indoorOutdoor, 10) || undefined,
    isFree: typeof x.isFree === "boolean" ? x.isFree : undefined,
    priceMin: typeof x.priceMin === "number" ? x.priceMin : undefined,
    topicTags: Array.isArray(x.topicTags) ? x.topicTags.filter((v: unknown): v is string => typeof v === "string").slice(0, 8) : [],
    maximumAge: typeof x.maximumAge === "number" ? x.maximumAge : undefined,
  };
}

/** Minor protection (W2): an adult-only listing never reaches a viewer who is not a recorded adult. */
export function minorSafe<T extends { adultOnly?: boolean }>(events: T[], viewerIsAdult: boolean | undefined): T[] {
  return viewerIsAdult ? events : events.filter((ev) => ev.adultOnly !== true);
}

/** One five-minute area snapshot serves many users. It merges soon, quality
 * and category sweeps, rather than taking an arbitrary first 400 records. */
export async function areaCandidates(areaId: string, nowMs: number): Promise<RankableEvent[]> {
  const cacheRef = db.collection("feedCaches").doc(areaId);
  const cached = await cacheRef.get();
  const saved = cached.data();
  if (Number(saved?.cachedAtMs) > nowMs - CACHE_MS && Array.isArray(saved?.events)) {
    return saved.events as RankableEvent[];
  }
  const base = db.collection("events").where("areaId", "==", areaId).where("active", "==", true);
  const cutoff = Timestamp.fromMillis(nowMs - 3_600_000);
  const [soon, quality, ...categories] = await Promise.all([
    base.where("date", ">=", cutoff).orderBy("date").limit(180).get(),
    base.orderBy("qualityScore", "desc").limit(70).get(),
    ...DIVERSITY_CATEGORIES.map((category) =>
      base.where("category", "==", category).where("date", ">=", cutoff).orderBy("date").limit(15).get()),
  ]);
  const snapshots = [soon, quality, ...categories];
  const byId = new Map<string, RankableEvent>();
  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      const ev = rankableFromDoc(doc);
      if (ev && ev.startMs >= nowMs) byId.set(ev.id, ev);
    }
  }
  const events = Array.from(byId.values()).slice(0, MAX_CANDIDATES);
  await cacheRef.set({ cachedAtMs: nowMs, events });
  // Counts document reads returned by the candidate queries. Index-entry
  // charges and minimum query reads are reported separately in READ-BUDGET.
  const queryDocuments = snapshots.reduce((sum, snap) => sum + snap.size, 0);
  await db.collection("treasury").doc(utcMonthKey()).set({
    readTelemetry: {
      candidateDocuments: FieldValue.increment(queryDocuments),
      candidateRefreshes: FieldValue.increment(1),
    },
  }, { merge: true });
  return events;
}

/**
 * Interest-based retrieval (CAC 2026, 1.1 cause 2). The shared area snapshot is
 * soon-and-nearby: 180 by date, 70 by quality, 15 per category — mostly the
 * next day or two, so a user who picked Parks could be ranked over a pool that
 * held seven outdoor events. This adds, per DISTINCT interest set, the next
 * fourteen days of events whose topic tags or specific categories speak to
 * those interests. The matcher in interests.ts still decides what counts: the
 * tags are a superset used only to find candidates, never a match by themselves.
 *
 * Reads are bounded and shared: at most INTEREST_POOL_LIMIT + INTEREST_CATEGORY_LIMIT
 * documents per cache refresh, cached five minutes under a key made of the
 * sorted topics (so every "Parks" user and every "Trails" user shares one
 * refresh), and nothing at all for a user with no interests.
 */
const INTEREST_POOL_LIMIT = 150;
const INTEREST_CATEGORY_LIMIT = 100;
const INTEREST_HORIZON_MS = 14 * 86_400_000;

export async function interestCandidates(areaId: string, interests: readonly unknown[], nowMs: number): Promise<RankableEvent[]> {
  const terms = interestTerms(interests);
  const topics = retrievalTopics(terms);
  const categories = retrievalCategories(terms);
  if (!topics.length && !categories.length) return [];
  const key = `${areaId}__topics__${[...topics, ...categories.map((c) => `cat-${c.toLowerCase()}`)].join("_")}`.slice(0, 1400);
  const cacheRef = db.collection("feedCaches").doc(key);
  const cached = await cacheRef.get();
  const saved = cached.data();
  if (Number(saved?.cachedAtMs) > nowMs - CACHE_MS && Array.isArray(saved?.events)) {
    return saved.events as RankableEvent[];
  }
  const base = db.collection("events").where("areaId", "==", areaId).where("active", "==", true);
  const from = Timestamp.fromMillis(nowMs - 3_600_000);
  const to = Timestamp.fromMillis(nowMs + INTEREST_HORIZON_MS);
  const snapshots = await Promise.all([
    topics.length
      ? base.where("topicTags", "array-contains-any", topics).where("date", ">=", from).where("date", "<=", to).orderBy("date").limit(INTEREST_POOL_LIMIT).get()
      : null,
    categories.length
      ? base.where("category", "in", categories.slice(0, 10)).where("date", ">=", from).where("date", "<=", to).orderBy("date").limit(INTEREST_CATEGORY_LIMIT).get()
      : null,
  ]);
  const byId = new Map<string, RankableEvent>();
  let queryDocuments = 0;
  for (const snap of snapshots) {
    if (!snap) continue;
    queryDocuments += snap.size;
    for (const doc of snap.docs) {
      const ev = rankableFromDoc(doc);
      if (ev && ev.startMs >= nowMs) byId.set(ev.id, ev);
    }
  }
  const events = Array.from(byId.values());
  await cacheRef.set({ cachedAtMs: nowMs, areaId, topics, categories, events });
  await db.collection("treasury").doc(utcMonthKey()).set({
    readTelemetry: {
      interestCandidateDocuments: FieldValue.increment(queryDocuments),
      interestCandidateRefreshes: FieldValue.increment(1),
    },
  }, { merge: true });
  return events;
}

/** Build a user's ranking context from Firestore. Shared by the callable and C/E. */
export async function loadContext(uid: string, lat?: number, lng?: number, nowMs = Date.now(), filters?: ClientFilterInput): Promise<RankingContext> {
  const [userSnap, accepted, blocked] = await Promise.all([
    db.collection("users").doc(uid).get(),
    friendIds(uid, 100),
    blockedSetFor(uid),
  ]);
  const u = userSnap.data() ?? {};

  const defaultInterests: string[] = Array.isArray(u.interests)
    ? u.interests.map((i: unknown) => safeText(i, 40)).filter(Boolean).slice(0, 20) : [];
  const plus = plusActiveFrom(u, nowMs);
  const active = plus && typeof u.interestProfiles === "object" && u.interestProfiles !== null
    ? u.interestProfiles[safeText(u.activeProfileId, 64)] as InterestProfile | undefined : undefined;
  const interests = active && Array.isArray(active.interests) ? active.interests : defaultInterests;

  // Behaviour: categories of events already attended.
  const attendedCategories: Record<string, number> = {};
  const attendedOrganizers: Record<string, number> = {};
  let weekendAttended = 0;
  let totalAttended = 0;
  const attended: string[] = Array.isArray(u.checkedInEventIDs) ? u.checkedInEventIDs.slice(-40) : [];
  if (attended.length) {
    const docs = await Promise.all(attended.slice(0, 30).map((id: string) => db.collection("events").doc(String(id)).get()));
    for (const d of docs) {
      const c = String(d.data()?.category ?? "");
      if (c) attendedCategories[c] = (attendedCategories[c] ?? 0) + 1;
      const org = String(d.data()?.organizer ?? "");
      if (org) attendedOrganizers[org] = (attendedOrganizers[org] ?? 0) + 1;
      const date = d.data()?.date;
      if (date instanceof Timestamp) {
        totalAttended++;
        const day = date.toDate().getUTCDay();
        if (day === 0 || day === 6) weekendAttended++;
      }
    }
  }

  // Friends going, for the events we are about to rank. Read from the
  // attendee subcollections of followed users' RSVPs is expensive; instead we
  // read each followed user's rsvpEventIDs, which is one doc each.
  const friendsGoing: Record<string, number> = {};
  if (accepted.length) {
    const visible = accepted.filter((id) => !blocked.has(id));
    const friendDocs = await Promise.all(visible.map((id) => db.collection("users").doc(id).get()));
    for (const f of friendDocs) {
      const fd = f.data();
      if (!fd) continue;
      // Only accepted friends enter the social ranking signal. Legacy follows
      // and a profile's old public flag confer no location access.
      for (const eid of (Array.isArray(fd.rsvpEventIDs) ? fd.rsvpEventIDs : [])) {
        const k = String(eid);
        friendsGoing[k] = (friendsGoing[k] ?? 0) + 1;
      }
    }
  }

  const feedback = typeof u.eventFeedback === "object" && u.eventFeedback !== null ? u.eventFeedback : {};
  const childAges: number[] = Array.isArray(u.householdChildAges)
    ? u.householdChildAges.filter((v: unknown): v is number => typeof v === "number" &&
      Number.isInteger(v) && v >= 0 && v <= 17) : [];
  return { interests, studentStatus: u.studentStatus === true, school: safeText(u.school, 100),
    householdYoungestAge: childAges.length > 0
      ? Math.min(...childAges)
      : Number.isInteger(u.householdYoungestAge) && u.householdYoungestAge >= 0 &&
        u.householdYoungestAge <= 17 ? u.householdYoungestAge : undefined,
    accessibilityNeeds: Array.isArray(u.householdAccessibilityNeeds)
      ? u.householdAccessibilityNeeds.filter((v: unknown): v is string =>
        typeof v === "string" && ["stepFree", "accessibleRestroom", "seating", "quietSpace", "asl", "captions"].includes(v)) : [],
    transportMode: ["walk", "transit", "drive"].includes(u.householdTransportMode) ? u.householdTransportMode : undefined,
    preferredCategories: active?.categories ?? [], excludedCategories: active?.exclusions ?? [],
    radiusMiles: active?.radiusMiles ?? (Number.isInteger(u.householdRadiusMiles) &&
      u.householdRadiusMiles >= 1 && u.householdRadiusMiles <= 50 ? u.householdRadiusMiles : undefined),
    distancePreset: active?.distancePreset,
    attendedCategories, attendedOrganizers, weekendAttendanceRatio: totalAttended ? weekendAttended / totalAttended : undefined,
    savedEventIDs: Array.isArray(u.savedEventIDs) ? u.savedEventIDs.slice(-500) : [], eventFeedback: feedback,
    friendsGoing, recentOrganizers: {}, lat, lng, nowMs, viewerIsAdult: u.ageBand === "adult",
    // W3.6: precomputed, bounded per-user state; never re-aggregated from history.
    affinity: u.affinity && typeof u.affinity === "object" && typeof u.affinity.asOfMs === "number" && typeof u.affinity.totals === "object"
      ? { asOfMs: u.affinity.asOfMs, totals: u.affinity.totals } : undefined,
    firstShown: u.firstShown && typeof u.firstShown === "object" ? u.firstShown : undefined,
    hiddenEventIDs: Array.isArray(u.hiddenEventIDs) ? u.hiddenEventIDs.filter((v: unknown): v is string => typeof v === "string").slice(-500) : [],
    rsvpEventIDs: Array.isArray(u.rsvpEventIDs) ? u.rsvpEventIDs.filter((v: unknown): v is string => typeof v === "string").slice(-500) : [],
    constraints: constraintsFromFilters(filters, u, nowMs, active?.radiusMiles ?? (Number.isInteger(u.householdRadiusMiles) ? u.householdRadiusMiles : undefined)),
    notifiedEventIDs: [] };
}

/** Explicit and implicit event signals. The bounded map lives on the profile
 * already read for ranking, so feedback does not add a per-feed query. */
/** Every feedback action and its learning weight (W3.6; port of users.py ACTION_WEIGHTS). */
export const FEEDBACK_KINDS = ["more", "less", "view", "rsvp", "link", "save", "share", "tap", "hide", "report"] as const;

export const recordEventFeedback = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "recordEventFeedback");
  const eventId = safeText(req.data?.eventId, 180);
  const kind = safeText(req.data?.kind, 10);
  if (!eventId || eventId.includes("/") || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    throw new HttpsError("invalid-argument", "Invalid event feedback.");
  }
  const event = await db.collection("events").doc(eventId).get();
  if (!event.exists || event.data()?.hidden === true || event.data()?.broadcast !== true) {
    throw new HttpsError("not-found", "Event unavailable.");
  }
  const ref = db.collection("users").doc(uid);
  const topicTags: string[] = Array.isArray(event.data()?.topicTags) ? event.data()!.topicTags.filter((v: unknown): v is string => typeof v === "string") : [];
  const nowMs = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.data() ?? {};
    const update: FirebaseFirestore.DocumentData = {};
    // v1's bounded feedback map (more / less / view) — unchanged behaviour.
    if (kind === "more" || kind === "less" || kind === "view") {
      const existing = u.eventFeedback;
      const rows: Record<string, { category?: string; organizer?: string; kind: string; atMs: number }> =
        typeof existing === "object" && existing !== null ? { ...existing } : {};
      if (!(kind === "view" && (rows[eventId]?.kind === "more" || rows[eventId]?.kind === "less"))) {
        rows[eventId] = { category: safeText(event.data()?.category, 50), organizer: safeText(event.data()?.organizer, 100), kind, atMs: nowMs };
        const ids = Object.keys(rows).sort((a, b) => rows[b].atMs - rows[a].atMs);
        for (const stale of ids.slice(100)) delete rows[stale];
        update.eventFeedback = rows;
      }
    }
    // W3.6: precomputed category affinity (a view carries no weight and does not touch it).
    if ((ACTION_WEIGHTS[kind] ?? 0) !== 0) {
      const state: AffinityState | undefined = u.affinity && typeof u.affinity.asOfMs === "number" ? u.affinity : undefined;
      update.affinity = applyFeedback(state, topicTags, kind, nowMs);
    }
    // hide (−1.0) and report (0.0, hidden for the reporter only): never show this event to this user again.
    if (EXCLUDING_ACTIONS.has(kind)) {
      const hidden: string[] = Array.isArray(u.hiddenEventIDs) ? u.hiddenEventIDs.filter((v: unknown): v is string => typeof v === "string") : [];
      if (!hidden.includes(eventId)) update.hiddenEventIDs = [...hidden, eventId].slice(-500);
    }
    if (Object.keys(update).length) tx.set(ref, update, { merge: true });
  });
  return { recorded: true, weight: ACTION_WEIGHTS[kind] ?? 0, hidden: EXCLUDING_ACTIONS.has(kind) };
});

// ── config/ranking (W3.2): the switch, read with a short in-process cache ────
let cachedConfig: { at: number; value: RankingConfig } | undefined;
export async function rankingConfig(nowMs = Date.now()): Promise<RankingConfig> {
  if (cachedConfig && nowMs - cachedConfig.at < 60_000) return cachedConfig.value;
  const snap = await db.doc("config/ranking").get();
  const value = coerceRankingConfig(snap.data());
  cachedConfig = { at: nowMs, value };
  return value;
}
/** Tests and the blind judge set the switch directly; this drops the cache so the next request sees it. */
export function resetRankingConfigCache(): void { cachedConfig = undefined; }

/**
 * Rank the area's upcoming events for one user.
 *
 * Internal, so C (notifications) and E (partner surfacing) call the same code
 * path the user sees. A second ranking implementation for notifications would
 * drift from this one within a sprint.
 */
export interface RecommendOptions {
  /** Force a ranking version for this request (W3.2: both versions callable for the same request). */
  version?: RankingVersion;
  /** The app's current filter state (W3.5). */
  filters?: ClientFilterInput;
}

export async function recommendFor(
  uid: string, areaId: string, lat?: number, lng?: number, limit = 50, nowMs = Date.now(), options: RecommendOptions = {},
): Promise<ScoredEvent[]> {
  const [ctx, shared, config] = await Promise.all([
    loadContext(uid, lat, lng, nowMs, options.filters), areaCandidates(areaId, nowMs), rankingConfig(nowMs),
  ]);
  const version: RankingVersion = options.version ?? config.version;
  const candidates = new Map(shared.filter((ev) => ev.startMs >= nowMs).map((ev) => [ev.id, ev]));
  // Interest-based retrieval joins the pool BEFORE ranking, so "For You" ranks
  // the user's kind of event over the next fortnight, not just whatever is soonest.
  for (const ev of await interestCandidates(areaId, ctx.interests, nowMs)) {
    if (ev.startMs >= nowMs && !candidates.has(ev.id)) candidates.set(ev.id, ev);
  }
  // Social candidates bypass the area and category sweeps; a friend going is
  // useful even when the event is far away or outside stated interests.
  const socialIds = Object.keys(ctx.friendsGoing).slice(0, 60);
  const socialDocs = await Promise.all(socialIds.map((id) => db.collection("events").doc(id).get()));
  for (const doc of socialDocs) {
    const ev = rankableFromDoc(doc);
    if (ev && ev.startMs >= nowMs) candidates.set(ev.id, ev);
  }
  const excluded = new Set(ctx.excludedCategories ?? []);
  const hidden = new Set(ctx.hiddenEventIDs ?? []);
  const eligible = minorSafe(Array.from(candidates.values()), ctx.viewerIsAdult)
    .filter((ev) => !excluded.has(ev.category ?? "") && !hidden.has(ev.id));
  if (version === "v2") return rankEventsV2(eligible, ctx, { limit });
  const byId = new Map(eligible.map((e) => [e.id, e]));
  return rankEvents(eligible, ctx).slice(0, limit).map((s) => {
    // The exploration slot keeps its own label; every other row explains itself from its parts, plus the series note.
    const more = s.moreDates?.length ?? 0;
    const reasons = s.reasons ?? [...reasonsForV1(byId.get(s.id)!, ctx, s.parts), ...(more ? [`Repeats — ${more} more date${more > 1 ? "s" : ""}`] : [])].slice(0, 3);
    return { ...s, version: "v1" as const, reasons };
  });
}

export const recommendedEvents = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "recommendedEvents");

  const areaId = safeText(req.data?.areaId, 60) || "san-jose-ca";
  if (areaId.includes("/")) throw new HttpsError("invalid-argument", "Invalid area.");
  const lat = Number(req.data?.lat);
  const lng = Number(req.data?.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.data?.limit ?? 50)) || 50));

  const ranked = await recommendFor(uid, areaId, hasLoc ? lat : undefined, hasLoc ? lng : undefined, limit);
  if (!ranked.length) throw new HttpsError("not-found", "No upcoming events in this area yet.");

  const feedSessionId = req.data?.telemetryEnabled === true
    ? await createFeedSession(uid, areaId, ranked) : null;

  return {
    areaId,
    feedSessionId,
    personalized: true,
    rankingVersion: ranked[0]?.version ?? "v1",
    // `parts` ships so the client can explain a placement ("a friend is going")
    // and so a bad ranking is debuggable from a device instead of by guesswork.
    events: ranked.map((r) => ({ id: r.id, score: Number(r.score.toFixed(4)), parts: r.parts, reasons: r.reasons ?? [], moreDates: r.moreDates ?? [] })),
  };
});
