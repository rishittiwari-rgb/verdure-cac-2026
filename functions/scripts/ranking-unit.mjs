/**
 * Ranking engine unit tests — no emulator, no network.
 *
 * The most important assertions in this file are the NEGATIVE ones: that no
 * input can cause rankEvents to return fewer events than it was given. That is
 * the property the whole design rests on, and it is the one a future weight
 * tweak is most likely to break by "helpfully" dropping a zero-scoring event.
 */
import {
  WEIGHTS, WEIGHT_SUM, rankEvents, scoreEvent, interestScore, distanceScore,
  socialScore, timingScore, noveltyScore, feedbackScore, haversineMiles, INTEREST_TO_CATEGORY, EXPLORATION_REASON, statedInterestMatch,
} from "../lib/ranking.js";
import { normalizeInterests, interestTerms, labelForTerm, matchInterests, stripVenueNames, APP_LABEL_TO_TERMS, SERVER_INTEREST_TERMS, TERM_CATEGORIES, retrievalTopics, retrievalCategories } from "../lib/interests.js";
import { reasonsForV1 } from "../lib/ranking-v2.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);
const days = (n) => NOW + n * 86_400_000;
const SJ = { lat: 37.3382, lng: -121.8863 };

const baseCtx = {
  interests: [], attendedCategories: {}, friendsGoing: {},
  recentOrganizers: {}, lat: SJ.lat, lng: SJ.lng, nowMs: NOW,
};
const ev = (id, o = {}) => ({
  id, category: "Meetup", organizer: "Org", startMs: days(3),
  latitude: SJ.lat, longitude: SJ.lng, ...o,
});

console.log("── weights ──");
ok("weights sum to exactly 1.0", Math.abs(WEIGHT_SUM - 1) < 1e-9, String(WEIGHT_SUM));
ok("interest and distance are the two heaviest terms, tied at 0.20 (CAC 2026: interest 0.16 → 0.20, distance 0.24 → 0.20)",
   WEIGHTS.interest === 0.20 && WEIGHTS.distance === 0.20 && Math.max(...Object.values(WEIGHTS)) === 0.20);
ok("a household with a four-year-old ranks a child-suitable event higher",
  interestScore(ev("family", { ageSuitability: "children", minimumAge: 4 }),
    { ...baseCtx, householdYoungestAge: 4 }) >
  interestScore(ev("adult", { ageSuitability: "adults", minimumAge: 18 }),
    { ...baseCtx, householdYoungestAge: 4 }));
ok("confirmed accessibility needs boost a listing without hiding unconfirmed listings",
  interestScore(ev("confirmed", { accessibilityFeatures: ["stepFree", "seating"] }),
    { ...baseCtx, accessibilityNeeds: ["stepFree", "seating"] }) >
  interestScore(ev("unconfirmed", { accessibilityFeatures: ["stepFree"] }),
    { ...baseCtx, accessibilityNeeds: ["stepFree", "seating"] }));
{
  const distant = ev("distant", { latitude: SJ.lat + 0.1 });
  ok("usual walking makes the same trip rank farther away than driving",
    distanceScore(distant, { ...baseCtx, transportMode: "walk" }) <
    distanceScore(distant, { ...baseCtx, transportMode: "drive" }));
  ok("typical distance changes the distance decay without filtering the event",
    distanceScore(distant, { ...baseCtx, radiusMiles: 2 }) <
    distanceScore(distant, { ...baseCtx, radiusMiles: 25 }) &&
    rankEvents([distant], { ...baseCtx, radiusMiles: 2 }).length === 1);
}

console.log("\n── rank, never filter (the load-bearing property) ──");
{
  const events = [
    ev("a", { category: "Sports", startMs: days(1) }),
    ev("b", { category: "Cleanup", startMs: days(40), latitude: 40.0, longitude: -100.0 }),
    ev("c", { category: "Hackathon", startMs: days(9) }),
    ev("d", { category: "Sports", startMs: days(2) }),
  ];
  const ctx = { ...baseCtx, interests: ["tech"] };
  const out = rankEvents(events, ctx);
  ok("every input event is present in the output", out.length === events.length, `${out.length} vs ${events.length}`);
  ok("no event is dropped even with an interest set that matches only one",
     new Set(out.map((o) => o.id)).size === 4);
  ok("the far, wrong-category, 40-days-out event still has a positive score",
     out.find((o) => o.id === "b").score > 0, JSON.stringify(out.find((o) => o.id === "b")));
}
{
  // Adversarial: a user whose every signal argues against every event.
  const events = [ev("x", { category: "Sports", startMs: days(90), latitude: 10, longitude: 10 })];
  const ctx = { ...baseCtx, interests: ["tech"], recentOrganizers: { Org: 50 } };
  const out = rankEvents(events, ctx);
  ok("worst possible event still returned, still scored above zero",
     out.length === 1 && out[0].score > 0, JSON.stringify(out[0]));
}

