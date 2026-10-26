/**
 * Adventure engine — a deterministic, model-free itinerary builder.
 *
 * WHY THIS EXISTS (CAC 2026, 1.2). The planner shipped behind an Anthropic key
 * that was never set, so the tile was visible and every tap returned "isn't
 * switched on yet". No key is being bought. This engine builds the plan from
 * the same candidate allowlist the model would have been handed, with rules a
 * picky local would apply, and planAdventure uses it whenever no key exists.
 * The model path stays intact and is used only when a key is configured; its
 * output still goes through the same allowlist guarantee.
 *
 * The rules, each of which has a test in scripts/adventure-engine-unit.mjs:
 *   • member-only organisations (clubs, lodges, societies, congregations tagged
 *     as community centres) are never stops;
 *   • posted hours are honoured per stop at the time you would ARRIVE, not just
 *     for the outing as a whole; at most ONE stop with unposted hours per plan,
 *     and after dark an outdoor place with unposted hours is not assumed open;
 *   • stops that match the user's picks are strongly preferred — an off-topic
 *     stop costs more than any distance advantage can buy back — and when the
 *     user made several picks each one gets a stop if a candidate exists;
 *   • heat shortens outdoor time (85 °F: ≤ 45-minute stops; 95 °F: ≤ 30 and an
 *     indoor stop is allowed in even when it is off-topic) and rain prefers
 *     shelter and short hops;
 *   • plain outdoor stops finish before sunset; a sunset spot or an indoor stop
 *     may run on and goes last; a trail is never a stop after dark;
 *   • the order is nearest-neighbour from where the user is, travel time is
 *     deducted from the budget, and the plan never runs over the minutes asked;
 *   • every sentence is built from phrase pools with no phrase used twice in a
 *     plan; every "why" states only facts the engine actually has (your pick,
 *     distance, minutes, posted hours, the weather) — nothing about benches,
 *     lawns, views or paths the place may not have;
 *   • a sparse area (two or three candidates) still yields a plan, and when
 *     nothing nearby is open the plan says so instead of inventing one.
 *
 * Pure: same inputs → same plan. Time zone, weather and the clock are inputs.
 */

export interface EngineCandidate {
  id: string;
  name: string;
  /** PlaceCategory raw value from the app ("Parks", "Trails", …) or a provider category. */
  category?: string;
  latitude?: number;
  longitude?: number;
  /** Raw OSM opening_hours (or provider hours) string; undefined = unposted. */
  hours?: string;
}

export interface EngineWeather {
  temperatureF: number;
  /** mm of precipitation right now. */
  precipitation: number;
  /** WMO weather code. */
  code: number;
  summary: string;
  /** Local sunset / sunrise for today, epoch ms, when known. */
  sunsetMs?: number;
  sunriseMs?: number;
}

export interface EngineInput {
  candidates: EngineCandidate[];
  /** The user's picks, as stored (PlaceCategory labels). */
  interests: string[];
  /** "morning" | "midday" | "afternoon" | "evening" | "night" (the client's clock). */
  timeOfDay: string;
  durationMinutes: number;
  weather: EngineWeather | null;
  /** Where the user is. */
  lat: number;
  lng: number;
  /** The clock, epoch ms. */
  nowMs: number;
  /** IANA zone for the hours parser and the sunset sentence. */
  timeZone?: string;
}

export interface EngineStop {
  placeId: string;
  name: string;
  order: number;
  minutes: number;
  why: string;
  /** Diagnostics for tests and the review: never shown to users. */
  meta: { travelMinutes: number; distanceMiles: number; arriveMs: number; onTopic: boolean; weatherPick: boolean; hoursKnown: boolean; openState: OpenState };
}

export interface EnginePlan {
  title: string;
  intro: string;
  stops: EngineStop[];
  /** One-line notes the client shows under the plan (sunset, heat, rain, unposted hours, or why there is no plan). */
  notes: string[];
  /** Why candidates were skipped, for the review and the tests. */
  skipped: Array<{ id: string; name: string; reason: string }>;
}

export type OpenState = "open" | "closed" | "unknown";

// ── Geography and travel ────────────────────────────────────────────────────

const MILE_M = 1609.344;
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h))) / MILE_M;
}

