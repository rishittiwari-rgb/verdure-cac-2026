// CAC 2026 (1.2) — regenerate the planner review: eleven scenarios through the deterministic engine.
//
//   cd functions && npm run build && node scripts/planner-review.mjs
//
// Candidates are REAL places: the City of San José parks nearest downtown, taken from the
// park catalog the app ingests (City of San José open data, CC BY — see
// functions/src/parks/sources.ts). The catalog publishes no opening hours, so the
// fixture marks every hours string as FIXTURE-SUPPLIED (the city's standard
// sunrise-to-sunset park hours, weekday hours for a community centre); in the app the
// hours come from OpenStreetMap's opening_hours tag. Weather is fixed per scenario so
// the review is reproducible; the live callable reads Open-Meteo.
// Output: docs/PLANNER-REVIEW-<date>.md (each plan with a review column to fill in)
// and docs/evidence/planner-review-<date>.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPlan, repeatedPhrases, openStateAt } from "../lib/adventure-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixture = JSON.parse(readFileSync(join(here, "..", "test-fixtures", "planner", "san-jose-parks.json"), "utf8"));
const TZ = "America/Los_Angeles";
const HERE = { lat: 37.3382, lng: -121.8863 };   // San José City Hall (the launch-area centre)

// Sat 2026-10-24 in San José: sunrise 07:27 PDT, sunset 18:21 PDT (Open-Meteo, 2026-10-24).
const SUNRISE = Date.UTC(2026, 9, 24, 14, 27), SUNSET = Date.UTC(2026, 9, 25, 1, 21);
const at = (h, m = 0) => Date.UTC(2026, 9, 24, h + 7, m);   // PDT = UTC−7
const wx = (temperatureF, code, summary, precipitation = 0) => ({ temperatureF, precipitation, code, summary, sunriseMs: SUNRISE, sunsetMs: SUNSET });
const all = fixture.places;
const byId = (...ids) => all.filter((p) => ids.includes(p.id));

const SCENARIOS = [
  { n: 1, name: "Saturday morning, 2 h, Parks + Trails, 64°F clear", interests: ["Parks", "Trails"], timeOfDay: "morning", durationMinutes: 120, nowMs: at(9, 30), weather: wx(64, 0, "clear"), candidates: all },
  { n: 2, name: "Afternoon hour with kids, Playgrounds, 76°F", interests: ["Playgrounds"], timeOfDay: "afternoon", durationMinutes: 60, nowMs: at(14), weather: wx(76, 1, "partly cloudy"), candidates: all },
  { n: 3, name: "Hot afternoon, 3 h, Parks, 97°F", interests: ["Parks"], timeOfDay: "afternoon", durationMinutes: 180, nowMs: at(13), weather: wx(97, 0, "clear"), candidates: all },
  { n: 4, name: "Rainy midday, 2 h, Community + Parks, 54°F rain", interests: ["Community", "Parks"], timeOfDay: "midday", durationMinutes: 120, nowMs: at(12), weather: wx(54, 61, "rainy", 1.4), candidates: all },
  { n: 5, name: "Evening starting 90 min before sunset, 2.5 h, Scenic + Waterfront", interests: ["Scenic", "Waterfront"], timeOfDay: "evening", durationMinutes: 150, nowMs: SUNSET - 90 * 60_000, weather: wx(68, 2, "partly cloudy"), candidates: all },
  { n: 6, name: "Night, 1 h, Community, after sunset", interests: ["Community"], timeOfDay: "night", durationMinutes: 60, nowMs: at(20, 30), weather: wx(58, 0, "clear"), candidates: all },
  { n: 7, name: "Sparse area: two candidates, 2 h", interests: ["Parks"], timeOfDay: "morning", durationMinutes: 120, nowMs: at(10), weather: wx(66, 0, "clear"), candidates: byId("city-parks_st-james-park", "city-parks_guadalupe-river-trail-gua13") },
  { n: 8, name: "Member-only organisations mixed in, Community, 2 h", interests: ["Community"], timeOfDay: "afternoon", durationMinutes: 120, nowMs: at(14), weather: wx(70, 0, "clear"),
    candidates: [...all, { id: "fx-lodge", name: "Fictional Lodge No. 7", category: "Community", latitude: HERE.lat + 0.001, longitude: HERE.lng + 0.001, hours: "24/7", fixture: true }, { id: "fx-church", name: "Fictional Chapel Hall", category: "Community", latitude: HERE.lat + 0.002, longitude: HERE.lng, hours: "24/7", fixture: true }] },
  { n: 9, name: "Weekday-only hours on a Saturday, Parks, 2 h", interests: ["Parks"], timeOfDay: "afternoon", durationMinutes: 120, nowMs: at(15), weather: wx(72, 0, "clear"),
    candidates: all.map((p) => p.category === "Community" ? { ...p, hours: "Mo-Fr 09:00-17:00" } : p) },
  { n: 10, name: "No picks (cold start), 4 h, 70°F", interests: [], timeOfDay: "midday", durationMinutes: 240, nowMs: at(11), weather: wx(70, 0, "clear"), candidates: all },
  { n: 11, name: "Sports pick, 90 min, 88°F", interests: ["Sports"], timeOfDay: "afternoon", durationMinutes: 90, nowMs: at(15), weather: wx(88, 0, "clear"), candidates: all },
];

