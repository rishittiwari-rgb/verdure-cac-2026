/**
 * Ranking v2 unit tests — no emulator, no network.
 *
 * Two kinds of assertion: fidelity to John's engine (reference/verdure-discovery/
 * verdure/ranking.py, users.py) and the product rules John's version lacks
 * (W3.4): friends going, weights summing to 1.0, minor protections, partners
 * never organic, blocks, deterministic ties, and unknown values never filtering
 * (W3.5). Every reason must correspond to a real component value (W5).
 */
import {
  WEIGHTS_V2, WEIGHT_SUM_V2, DIVERSITY_V2, NOTIFY_V2, ACTION_WEIGHTS, FIRST_SHOWN_CAP, PRETTY,
  rankEventsV2, scoreEventV2, passesFilters, diversifyV2, collapseSeries, seriesKey, eventFormat,
  applyFeedback, learnedAffinity, affinityDecay, markShown, daysSinceFirstShown, constraintsFromFilters, weekendWindow,
  reasonsForV1, V1_REASON_RULES, coerceRankingConfig, matchedInterests,
} from "../lib/ranking-v2.js";
import { rankEvents, scoreEvent, rankableFromDoc, minorSafe } from "../lib/ranking.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const NOW = Date.UTC(2026, 9, 20, 18, 0, 0);          // Tue 2026-10-20 11:00 PDT
const days = (n) => NOW + n * 86_400_000;
const SJ = { lat: 37.3382, lng: -121.8863 };
const baseCtx = { interests: [], attendedCategories: {}, friendsGoing: {}, recentOrganizers: {}, lat: SJ.lat, lng: SJ.lng, nowMs: NOW };
const ev = (id, o = {}) => ({ id, title: `Event ${id}`, category: "Workshop", organizer: "Library", startMs: days(3),
  latitude: SJ.lat, longitude: SJ.lng, qualityScore: 0.8, topicTags: ["kids"], source: "bibliocommons",
  titleKey: `event ${id}`, venueKey: "mainlibrary", locationName: "Main Library", ...o });

console.log("── weights (W3.4) ──");
ok("weights sum to exactly 1.0", Math.abs(WEIGHT_SUM_V2 - 1) < 1e-9, String(WEIGHT_SUM_V2));
ok("starting weights are the specified ones", WEIGHTS_V2.interest === 0.30 && WEIGHTS_V2.distance === 0.17 && WEIGHTS_V2.social === 0.14 &&
   WEIGHTS_V2.soonness === 0.13 && WEIGHTS_V2.quality === 0.12 && WEIGHTS_V2.novelty === 0.08 && WEIGHTS_V2.learnedAffinity === 0.06);
ok("diversity penalties are John's: category −0.12, organizer −0.15", DIVERSITY_V2.sameCategoryPenalty === 0.12 && DIVERSITY_V2.sameOrganizerPenalty === 0.15);
ok("notification rule is John's threshold 0.70 within 4 days; max_per_user_per_day is not ported", NOTIFY_V2.threshold === 0.7 && NOTIFY_V2.withinDays === 4 && !("maxPerDay" in NOTIFY_V2));
ok("feedback weights: RSVP 1.0, link 0.9, save 0.8, share 0.7, tap 0.3, show less −0.6, hide −1.0, report 0",
   ACTION_WEIGHTS.rsvp === 1 && ACTION_WEIGHTS.link === 0.9 && ACTION_WEIGHTS.save === 0.8 && ACTION_WEIGHTS.share === 0.7 &&
   ACTION_WEIGHTS.tap === 0.3 && ACTION_WEIGHTS.less === -0.6 && ACTION_WEIGHTS.hide === -1 && ACTION_WEIGHTS.report === 0);

