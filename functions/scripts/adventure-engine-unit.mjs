// Adventure engine unit tests — no emulator, no network. CAC 2026 (1.2).
//
// One test per rule in adventure-engine.ts, plus the hours parser and the two
// properties a picky local cares about most: the plan fits the time asked for,
// and no sentence repeats itself.
import { buildPlan, parseOpeningHours, openStateAt, topicScore, isMemberOnly, travelMinutes, stopsFor, repeatedPhrases, milesBetween, INVENTED_FEATURE_WORDS } from "../lib/adventure-engine.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const TZ = "America/Los_Angeles";
// Sat 2026-10-24 14:00 PDT (21:00Z). Sunset that day in San José ≈ 18:21 PDT.
const NOW = Date.UTC(2026, 9, 24, 21, 0, 0);
const SUNSET = Date.UTC(2026, 9, 25, 1, 21, 0);
const SUNRISE = Date.UTC(2026, 9, 24, 14, 27, 0);
const HERE = { lat: 37.3382, lng: -121.8863 };
const weather = (o = {}) => ({ temperatureF: 72, precipitation: 0, code: 0, summary: "clear", sunsetMs: SUNSET, sunriseMs: SUNRISE, ...o });
const place = (id, name, category, dLat, dLng, hours) => ({ id, name, category, latitude: HERE.lat + dLat, longitude: HERE.lng + dLng, hours });
const base = () => [
  place("p1", "St. James Park", "Parks", 0.004, 0.0, "sunrise-sunset"),
  place("p2", "Guadalupe River Trail", "Trails", 0.006, -0.008, "24/7"),
  place("p3", "Plaza de Cesar Chavez", "Parks", -0.006, -0.002),
  place("p4", "Northside Community Center", "Community", 0.009, 0.004, "Mo-Fr 09:00-21:00; Sa 09:00-17:00"),
  place("p5", "Ryland Dog Park", "Parks", 0.009, 0.0),
  place("p6", "Backesto Playground", "Playgrounds", 0.012, 0.006, "sunrise-sunset"),
  place("p7", "Overlook at Communications Hill", "Scenic", -0.03, -0.01),
  place("p8", "SoFA Pocket Garden", "Gardens", -0.005, 0.001, "Mo-Su 08:00-20:00"),
  place("p9", "Downtown Courts", "Sports", 0.002, 0.006, "Mo-Su 07:00-22:00"),
];
const plan = (o = {}) => buildPlan({ candidates: base(), interests: ["Parks", "Trails"], timeOfDay: "afternoon", durationMinutes: 120, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NOW, timeZone: TZ, ...o });

console.log("── opening hours parser ──");
ok("24/7 is always open", openStateAt("24/7", NOW, TZ) === "open");
ok("sunrise-sunset uses the sun times when known: open at 14:00, closed after sunset", openStateAt("sunrise-sunset", NOW, TZ, { sunriseMs: SUNRISE, sunsetMs: SUNSET }) === "open" && openStateAt("sunrise-sunset", SUNSET + 60_000, TZ, { sunriseMs: SUNRISE, sunsetMs: SUNSET }) === "closed");
ok("Mo-Fr 09:00-17:00 is closed on a Saturday afternoon", openStateAt("Mo-Fr 09:00-17:00", NOW, TZ) === "closed");
ok("Mo-Fr 09:00-21:00; Sa 09:00-17:00 is open on Saturday at 14:00 and closed at 17:30", openStateAt("Mo-Fr 09:00-21:00; Sa 09:00-17:00", NOW, TZ) === "open" && openStateAt("Mo-Fr 09:00-21:00; Sa 09:00-17:00", NOW + 3.5 * 3_600_000, TZ) === "closed");
ok("a day range that wraps (Fr-Mo) covers Saturday", openStateAt("Fr-Mo 10:00-18:00", NOW, TZ) === "open");
ok("'off' closes a day: Mo-Su 08:00-20:00; Sa off", openStateAt("Mo-Su 08:00-20:00; Sa off", NOW, TZ) === "closed");
ok("unposted or unparseable hours are 'unknown', never guessed", openStateAt(undefined, NOW, TZ) === "unknown" && openStateAt("by appointment", NOW, TZ) === "unknown" && parseOpeningHours("Mo-Fr 9am-5pm") === null);
ok("two ranges in one day parse", JSON.stringify(parseOpeningHours("Mo-Fr 06:00-12:00,13:00-20:00")[0].ranges) === JSON.stringify([[360, 720], [780, 1200]]));