console.log("\n── cold start ──");
{
  const ctx = { ...baseCtx };   // no interests, no history, no friends
  const out = rankEvents([ev("a", { startMs: days(3) }), ev("b", { startMs: days(60) })], ctx);
  ok("cold-start user gets a non-empty ranked list", out.length === 2);
  ok("cold start falls back to soon-and-nearby", out[0].id === "a", JSON.stringify(out.map((o) => o.id)));
  ok("unknown interests score neutral 0.5, not 0",
     interestScore(ev("a"), ctx) === 0.5);
  const qualityChoice = rankEvents([
    ev("thin", { qualityScore: 0.15 }),
    ev("complete", { qualityScore: 0.95 }),
  ], ctx);
  ok("cold-start ranks a complete listing above an otherwise equal thin one",
     qualityChoice[0].id === "complete", JSON.stringify(qualityChoice));
  const workshop = ev("workshop", { category: "Workshop", organizer: "San Jose City College" });
  ok("student mode raises a public workshop above a neutral event",
     interestScore(workshop, { ...ctx, studentStatus: true }) > interestScore(ev("neutral"), { ...ctx, studentStatus: true }));
  ok("a workshop at the student's school gets a stronger affinity",
     interestScore(workshop, { ...ctx, studentStatus: true, school: "San Jose City College" }) >
     interestScore(workshop, { ...ctx, studentStatus: true, school: "Other School" }));
}

console.log("\n── interest term ──");
{
  const stated = { ...baseCtx, interests: ["tech"] };
  ok("stated interest matches its mapped categories",
     interestScore(ev("a", { category: "Hackathon" }), stated) === 1 &&
     interestScore(ev("a", { category: "Sports" }), stated) === 0);
  ok("every app interest label (PlaceCategory) normalises to at least one server term with a lexicon",
     ["Parks", "Trails", "Gardens", "Playgrounds", "Waterfront", "Sports", "Scenic", "Community"].every((label) => {
       const terms = interestTerms([label]);
       return terms.length > 0 && terms.every((t) => SERVER_INTEREST_TERMS.includes(t) && t in TERM_CATEGORIES);
     }));
  ok("no app-reachable interest maps to a catch-all category (Workshop/Social/Meetup) — those produced the false matches",
     interestTerms(["Parks", "Trails", "Gardens", "Playgrounds", "Waterfront", "Sports", "Scenic", "Community"])
       .flatMap((t) => INTEREST_TO_CATEGORY[t] ?? []).every((c) => !["Workshop", "Social", "Meetup"].includes(c)));
  const hiking = { ...baseCtx, interests: ["hiking"] };
  ok("semantic interest matches a trail day without the word hiking",
     interestScore(ev("trail", { category: "Volunteer", title: "Trail Day at Rancho San Antonio" }), hiking) > 0.8);
  ok("semantic interest matches a nature walk without the word hiking",
     interestScore(ev("walk", { category: "Meetup", title: "Guided Nature Walk" }), hiking) > 0.8);
  ok("semantic match respects word boundaries",
     interestScore(ev("noise", { category: "Meetup", title: "Parkitecture talk" }), hiking) === 0);

  // Behaviour overrides the onboarding tap.
  const contradicted = { ...baseCtx, interests: ["tech"], attendedCategories: { Cleanup: 4 } };
  const cleanup = interestScore(ev("a", { category: "Cleanup" }), contradicted);
  const hack = interestScore(ev("a", { category: "Hackathon" }), contradicted);
  ok("four attended cleanups outweigh a stated 'tech' interest", cleanup > hack, `cleanup=${cleanup} hack=${hack}`);
}

console.log("\n── distance term ──");
{
  ok("haversine: San Jose to Palo Alto is ~14-18 mi",
     (() => { const d = haversineMiles(37.3382, -121.8863, 37.4419, -122.1430); return d > 13 && d < 19; })(),
     String(haversineMiles(37.3382, -121.8863, 37.4419, -122.1430)));
  ok("distance decays monotonically and never reaches 0", (() => {
      const d = (m) => distanceScore(ev("a", { latitude: 37.3382 + m / 69, longitude: -121.8863 }), baseCtx);
      return d(0) > d(5) && d(5) > d(25) && d(200) > 0;
    })());
  ok("~5 miles scores about half", (() => {
      const s = distanceScore(ev("a", { latitude: 37.3382 + 5 / 69, longitude: -121.8863 }), baseCtx);
      return Math.abs(s - 0.5) < 0.05;
    })());
  ok("an event with no coordinates is mildly penalised, not excluded",
     distanceScore(ev("a", { latitude: undefined, longitude: undefined }), baseCtx) === 0.4);
  ok("a user with no location gets neutral distance for everyone",
     distanceScore(ev("a"), { ...baseCtx, lat: undefined, lng: undefined }) === 0.5);
}