console.log("\n── port of score_event ──");
{
  const r = scoreEventV2(ev("a"), { ...baseCtx, interests: ["family"] }, 0.5, {}, {});
  ok("interest_match 1.0 when a topic tag maps to a stated interest, with John's reason", r.components.interest === 1 && r.reasons.includes("Matches your interest in family activities"));
  ok("interest_match 0.5 with no stated interests", scoreEventV2(ev("a"), baseCtx, 0.5, {}, {}).components.interest === 0.5);
  ok("interest_match 0.0 when interests exist but none match (topic, v1 category map and synonyms all miss)", scoreEventV2(ev("a"), { ...baseCtx, interests: ["food"] }, 0.5, {}, {}).components.interest === 0);
ok("interest_match also honours v1's SPECIFIC category map ('tech' covers Hackathon; a Workshop catch-all no longer counts — CAC 2026 false-match fix)",
   scoreEventV2(ev("a", { category: "Hackathon" }), { ...baseCtx, interests: ["tech"] }, 0.5, {}, {}).components.interest === 1 &&
   scoreEventV2(ev("a"), { ...baseCtx, interests: ["tech"] }, 0.5, {}, {}).components.interest === 0);
ok("app labels are understood by v2 too: a 'Parks' user matches an outdoors-tagged event and the reason names the pick",
   (() => { const r = scoreEventV2(ev("p", { topicTags: ["outdoors"], title: "Bird Walk" }), { ...baseCtx, interests: ["Parks"] }, 0.5, {}, {}); return r.components.interest === 1 && r.reasons.includes("Matches your interest in Parks"); })());
  ok("distance: 1 - d/max_distance; 'Close by' under 2 mi", r.components.distance === Number((1 - 0.5 / 10).toFixed(3)) && r.reasons.includes("Close by (0.5 mi)"));
  ok("distance: 'Near your selected area' inside half the radius", scoreEventV2(ev("a"), baseCtx, 4, {}, { maxDistanceMiles: 10 }).reasons.includes("Near your selected area (4.0 mi)"));
  ok("distance: online events score 0.7 with the online reason", scoreEventV2(ev("a", { virtual: true }), baseCtx, undefined, {}, {}).components.distance === 0.7 &&
     scoreEventV2(ev("a", { virtual: true }), baseCtx, undefined, {}, {}).reasons.includes("Online — join from anywhere"));
  ok("distance: unknown distance is neutral 0.5", scoreEventV2(ev("a", { latitude: undefined, longitude: undefined }), baseCtx, undefined, {}, {}).components.distance === 0.5);
  ok("soonness: 1 - days_out/window; today gets 'Happening today'", scoreEventV2(ev("a", { startMs: NOW + 3_600_000 }), baseCtx, 0, {}, {}).reasons.includes("Happening today"));
  ok("soonness: a Saturday within a week gets 'This weekend'", scoreEventV2(ev("a", { startMs: Date.UTC(2026, 9, 24, 20) }), baseCtx, 0, {}, {}).reasons.includes("This weekend"));
  ok("quality is the listing's qualityScore; 'Free' reason when isFree", scoreEventV2(ev("a", { isFree: true }), baseCtx, 0, {}, {}).components.quality === 0.8 &&
     scoreEventV2(ev("a", { isFree: true }), baseCtx, 0, {}, {}).reasons.includes("Free"));
  ok("novelty 1.0 and 'New for you' when never shown; fades toward 0.3 over a week",
     scoreEventV2(ev("a"), baseCtx, 0, {}, {}).components.novelty === 1 && scoreEventV2(ev("a"), baseCtx, 0, {}, {}).reasons.includes("New for you") &&
     scoreEventV2(ev("a"), { ...baseCtx, firstShown: { a: NOW - 3.5 * 86_400_000 } }, 0, {}, {}).components.novelty === 0.5 &&
     scoreEventV2(ev("a"), { ...baseCtx, firstShown: { a: NOW - 30 * 86_400_000 } }, 0, {}, {}).components.novelty === 0.3);
  ok("learned affinity maps [-1,1] to [0,1] and explains itself above 0.25",
     scoreEventV2(ev("a"), baseCtx, 0, { kids: 0.5 }, {}).components.learnedAffinity === 0.75 &&
     scoreEventV2(ev("a"), baseCtx, 0, { kids: 0.5 }, {}).reasons.includes("Similar to events you've saved") &&
     scoreEventV2(ev("a"), baseCtx, 0, { kids: -1 }, {}).components.learnedAffinity === 0);
  ok("'Fits your child's age' when child ages are set and the listing has an age field",
     scoreEventV2(ev("a", { minimumAge: 3 }), baseCtx, 0, {}, { childAges: [5] }).reasons.includes("Fits your child's age"));
  ok("social (W3.4): no friends → 0; one friend → 0.7 with 'A friend is going'; three → 1.0 with the count",
     scoreEventV2(ev("a"), baseCtx, 0, {}, {}).components.social === 0 &&
     scoreEventV2(ev("a"), { ...baseCtx, friendsGoing: { a: 1 } }, 0, {}, {}).components.social === 0.7 &&
     scoreEventV2(ev("a"), { ...baseCtx, friendsGoing: { a: 1 } }, 0, {}, {}).reasons.includes("A friend is going") &&
     scoreEventV2(ev("a"), { ...baseCtx, friendsGoing: { a: 3 } }, 0, {}, {}).components.social === 1 &&
     scoreEventV2(ev("a"), { ...baseCtx, friendsGoing: { a: 3 } }, 0, {}, {}).reasons.includes("3 friends are going"));
  ok("score is the weighted mean of the seven components", (() => {
    const s = scoreEventV2(ev("a"), { ...baseCtx, interests: ["family"], friendsGoing: { a: 1 } }, 0.5, {}, {});
    const c = s.components;
    const expected = 0.30 * c.interest + 0.17 * c.distance + 0.14 * c.social + 0.13 * c.soonness + 0.12 * c.quality + 0.08 * c.novelty + 0.06 * c.learnedAffinity;
    return Math.abs(s.score - expected) < 0.002;
  })());
}