console.log("\n── relevance and eligibility ──");
ok("a pick's own category scores 1, a related one 0.6, off-topic 0; with no picks general places 0.5 and specialised ones (playgrounds, sports) 0.3", topicScore("Parks", ["Parks"]) === 1 && topicScore("Gardens", ["Parks"]) === 0.6 && topicScore("Sports", ["Parks"]) === 0 && topicScore("Parks", []) === 0.5 && topicScore("Sports", []) === 0.3 && topicScore("Playgrounds", []) === 0.3);
ok("a club, lodge or congregation tagged as a community centre is member-only; an ordinary centre is not",
   isMemberOnly({ id: "a", name: "Elks Lodge 522", category: "Community" }) && isMemberOnly({ id: "b", name: "Italian American Heritage Society", category: "Community" }) &&
   isMemberOnly({ id: "c", name: "First Baptist Church", category: "Community" }) && !isMemberOnly({ id: "d", name: "Northside Community Center", category: "Community" }) &&
   !isMemberOnly({ id: "e", name: "Boat Club Park", category: "Parks" }));
{
  const p = plan({ candidates: [...base(), place("club", "Masonic Lodge Hall", "Community", 0.001, 0.001, "24/7")], interests: ["Community"] });
  ok("a member-only organisation is never a stop and the skip is explained", !p.stops.some((s) => s.placeId === "club") && p.skipped.some((s) => s.id === "club" && /member-only/.test(s.reason)));
}
{
  const p = plan({ candidates: [...base(), place("closed", "Weekday Rec Center", "Community", 0.001, 0.001, "Mo-Fr 09:00-17:00")], interests: ["Community"] });
  ok("a place whose posted hours say closed for the whole outing is never a stop", !p.stops.some((s) => s.placeId === "closed") && p.skipped.some((s) => s.id === "closed" && /closed/.test(s.reason)));
}
{
  const p = plan({ interests: ["Parks"] , durationMinutes: 240 });
  ok("at most one stop with unposted hours per plan", p.stops.filter((s) => !s.meta.hoursKnown).length <= 1, JSON.stringify(p.stops.map((s) => [s.name, s.meta.hoursKnown])));
}

console.log("\n── topic over distance ──");
{
  const cands = [place("far-trail", "Coyote Creek Trail", "Trails", 0.025, 0.02, "24/7"), place("near-courts", "Downtown Courts", "Sports", 0.001, 0.0, "24/7"), place("near-garden", "Pocket Garden", "Gardens", 0.002, 0.001, "24/7"), place("far-park", "Kelley Park", "Parks", -0.028, 0.012, "sunrise-sunset")];
  const p = buildPlan({ candidates: cands, interests: ["Trails", "Parks"], timeOfDay: "morning", durationMinutes: 150, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NOW - 4 * 3_600_000, timeZone: TZ });
  ok("the far trail and far park (the picks) are chosen over the near courts (off-topic)", p.stops.some((s) => s.placeId === "far-trail") && p.stops.some((s) => s.placeId === "far-park") && !p.stops.some((s) => s.placeId === "near-courts"), JSON.stringify(p.stops.map((s) => s.name)));
  ok("every chosen stop is on topic", p.stops.every((s) => s.meta.onTopic));
}

