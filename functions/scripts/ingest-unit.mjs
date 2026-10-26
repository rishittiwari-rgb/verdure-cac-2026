// Ingest layer unit checks — no emulator, no network.
//
//   npm run build && node scripts/ingest-unit.mjs
//
// The fixtures under test-fixtures/ are TRIMMED COPIES OF REAL RESPONSES
// captured on 2026-09-06 (San Jose Public Library LibCal, Ticketmaster
// Discovery for San Jose, NPS events for Cuyahoga Valley, Tri-C Localist), so
// the mappers are exercised against the shapes the vendors actually return, not
// against what their docs say.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseIcs, unfold, unescapeText, expandRRule, parseIcsDate } from "../lib/ingest/ics.js";
import { titleKey, venueKey, classify, zonedToUtc, cleanText, cleanUrl, eventDocId } from "../lib/ingest/normalize.js";
import { mapTicketmaster } from "../lib/ingest/sources/ticketmaster.js";
import { mapIcsEvent } from "../lib/ingest/sources/icsfeed.js";
import { parseBiblioPayload, mapBiblioItem, trustedCoordinateIds, fetchBiblioCommons } from "../lib/ingest/sources/bibliocommons.js";
import { parseMidpenListing, mapMidpenItem, parseMidpenDate, MIDPEN_PRESERVES, fetchMidpen, MIDPEN_PAGE_CAP } from "../lib/ingest/sources/midpen.js";
import { parseLibCalRss, mapLibCalItem } from "../lib/ingest/sources/libcal.js";
import { mapLocalist } from "../lib/ingest/sources/localist.js";
import { fetchLiveWhale, mapLiveWhale } from "../lib/ingest/sources/livewhale.js";
import { mapLegistar } from "../lib/ingest/sources/legistar.js";
import { enrichEvent } from "../lib/ingest/classify.js";
import { mapNps } from "../lib/ingest/sources/nps.js";
import { mapSerp, parseSerpDate, serpApiBudgetAllows, SERPAPI_MONTHLY_CAP } from "../lib/ingest/sources/serpapi.js";
import { isSameEvent, isWithinHorizon, auditSuspectedDuplicates, listingChecks, isFuzzyDuplicate, fuzzyTokens, jaccard,
  auditFuzzyDuplicates, contentHash, unchangedSighting, isOnlineListing, UNCHANGED_REWRITE_MS } from "../lib/ingest/store.js";
import { annotateEvent, inferAdultOnly, adultOnlyReason, inferTopicTags, interestsForTopics, mentionsAlcohol, alcoholBrandPresents, TOPIC_TAGS } from "../lib/ingest/annotate.js";
import { SAN_JOSE, isInsideArea } from "../lib/ingest/areas.js";
import { coercePayloadRecord, fetchOneSource } from "../lib/ingest/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "..", "test-fixtures", name), "utf8");