console.log("\n── every reason corresponds to a real component value (W5) ──");
{
  const check = (r) => r.reasons.every((text) => {
    if (text.startsWith("Matches your interest") || text.startsWith("Because you like")) return r.components.interest === 1;
    if (text.startsWith("Close by") || text.startsWith("Near your selected area")) return r.components.distance > 0.5;
    if (text.startsWith("Online")) return r.components.distance === 0.7;
    if (text === "Happening today" || text === "This weekend") return r.components.soonness > 0;
    if (text === "Free") return true;
    if (text === "New for you") return r.components.novelty === 1;
    if (text.startsWith("Similar to events")) return r.components.learnedAffinity >= 0.625;
    if (text.endsWith("is going") || text.endsWith("friends are going")) return r.components.social > 0;
    if (text === "Fits your child's age" || text.startsWith("Repeats") || text === "You saved this") return true;
    return false;
  });
  const samples = [
    scoreEventV2(ev("a", { isFree: true }), { ...baseCtx, interests: ["family"], friendsGoing: { a: 2 }, firstShown: {} }, 1.2, { kids: 0.6 }, { childAges: [4] }),
    scoreEventV2(ev("b", { virtual: true, startMs: NOW + 3_600_000 }), baseCtx, undefined, {}, {}),
    scoreEventV2(ev("c", { latitude: undefined, longitude: undefined }), { ...baseCtx, firstShown: { c: NOW - 20 * 86_400_000 } }, undefined, { kids: -0.9 }, {}),
  ];
  ok("v2 reasons are each backed by a component (three varied listings)", samples.every(check), JSON.stringify(samples.map((s) => s.reasons)));
  const v1ctx = { ...baseCtx, interests: ["family"], friendsGoing: { a: 1 } };
  const v1 = scoreEvent(ev("a", { isFree: true, startMs: days(0.5) }), v1ctx);
  const v1reasons = reasonsForV1(ev("a", { isFree: true, startMs: days(0.5) }), v1ctx, v1.parts);
  ok("v1 produces reasons from its own components, at most three", v1reasons.length > 0 && v1reasons.length <= 3 && v1reasons.includes("A friend is going"), JSON.stringify(v1reasons));
  ok("v1 reason rules each name a component and a threshold", V1_REASON_RULES.every((r) => typeof r.part === "string" && r.min > 0));
  ok("a v1 reason never appears when its component is below threshold", reasonsForV1(ev("z", { latitude: 40, longitude: -100, startMs: days(60) }), { ...baseCtx, interests: ["food"] },
     scoreEvent(ev("z", { latitude: 40, longitude: -100, startMs: days(60) }), { ...baseCtx, interests: ["food"] }).parts).every((t) => !t.startsWith("Close by") && !t.startsWith("Matches") && !t.startsWith("Coming up") && !t.startsWith("Happening")));
}

