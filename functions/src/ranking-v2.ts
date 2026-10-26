/**
 * Ranking v2 — a line-by-line port of John's engine,
 * reference/verdure-discovery/verdure/ranking.py (+ users.py learned_affinity),
 * pinned at 0ab11e6991045eadce8a4ada61fdc9d4d3b86adf, kept behind the
 * config/ranking switch (W3.2) until the blind judge (W6.1) says it is at least
 * as good as v1.
 *
 * Every function below that ports Python carries a header naming its source so
 * John can review the port against his code. Deliberate deviations are marked
 * DEVIATION with the reason; everything else is John's rule as written.
 *
 * W3.4 — the product rules John's version lacks are kept here and tested:
 *   • Friends going: a `social` component with v1's meaning (socialScore).
 *   • Weights sum to 1.0: interest 0.30, distance 0.17, social 0.14,
 *     soonness 0.13, quality 0.12, novelty 0.08, learned affinity 0.06.
 *   • Verdure+ controls (active interest profile, saved filters, category
 *     exclusions) arrive in the context exactly as for v1.
 *   • Minor protections: adultOnly is excluded upstream (minorSafe); Program
 *     eligibility is re-checked downstream (program-feed.ts).
 *   • Partners never organic: only /events documents are ever candidates;
 *     rankableFromDoc refuses anything carrying partner fields.
 *   • Blocks: friendsGoing is built from accepted, unblocked friends only, so
 *     a blocked user never counts and never appears in a reason.
 *   • Deterministic ties by event ID.
 */

import type { RankableEvent, RankingContext, ScoredEvent } from "./ranking.js";
import { INTEREST_TO_CATEGORY, INTEREST_SYNONYMS, haversineMiles, socialScore } from "./ranking.js";
import { interestsForTopics } from "./ingest/annotate.js";
import { interestTerms, matchInterests, labelForTerm } from "./interests.js";

// ── Weights and constants ────────────────────────────────────────────────────

/** W3.4 starting weights. Asserted in a test to sum to 1.0. */
export const WEIGHTS_V2 = {
  interest: 0.30,
  distance: 0.17,
  social: 0.14,
  soonness: 0.13,
  quality: 0.12,
  novelty: 0.08,
  learnedAffinity: 0.06,
} as const;
export const WEIGHT_SUM_V2 = Object.values(WEIGHTS_V2).reduce((a, b) => a + b, 0);

/** Port of config.yaml ranking.diversity: same_category_penalty / same_organizer_penalty. */
export const DIVERSITY_V2 = { sameCategoryPenalty: 0.12, sameOrganizerPenalty: 0.15 } as const;
/** Port of config.yaml ranking.learning_rate / learned_affinity_cap. */
export const LEARNING_RATE = 0.08;
export const AFFINITY_CAP = 1.0;
/** Port of users.py FEEDBACK_HALF_LIFE_DAYS. */
export const FEEDBACK_HALF_LIFE_DAYS = 30;
/** Port of config.yaml schedule.horizon_days — the soonness window when the user set no date range. */
export const HORIZON_DAYS = 21;
/** Port of users.py UserProfile defaults. */
export const DEFAULT_MAX_DISTANCE_MILES = 10;
export const DEFAULT_DATE_RANGE_DAYS = 14;
/** Port of config.yaml notifications — notify_threshold / notify_within_days.
 *  max_per_user_per_day (2) is deliberately NOT ported: it allows 14 pushes a
 *  week, and delivery stays inside the existing MAX_PUSH_PER_WEEK notifier. */
export const NOTIFY_V2 = { threshold: 0.70, withinDays: 4 } as const;
/** Port of config.yaml ranking.max_results_per_user. */
export const MAX_RESULTS_V2 = 50;
/** Port of ranking.py: collapse_series keeps at most five later dates. */
export const MAX_MORE_DATES = 5;
const LOCAL_TZ = "America/Los_Angeles";