console.log("\n── weather ──");
{
  const cool = plan({ interests: ["Parks"], durationMinutes: 180 });
  const hot = plan({ interests: ["Parks"], durationMinutes: 180, weather: weather({ temperatureF: 97, summary: "clear" }) });
  ok("at 97°F every outdoor stop is capped at 30 minutes and the plan says so", hot.stops.filter((s) => ["Parks", "Trails", "Playgrounds", "Scenic", "Gardens", "Waterfront"].includes(base().find((c) => c.id === s.placeId)?.category)).every((s) => s.minutes <= 30) && hot.notes.some((n) => /97°F/.test(n)), JSON.stringify(hot.stops.map((s) => [s.name, s.minutes])));
  ok("in cool weather the same picks get longer outdoor stops", Math.max(...cool.stops.map((s) => s.minutes)) > Math.max(...hot.stops.map((s) => s.minutes)));
  const warm = plan({ interests: ["Parks"], durationMinutes: 180, weather: weather({ temperatureF: 88 }) });
  ok("at 88°F outdoor stops are capped at 45 minutes", warm.stops.every((s) => s.minutes <= 45) && warm.notes.some((n) => /45 minutes/.test(n)));
  const rain = plan({ interests: ["Community", "Parks"], weather: weather({ temperatureF: 55, precipitation: 1.2, code: 61, summary: "rainy" }) });
  ok("in rain the community centre is chosen and the trail is not, and the plan says so", rain.stops.some((s) => s.placeId === "p4") && !rain.stops.some((s) => s.placeId === "p2") && rain.notes.some((n) => /rain/i.test(n)), JSON.stringify(rain.stops.map((s) => s.name)));
}