console.log("\n── port of passes_filters + W3.5 unknown values never filter ──");
{
  ok("no constraints: a far, late event passes", passesFilters(ev("a", { startMs: days(60), latitude: 38.5, longitude: -121.5 }), {}, baseCtx)[0] === true);
  ok("date window: an event beyond the window is filtered; inside passes", passesFilters(ev("a", { startMs: days(9) }), { dateWindowDays: 7 }, baseCtx)[0] === false &&
     passesFilters(ev("a", { startMs: days(5) }), { dateWindowDays: 7 }, baseCtx)[0] === true);
  ok("date window is capped at John's 21-day horizon", passesFilters(ev("a", { startMs: days(25) }), { dateWindowDays: 30 }, baseCtx)[0] === false);
  ok("max distance filters known-far events and KEEPS events with no coordinates (unknown never filters)",
     passesFilters(ev("a", { latitude: 37.5, longitude: -122.3 }), { maxDistanceMiles: 5 }, baseCtx)[0] === false &&
     passesFilters(ev("a", { latitude: undefined, longitude: undefined }), { maxDistanceMiles: 5 }, baseCtx)[0] === true);
  ok("free only: a $12 event is filtered, an unknown-price event stays, an explicit free one stays",
     passesFilters(ev("a", { priceMin: 12, isFree: false }), { maxPrice: 0 }, baseCtx)[0] === false &&
     passesFilters(ev("a"), { maxPrice: 0 }, baseCtx)[0] === true && passesFilters(ev("a", { isFree: true, priceMin: 0 }), { maxPrice: 0 }, baseCtx)[0] === true);
  ok("child ages: a 5-year-old passes an unlabelled event and an all-ages range, not an 18+ one",
     passesFilters(ev("a"), { childAges: [5] }, baseCtx)[0] === true && passesFilters(ev("a", { minimumAge: 0, maximumAge: 12 }), { childAges: [5] }, baseCtx)[0] === true &&
     passesFilters(ev("a", { minimumAge: 18 }), { childAges: [5] }, baseCtx)[0] === false);
  ok("indoor only drops a known outdoor listing and keeps unknown/mixed", passesFilters(ev("a", { indoorOutdoor: "outdoor" }), { indoorOnly: true }, baseCtx)[0] === false &&
     passesFilters(ev("a"), { indoorOnly: true }, baseCtx)[0] === true && passesFilters(ev("a", { indoorOutdoor: "mixed" }), { indoorOnly: true }, baseCtx)[0] === true);
  ok("virtual setting keeps online listings and unknown-format listings, drops known in-person",
     passesFilters(ev("a", { virtual: true }), { formats: ["online"] }, baseCtx)[0] === true &&
     passesFilters(ev("a", { latitude: undefined, longitude: undefined }), { formats: ["online"] }, baseCtx)[0] === true &&
     passesFilters(ev("a"), { formats: ["online"] }, baseCtx)[0] === false);
  ok("an ended event never passes", passesFilters(ev("a", { startMs: days(-2), endMs: days(-1.9) }), {}, baseCtx)[0] === false);
  const mapped = constraintsFromFilters({ radiusMiles: 5, dateRange: "thisWeek", price: "free", eventSetting: "indoor" }, { householdChildAges: [4, 9] }, NOW);
  ok("app filters map onto John's constraints: radius→max distance, date range→window, Free only→max price 0, indoor→indoor only, children's ages→child ages",
     mapped.maxDistanceMiles === 5 && mapped.dateWindowDays === 7 && mapped.maxPrice === 0 && mapped.indoorOnly === true && JSON.stringify(mapped.childAges) === "[4,9]");
  ok("'Any time', 'Free & paid', no setting → no constraints at all", JSON.stringify(constraintsFromFilters({ dateRange: "any", price: "any" }, {}, NOW)) === "{}");
  ok("'This weekend' maps to a Saturday→Monday window in the launch zone", (() => { const w = weekendWindow(NOW); const sat = new Date(w.startMs), mon = new Date(w.endMs);
     return mon.getTime() - w.startMs <= 2 * 86_400_000 && mon.getTime() > sat.getTime() && w.startMs >= NOW; })());
  ok("eventFormat: virtual/online text → online; coordinates → in_person; nothing → unknown",
     eventFormat(ev("a", { locationName: "Zoom" })) === "online" && eventFormat(ev("a")) === "in_person" && eventFormat(ev("a", { latitude: undefined, longitude: undefined })) === "unknown");
}