/** Walking at 3 mph up to 1.2 mi; beyond that, a short drive or ride at ~18 mph plus 6 minutes to park and walk in. */
export function travelMinutes(miles: number): number {
  if (miles <= 1.2) return Math.max(3, Math.round((miles / 3) * 60));
  return Math.round((miles / 18) * 60) + 6;
}

// ── Opening hours (OSM opening_hours, the common shapes) ────────────────────

const DAY_INDEX: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

/** Minutes since local midnight and local weekday for an instant in a zone. */
export function localClock(ms: number, timeZone = "America/Los_Angeles"): { minutes: number; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24, minute = Number(get("minute"));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { minutes: hour * 60 + minute, weekday, hour };
}

interface HoursRule { days: Set<number> | null; ranges: Array<[number, number]> | "closed" | "24/7" | "daylight" }

/** Parse the OSM shapes that cover the overwhelming majority of park, garden and centre tags. Unknown syntax → null (unposted). */
export function parseOpeningHours(raw: string | undefined): HoursRule[] | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^24\/7$/i.test(text)) return [{ days: null, ranges: "24/7" }];
  if (/^(sunrise|dawn)\s*-\s*(sunset|dusk)$/i.test(text)) return [{ days: null, ranges: "daylight" }];
  const rules: HoursRule[] = [];
  for (const part of text.split(/\s*;\s*/)) {
    if (!part) continue;
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*)?)+)?\s*(off|closed|24\/7|(?:sunrise|dawn)\s*-\s*(?:sunset|dusk)|(?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*)?)+)$/i.exec(part.trim());
    if (!m) return null;
    let days: Set<number> | null = null;
    if (m[1]) {
      days = new Set();
      for (const token of m[1].split(/\s*,\s*/).filter(Boolean)) {
        if (/^PH$/i.test(token)) continue;
        const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?$/i.exec(token.trim());
        if (!range) return null;
        const from = DAY_INDEX[range[1].toLowerCase()], to = range[2] ? DAY_INDEX[range[2].toLowerCase()] : from;
        for (let d = from; ; d = (d + 1) % 7) { days.add(d); if (d === to) break; }
      }
    }
    const spec = m[2].toLowerCase();
    if (spec === "off" || spec === "closed") rules.push({ days, ranges: "closed" });
    else if (spec === "24/7") rules.push({ days, ranges: "24/7" });
    else if (/^(sunrise|dawn)/.test(spec)) rules.push({ days, ranges: "daylight" });
    else {
      const ranges: Array<[number, number]> = [];
      for (const r of spec.split(/\s*,\s*/)) {
        const t = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(r.trim());
        if (!t) return null;
        ranges.push([Number(t[1]) * 60 + Number(t[2]), Number(t[3]) * 60 + Number(t[4])]);
      }
      rules.push({ days, ranges });
    }
  }
  return rules.length ? rules : null;
}

/** Is the place open at `ms`? Later rules override earlier ones for the same day (OSM semantics). */
export function openStateAt(raw: string | undefined, ms: number, timeZone: string, daylight?: { sunriseMs?: number; sunsetMs?: number }): OpenState {
  const rules = parseOpeningHours(raw);
  if (!rules) return "unknown";
  const { minutes, weekday } = localClock(ms, timeZone);
  let state: OpenState = "closed";
  let matched = false;
  for (const rule of rules) {
    if (rule.days && !rule.days.has(weekday)) continue;
    matched = true;
    if (rule.ranges === "closed") state = "closed";
    else if (rule.ranges === "24/7") state = "open";
    else if (rule.ranges === "daylight") {
      if (daylight?.sunriseMs !== undefined && daylight?.sunsetMs !== undefined) state = ms >= daylight.sunriseMs && ms <= daylight.sunsetMs ? "open" : "closed";
      else state = minutes >= 7 * 60 && minutes <= 18 * 60 ? "open" : "closed";   // conservative daylight when the sun times are unknown
    } else {
      state = rule.ranges.some(([a, b]) => (b > a ? minutes >= a && minutes < b : minutes >= a || minutes < b)) ? "open" : "closed";
    }
  }
  return matched ? state : "closed";
}

// ── Relevance ───────────────────────────────────────────────────────────────