console.log("\n── sunset ──");
{
  // 90 minutes before sunset, a 150-minute outing.
  const start = SUNSET - 90 * 60_000;
  const p = buildPlan({ candidates: base(), interests: ["Scenic", "Parks"], timeOfDay: "evening", durationMinutes: 150, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: start, timeZone: TZ });
  ok("the plan names the sunset time", p.notes.some((n) => /Sunset is at 6:21 pm/.test(n)), JSON.stringify(p.notes));
  const last = p.stops[p.stops.length - 1];
  const lastCat = base().find((c) => c.id === last.placeId)?.category;
  ok("the last stop is a sunset spot or indoors", ["Scenic", "Waterfront", "Community", "Sports"].includes(lastCat), `${last.name} (${lastCat})`);
  let t = start;
  const outdoorEnds = p.stops.map((s) => { t += s.meta.travelMinutes * 60_000; const end = t + s.minutes * 60_000; t = end; return { s, end }; }).filter(({ s }) => ["Parks", "Trails", "Playgrounds", "Gardens"].includes(base().find((c) => c.id === s.placeId)?.category));
  ok("every plain outdoor stop finishes before sunset", outdoorEnds.every(({ end }) => end <= SUNSET + 60_000), JSON.stringify(outdoorEnds.map(({ s, end }) => [s.name, new Date(end).toISOString()])));
  const NIGHT = Date.UTC(2026, 9, 25, 5, 0, 0);   // 22:00 PDT, after sunset
  const night = buildPlan({ candidates: [...base(), place("late", "Night Rec Center", "Community", 0.002, 0.002, "Mo-Su 06:00-23:00")], interests: ["Community"], timeOfDay: "night", durationMinutes: 60, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NIGHT, timeZone: TZ });
  ok("after dark a trail is never a stop and an outdoor place with unposted hours is not assumed open", !night.stops.some((s) => s.placeId === "p2") && !night.stops.some((s) => ["p3", "p5", "p7"].includes(s.placeId)) && night.skipped.some((s) => /after dark/.test(s.reason)), JSON.stringify(night.stops.map((s) => s.name)));
  const nothingOpen = buildPlan({ candidates: base(), interests: ["Community"], timeOfDay: "night", durationMinutes: 60, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NIGHT, timeZone: TZ });
  ok("when everything nearby is closed after dark the plan says so instead of sending people to a dark playground", nothingOpen.stops.length === 0 && /Nothing open nearby/.test(nothingOpen.title) && nothingOpen.notes.some((n) => /closed at this hour/.test(n)), JSON.stringify([nothingOpen.title, nothingOpen.notes]));
  // A dawn-to-dusk place that would be reached after sunset is dropped even though it was open when the outing began.
  const lateArrival = buildPlan({ candidates: [place("a", "First Park", "Parks", 0.002, 0, "sunrise-sunset"), place("b", "Second Park", "Parks", 0.004, 0, "sunrise-sunset"), place("c", "Far Garden", "Gardens", 0.03, 0.03, "sunrise-sunset"), place("d", "Rec Center", "Community", 0.003, 0.001, "Mo-Su 06:00-22:00")],
    interests: ["Parks", "Gardens"], timeOfDay: "evening", durationMinutes: 180, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: SUNSET - 60 * 60_000, timeZone: TZ });
  ok("a stop that would be reached after its posted closing is dropped or flagged, never presented as open", lateArrival.stops.every((s) => s.meta.openState !== "closed"), JSON.stringify(lateArrival.stops.map((s) => [s.name, new Date(s.meta.arriveMs).toISOString(), s.meta.openState])));
  // A dawn-to-dusk sunset spot reached five minutes before sunset ends AT sunset, not 65 minutes later.
  const memorial = buildPlan({ candidates: [place("m", "Riverside Memorial", "Scenic", 0.003, 0, "sunrise-sunset"), place("cc", "Rec Center", "Community", 0.002, 0.001, "Mo-Su 06:00-22:00"), place("pk", "Near Park", "Parks", 0.001, 0, "sunrise-sunset")],
    interests: ["Scenic"], timeOfDay: "evening", durationMinutes: 150, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: SUNSET - 40 * 60_000, timeZone: TZ });
  const mem = memorial.stops.find((s) => s.placeId === "m");
  ok("a stop never runs past its posted closing time (the sunrise-sunset memorial ends by sunset)", !mem || mem.meta.arriveMs + mem.minutes * 60_000 <= SUNSET + 60_000, JSON.stringify(memorial.stops.map((s) => [s.name, s.minutes, new Date(s.meta.arriveMs).toISOString()])));
  // A two-stop plan whose second stop is reached seven minutes before it closes keeps it as a quick look and says so.
  const quick = buildPlan({ candidates: [place("q1", "First Overlook", "Scenic", 0.003, 0, "sunrise-sunset"), place("q2", "Second Overlook", "Scenic", 0.012, 0.002, "sunrise-sunset")],
    interests: ["Scenic"], timeOfDay: "evening", durationMinutes: 120, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: SUNSET - 75 * 60_000, timeZone: TZ });
  const q2 = quick.stops.find((s) => /closes at/.test(s.why));
  ok("with only two stops, the earlier stop is cut short so the second is reached with fifteen minutes before it closes, and the second says it closes at 6:21 pm", quick.stops.length === 2 && !!q2 && q2.minutes >= 15 && q2.meta.arriveMs + q2.minutes * 60_000 <= SUNSET + 60_000 && /closes at 6:21 pm, so this is a quick look/.test(q2.why) && !/\bopen\b/.test(q2.why), JSON.stringify(quick.stops.map((s) => [s.name, s.minutes, s.why])));
  ok("the shortened first stop still gets its fifteen-minute minimum", quick.stops[0].minutes >= 15);
  // When a stop is dropped for closing, its replacement must be on topic — never a random off-topic place.
  const replaced = buildPlan({ candidates: [place("s1", "Overlook One", "Scenic", 0.004, 0, "sunrise-sunset"), place("s2", "Overlook Two", "Scenic", 0.006, 0.001, "sunrise-sunset"), place("s3", "Overlook Three", "Scenic", 0.03, 0.03, "sunrise-sunset"), place("school", "Some School", "Playgrounds", 0.001, 0), place("cc", "Rec Center", "Community", 0.002, 0.001, "Mo-Su 06:00-22:00")],
    interests: ["Scenic"], timeOfDay: "evening", durationMinutes: 150, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: SUNSET - 90 * 60_000, timeZone: TZ });
  ok("a replacement for a dropped stop is on topic (no school playground in a Scenic evening plan)", !replaced.stops.some((s) => s.placeId === "school") && replaced.stops.every((s) => s.meta.onTopic), JSON.stringify(replaced.stops.map((s) => s.name)));
}