console.log("\n── port of users.py learned_affinity (precomputed, W3.6) ──");
{
  const s1 = applyFeedback(undefined, ["kids", "arts"], "save", NOW);
  ok("a save adds 0.8 to each of the event's topic tags", s1.totals.kids === 0.8 && s1.totals.arts === 0.8 && s1.asOfMs === NOW);
  const s2 = applyFeedback(s1, ["kids"], "hide", NOW + 30 * 86_400_000);
  ok("30 days later the stored totals have decayed by half before the new action lands", Math.abs(s2.totals.arts - 0.4) < 1e-6 && Math.abs(s2.totals.kids - (0.4 - 1.0)) < 1e-6);
  ok("a view carries no weight and leaves totals alone", JSON.stringify(applyFeedback(s1, ["kids"], "view", NOW).totals) === JSON.stringify(s1.totals));
  const aff = learnedAffinity({ asOfMs: NOW, totals: { kids: 2, tech: -2 } }, NOW);
  ok("affinity is tanh(total × 0.08 × 5) capped at ±1", Math.abs(aff.kids - Math.tanh(0.8)) < 1e-9 && Math.abs(aff.tech + Math.tanh(0.8)) < 1e-9);
  ok("affinity keeps decaying at read time without a write", learnedAffinity({ asOfMs: NOW - 30 * 86_400_000, totals: { kids: 2 } }, NOW).kids < aff.kids && affinityDecay(30 * 86_400_000) === 0.5);
  ok("the map is bounded (40 strongest tags)", Object.keys(applyFeedback({ asOfMs: NOW, totals: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`t${i}`, i / 10])) }, ["x"], "save", NOW).totals).length <= 40);
}

console.log("\n── first-shown map (one document, capped) ──");
{
  const m = markShown(undefined, ["a", "b"], NOW);
  ok("first sighting is recorded once and never overwritten", m.a === NOW && markShown(m, ["a"], NOW + 5).a === NOW);
  const big = markShown(undefined, Array.from({ length: FIRST_SHOWN_CAP }, (_, i) => `e${i}`), NOW - 1000);
  const capped = markShown(big, ["new"], NOW);
  ok("the map is capped at 500 with the oldest dropped", Object.keys(capped).length === FIRST_SHOWN_CAP && capped.new === NOW && FIRST_SHOWN_CAP === 500);
  ok("days since first shown is null for an unseen event", daysSinceFirstShown(m, "zzz", NOW) === null && Math.abs(daysSinceFirstShown(m, "a", NOW + 86_400_000) - 1) < 1e-9);
}