/** Place categories that satisfy an interest pick (the app's PlaceCategory labels on both sides). */
const RELATED: Record<string, string[]> = {
  parks: ["parks", "gardens", "playgrounds", "scenic", "trails"],
  trails: ["trails", "parks", "scenic"],
  gardens: ["gardens", "parks"],
  playgrounds: ["playgrounds", "parks"],
  waterfront: ["waterfront", "scenic", "trails"],
  sports: ["sports", "parks"],
  scenic: ["scenic", "trails", "waterfront", "parks"],
  community: ["community", "parks"],
};
const OUTDOOR = new Set(["parks", "trails", "gardens", "playgrounds", "waterfront", "scenic"]);
/** Categories a cold-start adult is not steered to unless picked. */
const SPECIALISED = new Set(["playgrounds", "sports"]);
const SUNSET_SPOTS = new Set(["scenic", "waterfront"]);
const INDOORISH = new Set(["community", "sports"]);
const SHADED = new Set(["gardens", "community", "trails"]);

/** 1 = a pick's own category, 0.6 = related, 0 = off-topic. With no picks: 0.5 for general places, 0.3 for specialised ones (playgrounds, sports). */
export function topicScore(category: string | undefined, interests: readonly string[]): number {
  const cat = String(category ?? "").toLowerCase();
  const picks = interests.map((i) => String(i).toLowerCase()).filter((i) => i in RELATED);
  if (!picks.length) return SPECIALISED.has(cat) ? 0.3 : 0.5;
  if (picks.includes(cat)) return 1;
  if (picks.some((p) => RELATED[p].includes(cat))) return 0.6;
  return 0;
}

/** Clubs, lodges, societies and congregations: a community centre you cannot just walk into. */
export const MEMBER_ONLY = /(?<![\p{L}\p{N}_])(?:club|clubhouse|society|lodge|masonic|masons|elks|moose|eagles|vfw|american legion|legion|fraternal|fraternity|sorority|order of|knights of|grange|yacht club|country club|members? only|private|church|chapel|cathedral|temple|mosque|masjid|synagogue|gurdwara|parish|ministry|ministries|congregation|fellowship hall)(?![\p{L}\p{N}_])/iu;
export function isMemberOnly(c: EngineCandidate): boolean {
  return String(c.category ?? "").toLowerCase() === "community" && MEMBER_ONLY.test(c.name);
}

// ── Wording ─────────────────────────────────────────────────────────────────

const TITLES: Record<string, string[]> = {
  morning: ["A morning outside", "Early air", "Morning rounds"],
  midday: ["A midday wander", "Noon in the open", "Lunch-hour loop"],
  afternoon: ["An afternoon loop", "Afternoon outside", "The long afternoon"],
  evening: ["An evening out", "Golden-hour loop", "Evening rounds"],
  night: ["A night walk", "After dark, nearby", "Night rounds"],
};

function pick<T>(pool: T[], seed: number): T { return pool[Math.abs(seed) % pool.length]; }
function hash(s: string): number { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

function fmtClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).toLowerCase();
}

/** A phrase pool that refuses to repeat within one plan. Templates are tracked by shape, so two legs with different numbers still get different wording. */
class Phrases {
  private used = new Set<string>();
  constructor(private seed: number) {}
  take(pool: string[]): string {
    const fresh = pool.filter((p) => !this.used.has(p));
    const chosen = fresh.length ? pick(fresh, this.seed++) : pick(pool, this.seed++);
    this.used.add(chosen);
    return chosen;
  }
  /** Choose a template by its shape, then fill it. */
  fill(templates: Array<(...args: string[]) => string>, ...args: string[]): string {
    const keys = templates.map((t) => t("#", "#", "#"));
    const key = this.take(keys);
    return templates[keys.indexOf(key)](...args);
  }
}

/**
 * What to do at a stop. These assert NOTHING about the place beyond its
 * category: no benches, lawns, loops, views or swings the engine cannot see.
 * The wet pools avoid sitting down.
 */