console.log("\n── coverage and heat allowances ──");
{
  const cands = [place("pk1", "Near Park", "Parks", 0.002, 0, "sunrise-sunset"), place("pk2", "Second Park", "Parks", 0.004, 0.001, "sunrise-sunset"), place("pk3", "Third Park", "Parks", 0.005, -0.001, "sunrise-sunset"), place("tr", "River Trail", "Trails", 0.012, -0.01, "sunrise-sunset")];
  const p = buildPlan({ candidates: cands, interests: ["Parks", "Trails"], timeOfDay: "morning", durationMinutes: 120, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NOW - 4 * 3_600_000, timeZone: TZ });
  ok("with Parks + Trails picked and a trail available, the plan includes a trail instead of a third park", p.stops.some((s) => s.placeId === "tr"), JSON.stringify(p.stops.map((s) => s.name)));
  const heat = buildPlan({ candidates: cands.concat(place("cc", "Cool Rec Center", "Community", 0.006, 0.002, "Mo-Su 09:00-21:00")), interests: ["Parks"], timeOfDay: "afternoon", durationMinutes: 150, weather: weather({ temperatureF: 98 }), lat: HERE.lat, lng: HERE.lng, nowMs: NOW, timeZone: TZ });
  const cc = heat.stops.find((s) => s.placeId === "cc");
  ok("at 98°F an indoor stop is allowed in for a Parks pick, goes last, and is explained as a break from the heat, not as a pick", !!cc && heat.stops[heat.stops.length - 1].placeId === "cc" && /heat|cooler/.test(cc.why) && !/pick/.test(cc.why), JSON.stringify(heat.stops.map((s) => [s.name, s.why])));
  const nothingExact = buildPlan({ candidates: cands, interests: ["Sports"], timeOfDay: "afternoon", durationMinutes: 90, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NOW, timeZone: TZ });
  ok("when no candidate is listed under the pick, the intro says so instead of claiming the stops were chosen for it", /Nothing nearby is listed under sports/.test(nothingExact.intro), nothingExact.intro);
}

console.log("\n── order, time and travel ──");
{
  const p = plan({ durationMinutes: 120 });
  ok("stops are numbered in visiting order from 1", p.stops.map((s) => s.order).join() === p.stops.map((_, i) => i + 1).join());
  ok("the first stop is the nearest chosen place to the user", p.stops[0].meta.distanceMiles === Math.min(...p.stops.map((s) => milesBetween(HERE.lat, HERE.lng, base().find((c) => c.id === s.placeId).latitude, base().find((c) => c.id === s.placeId).longitude))).toFixed(2) * 1 || p.stops[0].meta.distanceMiles <= p.stops[1].meta.distanceMiles);
  const total = p.stops.reduce((a, s) => a + s.minutes + s.meta.travelMinutes, 0);
  ok("stop minutes plus travel never exceed the 120 minutes asked for, and use most of it", total <= 120 && total >= 90, String(total));
  ok("every stop is at least 15 minutes and a multiple of 5 (a stop cut short by its closing time says so)", p.stops.every((s) => (s.minutes >= 15 || /closes at/.test(s.why)) && s.minutes % 5 === 0));
  ok("2 stops for an hour, 3 for two hours, 4 for four hours — bounded by what exists", stopsFor(60, 9) === 2 && stopsFor(120, 9) === 3 && stopsFor(240, 9) === 4 && stopsFor(240, 3) === 3 && stopsFor(240, 2) === 2);
  ok("travel: 0.5 mi walks in 10 min, 3 mi is a short drive plus parking (~16 min)", travelMinutes(0.5) === 10 && travelMinutes(3) === 16);
}