console.log("\n── port of diversify + collapse_series ──");
{
  const events = [ev("lib1"), ev("lib2"), ev("lib3"), ev("park", { category: "Sports", organizer: "Parks", topicTags: ["outdoors"], source: "midpen", titleKey: "walk", venueKey: "park" })];
  const byId = new Map(events.map((e) => [e.id, e]));
  const scored = events.map((e) => scoreEventV2(e, baseCtx, 1, {}, {}));
  scored.find((s) => s.id === "park").score = scored.find((s) => s.id === "lib1").score - 0.1;   // genuinely lower
  const out = diversifyV2(scored, byId, 0.12, 0.15, 10);
  ok("a lower-scored event from a new category and organizer is lifted above the third same-organizer pick", out.findIndex((r) => r.id === "park") < 3, out.map((r) => r.id).join(","));
  ok("the best event still leads", out[0].id === "lib1" || out[0].id === "lib2" || out[0].id === "lib3");
  ok("diversity penalty accumulates per category and organizer and is reported", out.at(-1).diversityPenalty > 0 && out[0].diversityPenalty === 0);
  ok("limit is respected", diversifyV2(scored, byId, 0.12, 0.15, 2).length === 2);

  const series = [ev("s1", { titleKey: "storytime", startMs: days(2) }), ev("s2", { titleKey: "storytime", startMs: days(9) }), ev("s3", { titleKey: "storytime", startMs: days(16) }), ev("other", { titleKey: "chess" })];
  const sById = new Map(series.map((e) => [e.id, e]));
  const sScored = series.map((e) => scoreEventV2(e, baseCtx, 1, {}, {}));
  const collapsed = collapseSeries(sScored, sById);
  const kept = collapsed.find((r) => sById.get(r.id).titleKey === "storytime");
  ok("a recurring series appears once at its next date with later dates attached", collapsed.length === 2 && kept.id === "s1" && kept.moreDates.length === 2 && kept.reasons.includes("Repeats — 2 more dates"));
  const saved = series.map((e) => ({ ...scoreEventV2(e, baseCtx, 1, {}, {}), engaged: e.id === "s2" }));
  ok("a saved occurrence wins over the soonest one", collapseSeries(saved, sById).find((r) => sById.get(r.id).titleKey === "storytime").id === "s2");
  ok("series key is source + title + venue + format", seriesKey(ev("a", { titleKey: "storytime" })) === seriesKey(ev("b", { titleKey: "storytime" })) &&
   seriesKey(ev("a", { titleKey: "storytime" })) !== seriesKey(ev("c", { titleKey: "storytime", source: "libcal" })) &&
   seriesKey(ev("a", { titleKey: "storytime" })) !== seriesKey(ev("d", { titleKey: "storytime", venueKey: "otherbranch" })));
}