const CATEGORY_VERB: Record<string, { dry: string[]; wet: string[] }> = {
  parks: { dry: ["take a slow lap", "wander for a while", "find a spot to sit for a bit", "walk it end to end"], wet: ["take a brisk lap", "walk through on the way", "keep it to a quick turn around"] },
  trails: { dry: ["walk a stretch of it", "go out and back at an easy pace", "follow it for a while", "stretch your legs on it"], wet: ["walk a short stretch of it", "go a little way out and back"] },
  gardens: { dry: ["see what is in bloom", "take a slow lap", "look for pollinators", "take it slowly"], wet: ["take a quick turn through", "see what is in bloom from under cover"] },
  playgrounds: { dry: ["let the kids run", "burn off some energy", "play before the next stop", "give the kids a turn"], wet: ["let the kids run while it is light", "a quick play between showers"] },
  waterfront: { dry: ["walk along the water", "watch the water for a while", "look for shorebirds", "follow the shoreline"], wet: ["a short walk along the water", "watch the water from somewhere dry"] },
  sports: { dry: ["get moving", "play for a bit", "take a few laps", "use the space while it is open"], wet: ["get moving under cover", "play indoors for a bit"] },
  scenic: { dry: ["take in the view", "stop for the view", "pause and look around", "take a slow look around"], wet: ["stop for the view between showers", "a short stop for the view"] },
  community: { dry: ["step inside for a while", "see what is on today", "warm up or cool off indoors", "drop in and look around"], wet: ["get out of the rain for a while", "step inside and dry off", "see what is on indoors"] },
};

// ── The plan ────────────────────────────────────────────────────────────────

const MIN_STOP = 15;

/** Stop count by budget, bounded by what is available. */
export function stopsFor(durationMinutes: number, available: number): number {
  const want = durationMinutes <= 60 ? 2 : durationMinutes <= 150 ? 3 : 4;
  return Math.max(Math.min(2, available), Math.min(want, available));
}

type Scored = { c: EngineCandidate; cat: string; miles: number; topic: number; score: number; hoursKnown: boolean; weatherPick: boolean };