console.log("\n── social term ──");
{
  ok("no friends going scores 0", socialScore(ev("a"), baseCtx) === 0);
  const one = socialScore(ev("a"), { ...baseCtx, friendsGoing: { a: 1 } });
  const three = socialScore(ev("a"), { ...baseCtx, friendsGoing: { a: 3 } });
  ok("one friend is most of the effect; it saturates", one >= 0.7 && three <= 1 && three - one < one, `1=${one} 3=${three}`);
  // The social term is worth 0.18, so it flips a moderate distance gap and NOT
  // a large one. Both halves are asserted — a weight change that made "a friend
  // is going" able to drag a 20-mile event to the top would be a bug, not an
  // improvement.
  ok("a friend going flips a moderate distance gap (~4 mi)", (() => {
      const out = rankEvents([
        ev("near", { startMs: days(3) }),
        ev("far", { startMs: days(3), latitude: 37.3382 + 4 / 69, longitude: -121.8863 }),
      ], { ...baseCtx, friendsGoing: { far: 2 } });
      return out[0].id === "far";
    })(), "social should outweigh ~4 miles");
  ok("but a friend going does NOT drag a 20-mile event to the top", (() => {
      const out = rankEvents([
        ev("near", { startMs: days(3) }),
        ev("far", { startMs: days(3), latitude: 37.3382 + 20 / 69, longitude: -121.8863 }),
      ], { ...baseCtx, friendsGoing: { far: 3 } });
      return out[0].id === "near";
    })(), "20 miles should still lose");
}

console.log("\n── timing term ──");
{
  ok("a past event scores 0 on timing", timingScore(ev("a", { startMs: days(-1) }), baseCtx) === 0);
  ok("2-7 days out is the peak",
     timingScore(ev("a", { startMs: days(3) }), baseCtx) === 1 &&
     timingScore(ev("a", { startMs: days(3) }), baseCtx) > timingScore(ev("a", { startMs: days(0.2) }), baseCtx));
  ok("six weeks out is nearly weightless", timingScore(ev("a", { startMs: days(45) }), baseCtx) < 0.2);
  ok("unreachable event starting in 30 minutes is strongly penalized",
     timingScore(ev("far-soon", { startMs: NOW + 30 * 60_000, latitude: 38, longitude: -122 }), baseCtx) < 0.1);
  ok("a weekend attendance pattern prefers weekend plans",
     timingScore(ev("weekend", { startMs: days(6) }), { ...baseCtx, weekendAttendanceRatio: 1 }) >
     timingScore(ev("weekday", { startMs: days(4) }), { ...baseCtx, weekendAttendanceRatio: 1 }));
}

console.log("\n── feedback term ──");
{
  const candidate = ev("feedback", { category: "Workshop", organizer: "Library" });
  const neutral = feedbackScore(candidate, baseCtx);
  ok("saved intent raises a score", feedbackScore(candidate, { ...baseCtx, savedEventIDs: ["feedback"] }) > neutral);
  ok("two attended organizer events raise affinity",
     feedbackScore(candidate, { ...baseCtx, attendedOrganizers: { Library: 2 } }) > neutral);
  const less = { ...baseCtx, eventFeedback: { seenWorkshop: { category: "Workshop", kind: "less", atMs: NOW } } };
  ok("less like this lowers matching category", feedbackScore(candidate, less) < neutral);
  ok("dismissal fades to neutral after 90 days",
     feedbackScore(candidate, { ...less, nowMs: NOW + 91 * 86_400_000 }) === neutral);
  const more = { ...baseCtx, eventFeedback: { seenWorkshop: { category: "Workshop", kind: "more", atMs: NOW } } };
  ok("more like this raises matching category", feedbackScore(candidate, more) > neutral);
  ok("feedback changes the subsequent rank order", (() => {
    const rows = [candidate, ev("other", { category: "Sports", organizer: "Parks" })];
    return rankEvents(rows, less)[0].id === "other" && rankEvents(rows, more)[0].id === "feedback";
  })());
}