/**
 * Port of users.py ACTION_WEIGHTS, extended with the app's existing "more"
 * signal (DEVIATION: not in John's table; +0.6 mirrors the magnitude of his
 * "dismiss" −0.6) and with the app's names for his actions
 * (link ≙ register_click, tap ≙ click, less ≙ dismiss).
 */
export const ACTION_WEIGHTS: Record<string, number> = {
  rsvp: 1.0, link: 0.9, save: 0.8, share: 0.7, tap: 0.3, more: 0.6,
  less: -0.6, hide: -1.0, report: 0.0, view: 0,
};
/** Port of users.py EXCLUDING_ACTIONS — hidden for this user forever. (report hides for the reporter only.) */
export const EXCLUDING_ACTIONS: ReadonlySet<string> = new Set(["hide", "report"]);
/** Port of users.py ENGAGED_ACTIONS. */
export const ENGAGED_ACTIONS: ReadonlySet<string> = new Set(["rsvp", "link", "save"]);

// ── Constraints (W3.5): the app's existing filters mapped onto John's ───────

/** Port of users.py UserProfile constraint fields; every value optional — unknown never filters. */
export interface V2Constraints {
  /** radius → max_distance_miles */
  maxDistanceMiles?: number;
  /** date range → date window (days from now); undefined = no window */
  dateWindowDays?: number;
  /** explicit start/end for "this weekend" windows */
  windowStartMs?: number;
  windowEndMs?: number;
  /** "Free only" → max_price 0 */
  maxPrice?: number;
  /** event setting indoor / outdoor → indoor_only / outdoor-only; virtual → formats ["online"] */
  indoorOnly?: boolean;
  outdoorOnly?: boolean;
  formats?: Array<"in_person" | "online" | "hybrid">;
  /** household children's ages (Profile) → child_ages */
  childAges?: number[];
}

/** The app's DiscoveryFilterState fields the client sends with a ranking request. */
export interface ClientFilterInput {
  radiusMiles?: unknown; dateRange?: unknown; price?: unknown; eventSetting?: unknown;
}

/**
 * Map the app's filter state (DiscoveryFilters.swift) and profile onto John's
 * constraints. Unknown or absent values map to "no constraint".
 */
export function constraintsFromFilters(input: ClientFilterInput | undefined, profile: { householdChildAges?: unknown; householdRadiusMiles?: unknown }, nowMs: number, radiusFromProfile?: number): V2Constraints {
  const out: V2Constraints = {};
  const radius = Number(input?.radiusMiles);
  if (Number.isFinite(radius) && radius >= 1 && radius <= 100) out.maxDistanceMiles = radius;
  else if (radiusFromProfile && radiusFromProfile >= 1) out.maxDistanceMiles = radiusFromProfile;
  switch (input?.dateRange) {
    case "today": out.dateWindowDays = 1; break;
    case "thisWeek": out.dateWindowDays = 7; break;
    case "thisMonth": out.dateWindowDays = 30; break;
    case "thisWeekend": {
      const w = weekendWindow(nowMs);
      out.windowStartMs = w.startMs; out.windowEndMs = w.endMs;
      break;
    }
    default: break;   // "any" or absent: no window
  }
  if (input?.price === "free") out.maxPrice = 0;
  if (input?.eventSetting === "indoor") out.indoorOnly = true;
  else if (input?.eventSetting === "outdoor") out.outdoorOnly = true;
  else if (input?.eventSetting === "virtual") out.formats = ["online"];
  const ages = Array.isArray(profile.householdChildAges)
    ? profile.householdChildAges.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 17) : [];
  if (ages.length) out.childAges = ages;
  return out;
}