export function buildPlan(input: EngineInput): EnginePlan {
  const tz = input.timeZone ?? "America/Los_Angeles";
  const w = input.weather;
  const temp = w?.temperatureF ?? 70;
  const hot = temp >= 85, veryHot = temp >= 95, cold = temp <= 45;
  const wet = (w?.precipitation ?? 0) > 0 || (w ? w.code >= 51 : false);
  const endMs = input.nowMs + input.durationMinutes * 60_000;
  const sunset = w?.sunsetMs, sunrise = w?.sunriseMs;
  const afterDark = sunset !== undefined && input.nowMs >= sunset;
  const endsAfterSunset = sunset !== undefined && endMs > sunset && !afterDark;
  const sun = { sunriseMs: sunrise, sunsetMs: sunset };
  const skipped: EnginePlan["skipped"] = [];
  const notes: string[] = [];
  const picks = input.interests.map((i) => String(i).toLowerCase()).filter((i) => i in RELATED);

  // 1. Eligibility.
  const eligible = input.candidates.filter((c) => {
    const cat = String(c.category ?? "").toLowerCase();
    if (!c.id || !c.name) { skipped.push({ id: c.id, name: c.name, reason: "no id or name" }); return false; }
    if (typeof c.latitude !== "number" || typeof c.longitude !== "number") { skipped.push({ id: c.id, name: c.name, reason: "no coordinates" }); return false; }
    if (isMemberOnly(c)) { skipped.push({ id: c.id, name: c.name, reason: "member-only organisation" }); return false; }
    if (afterDark && cat === "trails") { skipped.push({ id: c.id, name: c.name, reason: "a trail after dark" }); return false; }
    const atStart = openStateAt(c.hours, input.nowMs, tz, sun), atEnd = openStateAt(c.hours, endMs, tz, sun);
    if (atStart === "closed" && atEnd === "closed") { skipped.push({ id: c.id, name: c.name, reason: `closed for the whole outing (${c.hours})` }); return false; }
    if (afterDark && atStart === "unknown" && OUTDOOR.has(cat)) { skipped.push({ id: c.id, name: c.name, reason: "outdoor place with unposted hours after dark" }); return false; }
    return true;
  });

  // 2. Score: topic first, then weather fit, then distance.
  const scored: Scored[] = eligible.map((c) => {
    const cat = String(c.category ?? "").toLowerCase();
    const miles = milesBetween(input.lat, input.lng, c.latitude!, c.longitude!);
    let topic = topicScore(c.category, input.interests);
    // In real heat or rain an indoor stop earns a place even when it is off-topic.
    const weatherPick = (veryHot || wet) && INDOORISH.has(cat) && topic < 0.6;
    if (weatherPick) topic = 0.6;
    let weather = 0;
    if (veryHot) weather += INDOORISH.has(cat) ? 0.5 : SHADED.has(cat) ? 0.25 : -0.4;
    else if (hot) weather += SHADED.has(cat) ? 0.2 : OUTDOOR.has(cat) ? -0.15 : 0.1;
    if (wet) weather += INDOORISH.has(cat) ? 0.5 : cat === "trails" ? -0.5 : -0.25;
    if (cold) weather += INDOORISH.has(cat) ? 0.2 : -0.1;
    if (afterDark) weather += INDOORISH.has(cat) ? 0.4 : -0.3;
    if (endsAfterSunset) weather += SUNSET_SPOTS.has(cat) ? 0.8 : INDOORISH.has(cat) ? 0.3 : 0;
    const hoursKnown = parseOpeningHours(c.hours) !== null;
    // Off-topic costs 1.4: more than the whole distance range (0..0.9) and the weather range together can give back.
    const score = topic * 1.4 + weather + Math.max(0, 0.9 - miles * 0.3) + (hoursKnown ? 0.1 : 0);
    return { c, cat, miles, topic, score, hoursKnown, weatherPick };
  }).sort((a, b) => b.score - a.score || a.miles - b.miles || a.c.id.localeCompare(b.c.id));

  if (scored.length < 2) {
    const closedCount = skipped.filter((s) => /closed|after dark/.test(s.reason)).length;
    notes.push(closedCount >= 2 && input.candidates.length >= 2
      ? (afterDark ? "Everything nearby is closed at this hour. Try again in daylight." : "Nearly everything nearby is closed for the time you have. Try a different time.")
      : "Not enough nearby places to plan an outing yet.");
    return { title: afterDark ? "Nothing open nearby right now" : "Not enough nearby places", intro: "", stops: [], notes, skipped };
  }

  // 3. Choose: best-first with the one-unposted-hours rule, then make sure each pick is covered, then order nearest-neighbour.
  const count = stopsFor(input.durationMinutes, scored.length);
  let chosen: Scored[] = [];
  let unposted = 0;
  for (const s of scored) {
    if (chosen.length >= count) break;
    if (!s.hoursKnown && unposted >= 1) { skipped.push({ id: s.c.id, name: s.c.name, reason: "second stop with unposted hours" }); continue; }
    if (!s.hoursKnown) unposted++;
    chosen.push(s);
  }
  if (chosen.length < 2) {
    for (const s of scored) if (!chosen.includes(s) && chosen.length < 2) { chosen.push(s); notes.push("Opening hours are not posted for every stop — check before you go."); }
  }
  // Coverage: a pick with an eligible candidate but no stop takes the place of a duplicated category.
  for (const p of picks) {
    if (chosen.some((s) => s.cat === p)) continue;
    const candidate = scored.find((s) => s.cat === p && !chosen.includes(s) && (s.hoursKnown || unposted < 1));
    if (!candidate) continue;
    const counts = new Map<string, number>();
    for (const s of chosen) counts.set(s.cat, (counts.get(s.cat) ?? 0) + 1);
    const victim = [...chosen].reverse().find((s) => (counts.get(s.cat) ?? 0) > 1);
    if (!victim) continue;
    chosen = chosen.map((s) => (s === victim ? candidate : s));
    if (!candidate.hoursKnown) unposted++;
    if (!victim.hoursKnown) unposted--;
  }

  const orderNN = (list: Scored[]): Scored[] => {
    const out: Scored[] = []; let here = { lat: input.lat, lng: input.lng }; const pool = [...list];
    while (pool.length) {
      pool.sort((a, b) => milesBetween(here.lat, here.lng, a.c.latitude!, a.c.longitude!) - milesBetween(here.lat, here.lng, b.c.latitude!, b.c.longitude!) || a.c.id.localeCompare(b.c.id));
      const next = pool.shift()!; out.push(next); here = { lat: next.c.latitude!, lng: next.c.longitude! };
    }
    // Sunset: an indoor or sunset-spot stop goes last; in rain or real heat the indoor stop also goes last (a dry, cool finish).
    if (endsAfterSunset || wet || veryHot) {
      const idx = out.findIndex((s) => INDOORISH.has(s.cat) || (endsAfterSunset && SUNSET_SPOTS.has(s.cat)));
      if (idx >= 0 && idx !== out.length - 1) out.push(...out.splice(idx, 1));
    }
    return out;
  };

  // 4. Minutes and the timeline: budget minus travel, weighted by category and heat, each stop ≥ MIN_STOP, rounded DOWN to 5
  //    so the plan never runs over the minutes asked; then every stop must be open on arrival and plain outdoor stops must end
  //    before sunset, dropping stops (while two remain) until that holds.
  let ordered = orderNN(chosen);
  let legs: Array<{ miles: number; minutes: number }> = [];
  let minutes: number[] = [];
  let arrivals: number[] = [];
  /** Stops cut short by a posted closing time, with the closing instant, for the wording. */
  let closingAt = new Map<string, number>();
  /** Earlier stops shortened so a later one can be reached before it closes (persist across timeline passes). */
  const caps = new Map<string, number>();
  const capOutdoor = veryHot ? 30 : hot ? 45 : Infinity;
  for (let guard = 0; guard < 8; guard++) {
    let cur = { lat: input.lat, lng: input.lng };
    legs = ordered.map((s) => { const m = milesBetween(cur.lat, cur.lng, s.c.latitude!, s.c.longitude!); cur = { lat: s.c.latitude!, lng: s.c.longitude! }; return { miles: m, minutes: travelMinutes(m) }; });
    const travelTotal = legs.reduce((a, l) => a + l.minutes, 0);
    const budget = Math.max(ordered.length * MIN_STOP, input.durationMinutes - travelTotal);
    const weights = ordered.map((s) => (s.cat === "trails" ? 1.5 : s.cat === "playgrounds" || s.cat === "scenic" ? 0.8 : 1) * (hot && OUTDOOR.has(s.cat) ? 0.7 : 1));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    minutes = ordered.map((s, i) => Math.max(MIN_STOP, Math.floor((budget * weights[i]) / weightSum / 5) * 5));
    minutes = minutes.map((m, i) => (OUTDOOR.has(ordered[i].cat) ? Math.min(m, capOutdoor) : m));
    minutes = minutes.map((m, i) => Math.min(m, caps.get(ordered[i].c.id) ?? Infinity));
    let retry = false;
    // Timeline.
    arrivals = [];
    closingAt = new Map();
    let t = input.nowMs, drop = -1, reason = "";
    for (let i = 0; i < ordered.length; i++) {
      t += legs[i].minutes * 60_000;
      arrivals.push(t);
      const s = ordered[i];
      const open = openStateAt(s.c.hours, t, tz, sun);
      if (open === "closed") { drop = i; reason = `closed when you would arrive (${fmtClock(t, tz)}; hours ${s.c.hours})`; break; }
      if (open === "open") {
        // Walk forward in five-minute steps to the posted closing time; the stop ends there at the latest.
        let untilClose = 0;
        while (untilClose < minutes[i] && openStateAt(s.c.hours, t + (untilClose + 5) * 60_000, tz, sun) === "open") untilClose += 5;
        if (untilClose < minutes[i]) {
          // The exact closing minute, for the sentence; the stop itself stays a multiple of five.
          let exact = untilClose;
          while (exact < untilClose + 5 && openStateAt(s.c.hours, t + (exact + 1) * 60_000, tz, sun) === "open") exact += 1;
          const closeMs = t + exact * 60_000;
          if (untilClose < MIN_STOP) {
            // Too little time before closing. Three or more stops: drop it. Two stops: cut the earlier stop short so this one is
            // reached in time (a local would leave the first park early to catch the second before it shuts); if even that cannot
            // give it fifteen minutes, keep whatever five-minute look remains, or drop it when nothing sensible is left.
            if (ordered.length > 2) { drop = i; reason = `closes at ${fmtClock(closeMs, tz)}, too soon after you would arrive`; break; }
            let need = MIN_STOP - untilClose;
            for (let j = i - 1; j >= 0 && need > 0; j--) {
              const give = Math.min(Math.max(0, minutes[j] - MIN_STOP), need);
              if (give > 0) { caps.set(ordered[j].c.id, minutes[j] - give); need -= give; retry = true; }
            }
            if (retry) break;
            if (untilClose < 5) { drop = i; reason = `closes at ${fmtClock(closeMs, tz)}, as you would arrive`; break; }
          }
          minutes[i] = Math.max(5, Math.min(untilClose, minutes[i]));
          closingAt.set(s.c.id, closeMs);
        }
      }
      if (endsAfterSunset && sunset !== undefined && OUTDOOR.has(s.cat) && !SUNSET_SPOTS.has(s.cat)) {
        const roomMin = Math.floor((sunset - t) / 60_000);
        if (roomMin < MIN_STOP) { drop = i; reason = "no daylight left for it"; break; }
        if (roomMin < minutes[i]) minutes[i] = Math.max(MIN_STOP, Math.floor(roomMin / 5) * 5);
      }
      t += minutes[i] * 60_000;
    }
    if (retry) continue;
    if (drop < 0) break;
    if (ordered.length <= 2) {
      // Nothing to replace it with and no room to shorten: a one-stop plan that is honest beats a two-stop plan that sends someone to a closed gate.
      if (/closes at|closed when/.test(reason) && ordered.length === 2) {
        skipped.push({ id: ordered[drop].c.id, name: ordered[drop].c.name, reason });
        ordered = ordered.filter((_, i) => i !== drop);
        notes.push("Only one place nearby is open for the time you have.");
        continue;
      }
      notes.push(`${ordered[drop].c.name} may be ${/closed|closes/.test(reason) ? "closed" : "dark"} by the time you reach it — check before you go.`);
      break;
    }
    skipped.push({ id: ordered[drop].c.id, name: ordered[drop].c.name, reason });
    const replacement = scored.find((s) => !ordered.includes(s) && !skipped.some((k) => k.id === s.c.id) && (s.topic >= 0.6 || !picks.length) &&
      (s.hoursKnown || !ordered.some((o) => !o.hoursKnown)) && openStateAt(s.c.hours, arrivals[drop], tz, sun) !== "closed");
    ordered = orderNN([...ordered.filter((_, i) => i !== drop), ...(replacement ? [replacement] : [])]);
  }
  if (endsAfterSunset && sunset !== undefined) notes.push(`Sunset is at ${fmtClock(sunset, tz)} — the outdoor stops are timed to finish before it.`);
  if (veryHot) notes.push(`It is ${Math.round(temp)}°F: outdoor stops are kept to ${capOutdoor} minutes, with shade or indoors last. Bring water.`);
  else if (hot) notes.push(`It is ${Math.round(temp)}°F: outdoor stops are kept to ${capOutdoor} minutes. Bring water.`);
  if (wet) notes.push("Rain is in the forecast: shorter hops, shelter where there is some.");
  if (afterDark) notes.push("It is after sunset — lit, open places only.");

  // 5. Wording.
  const seed = hash(ordered.map((s) => s.c.id).join("|") + input.timeOfDay + input.durationMinutes);
  const phrases = new Phrases(seed);
  const title = pick(TITLES[input.timeOfDay] ?? TITLES.afternoon, seed);
  const conditions = w ? `${Math.round(w.temperatureF)}°F and ${w.summary}` : "whatever the sky does";
  const picksText = input.interests.length ? input.interests.slice(0, 3).join(", ").replace(/, ([^,]*)$/, " and $1").toLowerCase() : "";
  const introOpeners = [
    `${ordered.length} stops within about ${input.durationMinutes} minutes, ${conditions} right now.`,
    `About ${input.durationMinutes} minutes across ${ordered.length} real places near you, with ${conditions} outside.`,
    `A ${input.durationMinutes}-minute loop of ${ordered.length} places, planned for ${conditions}.`,
  ];
  const exactPick = ordered.some((s) => s.topic >= 1 && !s.weatherPick);
  const introCloser = !picksText
    ? phrases.take(["Every stop is a real place the app has already found nearby.", "Nothing here is invented: these are places the app found around you."])
    : exactPick
      ? phrases.take([`Built around your picks: ${picksText}.`, `Chosen for ${picksText}, the things you said you like.`, `Every stop leans toward ${picksText}.`])
      : `Nothing nearby is listed under ${picksText}, so these are the closest fits the app has found.`;
  const intro = `${phrases.take(introOpeners)} ${introCloser}`;

  const stops: EngineStop[] = ordered.map((s, i) => {
    const leg = legs[i];
    const verbs = CATEGORY_VERB[s.cat] ?? { dry: ["spend some time here"], wet: ["spend a little time here"] };
    const verb = phrases.take(wet ? verbs.wet : verbs.dry);
    const facts: string[] = [];
    if (s.weatherPick) facts.push(veryHot ? phrases.take(["a break from the heat", "somewhere cooler in this weather"]) : phrases.take(["shelter if the rain picks up", "somewhere dry for a while"]));
    else if (s.topic >= 1 && input.interests.length) facts.push(phrases.take([`it matches your ${s.c.category} pick`, `you picked ${s.c.category}`, `${s.c.category} is one of your picks`, `it is a ${String(s.c.category).toLowerCase()} stop, your pick`]));
    else if (s.topic >= 0.6 && input.interests.length) facts.push(phrases.take([`it sits close to your picks`, `it fits with what you like`, `it is near enough to your picks`, `it is the closest fit to your picks nearby`]));
    const mi = leg.miles.toFixed(1), min = String(leg.minutes);
    if (i === 0) facts.push(leg.miles < 0.3 ? "it is right where you are" : phrases.fill([(a, b) => `it is ${a} mi from you, about ${b} min`, (a, b) => `${a} mi from where you are, about ${b} min`], mi, min));
    else facts.push(phrases.fill([(a, b) => `${a} mi on from the last stop, about ${b} min`, (a, b) => `a ${b}-minute hop of ${a} mi`, (a, b) => `${a} mi further along, roughly ${b} min`, (a, b, n) => `about ${b} min and ${a} mi from stop ${n}`], mi, min, String(i)));
    const open = openStateAt(s.c.hours, arrivals[i] ?? input.nowMs, tz, sun);
    const closes = closingAt.get(s.c.id);
    if (closes !== undefined) facts.push(`it closes at ${fmtClock(closes, tz)}, so this is a quick look`);
    else if (open === "open") facts.push(phrases.take(["it is open when you get there", "its posted hours say it is open then", "open at that hour by its posted hours", "its hours have it open then", "open then, per its hours"]));
    else if (open === "unknown") facts.push(phrases.take(["hours are not posted, so treat it as a maybe", "no posted hours, so check before you go"]));
    else facts.push("it may be closed by then, so check first");
    if (!s.weatherPick && veryHot && (INDOORISH.has(s.cat) || SHADED.has(s.cat))) facts.push(phrases.take(["a break from the heat", "somewhere cooler in this weather"]));
    else if (!s.weatherPick && wet && INDOORISH.has(s.cat)) facts.push(phrases.take(["shelter if the rain picks up", "somewhere dry for a while"]));
    else if (endsAfterSunset && SUNSET_SPOTS.has(s.cat) && i === ordered.length - 1 && sunset !== undefined) facts.push(`timed for the sunset at ${fmtClock(sunset, tz)}`);
    const why = `${capitalize(verb)} — ${facts.slice(0, 3).join("; ")}.`;
    return { placeId: s.c.id, name: s.c.name, order: i + 1, minutes: minutes[i], why,
      meta: { travelMinutes: leg.minutes, distanceMiles: Number(leg.miles.toFixed(2)), arriveMs: arrivals[i], onTopic: s.topic >= 0.6 || !input.interests.length, weatherPick: s.weatherPick, hoursKnown: s.hoursKnown, openState: open } };
  });

  return { title, intro, stops, notes, skipped };
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Every phrase in the plan's prose appears once: the test for "no repeated phrases". */
export function repeatedPhrases(plan: EnginePlan): string[] {
  const seen = new Map<string, number>();
  const texts = [plan.intro, ...plan.stops.map((s) => s.why)];
  for (const t of texts) for (const clause of t.split(/[—;.]\s*/).map((c) => c.trim().toLowerCase()).filter((c) => c.length > 12)) {
    const key = clause.replace(/\d+(\.\d+)?/g, "#");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/** Words the engine must never use about a place it only knows by name and category. */
export const INVENTED_FEATURE_WORDS = /\b(bench|benches|lawn|grass|loop path|valley|swings?|notice board|courts?|fields?|fountain|pond|playground equipment|picnic tables?)\b/i;