console.log("\n── novelty + diversity ──");
{
  ok("an unseen organizer scores 1", noveltyScore(ev("a", { organizer: "New" }), baseCtx) === 1);
  ok("a heavily-seen organizer is damped but never zeroed",
     noveltyScore(ev("a", { organizer: "Org" }), { ...baseCtx, recentOrganizers: { Org: 10 } }) > 0);

  // One prolific library must not own the whole feed.
  //
  // The six workshops are deliberately made BETTER than the cleanup on every
  // per-event term (nearer and sooner), so without diversity damping they would
  // occupy all six leading positions and the cleanup would land dead last. The
  // assertion is that it does not.
  const many = Array.from({ length: 6 }, (_, i) =>
    ev(`lib${i}`, { category: "Workshop", organizer: "Library", startMs: days(3) }));
  const other = ev("cleanup", { category: "Cleanup", organizer: "Parks", startMs: days(6),
                                latitude: 37.3382 + 2 / 69, longitude: -121.8863 });

  // Establish the counterfactual rather than asserting it from memory.
  const undamped = [...many, other]
    .map((e) => scoreEvent(e, baseCtx))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  ok("counterfactual: without diversity the cleanup ranks last",
     undamped[undamped.length - 1].id === "cleanup", undamped.map((o) => o.id).join(","));

  const out = rankEvents([...many, other], baseCtx);
  const firstCleanupIdx = out.findIndex((o) => o.id === "cleanup");
  ok("diversity lifts the lone cleanup out of last place",
     firstCleanupIdx < 6, `idx=${firstCleanupIdx} order=${out.map((o) => o.id)}`);
  ok("the best workshop still leads — diversity reorders, it does not invert",
     out[0].id.startsWith("lib"), out.map((o) => o.id).join(","));
  ok("diversity damping never removes anything", out.length === 7);
  ok("the top result is never damped", out[0].parts.diversity === 1);
}

console.log("\n── CAC 2026: app labels are understood (1.1 cause 1) ──");
{
  const n = normalizeInterests(["Parks", "Trails", "parks", "Nonsense", 42, "outdoors"]);
  ok("app labels expand to server terms, duplicates and unknown values are dropped, terms pass through",
     JSON.stringify(n) === JSON.stringify([{ label: "Parks", terms: ["outdoors"] }, { label: "Trails", terms: ["hiking", "outdoors"] }, { label: "outdoors", terms: ["outdoors"] }]), JSON.stringify(n));
  ok("every PlaceCategory label is in the normaliser table", ["parks", "trails", "gardens", "playgrounds", "waterfront", "sports", "scenic", "community"].every((k) => k in APP_LABEL_TO_TERMS));
  ok("the user's own label is recovered from a term for the reasons line", labelForTerm(["Parks", "Community"], "volunteering") === "Community" && labelForTerm(["Parks"], "outdoors") === "Parks" && labelForTerm(["outdoors"], "outdoors") === "the outdoors");
  const parks = { ...baseCtx, interests: ["Parks"] };
  ok("BEFORE the fix the interest term was 0 for every event of a 'Parks' user; now a bird walk scores 1",
     interestScore(ev("walk", { title: "Lake Elizabeth Bird Walk", category: "Workshop" }), parks) === 1);
  ok("'Community' matches a Volunteer-category listing by category alone", statedInterestMatch(ev("v", { category: "Volunteer", title: "Saturday Shift" }), { ...baseCtx, interests: ["Community"] }) === 1);
  ok("'Sports' matches the Sports category and a yoga title", statedInterestMatch(ev("y", { category: "Sports", title: "Thing" }), { ...baseCtx, interests: ["Sports"] }) === 1 &&
     statedInterestMatch(ev("y2", { category: "Workshop", title: "Family Yoga" }), { ...baseCtx, interests: ["Sports"] }) === 1);
  ok("retrieval topics and categories derive from the same lexicon (Parks → outdoors tag + Cleanup; Community → civic/community/volunteer + Cleanup/Festival/Market/Volunteer)",
     JSON.stringify(retrievalTopics(interestTerms(["Parks"]))) === JSON.stringify(["outdoors"]) && JSON.stringify(retrievalCategories(interestTerms(["Parks"]))) === JSON.stringify(["Cleanup"]) &&
     JSON.stringify(retrievalTopics(interestTerms(["Community"]))) === JSON.stringify(["civic", "community", "volunteer"]) &&
     JSON.stringify(retrievalCategories(interestTerms(["Community"]))) === JSON.stringify(["Cleanup", "Festival", "Market", "Volunteer"]));
}