/** Saturday 00:00 through Monday 00:00 in the launch zone (the app's DateRangeOption.thisWeekend). */
export function weekendWindow(nowMs: number): { startMs: number; endMs: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const value = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = value("weekday");
  const toSaturday: Record<string, number> = { Sun: -1, Mon: 5, Tue: 4, Wed: 3, Thu: 2, Fri: 1, Sat: 0 };
  const noon = Date.parse(`${value("year")}-${value("month")}-${value("day")}T12:00:00Z`);
  const saturday = new Date(noon + (toSaturday[weekday] ?? 0) * 86_400_000).toISOString().slice(0, 10);
  const monday = new Date(Date.parse(`${saturday}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  // Local midnights via the Intl offset at those dates.
  const localMidnight = (day: string) => {
    const guess = Date.parse(`${day}T08:00:00Z`);   // 00:00 PST; corrected below for PDT
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(guess)));
    return guess - hour * 3_600_000;
  };
  return { startMs: Math.max(localMidnight(saturday), nowMs), endMs: localMidnight(monday) };
}

// ── Event format (John's `format` field, derived) ───────────────────────────

const ONLINE_TEXT = /\b(?:virtual|online|zoom|webinar|livestream|live stream)\b/i;

/** John's Event.format, derived from what the store knows. "unknown" never filters. */
export function eventFormat(ev: RankableEvent): "in_person" | "online" | "hybrid" | "unknown" {
  if (ev.virtual === true || ONLINE_TEXT.test(`${ev.locationName ?? ""} ${ev.title ?? ""}`)) return "online";
  if (ev.virtual === false || (ev.latitude !== undefined && ev.longitude !== undefined)) return "in_person";
  return "unknown";
}

// ── Port of ranking.py: passes_filters() ────────────────────────────────────

/**
 * Port of ranking.py: passes_filters(ev, user, point, horizon_days).
 * Returns [passes, distanceMiles]. DEVIATION (W3.5): an in-person event with no
 * coordinates is KEPT (John drops it when the user has a point) — unknown
 * values never filter; it ranks lower through the neutral distance score.
 * DEVIATION (W3.5): with no date range chosen there is no date window; John
 * always bounds by date_range_days (default 14).
 */
export function passesFilters(ev: RankableEvent, c: V2Constraints, ctx: RankingContext): [boolean, number | undefined] {
  const now = ctx.nowMs;
  const end = ev.endMs ?? ev.startMs;
  if (end < now) return [false, undefined];
  if (c.windowStartMs !== undefined && c.windowEndMs !== undefined) {
    if (ev.startMs < c.windowStartMs || ev.startMs >= c.windowEndMs) return [false, undefined];
  } else if (c.dateWindowDays !== undefined) {
    const windowEnd = now + Math.min(c.dateWindowDays, HORIZON_DAYS) * 86_400_000;
    if (ev.startMs > windowEnd) return [false, undefined];
  }

  const format = eventFormat(ev);
  if (c.formats && format !== "unknown" && !c.formats.includes(format)) {
    if (!(format === "hybrid" && (c.formats.includes("online") || c.formats.includes("in_person")))) return [false, undefined];
  }

  let distance: number | undefined;
  if (format !== "online") {
    if (ctx.lat !== undefined && ctx.lng !== undefined && ev.latitude !== undefined && ev.longitude !== undefined) {
      distance = haversineMiles(ctx.lat, ctx.lng, ev.latitude, ev.longitude);
      if (c.maxDistanceMiles !== undefined && distance > c.maxDistanceMiles) return [false, distance];
    }
    // John: `elif point: return False` — see DEVIATION above.
  }

  if (c.maxPrice !== undefined && ev.priceMin !== undefined && ev.priceMin > c.maxPrice) return [false, distance];
  if (c.maxPrice === 0 && ev.isFree === false && ev.priceMin === undefined) return [false, distance];

  if (c.childAges?.length) {
    const lo = ev.minimumAge ?? 0;
    const hi = ev.maximumAge ?? 200;
    if (!c.childAges.some((age) => lo <= age && age <= hi)) return [false, distance];
  }

  if (c.indoorOnly && ev.indoorOutdoor === "outdoor") return [false, distance];
  if (c.outdoorOnly && ev.indoorOutdoor === "indoor") return [false, distance];
  return [true, distance];
}

// ── Port of users.py: learned_affinity() — precomputed (W3.6) ───────────────

/** The per-user map precomputed at feedback time. `totals` are decayed sums of action weights per topic tag. */
export interface AffinityState { asOfMs: number; totals: Record<string, number> }

/** Exponential decay factor for `ageMs` under the 30-day half-life (users.py: 0.5 ** (age_days / FEEDBACK_HALF_LIFE_DAYS)). */
export function affinityDecay(ageMs: number): number {
  return Math.pow(0.5, Math.max(0, ageMs) / (FEEDBACK_HALF_LIFE_DAYS * 86_400_000));
}

/** Fold one action into the state: decay what is there, then add the weight to each of the event's topic tags. */
export function applyFeedback(state: AffinityState | undefined, topicTags: readonly string[], action: string, nowMs: number): AffinityState {
  const weight = ACTION_WEIGHTS[action] ?? 0;
  const decay = state ? affinityDecay(nowMs - state.asOfMs) : 1;
  const totals: Record<string, number> = {};
  for (const [tag, v] of Object.entries(state?.totals ?? {})) {
    const decayed = v * decay;
    if (Math.abs(decayed) >= 0.001) totals[tag] = Number(decayed.toFixed(4));
  }
  if (weight !== 0) for (const tag of topicTags) if (tag && tag !== "other") totals[tag] = Number(((totals[tag] ?? 0) + weight).toFixed(4));
  // Bound the map: John's categories number 19; keep the 40 strongest.
  const kept = Object.entries(totals).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 40);
  return { asOfMs: nowMs, totals: Object.fromEntries(kept) };
}

/** Port of users.py learned_affinity(): tanh(total * learning_rate * 5) * cap, in [-cap, cap], read from the precomputed state. */
export function learnedAffinity(state: AffinityState | undefined, nowMs: number): Record<string, number> {
  if (!state) return {};
  const decay = affinityDecay(nowMs - state.asOfMs);
  const out: Record<string, number> = {};
  for (const [tag, total] of Object.entries(state.totals)) {
    const v = Math.tanh(total * decay * LEARNING_RATE * 5) * AFFINITY_CAP;
    out[tag] = Math.max(-AFFINITY_CAP, Math.min(AFFINITY_CAP, v));
  }
  return out;
}

// ── Port of users.py: UserState.days_since_first_shown() — one document (W3.6) ──

/** Cap for the per-user "first shown" map; the oldest entries are dropped. */
export const FIRST_SHOWN_CAP = 500;

export function daysSinceFirstShown(firstShown: Record<string, number> | undefined, eventId: string, nowMs: number): number | null {
  const ms = firstShown?.[eventId];
  if (typeof ms !== "number") return null;
  return (nowMs - ms) / 86_400_000;
}

/** Port of users.py UserState.mark_shown(): first sighting wins; the map is capped at 500, oldest dropped. */
export function markShown(firstShown: Record<string, number> | undefined, eventIds: readonly string[], nowMs: number): Record<string, number> {
  const next: Record<string, number> = { ...(firstShown ?? {}) };
  for (const id of eventIds) if (!(id in next)) next[id] = nowMs;
  const entries = Object.entries(next);
  if (entries.length <= FIRST_SHOWN_CAP) return next;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, FIRST_SHOWN_CAP));
}

// ── Port of ranking.py: score_event() ───────────────────────────────────────

export interface RankedV2 {
  id: string;
  score: number;
  components: Record<string, number>;
  reasons: string[];
  distanceMiles?: number;
  diversityPenalty: number;
  engaged: boolean;
  notify: boolean;
  moreDates: string[];
  final: number;
}

/** Port of ranking.py PRETTY, extended to the app's interest vocabulary. */
export const PRETTY: Record<string, string> = {
  kids: "kids' activities", outdoors: "the outdoors", arts: "arts", family: "family activities", music: "music",
  food: "food", tech: "tech", learning: "learning", community: "your community", volunteering: "volunteering",
  fitness: "fitness", hiking: "hiking",
};

/**
 * Does this event match one of the user's interests? Returns the matching
 * server TERMS. The user's stored values are normalised first (interests.ts):
 * the app saves PlaceCategory labels such as "Parks", and before CAC 2026 none
 * of them could match here. John's topic-tag path is kept (port fidelity),
 * joined by v1's precise matcher, the specific-category map and the aliases.
 */
export function matchedInterests(ev: RankableEvent, interests: readonly string[]): string[] {
  const wanted = new Set(interestTerms(interests));
  if (!wanted.size) return [];
  const fromTopics = interestsForTopics(ev.topicTags ?? []).filter((i) => wanted.has(i));
  const fromPrecise = matchInterests(ev, interests).map((m) => m.term);
  const cat = ev.category ?? "";
  const fromCategory = [...wanted].filter((i) => (INTEREST_TO_CATEGORY[i] ?? []).includes(cat));
  const text = ` ${[ev.title, ev.description, ...(ev.tags ?? [])].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const fromSynonyms = [...wanted].filter((i) => (INTEREST_SYNONYMS[i] ?? []).some((term) => text.includes(` ${term} `)));
  return [...new Set([...fromPrecise, ...fromTopics, ...fromCategory, ...fromSynonyms])];
}

/** The name a reason uses for a matched term: the user's own pick when it produced the term ("Parks"), else the term's plain name. */
export function interestDisplayName(interests: readonly string[], term: string): string {
  return labelForTerm(interests, term);
}

function localWeekday(ms: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TZ, weekday: "short" }).format(new Date(ms));
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);   // Python weekday(): Monday = 0
}

