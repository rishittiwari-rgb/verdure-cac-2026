import { selectPlanCandidates, avoidRecentPlanEvents, validateModelStops, refineSelection, sequenceEventsFallback, isAllDayListing } from "../lib/eventPlanner.js";

let pass = 0;
let fail = 0;
function ok(name, condition) {
  if (condition) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}`); }
}

const nowMs = Date.UTC(2026, 8, 28, 15);
const rows = [
  { id: "a", title: "Park cleanup", category: "Cleanup", locationName: "Park", startMs: nowMs + 86_400_000, isFree: true, latitude: 37.3, longitude: -121.9 },
  { id: "b", title: "Maker workshop", category: "Workshop", locationName: "Library", startMs: nowMs + 2 * 86_400_000, isFree: false, priceMin: 10, latitude: 37.31, longitude: -121.9 },
  { id: "c", title: "Jazz concert", category: "Music", locationName: "Stage", startMs: nowMs + 3 * 86_400_000, isFree: false, priceMin: 25, latitude: 37.5, longitude: -121.9 },
  { id: "d", title: "Garden workshop", category: "Workshop", locationName: "Garden", startMs: nowMs + 4 * 86_400_000, isFree: true, latitude: 37.32, longitude: -121.9 },
];
const req = { when: "Any day", who: "Just me", distance: "Anywhere nearby", budget: "Doesn't matter", note: "", nowMs };
ok("free only excludes paid stops", selectPlanCandidates(rows, { ...req, budget: "Free" }).map((r) => r.id).join() === "a,d");
ok("search note narrows to real matching stops", selectPlanCandidates(rows, { ...req, note: "workshop" }).map((r) => r.id).join() === "b,d");
ok("picked calendar date keeps only events on that local day",
  selectPlanCandidates(rows, { ...req, when: "Pick a date", targetDate: "2026-09-29" })
    .map((r) => r.id).join() === "a");
const weekendRows = [
  { ...rows[0], id: "this-saturday", startMs: Date.UTC(2026, 9, 3, 19) },
  { ...rows[0], id: "this-sunday", startMs: Date.UTC(2026, 9, 4, 23) },
  { ...rows[0], id: "next-saturday", startMs: Date.UTC(2026, 9, 10, 19) },
];
ok("this weekend excludes the following weekend",
  selectPlanCandidates(weekendRows, { ...req, when: "This weekend" }).map((r) => r.id).join() ===
    "this-saturday,this-sunday");
ok("on Sunday this weekend means the remainder of the current weekend",
  selectPlanCandidates(weekendRows, { ...req, when: "This weekend", nowMs: Date.UTC(2026, 9, 4, 18) })
    .map((r) => r.id).join() === "this-sunday");
ok("tomorrow uses the local date across the fall DST change",
  selectPlanCandidates([
    { ...rows[0], id: "same-day", startMs: Date.UTC(2026, 10, 1, 20) },
    { ...rows[0], id: "tomorrow", startMs: Date.UTC(2026, 10, 2, 20) },
  ], { ...req, when: "Tomorrow", nowMs: Date.UTC(2026, 10, 1, 7, 30) })
    .map((r) => r.id).join() === "tomorrow");
ok("walking excludes an event with no verified venue coordinate",
  selectPlanCandidates([{ ...rows[0], id: "unknown", latitude: undefined, longitude: undefined }],
    { ...req, distance: "Walking", lat: 37.3, lng: -121.9 }).length === 0);
ok("with kids requires confirmed family or child suitability",
  selectPlanCandidates([
    { ...rows[0], id: "unknown", ageSuitability: undefined },
    { ...rows[0], id: "adults", ageSuitability: "adults" },
    { ...rows[0], id: "all", ageSuitability: "all" },
  ], { ...req, who: "With kids" }).map((r) => r.id).join() === "all");
ok("model IDs are verified and de-duplicated", validateModelStops([
  { eventId: "invented", why: "x" }, { eventId: "a", why: "real" }, { eventId: "a", why: "again" }, { eventId: "b", why: "real" },
], rows).map((r) => r.eventId).join() === "a,b");
ok("refinement swaps without another model call", refineSelection(["a", "b"], rows, "cheaper", "b").join() === "a,d");
ok("longer adds a new verified stop", refineSelection(["a", "b"], rows, "longer", "").join() === "a,b,c");
ok("shorter keeps one verified stop", refineSelection(["a", "b"], rows, "shorter", "").join() === "a");
const futureRows = rows.map((row, index) => ({ ...row, startMs: nowMs + (16 + index) * 86_400_000 }));
const twoWeeksLater = selectPlanCandidates(futureRows, { ...req, nowMs: nowMs + 14 * 86_400_000 });
ok("same user two weeks later receives different still-upcoming stops",
  avoidRecentPlanEvents(twoWeeksLater, ["a", "b"]).map((row) => row.id).join() === "c,d");
// CAC 2026 (1.2): planEvents must work through its deterministic fallback — it is the path that runs with no model key.
{
  const day = Date.UTC(2026, 9, 24);   // Sat 2026-10-24 (PDT = UTC−7)
  const at = (h, m = 0) => day + (h + 7) * 3_600_000 + m * 60_000;
  const ranked = [
    { id: "hike", title: "Guided Hike", category: "Sports", organizer: "Midpen", startMs: at(9), locationName: "Rancho San Antonio", isFree: true, social: 0.7, latitude: 37.33, longitude: -122.09 },
    { id: "market", title: "Farmers Market", category: "Market", organizer: "SJ Downtown", startMs: at(12), locationName: "San Pedro Square", isFree: true, social: 0, latitude: 37.336, longitude: -121.894 },
    { id: "clash", title: "Bird Walk", category: "Meetup", organizer: "Audubon", startMs: at(9, 30), locationName: "Lake Elizabeth", isFree: true, social: 0, latitude: 37.55, longitude: -121.96 },
    { id: "yoga", title: "Park Yoga", category: "Sports", organizer: "SJPL", startMs: at(15), locationName: "St. James Park", isFree: false, priceMin: 10, social: 0, latitude: 37.339, longitude: -121.889 },
    { id: "allday", title: "Art Exhibit", category: "Festival", organizer: "Library", startMs: at(0), locationName: "Saratoga Library", isFree: true, social: 0, allDay: true },
    { id: "nextday", title: "Sunday Cleanup", category: "Cleanup", organizer: "Keep Coyote Creek Beautiful", startMs: at(33), locationName: "Coyote Creek", isFree: true, social: 0 },
  ];
  const plan = sequenceEventsFallback(ranked);
  const ids = plan.stops.map((s) => s.eventId);
  ok("fallback: the best-ranked event leads and the plan stays on its day", ids[0] === "hike" && !ids.includes("nextday"));
  ok("fallback: later events are in start order and an unreachable overlap (Bird Walk, 30 min after the hike, 20 mi away) is left out", !ids.includes("clash") && ids.indexOf("hike") < ids.indexOf("market"), JSON.stringify(ids));
  ok("fallback: three stops at most — two timed events that chain plus the all-day listing, which reserves one slot (the paid 3 pm yoga is left for another day)", ids.join() === "hike,market,allday", JSON.stringify(ids));
  const sparse = sequenceEventsFallback([ranked[0], ranked[4]]);
  ok("fallback: with room, the all-day listing fills a slot and is described as 'fit it in when it suits'", sparse.stops.map((s) => s.eventId).join() === "hike,allday" && /fit it in when it suits/.test(sparse.stops[1].why), JSON.stringify(sparse.stops));
  ok("fallback: every why is a concrete sentence (ranking, travel leg or gap, host, friends) and no two are identical",
     plan.stops.every((s) => /\.$/.test(s.why) && s.why.length > 15) && new Set(plan.stops.map((s) => s.why)).size === plan.stops.length && /best-ranked/.test(plan.stops[0].why) && /a friend is going/.test(plan.stops[0].why));
  ok("fallback: the title names the day and the count, the intro says the times are reachable and that all are free", /^Saturday: 3 events from 9:00 am$/.test(plan.title) && /each reachable after the one before/.test(plan.intro) && /All free./.test(plan.intro), JSON.stringify([plan.title, plan.intro]));
  const paid = sequenceEventsFallback([ranked[3], ranked[0]]);
  ok("fallback: with a paid event in the plan the intro does not say 'All free'", !/All free/.test(paid.intro), paid.intro);
  const other = sequenceEventsFallback([ranked[3], ranked[1], ranked[0]]);
  ok("fallback: a different ranking (yoga first) keeps the plan in time order but marks the yoga as the best-ranked match", other.stops.some((s) => s.eventId === "yoga" && /best-ranked/.test(s.why)) && !/best-ranked/.test(other.stops.find((s) => s.eventId === "hike")?.why ?? ""), JSON.stringify(other.stops));
  // One event per day (the E2E fixture and a quiet fortnight): the plan continues onto later days rather than stopping at one stop.
  const perDay = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, title: `E${i}`, category: i % 2 ? "Cleanup" : "Hackathon", organizer: "o", startMs: at(10) + (i + 1) * 86_400_000, locationName: `Venue ${i}`, isFree: true, social: 0, latitude: 37.3382, longitude: -121.8863 }));
  const multi = sequenceEventsFallback(perDay), multiOther = sequenceEventsFallback([...perDay].reverse());
  ok("fallback: one event per day → three stops on three days, best-ranked first, in date order, and the intro says why", multi.stops.map((s) => s.eventId).join() === "d0,d1,d2" && /^Next up: 3 events over 3 days$/.test(multi.title) && /later days/.test(multi.intro), JSON.stringify([multi.title, multi.stops.map((s) => s.eventId)]));
  ok("fallback: a different ranking over the same days starts somewhere else (the E2E personalisation check)", multiOther.stops[0].eventId !== multi.stops[0].eventId, JSON.stringify(multiOther.stops.map((s) => s.eventId)));
  // Three events at the very same time (the W2 seed): one cannot attend them all, so the plan is the best one plus the others as labelled alternatives.
  const sameTime = ["a", "b", "c"].map((id) => ({ id, title: `Same-time ${id}`, category: "Social", organizer: "o", startMs: at(18), locationName: `Venue ${id}`, isFree: true, social: 0, latitude: 37.3382, longitude: -121.8863 }));
  const clash = sequenceEventsFallback(sameTime);
  ok("fallback: same-time events yield the best-ranked one plus alternatives labelled as such, never a one-card plan", clash.stops.length === 3 && clash.stops[0].eventId === "a" && clash.stops.slice(1).every((s) => /At the same time as Same-time a/.test(s.why)) && /alternatives at the same time/.test(clash.intro), JSON.stringify([clash.intro, clash.stops.map((s) => s.why)]));
  ok("fallback: one event alone is still a one-stop plan, not a crash", sequenceEventsFallback([ranked[0]]).stops.length === 1 && sequenceEventsFallback([]).stops.length === 0);
  ok("isAllDayListing: 'All day' label, or a local-midnight start that ends 20+ hours later; a 9 am class is not",
     isAllDayListing(at(0), at(23, 59), undefined) && isAllDayListing(at(9), undefined, "All day") && !isAllDayListing(at(9), at(10), "9:00 AM") && !isAllDayListing(at(0), at(2), undefined));
}
console.log(`══ ${pass} passed, ${fail} failed ══`);
if (fail) process.exitCode = 1;