console.log("\n── CAC 2026: no false matches (1.1 cause 4) ──");
{
  const storytime = ev("st", { title: "Family Storytime", category: "Workshop", locationName: "Mitchell Park Library · Midtown Room", organizer: "Palo Alto City Library",
    description: "Join us at Mitchell Park Library for songs and stories. Educational Park families welcome." });
  ok("a storytime at Mitchell Park Library is NOT a Parks match (venue names are stripped, bare 'park' is not a phrase)",
     statedInterestMatch(storytime, { ...baseCtx, interests: ["Parks"] }) === 0 && !/Mitchell Park Library/.test(stripVenueNames(storytime.description, storytime)),
     JSON.stringify([statedInterestMatch(storytime, { ...baseCtx, interests: ["Parks"] }), stripVenueNames(storytime.description, storytime)]));
  const craft = ev("cr", { title: "Art History for Kids: Design a Diya", category: "Workshop", locationName: "San Lorenzo · Greenhouse Community Room", description: "Crafts in the Greenhouse Community Room." });
  ok("a film night ('Cinema Sunday: Yellow Rose') is NOT a Gardens match, a rose garden tour is", statedInterestMatch(ev("ys", { title: "Cinema Sunday: Yellow Rose", category: "Festival" }), { ...baseCtx, interests: ["Gardens"] }) === 0 && statedInterestMatch(ev("rg", { title: "Rose Garden Tour", category: "Meetup" }), { ...baseCtx, interests: ["Gardens"] }) === 1);
  ok("a craft class in the Greenhouse Community Room is NOT a Gardens match", statedInterestMatch(craft, { ...baseCtx, interests: ["Gardens"] }) === 0);
  const homework = ev("hw", { title: "Homework Help Center", category: "Workshop", description: "Drop in for help from our trained volunteer tutors. Volunteers staff the center on weekdays." });
  ok("'volunteer' in a description is not a Volunteering/Community match", statedInterestMatch(homework, { ...baseCtx, interests: ["Community"] }) === 0 && statedInterestMatch(homework, { ...baseCtx, interests: ["volunteering"] }) === 0);
  const cleanup = ev("cu", { title: "Coyote Creek Restoration Morning", category: "Workshop", description: "Volunteers needed: help us remove invasive plants. Gloves and tools provided." });
  ok("'Restoration' in the title IS a Community match (and a Waterfront one via 'creek')",
     statedInterestMatch(cleanup, { ...baseCtx, interests: ["Community"] }) === 1 && statedInterestMatch(cleanup, { ...baseCtx, interests: ["Waterfront"] }) === 1);
  const descOnly = ev("do", { title: "Saturday Morning at the Farm", category: "Workshop", description: "Volunteers needed: help us remove invasive plants. Gloves and tools provided." });
  ok("'volunteers needed … help us remove invasive' only in the description LIFTS the score (0.8) but is not a direct match",
     statedInterestMatch(descOnly, { ...baseCtx, interests: ["Community"] }) === 0.8 && scoreEvent(descOnly, { ...baseCtx, interests: ["Community"] }).parts.interestMatch === 0);
  const umbrella = ev("um", { title: "Personal Emergency Preparedness Workshop", category: "Workshop", tags: ["library", "Health & Fitness", "Adults"] });
  ok("a library's umbrella tag 'Health & Fitness' is not a Sports match (a CPR class is not a sport)", statedInterestMatch(umbrella, { ...baseCtx, interests: ["Sports"] }) === 0);
  const tagLift = ev("tl", { title: "Evening Session", category: "Workshop", tags: ["library", "Yoga & Tai Chi series"] });
  ok("a phrase inside a feed label that is not allow-listed as a whole is a lift (0.8), not a direct match", statedInterestMatch(tagLift, { ...baseCtx, interests: ["Sports"] }) === 0.8 && scoreEvent(tagLift, { ...baseCtx, interests: ["Sports"] }).parts.interestMatch === 0);
  const midpen = ev("mp", { title: "Trees & Friends", category: "Sports", source: "midpen", tags: ["outdoors", "parks", "Hike"], description: "Hike · About 5.5 miles." });
  ok("an allow-listed whole feed tag ('Hike', 'outdoors') IS a direct Parks match", matchInterests(midpen, ["Parks"])[0]?.via === "tag" && statedInterestMatch(midpen, { ...baseCtx, interests: ["Parks"] }) === 1);
  ok("'The Songs of Nature: An Art Exhibit' is not an outdoors match (bare 'nature' is not a phrase)", statedInterestMatch(ev("sn", { title: "The Songs of Nature: An Art Exhibit", category: "Festival" }), { ...baseCtx, interests: ["Parks"] }) === 0);
  ok("'South Bay Needlepointers' and a geothermal 'Reservoir' seminar are not Waterfront matches",
     statedInterestMatch(ev("nb", { title: "The South Bay Needlepointers (SBN) Stitch-In", category: "Workshop" }), { ...baseCtx, interests: ["Waterfront"] }) === 0 &&
     statedInterestMatch(ev("rs", { title: "ESE Seminar: Reservoir Evolution and Stress Changes", category: "Workshop" }), { ...baseCtx, interests: ["Waterfront"] }) === 0);
  ok("'Open Lab Hours at AI Center for Civic and Social Good' is not a Community match (bare 'civic' is not a phrase)",
     statedInterestMatch(ev("cv", { title: "Open Lab Hours at AI Center for Civic and Social Good", category: "Workshop" }), { ...baseCtx, interests: ["Community"] }) === 0);
  const boardGames = ev("bg", { title: "Go: The Game", category: "Social", description: "Learn the ancient board game. All skill levels." });
  ok("a board-game afternoon (tagged 'sports' by the word game) is NOT a Sports match", statedInterestMatch(boardGames, { ...baseCtx, interests: ["Sports"] }) === 0);
  ok("a listing from a discovered source classified Cleanup with nothing outdoor about it is a lift, not a Parks match (allcove's 'glitter jars'); a config source's Cleanup still is",
     scoreEvent(ev("gj", { title: "senses and sensibility: glitter jars", category: "Cleanup", source: "wordpress-tec", organizer: "allcove" }), { ...baseCtx, interests: ["Parks"] }).parts.interestMatch === 0 &&
     statedInterestMatch(ev("gj", { title: "senses and sensibility: glitter jars", category: "Cleanup", source: "wordpress-tec" }), { ...baseCtx, interests: ["Parks"] }) === 0.8 &&
     statedInterestMatch(ev("cc", { title: "Saturday Shift", category: "Cleanup", source: "bibliocommons" }), { ...baseCtx, interests: ["Parks"] }) === 1 &&
     statedInterestMatch(ev("sb", { title: "Native Planting at Palo Alto Baylands!", category: "Volunteer", source: "wordpress-tec", tags: [] }), { ...baseCtx, interests: ["Community"] }) === 1);
  ok("a 'Social' catch-all category is NOT a Community match by itself", statedInterestMatch(ev("s", { category: "Social", title: "Resume Review" }), { ...baseCtx, interests: ["Community"] }) === 0);
  ok("a ticketed tribute concert classified Festival is a lift (0.8) for Community, not a direct match; a parade or celebration in the title is",
     statedInterestMatch(ev("cl", { category: "Festival", title: "Candlelight - Queen vs ABBA" }), { ...baseCtx, interests: ["Community"] }) === 0.8 &&
     statedInterestMatch(ev("pa", { category: "Festival", title: "Halloween Program & Costume Parade" }), { ...baseCtx, interests: ["Community"] }) === 1);
  ok("a used book sale tagged 'Families' / 'Kids: Family Events' is at most a lift for Playgrounds, never a direct match",
     scoreEvent(ev("bs", { category: "Market", title: "Friends of the Library Used Book Sale", tags: ["library", "Families", "Kids: Family Events", "Adults"] }), { ...baseCtx, interests: ["Playgrounds"] }).parts.interestMatch === 0);
  ok("a lecture ABOUT story time is not a Playgrounds match, and a seminar is never an outdoors one",
     statedInterestMatch(ev("lec", { category: "Workshop", title: "WGSS Lecture: Drag Story Time as a Site of Resistance" }), { ...baseCtx, interests: ["Playgrounds"] }) === 0 &&
     statedInterestMatch(ev("sem", { category: "Workshop", title: "Seminar: Trail Networks and Urban Form" }), { ...baseCtx, interests: ["Trails"] }) === 0 &&
     statedInterestMatch(ev("st2", { category: "Workshop", title: "Drag Story Time" }), { ...baseCtx, interests: ["Playgrounds"] }) === 1);
  ok("'Bay Area Coders' is not a Waterfront match but 'Bay Trail Bird Walk' is",
     statedInterestMatch(ev("ba", { title: "Bay Area Coders Meetup", category: "Meetup" }), { ...baseCtx, interests: ["Waterfront"] }) === 0 &&
     statedInterestMatch(ev("bt", { title: "Bay Trail Bird Walk", category: "Meetup" }), { ...baseCtx, interests: ["Waterfront"] }) === 1);
  ok("a description-only match is refused when the title's own topic points elsewhere",
     statedInterestMatch(ev("mv", { title: "Vintage Film Lab", category: "Workshop", description: "Digitize film with help from volunteers needed on site." }), { ...baseCtx, interests: ["Community"] }) === 0);
  ok("the match reports which pick matched and how", JSON.stringify(matchInterests(cleanup, ["Parks", "Community"]).map((m) => [m.label, m.term, m.strength, m.via])) ===
     JSON.stringify([["Parks", "outdoors", 1, "title"], ["Community", "volunteering", 1, "title"], ["Community", "community", 0.8, "description"]]), JSON.stringify(matchInterests(cleanup, ["Parks", "Community"])));
}