/**
 * Port of ranking.py: score_event(ev, user, distance, affinity, state, weights, horizon_days),
 * plus the W3.4 `social` component.
 */
export function scoreEventV2(ev: RankableEvent, ctx: RankingContext, distance: number | undefined, affinity: Record<string, number>, c: V2Constraints): RankedV2 {
  const reasons: string[] = [];
  const comps: Record<string, number> = {};
  const now = ctx.nowMs;

  // Interest match
  const matched = matchedInterests(ev, ctx.interests);
  if (!ctx.interests.length) comps.interest = 0.5;
  else {
    comps.interest = matched.length ? 1.0 : 0.0;
    if (matched.length) reasons.push(`Matches your interest in ${interestDisplayName(ctx.interests, matched[0])}`);
  }

  // Distance
  const maxDistance = c.maxDistanceMiles ?? ctx.radiusMiles ?? DEFAULT_MAX_DISTANCE_MILES;
  if (eventFormat(ev) === "online") {
    comps.distance = 0.7;
    reasons.push("Online — join from anywhere");
  } else if (distance !== undefined) {
    comps.distance = Math.max(0, 1 - distance / Math.max(maxDistance, 0.1));
    if (distance <= 2) reasons.push(`Close by (${distance.toFixed(1)} mi)`);
    else if (distance <= maxDistance / 2) reasons.push(`Near your selected area (${distance.toFixed(1)} mi)`);
  } else {
    comps.distance = 0.5;
  }

  // Social (W3.4): the same meaning as v1's socialScore.
  const friends = ctx.friendsGoing[ev.id] ?? 0;
  comps.social = socialScore(ev, ctx);
  if (friends === 1) reasons.push("A friend is going");
  else if (friends > 1) reasons.push(`${friends} friends are going`);

  // Soonness
  const daysOut = Math.max((ev.startMs - now) / 86_400_000, 0);
  const window = Math.max(Math.min(c.dateWindowDays ?? DEFAULT_DATE_RANGE_DAYS, HORIZON_DAYS), 1);
  comps.soonness = Math.max(0, 1 - daysOut / window);
  if (daysOut < 1) reasons.push("Happening today");
  else if (localWeekday(ev.startMs) >= 5 && daysOut <= 7) reasons.push("This weekend");

  // Listing quality (the frozen classifier's qualityScore stands in for validate.py's completeness score)
  comps.quality = typeof ev.qualityScore === "number" && Number.isFinite(ev.qualityScore) ? Math.max(0, Math.min(1, ev.qualityScore)) : 0.35;
  if (ev.isFree === true) reasons.push("Free");

  // Novelty: brand-new to this user scores highest, fades over a week of being shown
  const seen = daysSinceFirstShown(ctx.firstShown, ev.id, now);
  comps.novelty = seen === null ? 1.0 : Math.max(0.3, 1 - seen / 7);
  if (seen === null) reasons.push("New for you");

  // Learned affinity from feedback, mapped from [-1, 1] to [0, 1]
  const tags = (ev.topicTags ?? []).filter((t) => t in affinity);
  const aff = tags.length ? tags.reduce((s, t) => s + affinity[t], 0) / tags.length : 0;
  comps.learnedAffinity = (aff + 1) / 2;
  if (aff >= 0.25) reasons.push("Similar to events you've saved");

  if (c.childAges?.length && (ev.minimumAge !== undefined || ev.maximumAge !== undefined)) reasons.push("Fits your child's age");

  const score = (
    WEIGHTS_V2.interest * comps.interest + WEIGHTS_V2.distance * comps.distance + WEIGHTS_V2.social * comps.social +
    WEIGHTS_V2.soonness * comps.soonness + WEIGHTS_V2.quality * comps.quality + WEIGHTS_V2.novelty * comps.novelty +
    WEIGHTS_V2.learnedAffinity * comps.learnedAffinity) / WEIGHT_SUM_V2;
  const rounded = Object.fromEntries(Object.entries(comps).map(([k, v]) => [k, Number(v.toFixed(3))]));
  return { id: ev.id, score: Number(score.toFixed(4)), components: rounded, reasons,
    distanceMiles: distance !== undefined ? Number(distance.toFixed(2)) : undefined,
    diversityPenalty: 0, engaged: false, notify: false, moreDates: [], final: Number(score.toFixed(4)) };
}