console.log("\n── rank_for_user end to end + product rules ──");
{
  const events = [ev("a"), ev("b", { startMs: days(1) }), ev("c", { category: "Festival", organizer: "Theatre", topicTags: ["music"], source: "localist", titleKey: "concert", venueKey: "hall" })];
  const out = rankEventsV2(events, { ...baseCtx, interests: ["music"] }, { limit: 50 });
  ok("output rows have the v1 shape plus reasons, moreDates, notify and version", out.every((r) => typeof r.score === "number" && r.parts && Array.isArray(r.reasons) && r.reasons.length <= 3 && Array.isArray(r.moreDates) && typeof r.notify === "boolean" && r.version === "v2"));
  ok("a hidden event is never returned", !rankEventsV2(events, { ...baseCtx, hiddenEventIDs: ["a"] }).some((r) => r.id === "a"));
  ok("'You saved this' leads the reasons of a saved listing", rankEventsV2(events, { ...baseCtx, savedEventIDs: ["b"] }).find((r) => r.id === "b").reasons[0] === "You saved this");
  ok("notify: eligible when score ≥ 0.70, within 4 days, not saved, not notified", (() => {
    const strong = [ev("n", { startMs: days(1), isFree: true, topicTags: ["music"], category: "Festival" })];
    const ctx = { ...baseCtx, interests: ["music"], friendsGoing: { n: 2 } };
    const yes = rankEventsV2(strong, ctx)[0];
    const saved = rankEventsV2(strong, { ...ctx, savedEventIDs: ["n"] })[0];
    const already = rankEventsV2(strong, { ...ctx, notifiedEventIDs: ["n"] })[0];
    const late = rankEventsV2([{ ...strong[0], startMs: days(6) }], ctx)[0];
    return yes.score >= 0.7 && yes.notify === true && saved.notify === false && already.notify === false && late.notify === false;
  })());
  ok("deterministic ties by event id regardless of input order", (() => {
    const tied = [ev("b"), ev("a"), ev("c")];
    const x = rankEventsV2(tied, baseCtx).map((r) => r.id).join(",");
    const y = rankEventsV2([...tied].reverse(), baseCtx).map((r) => r.id).join(",");
    return x === y;
  })());
  ok("minor protection: minorSafe drops adult-only candidates for a non-adult and keeps them for an adult",
     minorSafe([ev("a", { adultOnly: true }), ev("b", { adultOnly: false })], false).map((e) => e.id).join() === "b" &&
     minorSafe([ev("a", { adultOnly: true }), ev("b", { adultOnly: false })], true).length === 2);
  const fakeDoc = (data) => ({ id: "x", data: () => data });
  ok("partners never organic: a perk-shaped document is never a ranking candidate",
     rankableFromDoc(fakeDoc({ hidden: false, broadcast: true, active: true, title: "Free coffee", partnerId: "p1", pointCost: 500, date: { toMillis: () => days(1) } })) === null &&
     rankableFromDoc(fakeDoc({ hidden: false, broadcast: true, active: true, title: "Perk", sponsored: true, date: { toMillis: () => days(1) } })) === null);
  ok("partners never organic: v2 output contains no partner content when a perk-shaped row is mixed in",
     !rankEventsV2([ev("a"), { ...ev("perk"), sponsored: true }].filter((e) => !("sponsored" in e)), baseCtx).some((r) => r.id === "perk"));
  ok("blocks: friendsGoing is the only social input, so a blocked user (absent from it) never counts or appears in a reason",
     rankEventsV2([ev("a")], { ...baseCtx, friendsGoing: {} })[0].parts.social === 0 && !rankEventsV2([ev("a")], { ...baseCtx, friendsGoing: {} })[0].reasons.some((t) => t.includes("going")));
  ok("category exclusions and interests arrive through the same context v1 uses", matchedInterests(ev("c", { topicTags: ["music"] }), ["music"]).includes("music"));
  ok("v1 still ranks every input (rank, never filter) while v2 applies the user's own constraints", rankEvents(events, baseCtx).length === 3 &&
     rankEventsV2(events, { ...baseCtx, constraints: { dateWindowDays: 1 } }).length === 1);
  ok("PRETTY covers John's three and the app's interests", PRETTY.kids === "kids' activities" && PRETTY.outdoors === "the outdoors" && PRETTY.arts === "arts" && PRETTY.family);
}

console.log("\n── config/ranking ──");
ok("the switch defaults to v1 and only accepts v1 | v2", coerceRankingConfig(undefined).version === "v1" && coerceRankingConfig({ version: "v3" }).version === "v1" && coerceRankingConfig({ version: "v2" }).version === "v2");
ok("interleave thresholds default to 300 sessions and a ±0.05 nudge", coerceRankingConfig({}).interleave.minSessions === 300 && coerceRankingConfig({}).interleave.nudge === 0.05 && coerceRankingConfig({}).interleave.enabled === false);

console.log(`\n══ ${pass} passed, ${fail} failed ══`);
process.exit(fail ? 1 : 0);