console.log("\n── CAC 2026: a direct match ranks above every non-match (1.1 cause 3) ──");
{
  const near = ev("near-career", { category: "Workshop", title: "Resume Clinic", qualityScore: 0.95, startMs: days(2) });
  const far = ev("far-hike", { category: "Meetup", title: "Guided Hike at Rancho San Antonio", qualityScore: 0.3, startMs: days(12), latitude: SJ.lat + 0.25, longitude: SJ.lng - 0.2 });
  const ctx = { ...baseCtx, interests: ["Parks", "Trails"], studentStatus: true, school: "SJSU" };
  const out = rankEvents([near, far], ctx);
  ok("a far, low-quality, 12-days-out hike outranks a near, complete, same-week career workshop for a Parks + Trails student",
     out[0].id === "far-hike" && out[0].parts.interestMatch === 1 && out[1].parts.interestMatch === 0, JSON.stringify(out.map((o) => [o.id, o.score])));
  ok("the student floor still lifts the workshop's interest term (0.75) — it just cannot beat a direct match",
     out[1].parts.interest === 0.75 && out[0].parts.interest === 1);
  const noInterests = rankEvents([near, far], { ...baseCtx, studentStatus: true });
  ok("with no stated interests the order is the plain score (near career workshop first) — tiering is off", noInterests[0].id === "near-career" && noInterests.every((o) => o.parts.interestMatch === 0));
  ok("nothing is dropped: both events are returned", out.length === 2 && noInterests.length === 2);
  const nearHike = ev("near-hike", { category: "Meetup", title: "Evening Trail Walk", startMs: days(3) });
  const two = rankEvents([far, nearHike, near], ctx).map((o) => o.id);
  ok("inside the matching group the nearer, sooner hike leads", JSON.stringify(two) === JSON.stringify(["near-hike", "far-hike", "near-career"]), JSON.stringify(two));
}