console.log("\n── wording ──");
{
  for (const [i, p] of [plan(), plan({ interests: ["Community"] }), plan({ interests: [], durationMinutes: 240 }), plan({ weather: null })].entries()) {
    ok(`plan ${i + 1}: no phrase is used twice across the intro and the stops`, repeatedPhrases(p).length === 0, JSON.stringify(repeatedPhrases(p)));
    ok(`plan ${i + 1}: every why is one sentence that ends with a full stop and names a concrete fact (distance, minutes, hours or a pick)`, p.stops.every((s) => /\.$/.test(s.why) && /(mi |min|open|hours|pick|where you are)/.test(s.why)), JSON.stringify(p.stops.map((s) => s.why)));
    ok(`plan ${i + 1}: no superlatives or filler`, !p.stops.some((s) => /\b(amazing|stunning|best|perfect|breathtaking|incredible|must[- ]see|hidden gem)\b/i.test(s.why)) && !/\b(amazing|stunning|perfect)\b/i.test(p.intro));
  }
  for (const p of [plan(), plan({ interests: ["Playgrounds"] }), plan({ interests: ["Scenic"] }), plan({ interests: ["Community"] }), plan({ interests: [] })]) {
    ok("no stop asserts a feature the engine cannot see (bench, lawn, loop path, valley, swings…)", !p.stops.some((s) => INVENTED_FEATURE_WORDS.test(s.why)), JSON.stringify(p.stops.map((s) => s.why)));
  }
  const rainy = plan({ interests: ["Parks"], weather: weather({ temperatureF: 55, precipitation: 1, code: 61, summary: "rainy" }) });
  ok("in the rain nobody is told to sit down or stretch out", !rainy.stops.some((s) => /sit|stretch out/.test(s.why)), JSON.stringify(rainy.stops.map((s) => s.why)));
  const noWeather = plan({ weather: null });
  ok("with no weather the intro still reads and nothing claims a temperature", /whatever the sky does/.test(noWeather.intro) && !/°F/.test(noWeather.intro));
  const a = plan(), b = plan();
  ok("deterministic: the same inputs give the same plan", JSON.stringify(a) === JSON.stringify(b));
}

console.log("\n── sparse area ──");
{
  const two = buildPlan({ candidates: base().slice(0, 2), interests: ["Parks"], timeOfDay: "morning", durationMinutes: 120, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NOW - 4 * 3_600_000, timeZone: TZ });
  ok("two candidates still make a two-stop plan", two.stops.length === 2 && two.title.length > 0);
  const twoUnposted = buildPlan({ candidates: [place("u1", "Pellier Park", "Parks", 0.003, 0.001), place("u2", "Ryland Park", "Parks", 0.006, 0.0)], interests: ["Parks"], timeOfDay: "morning", durationMinutes: 60, weather: weather(), lat: HERE.lat, lng: HERE.lng, nowMs: NOW - 4 * 3_600_000, timeZone: TZ });
  ok("two unposted-hours candidates still plan, with a note to check hours", twoUnposted.stops.length === 2 && twoUnposted.notes.some((n) => /not posted/.test(n)));
  const one = buildPlan({ candidates: base().slice(0, 1), interests: [], timeOfDay: "morning", durationMinutes: 60, weather: null, lat: HERE.lat, lng: HERE.lng, nowMs: NOW, timeZone: TZ });
  ok("one candidate yields no stops (the callable refuses before this anyway)", one.stops.length === 0);
  const noCoords = buildPlan({ candidates: [{ id: "x", name: "Nowhere" }, ...base().slice(0, 2)], interests: [], timeOfDay: "morning", durationMinutes: 60, weather: null, lat: HERE.lat, lng: HERE.lng, nowMs: NOW, timeZone: TZ });
  ok("a candidate without coordinates is skipped, not planned", !noCoords.stops.some((s) => s.placeId === "x") && noCoords.skipped.some((s) => s.id === "x"));
}

console.log(`\n══ adventure-engine: ${pass} passed, ${fail} failed ══`);
process.exit(fail ? 1 : 0);