let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name} ${extra}`); }
};

console.log("── normalize ──");
ok("titleKey ignores case, punctuation and stopwords",
   titleKey("The San Jose Orchestra: Beethoven at Blossom!") === titleKey("san jose orchestra — beethoven AT blossom"),
   `${titleKey("The San Jose Orchestra: Beethoven at Blossom!")} vs ${titleKey("san jose orchestra — beethoven AT blossom")}`);
ok("titleKey keeps distinct titles distinct", titleKey("Storytime: Dinosaurs") !== titleKey("Storytime: Trucks"));
ok("titleKey removes a presenter prefix", titleKey("City of San Jose presents: Creek Walk") === titleKey("Creek Walk"));
ok("venueKey uses the first comma segment, alphanumerics only",
   venueKey("Main Library - Downtown, 325 Superior Ave") === "mainlibrarydowntown");
ok("venueKey ignores a room suffix and generic locations",
   venueKey("Main Library · Meeting Room") === "mainlibrary" && venueKey("Location TBA") === "");
ok("classify: volunteer beats social", classify("Park cleanup volunteer day") === "Cleanup");
ok("classify: library storytime is a Workshop", classify("Toddler Storytime") === "Workshop");
ok("classify: farmers market", classify("Cuyahoga Valley Farmers Market") === "Market");
ok("classify: concert is a Festival", classify("Beethoven concert at Blossom") === "Festival");
ok("classify: unknown → Social", classify("Thing") === "Social");
ok("cleanText strips markup, entities and control chars",
   cleanText("<b>Hello</b>&nbsp;&amp; world  \n now", 50) === "Hello & world now", JSON.stringify(cleanText("<b>Hello</b>&nbsp;&amp; world  \n now", 50)));
ok("cleanUrl rejects javascript:", cleanUrl("javascript:alert(1)") === undefined);
ok("cleanUrl accepts https", cleanUrl("https://cpl.libcal.com/event/1") === "https://cpl.libcal.com/event/1");
ok("eventDocId is Firestore-safe", /^[A-Za-z0-9_-]+$/.test(eventDocId("libcal", "LibCal-8758-17093140@2026-09-10T14:00:00.000Z")));
// 2026-07-04 10:00 New York = 14:00Z (EDT); 2026-01-04 10:00 = 15:00Z (EST).
ok("zonedToUtc handles EDT", zonedToUtc({ y: 2026, m: 7, d: 4, hh: 10, mm: 0, ss: 0 }, "America/New_York").toISOString() === "2026-07-04T14:00:00.000Z");
ok("zonedToUtc handles EST", zonedToUtc({ y: 2026, m: 1, d: 4, hh: 10, mm: 0, ss: 0 }, "America/New_York").toISOString() === "2026-01-04T15:00:00.000Z");

console.log("\n── ics parser ──");
const raw = fixture("cpl-libcal-sample.ics");
ok("unfold joins continuation lines", unfold("DESCRIPTION:Hello\r\n  world\r\nX:1").length === 2 && unfold("DESCRIPTION:Hello\r\n  world")[0] === "DESCRIPTION:Hello world");
ok("unescapeText handles \\, \\; \\n", unescapeText("a\\, b\\; c\\nd") === "a, b; c\nd");
const dOnly = parseIcsDate("20260806", { VALUE: "DATE" }, "America/New_York");
ok("VALUE=DATE parses as all-day local midnight", dOnly?.allDay === true && dOnly.date.toISOString() === "2026-08-06T04:00:00.000Z", dOnly?.date.toISOString());
const dt = parseIcsDate("20260906T100000", { TZID: "America/New_York" }, "UTC");
ok("TZID local time converts to UTC", dt?.date.toISOString() === "2026-09-06T14:00:00.000Z", dt?.date.toISOString());
const dz = parseIcsDate("20260906T140000Z", {}, "America/New_York");
ok("Z suffix is UTC", dz?.date.toISOString() === "2026-09-06T14:00:00.000Z");
const horizon = new Date("2030-01-01T00:00:00Z");
const events = parseIcs(raw, { defaultTimeZone: "America/New_York", horizonEnd: horizon });
ok("parses every VEVENT in the real CPL sample", events.length === 12, `got ${events.length}`);
const first = events[0];
ok("SUMMARY / UID / URL / CATEGORIES / ORGANIZER come through",
   first.summary === "AsiaTown Passport" && first.uid === "LibCal-8758-17093140"
   && first.url === "https://cpl.libcal.com/event/17093140" && first.categories.includes("School of Arts & Culture")
   && first.organizer === "Tai-Renee King", JSON.stringify({ s: first.summary, u: first.uid, url: first.url, c: first.categories, o: first.organizer }));
ok("folded DESCRIPTION is unfolded and unescaped",
   first.description.includes("Passport Challenge!") && first.description.includes("locations, including the ArtBox"), first.description.slice(0, 120));
ok("LOCATION with escaped comma", first.location === "ArtBoxEvent, Offsite", first.location);
ok("X-WR-TIMEZONE applied to local DATE-TIMEs",
   events.some((e) => !e.allDay && e.start.getUTCHours() !== 0) || events.every((e) => e.allDay));
const weekly = expandRRule("FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4", new Date("2026-09-01T14:00:00Z"), horizon);
ok("RRULE weekly BYDAY COUNT expands to 4 Tue/Thu", weekly.length === 4 && weekly.every((d) => [2, 4].includes(d.getUTCDay())),
   weekly.map((d) => d.toISOString()).join(","));
const daily = expandRRule("FREQ=DAILY;INTERVAL=2;UNTIL=20260910T000000Z", new Date("2026-09-01T14:00:00Z"), horizon);
ok("RRULE daily INTERVAL/UNTIL", daily.length === 5, `got ${daily.length}`);
const rec = parseIcs(
  "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r1\r\nSUMMARY:Storytime\r\nDTSTART;TZID=America/New_York:20260901T100000\r\nDTEND;TZID=America/New_York:20260901T103000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=America/New_York:20260908T100000\r\nEND:VEVENT\r\nEND:VCALENDAR",
  { defaultTimeZone: "America/New_York", horizonEnd: horizon });
ok("recurring VEVENT expands with EXDATE removed and duration kept",
   rec.length === 2 && rec.every((e) => e.end.getTime() - e.start.getTime() === 30 * 60_000) && rec.every((e) => e.recurrenceId),
   JSON.stringify(rec.map((e) => e.start.toISOString())));
ok("occurrences get distinct source ids", new Set(rec.map((e) => `${e.uid}@${e.recurrenceId}`)).size === 2);

console.log("\n── mappers (real fixtures) ──");
const tm = JSON.parse(fixture("ticketmaster-sample.json"));
const tmMapped = tm._embedded.events.map((e) => mapTicketmaster(e, SAN_JOSE)).filter(Boolean);
ok("ticketmaster: every fixture event maps", tmMapped.length === tm._embedded.events.length);
const trivia = tmMapped.find((e) => e.title.includes("Trivia"));
ok("ticketmaster: venue coords + city + free price range",
   trivia && Math.abs(trivia.latitude - 41.477055) < 1e-6 && trivia.locationName.includes("Lakewood") && trivia.isFree === true && trivia.priceMin === 0,
   JSON.stringify({ lat: trivia?.latitude, loc: trivia?.locationName, free: trivia?.isFree, min: trivia?.priceMin }));
ok("ticketmaster: local date/time land in the venue's zone",
   trivia && trivia.start.toISOString() === "2026-09-06T15:30:00.000Z", trivia?.start.toISOString());
ok("ticketmaster: category from segment", tmMapped.every((e) => typeof e.category === "string"));
ok("ticketmaster: source ids stable", tmMapped.every((e) => e.source === "ticketmaster" && e.sourceEventId.length > 5));

const cplIcs = { name: "San Jose Public Library", url: "https://example.invalid/feed.ics",
  venues: { "Main Library - Downtown": { lat: 37.3352, lng: -121.8850 } }, tags: ["library"] };
const libMapped = events.map((e) => mapIcsEvent(e, SAN_JOSE, cplIcs, "ics")).filter(Boolean);
ok("ics feed: every parsed VEVENT maps", libMapped.length === 12);
ok("ics feed: organizer is the feed name, tags attached",
   libMapped.every((e) => e.organizer === "San Jose Public Library" && e.tags.includes("library")));
const mainLib = libMapped.find((e) => e.locationName.startsWith("Main Library"));
ok("ics feed: branch leads the location and known venue coordinates attach",
   mainLib && mainLib.latitude === 37.3352, JSON.stringify(mainLib && { loc: mainLib.locationName, lat: mainLib.latitude }));
ok("ics feed: all-day events read 'All day'", libMapped.filter((e) => e.time === "All day").length >= 1);

// LibCal RSS parser.
//
// These assert the PARSER, not the launch area, so they carry their own feed and
// their own area rather than reaching into LAUNCH_AREAS. The fixture is a real
// Cleveland Public Library RSS capture and the 10:30 EDT → 14:30Z assertion
// below only holds in America/New_York — binding it to whatever city happens to
// be launching would make an unrelated config change fail a parser test, which
// is exactly what happened when the launch area moved to San Jose (which runs
// BiblioCommons and has no LibCal calendars at all).
const CPL_AREA = { id: "fixture-cle", name: "Cleveland, OH", center: { lat: 41.4993, lng: -81.6944 },
  radiusMiles: 25, timeZone: "America/New_York", ticketmaster: { enabled: false },
  libcal: [], bibliocommons: [], midpen: [], localist: [], nps: { parkCodes: [] }, ics: [],
  serpapi: { enabled: false, query: "" } };
const CPL_LIBCAL_FEED = { name: "Cleveland Public Library", calendarId: "8758",
  rssUrl: "https://cpl.libcal.com/rss.php?m=month&cid=8758",
  venues: { "Glenville": { lat: 41.541, lng: -81.6025 } }, tags: ["library"] };
const rss = fixture("cpl-libcal-rss-sample.xml");
const rssItems = parseLibCalRss(rss);
ok("libcal rss: parses every <item> with structured fields", rssItems.length === 6 && rssItems.every((i) => i.eventId && i.date && i.title), `n=${rssItems.length}`);
const exhibit = rssItems.find((i) => i.title.includes("International Language"));
ok("libcal rss: all-day marker (00:00:00–23:59:59) and branch/room split",
   exhibit && exhibit.start === "00:00:00" && exhibit.end === "23:59:59" && exhibit.branch === "Main Library - Downtown" && exhibit.room.includes("4th Floor"),
   JSON.stringify(exhibit));
ok("libcal rss: hex entities in HTML descriptions decode", exhibit && exhibit.descriptionHtml.startsWith("<p>Local Artist"), exhibit?.descriptionHtml.slice(0, 40));
ok("libcal rss: '&#x26;' in titles decodes to '&'", rssItems.some((i) => i.title === "Coffee & Conversation"));
const rssMapped = rssItems.map((i) => mapLibCalItem(i, CPL_AREA, CPL_LIBCAL_FEED)).filter(Boolean);
ok("libcal rss: every item maps to a normalized event", rssMapped.length === rssItems.length);
const coffee = rssMapped.find((e) => e.title === "Coffee & Conversation");
ok("libcal rss: 10:30am New York → 14:30Z (EDT) with an end time and branch coordinates",
   coffee && coffee.start.toISOString() === "2026-09-07T14:30:00.000Z" && coffee.end && coffee.time === "10:30 AM" && coffee.latitude === 41.541,
   JSON.stringify(coffee && { s: coffee.start.toISOString(), t: coffee.time, lat: coffee.latitude, loc: coffee.locationName }));
ok("libcal rss: source ids are prefixed by calendar id and stable", rssMapped.every((e) => e.sourceEventId.startsWith("8758-")));
ok("libcal rss: audiences become tags alongside 'library'", coffee && coffee.tags.includes("library") && coffee.tags.length >= 2);

const lo = JSON.parse(fixture("localist-tri-c-sample.json"));
const loMapped = lo.events.flatMap((w) => mapLocalist(w.event, SAN_JOSE, "events.tri-c.edu", "Tri-C") ?? []);
ok("localist: one record per instance with coordinates", loMapped.length >= 3 && loMapped.every((e) => typeof e.latitude === "number"), `n=${loMapped.length}`);
ok("localist: ISO start with offset parses to UTC", loMapped[0].start.toISOString() === "2026-09-07T14:00:00.000Z", loMapped[0].start.toISOString());
ok("localist: explicit free survives while absent cost stays unknown",
   loMapped.some((e) => e.isFree === true) && loMapped.some((e) => e.isFree === undefined));

console.log("\n── livewhale ──");
const lwBase = { id: 506162, title: "Parallel Visions", date_iso: "2026-09-27T10:00:00-07:00",
  location: "SCU Gallery", location_latitude: 37.35, location_longitude: -121.94,
  event_types: ["Exhibits"], tags: ["Arts at SCU"], url: "https://events.scu.edu/event/506162",
  group_title: "Arts &amp; Sciences" };
const lw = mapLiveWhale({ ...lwBase, cost: 135 }, SAN_JOSE, "events.scu.edu", "SCU");
ok("livewhale: numeric cost and coordinates survive normalization",
   lw?.priceMin === 135 && lw.isFree === false && lw.latitude === 37.35 && lw.organizer === "Arts & Sciences");
const lwMixed = mapLiveWhale({ ...lwBase, cost: "$20 adults, $10 children, free under 6" }, SAN_JOSE, "events.scu.edu", "SCU");
ok("livewhale: mixed prices use minimum paid price", lwMixed?.priceMin === 10 && lwMixed.isFree === false);
ok("livewhale: missing cost stays unknown, not advertised free",
   mapLiveWhale({ ...lwBase, cost: null }, SAN_JOSE, "events.scu.edu", "SCU")?.isFree === undefined);
ok("livewhale: private and canceled entries excluded",
   mapLiveWhale({ ...lwBase, tags: ["private"] }, SAN_JOSE, "events.scu.edu", "SCU") === null &&
   mapLiveWhale({ ...lwBase, is_canceled: 1 }, SAN_JOSE, "events.scu.edu", "SCU") === null);
const lwCalls = [];
const lwFetch = async (url) => {
  lwCalls.push(url);
  const page = Number(new URL(url).searchParams.get("page"));
  return new Response(JSON.stringify({ meta: { type: "events", page, total_pages: 2 },
    data: [{ ...lwBase, id: page, title: `Gallery ${page}` }] }), { status: 200 });
};
const lwPages = await fetchLiveWhale(SAN_JOSE, "events.scu.edu", "SCU", lwFetch, new Date("2026-09-26T12:00:00Z"));
ok("livewhale: pages through v2 feed without truncating at five",
   lwPages.length === 2 && lwCalls.length === 2 && lwCalls.every((u) => u.includes("/paginate/100/")));
const lwAllDay = await fetchLiveWhale(SAN_JOSE, "events.scu.edu", "SCU", async () =>
  new Response(JSON.stringify({ meta: { type: "events", page: 1, total_pages: 1 },
    data: [{ ...lwBase, is_all_day: 1 }] }), { status: 200 }), new Date("2026-09-27T18:00:00Z"));
ok("livewhale: today's all-day event remains visible after local midnight", lwAllDay.length === 1);
let lwShapeError = false;
try { await fetchLiveWhale(SAN_JOSE, "events.scu.edu", "SCU", async () => new Response("{\"events\":[]}"), new Date("2026-09-26T12:00:00Z")); }
catch { lwShapeError = true; }
ok("livewhale: changed response shape fails loudly", lwShapeError);

const nps = JSON.parse(fixture("nps-sample.json"));
const npsMapped = nps.data.flatMap((e) => mapNps(e, SAN_JOSE));
ok("nps: recurring dates expand (only in-horizon occurrences kept)", npsMapped.length >= 0 && npsMapped.every((e) => e.source === "nps"));
const farmersRaw = nps.data.find((e) => /Farmers Market/.test(e.title));
const farmersAll = mapNps({ ...farmersRaw, dates: ["2099-01-03"], times: [{ timestart: "09:00 AM" }] }, SAN_JOSE);
ok("nps: horizon filter drops far-future dates", farmersAll.length === 0);
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const farmersSoon = mapNps({ ...farmersRaw, dates: [soon], times: [{ timestart: "09:00 AM", timeend: "12:00 PM" }] }, SAN_JOSE);
ok("nps: 09:00 AM local becomes the right UTC hour and category Market",
   farmersSoon.length === 1 && farmersSoon[0].category === "Market" && farmersSoon[0].time === "9:00 AM" && farmersSoon[0].isFree === true,
   JSON.stringify(farmersSoon[0] && { c: farmersSoon[0].category, t: farmersSoon[0].time }));

const serpDate = parseSerpDate({ start_date: "Sep 12", when: "Sat, Sep 12, 7 – 9 PM" }, "America/New_York", new Date("2026-09-06T00:00:00Z"));
ok("serpapi: 'Sep 12, 7 PM' → 23:00Z in September", serpDate?.toISOString() === "2026-09-12T23:00:00.000Z", serpDate?.toISOString());
const rollover = parseSerpDate({ start_date: "Jan 5" }, "America/New_York", new Date("2026-12-20T00:00:00Z"));
ok("serpapi: month already passed rolls to next year", rollover?.getUTCFullYear() === 2027, rollover?.toISOString());
const serpMapped = mapSerp({ title: "San Jose Night Market", date: { start_date: "Sep 20", when: "Sat, Sep 20, 6 PM" },
  venue: { name: "AsiaTown" }, link: "https://example.com/e", ticket_info: [{ link_type: "Tickets", link: "https://t.example.com" }] }, SAN_JOSE);
ok("serpapi: ticket links mark the event paid; venue + link kept",
   serpMapped && serpMapped.isFree === false && serpMapped.locationName === "AsiaTown" && serpMapped.website === "https://example.com/e" && serpMapped.category === "Market");
ok("serpapi: the same event with and without a clock time hashes to one id", mapSerp({ title: "San Jose Night Market", date: { start_date: "Sep 20" }, venue: { name: "AsiaTown" } }, SAN_JOSE).sourceEventId === serpMapped.sourceEventId);
ok(`serpapi: budget allows below the ${SERPAPI_MONTHLY_CAP}-call cap and refuses at it`, serpApiBudgetAllows(0) && serpApiBudgetAllows(SERPAPI_MONTHLY_CAP - 1) && !serpApiBudgetAllows(SERPAPI_MONTHLY_CAP));


// ── BiblioCommons (San José PL + Santa Clara County LD) ──────────────────────
//
// Fixture is a trimmed live capture (2026-09-13) of the public gateway,
// deliberately including a VIRTUAL event with no branch — the case where an
// event must end up with NO coordinates rather than the library's.
console.log("\n── bibliocommons ──");
const bcPayload = JSON.parse(fixture("sjpl-bibliocommons-sample.json"));
const bcItems = parseBiblioPayload(bcPayload, "sjpl.bibliocommons.com");
ok("bibliocommons: flattens the entity graph into one item per occurrence",
   bcItems.length === 4 && bcItems.every((i) => i.eventId && i.title && i.startISO), `n=${bcItems.length}`);

const SJPL_FEED = { name: "San José Public Library", library: "sjpl",
  host: "sjpl.bibliocommons.com", tags: ["library"] };
const bcMapped = bcItems.map((i) => mapBiblioItem(i, SAN_JOSE, SJPL_FEED)).filter(Boolean);
ok("bibliocommons: every item maps to a normalized event", bcMapped.length === bcItems.length);
ok("bibliocommons: cancellations and library closures are not attendable events",
   mapBiblioItem({ ...bcItems[0], title: "CANCELED: Storytime" }, SAN_JOSE, SJPL_FEED) === null &&
   mapBiblioItem({ ...bcItems[0], title: "CLOSED: Holiday", types: ["Library Closures"] }, SAN_JOSE, SJPL_FEED) === null);
const WIDE_FEED = { ...SJPL_FEED, requireInAreaCoordinates: true };
ok("bibliocommons: a wide-area feed requires a real in-area venue coordinate",
   mapBiblioItem({ ...bcItems[0], lat: 37.35, lng: -121.94 }, SAN_JOSE, WIDE_FEED) !== null &&
   mapBiblioItem({ ...bcItems[0], lat: undefined, lng: undefined }, SAN_JOSE, WIDE_FEED) === null &&
   mapBiblioItem({ ...bcItems[0], lat: 37.77, lng: -122.42 }, SAN_JOSE, WIDE_FEED) === null);
const bcCalls = [];
const bcTwoPages = await fetchBiblioCommons(SAN_JOSE, SJPL_FEED, async (url) => {
  bcCalls.push(url);
  return new Response(JSON.stringify({ ...bcPayload, events: { ...bcPayload.events, pagination: { pages: 2 } } }), { status: 200 });
});
ok("bibliocommons: reads every reported page at the supported size",
   bcCalls.length === 2 && bcCalls.every((u) => u.includes("limit=150")) && bcTwoPages.length === bcItems.length * 2);
let bcRetryCalls = 0;
const bcAfterTransientError = await fetchBiblioCommons(SAN_JOSE, SJPL_FEED, async () => {
  bcRetryCalls++;
  return bcRetryCalls === 1 ? new Response("error", { status: 500 })
    : new Response(JSON.stringify({ ...bcPayload, events: { ...bcPayload.events, pagination: { pages: 1 } } }), { status: 200 });
});
ok("bibliocommons: retries a transient server error without returning a partial source",
   bcRetryCalls === 2 && bcAfterTransientError.length === bcItems.length);
let bcPartialError = false;
try {
  await fetchBiblioCommons(SAN_JOSE, SJPL_FEED, async (url) =>
    new Response(JSON.stringify({ ...bcPayload, events: { ...bcPayload.events, pagination: { pages: 2 } } }),
      { status: new URL(url).searchParams.get("page") === "2" ? 503 : 200 }));
} catch { bcPartialError = true; }
ok("bibliocommons: a failed later page fails the entire source", bcPartialError);

const king = bcMapped.find((e) => e.locationName.startsWith("King Library"));
ok("bibliocommons: branch coordinates come from the feed, no venue table needed",
   king && Math.abs(king.latitude - 37.3356906) < 1e-6 && Math.abs(king.longitude + 121.8852558) < 1e-6,
   JSON.stringify(king && { loc: king.locationName, lat: king.latitude, lng: king.longitude }));

const virtual = bcMapped.find((e) => e.title.includes("Digital Skills"));
ok("bibliocommons: an event with no branch gets NO coordinates (check-in gate stays off, not wrong)",
   virtual && virtual.latitude === undefined && virtual.longitude === undefined,
   JSON.stringify(virtual && { t: virtual.title, lat: virtual.latitude }));

ok("bibliocommons: source ids are prefixed by library so systems never collide",
   bcMapped.every((e) => e.source === "bibliocommons" && e.sourceEventId.startsWith("sjpl-")));
ok("bibliocommons: library programming is free and tagged",
   bcMapped.every((e) => e.isFree === true && e.tags.includes("library")));
ok("bibliocommons: indexStart is already UTC — no timezone maths applied",
   bcMapped.every((e) => !Number.isNaN(e.start.getTime())) &&
   bcMapped[0].start.toISOString() === new Date(bcItems[0].startISO).toISOString());
ok("bibliocommons: HTML descriptions are stripped to text",
   bcMapped.every((e) => !/<[a-z]/i.test(e.description)));

// Coordinate trust. The first version of this adapter accepted a coordinate
// only when `mapLocation.isGeocoded === true`. A live run showed SJPL sets that
// flag and Santa Clara County Library District does not — on ANY branch — while
// publishing plainly correct per-branch coordinates. That rule discarded good
// data for 2,106 events and silently disabled check-in proximity for a whole
// library system. The replacement keeps the protection it was actually there
// for (a city centroid repeated across every branch) without the collateral.
const geo = (lat, lng, flag) => ({ mapLocation: { centrePoint: { lat, lng }, isGeocoded: flag } });
ok("bibliocommons: a flagged coordinate is trusted",
   trustedCoordinateIds({ a: geo(37.1, -121.1, true) }).has("a"));
ok("bibliocommons: an UNflagged but distinct coordinate is trusted (the SCCLD case)",
   (() => {
     const t = trustedCoordinateIds({
       a: geo(37.3178, -122.0290, false), b: geo(37.4324, -121.9065, false), c: geo(37.1241, -121.6628, false),
     });
     return t.size === 3;
   })());
ok("bibliocommons: a point REPEATED across every branch is discarded for all of them",
   (() => {
     const t = trustedCoordinateIds({
       a: geo(37.3382, -121.8863, false), b: geo(37.3382, -121.8863, false), c: geo(37.3382, -121.8863, false),
     });
     return t.size === 0;
   })(), "that is the city-centroid signature");
ok("bibliocommons: a flagged coordinate survives even if it collides with a centroid",
   (() => {
     const t = trustedCoordinateIds({
       a: geo(37.3382, -121.8863, true), b: geo(37.3382, -121.8863, false),
     });
     return t.has("a") && !t.has("b");
   })());
ok("bibliocommons: a location with no coordinate at all is simply absent",
   trustedCoordinateIds({ a: { mapLocation: {} }, b: {} }).size === 0);

// A feed that hands back an unrecognised shape must yield nothing, not throw:
// a library changing its API should degrade to zero events for that system,
// leaving every other source in the run intact.
ok("bibliocommons: junk payload yields no items instead of throwing",
   parseBiblioPayload({ nope: true }, "x").length === 0 && parseBiblioPayload(null, "x").length === 0);


// ── Midpen (the outdoor source that replaced NPS) ────────────────────────────
//
// This adapter parses HTML, so its tests carry more weight than a feed
// parser's: there is no contract upstream, only a page that can change. The
// fixture is a trimmed live capture (2026-09-13).
console.log("\n── midpen ──");
const mpHtml = fixture("midpen-events-listing.html");
const mpItems = parseMidpenListing(mpHtml);
ok("midpen: parses the Views table into one item per event",
   mpItems.length === 6 && mpItems.every((i) => i.title && i.dateText && i.preserve && i.link),
   `n=${mpItems.length} ${JSON.stringify(mpItems[0] ?? {})}`);
ok("midpen: the 'Image' alt-text prefix is stripped off the activity",
   mpItems.every((i) => !/^Image/i.test(i.activity)), JSON.stringify(mpItems.map((i) => i.activity)));

const MIDPEN_FEED = { name: "Midpeninsula Regional Open Space District", tags: ["outdoors", "parks"] };
const mpMapped = mpItems.map((i) => mapMidpenItem(i, SAN_JOSE, MIDPEN_FEED)).filter(Boolean);
ok("midpen: every parsed row maps to a normalized event", mpMapped.length === mpItems.length,
   `${mpMapped.length}/${mpItems.length}`);
ok("midpen: preserve coordinates attach from the verified table",
   mpMapped.some((e) => typeof e.latitude === "number"),
   JSON.stringify(mpMapped.map((e) => [e.locationName, e.latitude])));
ok("midpen: all programming is free and tagged outdoors",
   mpMapped.every((e) => e.isFree === true && e.tags.includes("outdoors")));
ok("midpen: volunteer projects classify as Volunteer regardless of title wording",
   mapMidpenItem({ ...mpItems[0], kind: "Volunteer Project", title: "Trail Maintenance" },
                 SAN_JOSE, MIDPEN_FEED).category === "Volunteer");

// Dates. A misparse here silently shifts an event by hours or a year.
ok("midpen: 12-hour times convert correctly, including the noon/midnight edges", (() => {
    const pm = parseMidpenDate("Saturday, Sep 12, 2026 6:00 pm");
    const am = parseMidpenDate("Sunday, Sep 13, 2026 9:30 am");
    const noon = parseMidpenDate("Monday, Sep 14, 2026 12:00 pm");
    const mid = parseMidpenDate("Monday, Sep 14, 2026 12:30 am");
    return pm.hh === 18 && am.hh === 9 && am.mm === 30 && noon.hh === 12 && mid.hh === 0 && mid.mm === 30;
  })(), "12pm must be 12 and 12am must be 0");
ok("midpen: an unparseable date drops the row instead of defaulting to now",
   parseMidpenDate("sometime next spring") === null &&
   mapMidpenItem({ ...mpItems[0], dateText: "sometime next spring" }, SAN_JOSE, MIDPEN_FEED) === null);

// Coordinates: every preserve we claim to know must be inside the area, or the
// check-in gate would sit around a hillside 40 miles away.
ok("midpen: every preserve in the table geocodes inside the launch area",
   Object.values(MIDPEN_PRESERVES).every((v) => isInsideArea(SAN_JOSE, v.lat, v.lng)),
   JSON.stringify(Object.entries(MIDPEN_PRESERVES).filter(([, v]) => !isInsideArea(SAN_JOSE, v.lat, v.lng))));
ok("midpen: an unknown preserve yields NO coordinates rather than a guess",
   mapMidpenItem({ ...mpItems[0], preserve: "Somewhere Unlisted Preserve" }, SAN_JOSE, MIDPEN_FEED).latitude === undefined);

// The loud-failure contract. Returning [] on a redesign would read as "no
// events this week" and drain the outdoor category silently over three cycles.
ok("midpen: unrecognisable markup yields zero rows (so fetchMidpen can throw)",
   parseMidpenListing("<html><body><p>we redesigned</p></body></html>").length === 0);
ok("midpen: a table with no event links is not mistaken for events",
   parseMidpenListing("<table><tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr></table>").length === 0);

// Every published page is read: a fixed 4-page walk dropped about half of the
// district's 116 listings (8 pages on 2026-10-23).
{
  const requested = [];
  const pages = 6;
  const stub = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    requested.push(page);
    return new Response(page < pages ? mpHtml : "<html><body><table></table></body></html>", { status: 200 });
  };
  const all = await fetchMidpen(SAN_JOSE, MIDPEN_FEED, stub);
  ok("midpen: walks every page until an empty one (not a fixed four)",
     all.length === pages * mpItems.length && requested.join(",") === "0,1,2,3,4,5,6", `${all.length} rows, pages ${requested.join(",")}`);
  const endless = [];
  await fetchMidpen(SAN_JOSE, MIDPEN_FEED, async (url) => { endless.push(url); return new Response(mpHtml, { status: 200 }); });
  ok("midpen: a site that ignores ?page= stops at the safety cap", endless.length === MIDPEN_PAGE_CAP);
  // A 304 on page 0 said nothing about pages 1–7, yet it skipped the whole listing.
  const { sourceFetchFor } = await import("../lib/ingest/index.js");
  const seen = [];
  const answer = async (url, init) => { const h = new Headers(init?.headers ?? {}); seen.push(h.get("if-none-match"));
    return h.get("if-none-match") ? new Response(null, { status: 304 }) : new Response(Number(new URL(url).searchParams.get("page")) < 2 ? mpHtml : "<table></table>", { status: 200 }); };
  const read = await fetchMidpen(SAN_JOSE, MIDPEN_FEED, sourceFetchFor({ type: "midpen", etag: 'W/"1792783021"', lastModified: "Fri, 23 Oct 2026 19:17:01 GMT" }, answer).fetchImpl);
  ok("midpen: never conditional, so a stored ETag can't skip pages 1+", read.length === 2 * mpItems.length && seen.every((x) => x === null), JSON.stringify(seen));
  const icsSeen = [];
  sourceFetchFor({ type: "ics", etag: 'W/"1"' }, async (u, init) => { icsSeen.push(new Headers(init?.headers ?? {}).get("if-none-match")); return new Response("", { status: 200 }); }).fetchImpl("https://example.org/feed.ics");
  ok("single-document feeds stay conditional", icsSeen[0] === 'W/"1"');
}

console.log("\n── dedupe + scoping ──");
const ts = (d) => ({ toMillis: () => new Date(d).getTime() });
const existing = { date: ts("2026-09-20T23:00:00Z"), venueKey: "asiatown", latitude: 41.51, longitude: -81.66, titleKey: "san jose night market" };
const same = { title: "San Jose Night Market", start: new Date("2026-09-20T23:30:00Z"), locationName: "AsiaTown, San Jose", latitude: 41.5101, longitude: -81.6601 };
ok("isSameEvent: same title, 30 min apart, same venue key → match", isSameEvent(existing, same));
ok("isSameEvent: 3 hours apart → no match", !isSameEvent(existing, { ...same, start: new Date("2026-09-21T02:30:00Z") }));
ok("isSameEvent: different venue with far coordinates → no match",
   !isSameEvent(existing, { ...same, locationName: "Plaza de Cesar Chavez", latitude: 37.3325, longitude: -121.8890 }));
ok("isSameEvent: identical venue names far apart do not merge",
   !isSameEvent(existing, { ...same, locationName: "AsiaTown", latitude: 37.3325, longitude: -121.8890 }));
ok("isSameEvent: no venue info on the new record → title+time match",
   isSameEvent(existing, { ...same, locationName: "", latitude: undefined, longitude: undefined }));
const duplicateAudit = auditSuspectedDuplicates({ all: [
  { id: "a", data: { active: true, date: ts("2026-09-20T23:00:00Z"), title: "Museum presents: Creek Walk", locationName: "River Park" } },
  { id: "b", data: { active: true, date: ts("2026-09-20T23:30:00Z"), title: "Creek Walk", locationName: "River Park" } },
  { id: "c", data: { active: true, date: ts("2026-09-20T23:30:00Z"), title: "Creek Walk", locationName: "Different Park" } },
] });
ok("dedupe audit flags one surviving cross-source lookalike", duplicateAudit.suspected === 1 && duplicateAudit.active === 3);
ok("horizon: 200 days out is skipped", !isWithinHorizon({ start: new Date(Date.now() + 200 * 86_400_000) }));
ok("scoping: Public Square is inside San Jose, Columbus is not",
   isInsideArea(SAN_JOSE, 37.3382, -121.8863) && !isInsideArea(SAN_JOSE, 39.9612, -82.9988));

const civicMeeting = { EventId: 8246, EventBodyName: "Bicycle Pedestrian Advisory Committee",
  EventDate: "2026-09-28T00:00:00", EventTime: "6:15 PM",
  EventLocation: "City Hall Wing, Rooms W118-W120",
  EventInSiteURL: "https://sanjose.legistar.com/MeetingDetail.aspx?LEGID=8246" };
const mappedMeeting = mapLegistar(civicMeeting, SAN_JOSE, "sanjose", "City of San José");
ok("legistar: local meeting clock converts to UTC",
   mappedMeeting?.start.toISOString() === "2026-09-29T01:15:00.000Z");
ok("legistar: closed sessions are excluded",
   mapLegistar({ ...civicMeeting, EventBodyName: "City Council Closed Session" }, SAN_JOSE, "sanjose", "City of San José") === null);
const enrichedWorkshop = enrichEvent({
  source: "bibliocommons", sourceEventId: "one", areaId: SAN_JOSE.id,
  title: "Teen Coding Workshop", description: "Hands-on Python basics for high school students.",
  organizer: "San José Public Library", start: new Date("2026-10-01T18:00:00Z"),
  time: "11:00 AM", locationName: "Main Library", category: "Social", isFree: true,
  tags: ["Technology", "Teens"],
});
ok("classifier: structured library metadata yields workshop, youth and opportunity",
   enrichedWorkshop.category === "Workshop" && ["Workshop", "Youth", "Opportunity", "Free"].every((label) => enrichedWorkshop.categories.includes(label)));
ok("classifier: uncertain venue stays ungeocoded and lowers quality",
   enrichedWorkshop.latitude === undefined && enrichedWorkshop.qualityScore < 0.8 && enrichedWorkshop.endInferred);
const enrichedHike = enrichEvent({ ...enrichedWorkshop, source: "midpen", title: "Guided Nature Walk",
  description: "Enjoy a trail hike through the preserve.", category: "Sports", tags: ["outdoors"] });
ok("classifier: hiking remains Sports with an Outdoors label",
   enrichedHike.category === "Sports" && enrichedHike.categories.includes("Outdoors"));
ok("classifier: volunteer trail work stays Volunteer",
   enrichEvent({ ...enrichedHike, title: "Volunteer Trail Maintenance and Hike",
     category: "Volunteer" }).category === "Volunteer");
ok("classifier: library console gaming is not a sport",
   enrichEvent({ ...enrichedWorkshop, title: "Game On!", description: "Play Nintendo Switch games.",
     tags: ["Games & Family Entertainment", "Teens"], category: "Workshop" }).category !== "Sports");
ok("classifier: volunteer-led sewing class stays Workshop",
   enrichEvent({ ...enrichedWorkshop, title: "Sewing with FabMo", description: "A class led by a volunteer.",
     tags: ["library", "Adults"], category: "Volunteer" }).category === "Workshop");
ok("classifier: library snack pickup is not Sports from a broad health tag",
   enrichEvent({ ...enrichedWorkshop, title: "Snack Break-Free Snacks for Kids!",
     description: "Pick up a free after-school snack. USDA nondiscrimination on the basis of race.",
     tags: ["library", "Health & Fitness", "Kids"], category: "Sports" }).category !== "Sports");
ok("classifier: tabletop club is not a sport from the recreation tag",
   enrichEvent({ ...enrichedWorkshop, title: "Teen Dungeons and Dragons Social Club",
     description: "Drop in to watch the long running game with different fantasy races.",
     tags: ["library", "Entertainment & Recreation", "Teens"], category: "Sports" }).category !== "Sports");
ok("classifier: homework help is a Workshop even with a generic source category",
   enrichEvent({ ...enrichedWorkshop, title: "Homework Help for Grades K-6",
     description: "Get help from a tutor.", tags: ["library"], category: "Meetup" }).category === "Workshop");
ok("classifier: a volleyball match is Sports",
   enrichEvent({ ...enrichedWorkshop, source: "livewhale", title: "Women's Volleyball vs Seattle",
     description: "Cheer on the team.", tags: ["Athletics"], category: "Social" }).category === "Sports");
ok("classifier: help provided by a volunteer is not a volunteer opportunity",
   enrichEvent({ ...enrichedWorkshop, title: "One-On-One Tech Help",
     description: "Get personalized assistance from an adult volunteer.",
     tags: ["library", "Computer Help"], category: "Volunteer" }).category === "Workshop");
ok("classifier: teen volunteer orientation remains Volunteer",
   enrichEvent({ ...enrichedWorkshop, title: "Teens Reach Orientation",
     description: "New to volunteering? Attend orientation and start earning volunteer service hours.",
     tags: ["library", "Teens"], category: "Volunteer" }).category === "Volunteer");

console.log("\n── completing-product classifier regressions ──");
for (const title of ["Summer Internship", "Research Fellowships", "Paid Apprenticeship"]) {
  const result = enrichEvent({ ...enrichedWorkshop, title, description: "Work with a local organization.",
    category: "Volunteer", tags: [] });
  ok(`classifier: ${title} is Program, not Volunteer`, result.category === "Program" && !result.categories.includes("Volunteer"));
}
for (const type of ["Workshops", "Crafts & Hobbies", "Learn English", "STEAM"]) {
  const result = enrichEvent({ ...enrichedWorkshop, title: "Tuesday at the library", description: "",
    category: "Social", tags: ["Adults"], eventTypes: [type] });
  ok(`classifier: activity type ${type} maps without text inference`, result.category === "Workshop" && result.classificationConfidence >= 0.65);
}
ok("classifier: audience and generic fitness tags do not invent a sporting activity",
  enrichEvent({ ...enrichedWorkshop, title: "Afternoon Snack", description: "Pick up food.",
    category: "Sports", tags: ["Health & Fitness"], eventTypes: ["Health & Fitness"], audiences: ["Kids"] }).category !== "Sports");
ok("classifier: recreational gaming metadata means Social, never sport",
  enrichEvent({ ...enrichedWorkshop, title: "Friday Fun", description: "", category: "Sports",
    tags: [], eventTypes: ["Games & Gaming"] }).category === "Social");
ok("classifier: mixed source audience bands do not invent adult-only/all-age eligibility",
  enrichEvent({ ...enrichedWorkshop, title: "Craft time", tags: [], eventTypes: ["Crafts & Hobbies"],
    audiences: ["Kids, ages 5-10", "Adults, ages 18+"] }).ageSuitability === "unknown");
ok("classifier: explicit source audience all ages is preserved",
  enrichEvent({ ...enrichedWorkshop, audiences: ["All Ages"] }).ageSuitability === "all");
const crowdedLocalist = mapLocalist({ id: 98765, title: "Ofrenda", description_text: "Display on campus.",
  event_instances: [{ event_instance: { start: "2026-11-01T18:00:00Z" } }],
  filters: { event_target_audience: Array.from({ length: 12 }, (_, n) => ({ name: `Audience ${n}` })),
    event_types: [{ name: "Exhibitions, Performances, Installations" }] } }, SAN_JOSE, "events.sjsu.edu", "SJSU")[0];
ok("localist: activity type survives more than eight audience tags", crowdedLocalist.eventTypes.includes("Exhibitions, Performances, Installations") &&
  crowdedLocalist.tags.includes("Exhibitions, Performances, Installations"));
ok("classifier: Localist activity type survives audience truncation", enrichEvent(crowdedLocalist).category === "Festival");
ok("classifier: BiblioCommons keeps audiences separate from activity types",
  bcMapped[0].eventTypes?.length > 0 && bcMapped[0].audiences?.length > 0);

console.log("\n── payload coercion (runIngest payload mode) ──");
const good = coercePayloadRecord({ source: "libcal", sourceEventId: "x1", title: "<b>Book Club</b>", start: "2026-10-01T18:00:00Z", locationName: "Main Library", tags: ["library", 42] }, SAN_JOSE);
ok("valid payload record coerces with cleaned title and tags", good && good.title === "Book Club" && good.category === "Workshop" && good.tags.length === 1, JSON.stringify(good));
ok("unknown source rejected", coercePayloadRecord({ source: "meetup", title: "x", start: "2026-10-01T18:00:00Z" }, SAN_JOSE) === null);
ok("bad date rejected", coercePayloadRecord({ source: "libcal", title: "x", start: "yesterday-ish" }, SAN_JOSE) === null);
ok("hostile toString payload does not crash", coercePayloadRecord({ source: { toString: "x" }, title: {}, start: [] }, SAN_JOSE) === null);


// ── W1.1 annotate: adultOnly + topicTags (annotate.ts; frozen classifier untouched) ──
console.log("\n── annotate: adultOnly ──");
const baseRec = { source: "localist", sourceEventId: "a1", areaId: SAN_JOSE.id, organizer: "San José State University",
  start: new Date("2026-11-01T18:00:00Z"), time: "11:00 AM", locationName: "Tower Lawn", category: "Festival", tags: [], description: "" };
const sparta = annotateEvent(enrichEvent({ ...baseRec, title: "Sparta Kickoff Fest",
  description: "Welcome back Spartans! Live music, food trucks and beer tastings, presented by Modelo.", audiences: ["Students", "General Public"] }));
ok("adultOnly: SJSU 'Sparta Kickoff Fest' (presented by Modelo, beer tastings) is flagged", sparta.adultOnly === true);
ok("adultOnly: a brand presenter alone flags it", inferAdultOnly({ ...baseRec, title: "Kickoff Fest", description: "Games on the lawn, presented by Modelo." }) === true &&
   alcoholBrandPresents({ ...baseRec, title: "Kickoff Fest", description: "Games on the lawn, presented by Modelo." }));
ok("adultOnly: a structured 21+ audience wins without alcohol words", inferAdultOnly({ ...baseRec, title: "Trivia Night", description: "Teams of four.", audiences: ["21+"] }) === true);
ok("adultOnly: a structured 'Adults (18+)' audience is an age limit", inferAdultOnly({ ...baseRec, source: "bibliocommons", title: "Crochet Club", description: "Bring yarn.", audiences: ["Adults (18+)"] }) === true);
ok("adultOnly: '18+' and 'ages 21 and over' in text flag it", inferAdultOnly({ ...baseRec, title: "Comedy Night 18+", description: "" }) === true &&
   inferAdultOnly({ ...baseRec, title: "Jazz", description: "Ages 21 and over only." }) === true);
ok("adultOnly: an age mentioned as a fact is not a limit ('over 70 years of dialogue', 'teaching for over 20 years', a lecture about adults 65 years and older)",
   inferAdultOnly({ ...baseRec, title: "Archive tour", description: "The exhibit explores over 70 years of dialogue." }) === false &&
   inferAdultOnly({ ...baseRec, title: "Paint Party", description: "An artist who has been teaching art for over 20+ years." }) === false &&
   inferAdultOnly({ ...baseRec, title: "Scholar Series", description: "A talk for adults and teens about aging well across 70 years of research." }) === false &&
   inferAdultOnly({ ...baseRec, title: "ESL Club", description: "This program is for adults aged 18 and older who speak basic English." }) === true &&
   inferAdultOnly({ ...baseRec, title: "Totes", description: "This class is intended for adults, ages 18 and up." }) === true &&
   inferAdultOnly({ ...baseRec, title: "Board Game Day", description: "Open to ages 18+ from 10am." }) === true);
ok("adultOnly: a toddler age range and a percentage are not limits ('Ages 18 Months - 4 Years', 'At least 60 percent')",
   inferAdultOnly({ ...baseRec, title: "Lil' Athletes for Ages 18 Months - 4 Years", description: "Stories and stretches." }) === false &&
   inferAdultOnly({ ...baseRec, title: "Wetland talk", description: "At least 60 percent of residents live near water." }) === false);
ok("adultOnly: common service wording flags — alcohol served, cash bar, open bar, BYOB, champagne toast, sake tasting, hard cider release, taproom trivia, pub quiz, Brewfest, Beerfest, drink tickets, Sip & Paint, winemaker dinner",
   ["Alcoholic beverages will be available for purchase.", "Alcohol will be served.", "Cash bar available.", "Open bar all night.", "BYOB!", "Champagne toast at midnight.",
    "Sake Tasting", "Hard Cider Release Party", "Taproom Trivia", "Pub Quiz Night", "San Jose Brewfest", "Beerfest 2026", "Two drink tickets included.", "Sip & Paint", "Winemaker Dinner", "IPA release with lager on tap"]
   .every((text) => inferAdultOnly({ ...baseRec, title: "Evening", description: text }) === true));
ok("adultOnly: a brewery, taproom or wine bar as organizer or venue flags with the venue reason",
   adultOnlyReason({ ...baseRec, organizer: "Hermitage Brewing Company", title: "Trivia Tuesday", description: "" }) === "alcohol-venue" &&
   adultOnlyReason({ ...baseRec, organizer: "Community", locationName: "Gordon Biersch Brewery Restaurant", title: "Trivia", description: "" }) === "alcohol-venue" &&
   adultOnlyReason({ ...baseRec, organizer: "Testarossa Winery", title: "Harvest Dinner", description: "" }) === "alcohol-venue");
ok("adultOnly: bare age-limit grammar flags — '21 and over', '18 & up', 'adults aged 18 and older', 'must be over 21', 'over 21 only', 'no children under 18', 'under 21 not admitted', 'Adults-Only', 'ages 25-35', 'Adults (21 and over)' audience",
   ["This is a 21 and over event.", "18 & up.", "Open to adults aged 18 and older.", "You must be over 21 to attend.", "Over 21 only.", "No children under 18 permitted.",
    "Attendees under 21 will not be admitted.", "Adults-Only Night at the Museum", "For ages 25-35."]
   .every((text) => inferAdultOnly({ ...baseRec, title: "Night", description: text }) === true) &&
   inferAdultOnly({ ...baseRec, title: "Trivia", description: "", audiences: ["Adults (21 and over)"] }) === true);
ok("adultOnly: counted nouns, student IDs, 'last call', cocktail attire, library happy hours and root-beer are NOT flagged",
   ["20+ carnival games", "50+ vendors and 30+ food trucks", "Student ID required", "Last call for volunteers", "Cocktail attire requested", "Happy Hour Storytime",
    "Homework Happy Hour", "Root-Beer Floats", "Root  Beer Float Social", "Ages 18+ months welcome", "The exhibit explores over 70 years of dialogue", "Mocktail party for teens"]
   .every((text) => inferAdultOnly({ ...baseRec, title: text, description: "" }) === false));
ok("adultOnly: a brand name alone in a title is not a presenter ('Sierra Nevada hike', 'Blue Moon stargazing', 'Corona Heights walk', 'Guinness World Record attempt', 'Modelo de negocio')",
   ["Sierra Nevada day hike", "Blue Moon stargazing night", "Corona Heights neighborhood walk", "Guinness World Record attempt", "Taller: Modelo de negocio", "Jameson family reunion"]
   .every((text) => inferAdultOnly({ ...baseRec, organizer: "Community Center", title: text, description: "" }) === false) &&
   inferAdultOnly({ ...baseRec, organizer: "Community Center", title: "Kickoff", description: "Sponsored by Sierra Nevada Brewing" }) === true &&
   inferAdultOnly({ ...baseRec, organizer: "Modelo", title: "Kickoff", description: "" }) === true);
ok("annotate: an enriched record stripped of tags and description does not crash", typeof annotateEvent({ ...enrichEvent({ ...baseRec, title: "Thing" }), description: undefined, tags: undefined, eventTypes: undefined, audiences: undefined }).adultOnly === "boolean");
ok("topicTags: word boundaries are Unicode-aware like Python's — 'artística' is not 'art', 'aiña' is not 'ai', 'Exposición artística para niños' gets the fallback",
   !inferTopicTags("Exposición artística", "").includes("arts") && !inferTopicTags("aiña", "").includes("tech") &&
   JSON.stringify(inferTopicTags("Exposición artística para niños", "", "community")) === JSON.stringify(["community"]) &&
   inferTopicTags("Art walk", "").includes("arts") && inferTopicTags("AI workshop", "").includes("tech"));
ok("adultOnly: wine, brewery, tasting room, cocktails, happy hour, bar crawl each flag", ["Wine down Wednesday", "Brewery tour", "Tasting room open house", "Cocktails on the terrace", "Happy hour mixer", "Downtown bar crawl"]
   .every((title) => inferAdultOnly({ ...baseRec, title, description: "" }) === true));
ok("adultOnly: a toddler storytime is NOT flagged", annotateEvent(enrichEvent({ ...baseRec, source: "bibliocommons", title: "Toddler Storytime", description: "Songs and stories for ages 1-3.", audiences: ["Kids (0-5)"] })).adultOnly === false);
ok("adultOnly: root beer floats, ginger beer, apple cider and mocktails are not alcohol",
   !mentionsAlcohol("Root beer float social") && !mentionsAlcohol("Ginger beer tasting for kids") && !mentionsAlcohol("Hot apple cider and donuts") && !mentionsAlcohol("Mocktail mixology for teens"));
ok("adultOnly: an 'Adults' audience without an age figure is a target audience, not an age limit", inferAdultOnly({ ...baseRec, source: "bibliocommons", title: "Mystery Book Club", description: "Monthly discussion.", audiences: ["Adults"] }) === false);
ok("adultOnly: minimumAge 21 from a feed wins", inferAdultOnly({ ...baseRec, title: "Trivia", description: "", minimumAge: 21 }) === true &&
   inferAdultOnly({ ...baseRec, title: "Trivia", description: "", minimumAge: 12 }) === false);
ok("adultOnly: the field is always a boolean", typeof annotateEvent(enrichEvent({ ...baseRec, title: "Thing", description: "" })).adultOnly === "boolean");
ok("adultOnly: the library audience labels decide — 'Adults, ages 18+' and 'Seniors, ages 65+' are limits, 'Teens, ages 12-18' and 'Kids, ages 5-10' are not",
   inferAdultOnly({ ...baseRec, source: "bibliocommons", title: "Knitting", description: "", audiences: ["Adults, ages 18+"] }) === true &&
   inferAdultOnly({ ...baseRec, source: "bibliocommons", title: "Tai Chi", description: "", audiences: ["Seniors, ages 65+"] }) === true &&
   inferAdultOnly({ ...baseRec, source: "bibliocommons", title: "Anime Club", description: "", audiences: ["Teens, ages 12-18"] }) === false &&
   inferAdultOnly({ ...baseRec, source: "bibliocommons", title: "Lego Club", description: "", audiences: ["Kids, ages 5-10"] }) === false);
ok("adultOnly: a reason is recorded and null when not flagged",
   adultOnlyReason({ ...baseRec, title: "Trivia Night", description: "", audiences: ["21+"] }) === "structured-age-limit" &&
   adultOnlyReason({ ...baseRec, title: "Brewery tour", description: "" }) === "alcohol" &&
   adultOnlyReason({ ...baseRec, title: "Kickoff", description: "presented by Modelo" }) === "alcohol-brand" &&
   adultOnlyReason({ ...baseRec, title: "Storytime", description: "" }) === null &&
   annotateEvent(enrichEvent({ ...baseRec, title: "Storytime", description: "" })).adultOnlyReason === null);

console.log("\n── annotate: topicTags (port of models.py infer_categories) ──");
const midpenWalk = annotateEvent(enrichEvent({ source: "midpen", sourceEventId: "w1", areaId: SAN_JOSE.id, title: "Explorer Hike: Bayside Birding",
  description: "Hike · About 3 miles.", organizer: "Midpeninsula Regional Open Space District", start: new Date("2026-11-01T16:00:00Z"), time: "9:00 AM",
  locationName: "Ravenswood Preserve", latitude: 37.4816, longitude: -122.1264, category: "Sports", isFree: true, tags: ["outdoors", "parks", "Hike"] }));
ok("topicTags: a Midpen guided walk keeps category Sports, gains outdoors, matches the outdoors interest",
   midpenWalk.category === "Sports" && midpenWalk.topicTags.includes("outdoors") && interestsForTopics(midpenWalk.topicTags).includes("outdoors"), JSON.stringify(midpenWalk.topicTags));
ok("topicTags: whole-word matching — 'art' does not match 'start' or 'party', 'ai' does not match 'Thai'",
   !inferTopicTags("Start of the party", "").includes("arts") && !inferTopicTags("Thai cooking", "").includes("tech") && inferTopicTags("Art walk", "").includes("arts"));
ok("topicTags: John's optional plural — 'toddlers' matches the 'toddler' keyword; a bare 'kid' does not match 'kids'",
   inferTopicTags("Toddlers at play", "").includes("kids") && !inferTopicTags("Kid's craft hour", "").includes("kids"));
ok("topicTags: title signals win; description-only sports/theater are ignored",
   !inferTopicTags("Coding Club", "Build small games in Python.").includes("sports") && inferTopicTags("Coding Club", "Build small games in Python.").includes("tech"));
ok("topicTags: description adds categories the title lacks", inferTopicTags("Evening program", "A free yoga class in the park").includes("fitness"));
ok("topicTags: nothing matched falls back to the source default, then 'other'",
   JSON.stringify(inferTopicTags("Thing", "", "campus")) === JSON.stringify(["campus"]) && JSON.stringify(inferTopicTags("Thing", "")) === JSON.stringify(["other"]));
ok("topicTags: every label is one of John's 19", midpenWalk.topicTags.every((t) => TOPIC_TAGS.includes(t)) && TOPIC_TAGS.length === 19);
ok("topicTags: structured labels join the title as a strong signal",
   annotateEvent(enrichEvent({ ...baseRec, title: "Opening Night", description: "", eventTypes: ["Theater"] })).topicTags.includes("theater"));
ok("topicTags: kids → family, theater/film → arts, campus → learning, civic → community mapping",
   JSON.stringify(interestsForTopics(["kids", "theater", "film", "campus", "civic"])) === JSON.stringify(["family", "arts", "learning", "community"]));

// ── W1.2 listing checks (port of validate.py BLOCKING) ──
console.log("\n── listing checks ──");
const NOW = Date.parse("2026-10-18T20:00:00Z");
const goodListing = { source: "localist", sourceEventId: "ok", areaId: SAN_JOSE.id, title: "Campus Concert", description: "", organizer: "SJSU",
  start: new Date(NOW + 86_400_000), end: new Date(NOW + 90_000_000), time: "7 PM", locationName: "Music Hall", latitude: 37.3352, longitude: -121.8811, category: "Festival", tags: [] };
ok("listing: a complete future listing passes", listingChecks(goodListing, SAN_JOSE, NOW).length === 0);
ok("listing: missing_title (under three characters)", listingChecks({ ...goodListing, title: "Go" }, SAN_JOSE, NOW).includes("missing_title"));
ok("listing: missing_start", listingChecks({ ...goodListing, start: new Date("nope") }, SAN_JOSE, NOW).includes("missing_start"));
ok("listing: end_before_start", listingChecks({ ...goodListing, end: new Date(NOW + 1000) }, SAN_JOSE, NOW).includes("end_before_start"));
ok("listing: already_ended after the two-hour grace, but a still-running event passes",
   listingChecks({ ...goodListing, start: new Date(NOW - 4 * 3_600_000), end: new Date(NOW - 3 * 3_600_000) }, SAN_JOSE, NOW).includes("already_ended") &&
   listingChecks({ ...goodListing, start: new Date(NOW - 4 * 3_600_000), end: new Date(NOW + 3_600_000) }, SAN_JOSE, NOW).length === 0 &&
   listingChecks({ ...goodListing, start: new Date(NOW - 3 * 3_600_000), end: undefined }, SAN_JOSE, NOW).includes("already_ended") &&
   !listingChecks({ ...goodListing, start: new Date(NOW - 3_600_000), end: undefined }, SAN_JOSE, NOW).includes("already_ended"));
ok("listing: cancelled (status or title prefix)", listingChecks({ ...goodListing, status: "cancelled" }, SAN_JOSE, NOW).includes("cancelled") &&
   listingChecks({ ...goodListing, title: "CANCELLED: Campus Concert" }, SAN_JOSE, NOW).includes("cancelled"));
ok("listing: postponed / rescheduled listings are NOT rejected (John keeps status 'postponed')",
   listingChecks({ ...goodListing, status: "postponed" }, SAN_JOSE, NOW).length === 0 &&
   listingChecks({ ...goodListing, title: "POSTPONED: Campus Concert" }, SAN_JOSE, NOW).length === 0 &&
   listingChecks({ ...goodListing, title: "Rescheduled - Jazz Night" }, SAN_JOSE, NOW).length === 0);
ok("listing: a venue written in another script counts as a location; 'See website' and 'TBD' do not",
   listingChecks({ ...goodListing, latitude: undefined, longitude: undefined, locationName: "日本町" }, SAN_JOSE, NOW).length === 0 &&
   listingChecks({ ...goodListing, latitude: undefined, longitude: undefined, locationName: "See website" }, SAN_JOSE, NOW).includes("missing_location_in_person") &&
   listingChecks({ ...goodListing, latitude: undefined, longitude: undefined, locationName: "TBD" }, SAN_JOSE, NOW).includes("missing_location_in_person"));
ok("listing: 'Virtual Reality Lab Open House' is not an online listing, '*Virtual* Mock Interview' and '(Virtual) Math Club' are",
   !isOnlineListing({ title: "Virtual Reality Lab Open House", locationName: "Location TBA" }) &&
   isOnlineListing({ title: "*Virtual* Mock Interview", locationName: "San José Public Library" }) &&
   isOnlineListing({ title: "(Virtual) Math Club", locationName: "" }) && isOnlineListing({ title: "Book Club", locationName: "Zoom" }));
ok("ticketmaster: dates.status.code maps to John's status (cancelled / postponed / scheduled)",
   mapTicketmaster({ ...tm._embedded.events[0], dates: { ...tm._embedded.events[0].dates, status: { code: "cancelled" } } }, SAN_JOSE).status === "cancelled" &&
   mapTicketmaster({ ...tm._embedded.events[0], dates: { ...tm._embedded.events[0].dates, status: { code: "rescheduled" } } }, SAN_JOSE).status === "postponed" &&
   mapTicketmaster(tm._embedded.events[0], SAN_JOSE).status === "scheduled");
ok("ics: STATUS:CANCELLED becomes a structured cancellation the listing checks reject",
   (() => { const cancelled = parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:c1\r\nSUMMARY:Author Talk\r\nSTATUS:CANCELLED\r\nDTSTART:20991101T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR", { defaultTimeZone: "UTC", horizonEnd: new Date("2100-01-01") });
     const mapped = mapIcsEvent(cancelled[0], SAN_JOSE, cplIcs, "ics"); return mapped.status === "cancelled" && listingChecks(mapped, SAN_JOSE, NOW).includes("cancelled"); })());
ok("listing: outside_region (Sacramento)", listingChecks({ ...goodListing, latitude: 38.58, longitude: -121.49 }, SAN_JOSE, NOW).includes("outside_region"));
ok("listing: in-person with no location is rejected; a named venue without coordinates passes",
   listingChecks({ ...goodListing, latitude: undefined, longitude: undefined, locationName: "Location TBA" }, SAN_JOSE, NOW).includes("missing_location_in_person") &&
   listingChecks({ ...goodListing, latitude: undefined, longitude: undefined, locationName: "Dr. Martin Luther King Jr. Library" }, SAN_JOSE, NOW).length === 0);
ok("listing: an online listing needs no location and is never outside the region",
   listingChecks({ ...goodListing, title: "*Virtual* Mock Interview", latitude: undefined, longitude: undefined, locationName: "Online" }, SAN_JOSE, NOW).length === 0 &&
   isOnlineListing({ ...goodListing, locationName: "Zoom" }));
ok("listing: several reasons are reported together", listingChecks({ ...goodListing, title: "x", start: new Date("nope") }, SAN_JOSE, NOW).length === 2);

// ── W1.3 fuzzy duplicate rule (port of dedupe.py) ──
console.log("\n── fuzzy duplicates ──");
const t0 = Date.parse("2026-11-03T18:30:00Z");
const branch = { venue: "Biblioteca Latinoamericana Branch Library", latitude: 37.3284, longitude: -121.8862 };
const storytimeA = { title: "Toddler Storytime", startMs: t0, url: "https://sjpl.bibliocommons.com/events/1", ...branch };
const storytimeB = { title: "Storytime: Toddlers", startMs: t0 + 10 * 60_000, url: "https://sjpl.bibliocommons.com/events/2", ...branch };
ok("fuzzy: 'Toddler Storytime' and 'Storytime: Toddlers' at one branch, 10 min apart, are one event", isFuzzyDuplicate(storytimeA, storytimeB));
ok("fuzzy: the same titles 45 minutes apart are not", !isFuzzyDuplicate(storytimeA, { ...storytimeB, startMs: t0 + 45 * 60_000 }));
ok("fuzzy: the same titles at a different branch 2 miles away are not",
   !isFuzzyDuplicate(storytimeA, { ...storytimeB, venue: "Rose Garden Branch Library", latitude: 37.3380, longitude: -121.9230 }));
ok("fuzzy: 'Branch Library' venue tokens alone do not make two branches the same place (venue Jaccard < 0.5)",
   jaccard(fuzzyTokens("Biblioteca Latinoamericana Branch Library"), fuzzyTokens("Rose Garden Branch Library")) < 0.5);
ok("fuzzy: distinct titles are not duplicates (Jaccard < 0.7)", !isFuzzyDuplicate(storytimeA, { ...storytimeB, title: "Teen Chess Club" }));
ok("fuzzy: same URL and same start is a duplicate regardless of title", isFuzzyDuplicate(storytimeA, { ...storytimeB, title: "Something else entirely", url: "https://www.sjpl.bibliocommons.com/events/1/", startMs: t0 }));
ok("fuzzy: coordinates within a quarter mile count as the same place when venue names differ",
   isFuzzyDuplicate({ ...storytimeA, venue: "Plaza de César Chávez" }, { ...storytimeB, venue: "Downtown stage", latitude: 37.3290, longitude: -121.8870 }));
ok("fuzzy: stop-words and punctuation are ignored in tokens", jaccard(fuzzyTokens("The Walk & the Talk"), fuzzyTokens("walk, talk")) === 1);
const fuzzyAudit = auditFuzzyDuplicates({ all: [
  { id: "a", data: { active: true, date: ts(new Date(t0).toISOString()), title: "Toddler Storytime", locationName: branch.venue, latitude: branch.latitude, longitude: branch.longitude, qualityScore: 0.9 } },
  { id: "b", data: { active: true, date: ts(new Date(t0 + 600_000).toISOString()), title: "Storytime: Toddlers", locationName: branch.venue, latitude: branch.latitude, longitude: branch.longitude, qualityScore: 0.5 } },
  { id: "c", data: { active: true, date: ts(new Date(t0).toISOString()), title: "Teen Chess Club", locationName: branch.venue, qualityScore: 0.5 } },
] }, t0 - 86_400_000);
ok("fuzzy audit: report-only count keeps the richer listing and counts one duplicate", fuzzyAudit.duplicates === 1 && fuzzyAudit.active === 3 && fuzzyAudit.sample[0].keep === "a" && fuzzyAudit.sample[0].drop === "b");

// ── W1.4 content hash / unchanged sighting ──
console.log("\n── write only what changed ──");
const annotatedGood = annotateEvent(enrichEvent(goodListing));
const h1 = contentHash(annotatedGood);
ok("hash: stable across calls", h1 === contentHash(annotateEvent(enrichEvent(goodListing))));
ok("hash: changes when the description, time or price changes",
   h1 !== contentHash(annotateEvent(enrichEvent({ ...goodListing, description: "New blurb" }))) &&
   h1 !== contentHash(annotateEvent(enrichEvent({ ...goodListing, start: new Date(NOW + 2 * 86_400_000) }))) &&
   h1 !== contentHash(annotateEvent(enrichEvent({ ...goodListing, priceMin: 12, isFree: false }))));
const fresh = { contentHash: h1, missedCycles: 0, active: true, lastSeenAt: ts(new Date(NOW - 3_600_000).toISOString()) };
ok("unchanged: same hash, missedCycles 0, seen within 24 h → skip", unchangedSighting(fresh, h1, NOW));
ok("unchanged: a changed hash forces a write", !unchangedSighting(fresh, "other", NOW));
ok("unchanged: a missed cycle forces a write (staleness reset must land)", !unchangedSighting({ ...fresh, missedCycles: 1 }, h1, NOW));
ok("unchanged: an inactive document is always rewritten", !unchangedSighting({ ...fresh, active: false }, h1, NOW));
ok("unchanged: lastSeenAt older than 24 h forces a refresh write", !unchangedSighting({ ...fresh, lastSeenAt: ts(new Date(NOW - UNCHANGED_REWRITE_MS - 1).toISOString()) }, h1, NOW));
ok("unchanged: a legacy document without a hash is written once", !unchangedSighting({ missedCycles: 0, active: true, lastSeenAt: fresh.lastSeenAt }, h1, NOW));


// ── W4.1: sources are data; the deny-list is absolute ─────────────────────────
console.log("\n── sources are data (W4.1) ──");
{
  const { isDeniedHost, DENIED_DOMAINS, sourceDocFromSeed } = await import("../lib/ingest/sources-registry.js");
  const { SOURCE_SEEDS, seedsOfType } = await import("../lib/ingest/sources-config.js");
  const denied = ["maps.google.com", "https://maps.googleapis.com/maps/api/place/", "places.googleapis.com", "https://www.google.com/maps/place/SAP+Center",
    "meetup.com", "www.meetup.com", "https://www.meetup.com/sj-hikers/events/ical/", "facebook.com", "m.facebook.com", "https://fb.me/e/abc", "instagram.com",
    "www.eventbrite.com", "eventbrite.co.uk", "https://www.eventbriteapi.com/v3/events/", "active.com", "apps.active.com", "campscui.active.com", "anc.apm.activecommunities.com"];
  for (const h of denied) ok(`deny-list: ${h} is refused`, isDeniedHost(h));
  const allowed = ["events.sjsu.edu", "sjpl.bibliocommons.com", "www.openspace.org", "google.com", "www.google.com", "calendar.google.com", "activekids.org", "faceboom.com", "notmeetup.com", "eventbrite.example.org", ""];
  for (const h of allowed) ok(`deny-list: ${h || "(empty)"} is not on the list`, !isDeniedHost(h));
  ok("deny-list: the six families named by the sourcing rule are all present", ["google", "meetup", "facebook", "instagram", "eventbrite", "active"].every((k) => DENIED_DOMAINS.some((d) => d.includes(k))));
  ok("deny-list: case and a leading www. do not matter", isDeniedHost("WWW.MEETUP.COM") && isDeniedHost("Facebook.com"));
  ok("seeds: no configured seed is on the deny-list", SOURCE_SEEDS.every((x) => !isDeniedHost(x.host)));
  ok("seeds: ids are unique and carry the area prefix", new Set(SOURCE_SEEDS.map((x) => x.id)).size === SOURCE_SEEDS.length && SOURCE_SEEDS.every((x) => x.id.startsWith(`${x.areaId}_`)));
  ok("seeds: every adapter type that used to live in areas.ts has at least one seed",
     ["ticketmaster", "libcal", "bibliocommons", "localist", "livewhale", "legistar", "midpen", "nps", "serpapi"].every((t) => seedsOfType(t, "san-jose-ca").length >= 1));
  ok("seeds: bibliocommons seeds carry the adapter's own parameter shape", seedsOfType("bibliocommons").every((x) => typeof x.params.library === "string" && typeof x.params.name === "string"));
  const d = sourceDocFromSeed(seedsOfType("localist", "san-jose-ca")[0]);
  ok("seed → document: active, origin config, url derived from the host, params carried verbatim", d.status === "active" && d.origin === "config" && d.url === "https://events.sjsu.edu/api/2/events" && d.params.host === "events.sjsu.edu");
}

console.log("\n── CAC 2026 (1.5): a missing provider key is a silent skip, never an error ──");
{
  const { sourceDocFromSeed } = await import("../lib/ingest/sources-registry.js");
  const { seedsOfType } = await import("../lib/ingest/sources-config.js");
  const npsDoc = sourceDocFromSeed(seedsOfType("nps", "san-jose-ca")[0]);
  let threw = null, records = null;
  const neverFetch = async () => { throw new Error("the network must not be touched when the key is missing"); };
  try { records = await fetchOneSource(npsDoc, SAN_JOSE, { ticketmaster: "", nps: "", serpapi: "" }, neverFetch); } catch (e) { threw = e; }
  ok("nps with no key and no park codes: resolves to an empty list, throws nothing, makes no request", threw === null && Array.isArray(records) && records.length === 0, String(threw));
}

console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed ? 1 : 0);