console.log("\n── CAC 2026: the exploration slot is labelled and is the only off-interest card (1.1 cause 6) ──");
{
  const matches = Array.from({ length: 12 }, (_, i) => ev(`hike-${String(i).padStart(2, "0")}`, { category: "Meetup", title: `Trail Walk ${i}`, startMs: days(1 + i % 6), qualityScore: 0.6 }));
  const others = [
    ev("concert", { category: "Festival", title: "Jazz in the Plaza", qualityScore: 0.95, startMs: days(2) }),
    ev("career", { category: "Workshop", title: "Career Fair", qualityScore: 0.9, startMs: days(2) }),
    ev("thin", { category: "Social", title: "Board Games", qualityScore: 0.2, startMs: days(2) }),
  ];
  const ctx = { ...baseCtx, interests: ["Trails"] };
  const out = rankEvents([...others, ...matches], ctx);
  const top10 = out.slice(0, 10);
  ok("nine of the top ten match the pick and the tenth is the exploration card", top10.slice(0, 9).every((o) => o.parts.interestMatch === 1) && top10[9].parts.exploration === 1 && top10[9].parts.interestMatch === 0);
  ok("the exploration card is the highest-quality non-match and carries its own reason", top10[9].id === "concert" && JSON.stringify(top10[9].reasons) === JSON.stringify([EXPLORATION_REASON]));
  ok("every other non-match ranks below every match", out.slice(10).filter((o) => o.parts.interestMatch === 1).length === 3 && out.findIndex((o) => o.id === "career") > 12);
  ok("output length equals input length", out.length === 15);
}

console.log("\n── CAC 2026: the pick's primary meaning leads its shared outdoors matches ──");
{
  const ctx = { ...baseCtx, interests: ["Waterfront"] };
  const hike = ev("hike", { category: "Meetup", title: "Guided Hike", startMs: days(1) });
  const creek = ev("creek", { category: "Meetup", title: "Coyote Creek Bird Walk", startMs: days(6), latitude: SJ.lat + 0.1 });
  const out = rankEvents([hike, creek], ctx).map((o) => o.id);
  ok("for a Waterfront pick the creek walk (primary: waterfront) leads the sooner, nearer general hike (secondary: outdoors)", JSON.stringify(out) === JSON.stringify(["creek", "hike"]), JSON.stringify(out));
  ok("both are still direct matches", rankEvents([hike, creek], ctx).every((o) => o.parts.interestMatch === 1));
}