// ── Port of ranking.py: diversify() ─────────────────────────────────────────

/** Port of ranking.py _primary(): the first inferred label (topicTags[0]), falling back to the app category. */
export function primaryLabel(ev: RankableEvent): string {
  return (ev.topicTags?.[0] && ev.topicTags[0] !== "other") ? ev.topicTags[0] : (ev.category ?? "other");
}

/**
 * Port of ranking.py: diversify(items, cat_pen, org_pen, limit).
 * Greedy re-rank: each pick penalizes later events from the same category/organizer.
 * Ties break by event id (W3.4 determinism; John's max() keeps pool order).
 */
export function diversifyV2(items: RankedV2[], byId: Map<string, RankableEvent>, catPen: number, orgPen: number, limit: number): RankedV2[] {
  const pool = [...items].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const picked: RankedV2[] = [];
  const catCounts = new Map<string, number>();
  const orgCounts = new Map<string, number>();
  while (pool.length && picked.length < limit) {
    let best: RankedV2 | undefined;
    for (const r of pool) {
      const ev = byId.get(r.id)!;
      const org = (ev.organizer ?? "").toLowerCase();
      r.diversityPenalty = catPen * (catCounts.get(primaryLabel(ev)) ?? 0) + orgPen * (org ? (orgCounts.get(org) ?? 0) : 0);
      r.final = Number(Math.max(r.score - r.diversityPenalty, 0).toFixed(4));
      if (!best || r.final > best.final || (r.final === best.final && r.id.localeCompare(best.id) < 0)) best = r;
    }
    const chosen = best!;
    pool.splice(pool.indexOf(chosen), 1);
    picked.push(chosen);
    const ev = byId.get(chosen.id)!;
    catCounts.set(primaryLabel(ev), (catCounts.get(primaryLabel(ev)) ?? 0) + 1);
    const org = (ev.organizer ?? "").toLowerCase();
    if (org) orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1);
  }
  return picked;
}