const clock = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
const date = new Date().toISOString().slice(0, 10);
const lines = [`# Adventure Planner review — ${date}`, "",
  `Eleven scenarios through the deterministic engine (\`functions/src/adventure-engine.ts\`), regenerated by \`functions/scripts/planner-review.mjs\`. Candidates are the ${all.length} City of San José parks, trails and centres nearest City Hall from the ingested park catalog (City of San José open data, CC BY). The catalog has no opening hours: every hours string here is fixture-supplied (standard sunrise-to-sunset park hours; weekday hours for a community centre) and is labelled so. In the app, hours come from OpenStreetMap. Weather is fixed per scenario; the live callable reads Open-Meteo (credit shown in the app). Sun times: sunrise 7:27 am, sunset 6:21 pm (San José, 2026-10-24).`, "",
  "Checklist per plan — right order (nearest-neighbour from City Hall), places open (posted hours honoured, at most one unposted), sensible times (fits the minutes asked, ≥ 15 min per stop, heat caps), sunset handled (outdoor stops end before it, sunset spot or indoors last), weather handled, no repeated phrase, no invented fact.", ""];
const evidence = [];
for (const sc of SCENARIOS) {
  const plan = buildPlan({ candidates: sc.candidates, interests: sc.interests, timeOfDay: sc.timeOfDay, durationMinutes: sc.durationMinutes, weather: sc.weather, lat: HERE.lat, lng: HERE.lng, nowMs: sc.nowMs, timeZone: TZ });
  let t = sc.nowMs;
  const timeline = plan.stops.map((s) => { const arrive = t + s.meta.travelMinutes * 60_000; const leave = arrive + s.minutes * 60_000; t = leave; return { s, arrive, leave }; });
  const total = plan.stops.reduce((a, s) => a + s.minutes + s.meta.travelMinutes, 0);
  const repeats = repeatedPhrases(plan);
  const checks = {
    fitsBudget: total <= sc.durationMinutes + 5 * plan.stops.length,
    allOpenOrOneUnposted: plan.stops.filter((s) => !s.meta.hoursKnown).length <= 1 && plan.stops.every((s) => s.meta.openState !== "closed"),
    noRepeats: repeats.length === 0,
    onTopic: plan.stops.every((s) => s.meta.onTopic),
    outdoorBeforeSunset: timeline.every(({ s, leave }) => { const cat = sc.candidates.find((c) => c.id === s.placeId)?.category; return !["Parks", "Trails", "Playgrounds", "Gardens"].includes(cat) || leave <= SUNSET + 60_000 || sc.nowMs >= SUNSET; }),
  };
  evidence.push({ scenario: sc.n, name: sc.name, plan, totalMinutes: total, checks, repeats });
  lines.push(`## ${sc.n}. ${sc.name}`, "", `Start ${clock(sc.nowMs)} · asked for ${sc.durationMinutes} min · picks: ${sc.interests.join(", ") || "none"} · ${sc.weather.temperatureF}°F ${sc.weather.summary}${sc.weather.precipitation ? ` (${sc.weather.precipitation} mm)` : ""}`, "",
    `**${plan.title}** — ${plan.intro}`, "");
  if (plan.stops.length) {
    lines.push("| # | Stop | Arrive → leave | Travel | Hours (fixture) | Why |", "|---|---|---|---|---|---|");
    for (const { s, arrive, leave } of timeline) {
      const c = sc.candidates.find((x) => x.id === s.placeId);
      lines.push(`| ${s.order} | ${s.name} (${c?.category}) | ${clock(arrive).replace(/^\w+ /, "")} → ${clock(leave).replace(/^\w+ /, "")} | ${s.meta.distanceMiles} mi, ${s.meta.travelMinutes} min | ${c?.hours ?? "unposted"} → ${s.meta.openState} | ${s.why} |`);
    }
  } else lines.push("_No plan: fewer than two eligible places._");
  if (plan.notes.length) lines.push("", ...plan.notes.map((n) => `- Note: ${n}`));
  if (plan.skipped.length) lines.push("", `Skipped: ${plan.skipped.slice(0, 8).map((k) => `${k.name} (${k.reason})`).join("; ")}${plan.skipped.length > 8 ? ` … and ${plan.skipped.length - 8} more` : ""}`);
  lines.push("", `Checks — fits budget: ${checks.fitsBudget ? "✓" : "✗"} (${total} of ${sc.durationMinutes} min incl. travel) · open or one unposted: ${checks.allOpenOrOneUnposted ? "✓" : "✗"} · on topic: ${checks.onTopic ? "✓" : "✗"} · no repeated phrase: ${checks.noRepeats ? "✓" : "✗ " + repeats.join(" | ")} · outdoor stops before sunset: ${checks.outdoorBeforeSunset ? "✓" : "✗"}`, "", "**Review:** _(filled in by hand below)_", "");
}
mkdirSync(join(root, "docs", "evidence"), { recursive: true });
writeFileSync(join(root, "docs", `PLANNER-REVIEW-${date}.md`), lines.join("\n"));
writeFileSync(join(root, "docs", "evidence", `planner-review-${date}.json`), JSON.stringify({ ranAt: new Date().toISOString(), candidates: all.length, scenarios: evidence }, null, 2) + "\n");
const failing = evidence.filter((e) => Object.values(e.checks).some((v) => !v));
console.log(lines.join("\n"));
console.log(`\n${evidence.length} scenarios; ${failing.length} with a failing check${failing.length ? ": " + failing.map((f) => f.scenario).join(", ") : ""}`);
process.exit(failing.length ? 1 : 0);