console.log("\n── CAC 2026: a recurring listing is one card, not three (series collapse in v1) ──");
{
  const ctx = { ...baseCtx, interests: ["Community"] };
  const series = [1, 3, 5].map((d) => ev(`lab-${d}`, { category: "Volunteer", title: "Forge Volunteer Hours", locationName: "Forge", source: "livewhale", startMs: days(d) }));
  const other = ev("sale", { category: "Market", title: "Friends Book Sale", startMs: days(2) });
  const out = rankEvents([...series, other], ctx);
  ok("the soonest occurrence stays, the later two move to the end, nothing is dropped", out.length === 4 && out[0].id === "lab-1" && out.slice(-2).map((o) => o.id).sort().join() === "lab-3,lab-5", JSON.stringify(out.map((o) => o.id)));
  ok("the kept card carries the later dates (ISO, sorted, ≤ 5)", JSON.stringify(out[0].moreDates) === JSON.stringify([new Date(days(3)).toISOString(), new Date(days(5)).toISOString()]), JSON.stringify(out[0].moreDates));
  ok("a one-off listing is untouched", out.find((o) => o.id === "sale").moreDates === undefined);
}

console.log("\n── CAC 2026: the reasons line names the user's own pick and is never wrong ──");
{
  const hike = ev("h", { category: "Meetup", title: "Guided Hike at Alum Rock", startMs: days(3) });
  const ctx = { ...baseCtx, interests: ["Parks", "Community"] };
  const s = scoreEvent(hike, ctx);
  const reasons = reasonsForV1(hike, ctx, s.parts);
  ok("'Because you like Parks' — the pick, not a server term", reasons[0] === "Because you like Parks", JSON.stringify(reasons));
  const workshop = ev("w", { category: "Workshop", title: "Resume Clinic", startMs: days(3) });
  const student = { ...baseCtx, interests: ["Parks"], studentStatus: true, school: "Org" };
  const sw = scoreEvent(workshop, student);
  ok("a student-floor event (interest 0.9 via same school) gets NO 'Because you like' reason", sw.parts.interest === 0.9 && !reasonsForV1(workshop, student, sw.parts).some((r) => r.startsWith("Because you like")));
  const blended = { ...baseCtx, interests: ["Parks"], attendedCategories: { Workshop: 4 } };
  const sb = scoreEvent(workshop, blended);
  ok("behaviour blended with a non-matching pick (0.6) earns no interest reason at all — never 'Because you like Parks' on a resume clinic",
     sb.parts.interest === 0.6 && !reasonsForV1(workshop, blended, sb.parts).some((r) => r.startsWith("Because you like") || r.startsWith("Matches")), JSON.stringify(reasonsForV1(workshop, blended, sb.parts)));
  const attendedOnly = { ...baseCtx, attendedCategories: { Workshop: 4 } };
  const sa = scoreEvent(workshop, attendedOnly);
  ok("a purely behavioural match says so instead of claiming a pick", sa.parts.interest === 1 && reasonsForV1(workshop, attendedOnly, sa.parts).includes("Matches what you've attended") && !reasonsForV1(workshop, attendedOnly, sa.parts).some((r) => r.startsWith("Because you like")), JSON.stringify(reasonsForV1(workshop, attendedOnly, sa.parts)));
  const community = ev("c", { category: "Volunteer", title: "Saturday Shift", startMs: days(3) });
  ok("the pick that actually matched is the one named (Community, not Parks)", reasonsForV1(community, ctx, scoreEvent(community, ctx).parts)[0] === "Because you like Community");
}

console.log("\n── determinism ──");
{
  const events = [ev("b"), ev("a"), ev("c")];
  const a = rankEvents(events, baseCtx).map((o) => o.id);
  const b = rankEvents([...events].reverse(), baseCtx).map((o) => o.id);
  ok("ties break stably by id regardless of input order", JSON.stringify(a) === JSON.stringify(b), `${a} vs ${b}`);
}

console.log("\n── scoring shape ──");
{
  const s = scoreEvent(ev("a"), baseCtx);
  ok("score is 0..1 and parts are all 0..1",
     s.score >= 0 && s.score <= 1 && Object.values(s.parts).every((p) => p >= 0 && p <= 1), JSON.stringify(s));
  ok("parts are returned so a placement can be explained on-device",
     ["interest", "distance", "social", "timing", "novelty"].every((k) => k in s.parts));
}

console.log(`\n══ ${pass} passed, ${fail} failed ══`);
process.exit(fail ? 1 : 0);