// ── Port of ranking.py: _series_key() / collapse_series() ───────────────────

/** Port of ranking.py: _series_key(ev) — occurrences of one recurring series share a source, title and venue (and format). */
export function seriesKey(ev: RankableEvent): string {
  const title = (ev.titleKey ?? ev.title ?? "").trim().toLowerCase();
  const venue = (ev.venueKey ?? ev.locationName ?? "").trim().toLowerCase();
  return `${ev.source ?? ""}|${title}|${venue}|${eventFormat(ev)}`;
}

/** Port of ranking.py: collapse_series(candidates). Keep only the next occurrence of each series; a saved occurrence wins. */
export function collapseSeries(candidates: RankedV2[], byId: Map<string, RankableEvent>): RankedV2[] {
  const groups = new Map<string, RankedV2[]>();
  for (const r of candidates) {
    const key = seriesKey(byId.get(r.id)!);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out: RankedV2[] = [];
  for (const items of groups.values()) {
    items.sort((a, b) => byId.get(a.id)!.startMs - byId.get(b.id)!.startMs || a.id.localeCompare(b.id));
    const keep = items.find((r) => r.engaged) ?? items[0];
    keep.moreDates = items.filter((r) => r !== keep).map((r) => new Date(byId.get(r.id)!.startMs).toISOString()).slice(0, MAX_MORE_DATES);
    if (keep.moreDates.length) keep.reasons.push(`Repeats — ${items.length - 1} more date${items.length > 2 ? "s" : ""}`);
    out.push(keep);
  }
  return out;
}

// ── Port of ranking.py: rank_for_user() ─────────────────────────────────────

export interface RankV2Options {
  constraints?: V2Constraints;
  limit?: number;
}

/**
 * Port of ranking.py: rank_for_user(events, user, state, affinity, excluded, engaged, cfg).
 * Returns ScoredEvent-shaped rows so every caller of v1 can consume v2 unchanged.
 */
export function rankEventsV2(events: RankableEvent[], ctx: RankingContext, opts: RankV2Options = {}): ScoredEvent[] {
  const c = opts.constraints ?? ctx.constraints ?? {};
  const limit = opts.limit ?? MAX_RESULTS_V2;
  const affinity = learnedAffinity(ctx.affinity, ctx.nowMs);
  const excluded = new Set<string>([...(ctx.hiddenEventIDs ?? [])]);
  const engaged = new Set<string>([...(ctx.savedEventIDs ?? []), ...(ctx.rsvpEventIDs ?? [])]);
  const byId = new Map(events.map((e) => [e.id, e]));

  const candidates: RankedV2[] = [];
  for (const ev of events) {
    if (excluded.has(ev.id)) continue;
    const [ok, distance] = passesFilters(ev, c, ctx);
    if (!ok) continue;
    const r = scoreEventV2(ev, ctx, distance, affinity, c);
    r.engaged = engaged.has(ev.id);
    if (r.engaged) r.reasons.unshift("You saved this");
    candidates.push(r);
  }

  const collapsed = collapseSeries(candidates, byId);
  const ranked = diversifyV2(collapsed, byId, DIVERSITY_V2.sameCategoryPenalty, DIVERSITY_V2.sameOrganizerPenalty, limit);

  // Port of ranking.py: notification eligibility (score ≥ threshold, starts within 4 days, not saved, not already notified).
  // The daily budget is NOT ported; the notifier applies MAX_PUSH_PER_WEEK.
  const soon = ctx.nowMs + NOTIFY_V2.withinDays * 86_400_000;
  const notified = new Set(ctx.notifiedEventIDs ?? []);
  for (const r of ranked) {
    const ev = byId.get(r.id)!;
    r.notify = r.final >= NOTIFY_V2.threshold && ev.startMs <= soon && !r.engaged && !notified.has(r.id);
  }

  return ranked.map((r) => ({
    id: r.id, score: r.final,
    parts: { ...r.components, diversity: Number((1 - r.diversityPenalty).toFixed(3)) },
    reasons: r.reasons.slice(0, 3), moreDates: r.moreDates, notify: r.notify, version: "v2" as const,
  }));
}

// ── Reasons for v1 (W5): generated from v1's own component values ────────────

/** v1 produces up to three reasons from its own `parts`; each one is backed by a component value above a documented threshold. */
export const V1_REASON_RULES: Array<{ part: string; min: number; text: (ev: RankableEvent, ctx: RankingContext, value: number) => string | null }> = [
  { part: "social", min: 0.69, text: (ev, ctx) => { const n = ctx.friendsGoing[ev.id] ?? 0; return n === 1 ? "A friend is going" : n > 1 ? `${n} friends are going` : null; } },
  // "Because you like Parks" names the user's OWN pick and is emitted only when
  // that pick matched this listing directly (parts.interestMatch, not a floor or
  // behaviour). A high interest term with no direct match is behavioural.
  { part: "interest", min: 0.9, text: (ev, ctx, _value) => {
    const direct = matchInterests(ev, ctx.interests).find((m) => m.strength >= 0.9);
    // The user's own pick verbatim ("Parks"); a stored server term reads as its plain name ("family activities").
    if (direct) return `Because you like ${labelForTerm(ctx.interests, direct.term)}`;
    const attendedTotal = Object.values(ctx.attendedCategories ?? {}).reduce((a, b) => a + b, 0);
    return attendedTotal > 0 && (ctx.attendedCategories[ev.category ?? ""] ?? 0) > 0 ? "Matches what you've attended" : null;
  } },
  { part: "distance", min: 0.75, text: (ev, ctx) => ctx.lat !== undefined && ctx.lng !== undefined && ev.latitude !== undefined && ev.longitude !== undefined
    ? `Close by (${haversineMiles(ctx.lat, ctx.lng, ev.latitude, ev.longitude).toFixed(1)} mi)` : null },
  { part: "timing", min: 0.8, text: (ev, ctx) => (ev.startMs - ctx.nowMs) < 86_400_000 ? "Happening today or tomorrow" : "Coming up this week" },
  { part: "feedback", min: 0.7, text: () => "Similar to events you've saved" },
  { part: "quality", min: 0.85, text: (ev) => ev.isFree === true ? "Free" : "Complete listing" },
  { part: "novelty", min: 1, text: (ev) => ev.organizer ? `Something new from ${ev.organizer}` : "New for you" },
];

export function reasonsForV1(ev: RankableEvent, ctx: RankingContext, parts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const rule of V1_REASON_RULES) {
    const value = parts[rule.part];
    if (typeof value !== "number" || value < rule.min) continue;
    const text = rule.text(ev, ctx, value);
    if (text) out.push(text);
    if (out.length === 3) break;
  }
  return out;
}

// ── config/ranking (W3.2) ───────────────────────────────────────────────────

export type RankingVersion = "v1" | "v2";
export interface RankingConfig {
  version: RankingVersion;
  /** W6.2 live comparison thresholds live here too. */
  interleave?: { enabled: boolean; minSessions: number; nudge: number };
  updatedAtMs?: number;
  setBy?: string;
}
export const DEFAULT_RANKING_CONFIG: RankingConfig = { version: "v1", interleave: { enabled: false, minSessions: 300, nudge: 0.05 } };

export function coerceRankingConfig(raw: unknown): RankingConfig {
  const d = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const version: RankingVersion = d.version === "v2" ? "v2" : "v1";
  const il = (d.interleave && typeof d.interleave === "object") ? d.interleave as Record<string, unknown> : {};
  return {
    version,
    interleave: {
      enabled: il.enabled === true,
      minSessions: Number.isInteger(il.minSessions) && (il.minSessions as number) >= 1 ? il.minSessions as number : 300,
      nudge: typeof il.nudge === "number" && il.nudge > 0 && il.nudge <= 0.1 ? il.nudge : 0.05,
    },
    updatedAtMs: typeof d.updatedAtMs === "number" ? d.updatedAtMs : undefined,
    setBy: typeof d.setBy === "string" ? d.setBy : undefined,
  };
}
