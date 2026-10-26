# Feed survey — San Jose / South Bay launch area

Run date **2026-09-13**. Every row below was fetched live from this machine on
that date. Re-run the probes before trusting any of it; feeds change silently.

## Correction — 2026-09-26

The September 13 survey misidentified Santa Clara University's calendar as
Localist. `https://events.scu.edu/api/2/events` returns **403** because that is
the wrong platform endpoint. The site runs **LiveWhale**. Its public
`/live/json/v2/events` and `/live/ical/events` endpoints both return **200**,
even while the home page and `robots.txt` return 403. The new
`sources/livewhale.ts` uses only the public JSON feed. A read-only adapter run
returned **400 public upcoming records** in the 60-day horizon (119 with
coordinates) after filtering private/canceled items and paginating. This is an
upstream fetch, not evidence that Firestore currently contains them.

The LiveWhale feed exposes numeric as well as text cost fields; a missing cost
is treated as unknown, not free. The feed includes off-campus events, so the
store's coordinate radius check remains important. Items without coordinates
cannot be geographically verified by that check.

The original survey table below is retained as the September 13 snapshot; its
SCU conclusion is superseded by this correction.

### City and County follow-up probes — 2026-09-26

| Path | Result | Finding |
| --- | --- | --- |
| City `www.sanjoseca.gov/rss.aspx` | 403 from the fingerprinter; 404 on a separate direct probe | No usable RSS index confirmed; keep both observed statuses distinct. |
| City `data.sanjoseca.gov` | 200 | CKAN 2.9.11. Public `package_search` returns datasets; “events” finds three datasets but none is an event calendar. Parks and facility data may help geocoding. |
| City `gisdata-csj.opendata.arcgis.com` | 200 | Separate ArcGIS Hub, promising for venue and park geodata; event dataset not established. |
| City `sanjose.legistar.com` and `webapi.legistar.com/v1/sanjose/events` | 200 and 200 | Public meeting API is reachable. Civic meetings need a product relevance decision before ingestion. |
| County `parks.santaclaracounty.gov` | 403, including `robots.txt` | Main Parks site remains blocked from this machine. |
| County `www.parkhere.org` | Redirects to County Parks, then 403 | No separate registration platform found at that host. |
| County `gooutsideandplay.org` | 200 | Reservation and fee portal, not an events feed. |
| County volunteer calendar | Public link resolves to `scc.samaritan.com/custom/502/opp_search` | County uses Samaritan for volunteer opportunities. Platform and terms need further review before an adapter. |

### Additional library supply — 2026-09-26

Palo Alto City Library has a BiblioCommons calendar. Its public gateway reports
**457 records**, and the existing adapter fetched all 457 (385 with coordinates)
after adding the `paloalto` configuration. The old adapter stopped at four
pages, which returned only 400 Palo Alto records and a small fraction of SJPL's
**6,020**. Gateway pages are **not date sorted**: near-term SJPL events appear
on its last page. The adapter now reads every reported page at a page size of
150 (200 makes Palo Alto return HTTP 500) and throws on a failed later page.
The dry read fetched all 6,020 SJPL records. These are upstream counts, not
events written to Firestore; the live collection was empty at the coverage
baseline. The store and report's former 8,000-document query caps have been
replaced with cursor pagination so the larger corpus can be indexed fully.

On the September 27 stratified-audit pull, Santa Clara County Library's gateway
returned HTTP 500 at page 13 with 150 rows/page. The equivalent later range
returned 200 at 100 rows/page, so `sccl` now uses a source-specific page size
of 100. The adapter still throws on a failed page; it never converts that
failure into a short calendar.
The next pull saw a transient HTTP 500 on page 19 at 100 rows/page; a direct
retry returned 200. The adapter now retries 429/5xx twice with a short backoff
and still fails the entire source after repeated errors. The subsequent full
pull completed with 1,914 available SCCL records.

Two neighboring BiblioCommons systems also have real South Bay venues:
**Alameda County Library** (Fremont/Newark/Union City area) and **San Mateo
County Libraries** (eastern branches). Read-only full-feed probes returned
**1,116** and **2,057** records with trusted coordinates inside the configured
radius, respectively. Their config requires in-area coordinates: this excludes
outlying and ungeocoded branches instead of admitting them under a generic
library location. These are additional upstream counts, not a live ingest.

**Mountain View Public Library** publishes two LibCal calendars. Its public
calendar page lists `8800` as the Library Events Calendar and `8985` as the
Bookmobile Calendar. `rss.php?m=month&cid=8800` returned **64** event records
on September 26; the existing LibCal adapter maps them. They currently have no
trusted venue coordinates, so proximity check-in must not treat the library name
as a geocoded venue.

The **San José Legistar** public Web API returned **24** meeting records in a
120-day read, including closed sessions. The adapter keeps public meetings with
a parseable time; a read-only run mapped **14** records. Closed sessions are
excluded. These are low-discovery-value civic records but a legitimate public
source on an independent host. The source's own meeting URL remains the action
link. [Legistar documents its public Events API](https://webapi.legistar.com/Help).

These two feeds bring the new configured source count to **six**: SCU LiveWhale,
Palo Alto, Alameda County and San Mateo County BiblioCommons, Mountain View
LibCal, and San José Legistar. All counts above are upstream reads, not evidence
of documents in the currently empty live Firestore collection.

The City CKAN and ArcGIS portals are reachable, but no calendar dataset was
established there. The County's Samaritan volunteer endpoint needs a usage and
schema review before ingestion. They remain follow-up candidates after the
source-list freeze.

This survey is the evidence behind `SAN_JOSE` in `functions/src/ingest/areas.ts`.
It exists because the previous launch area (Cleveland, OH) was a placeholder that
had reached config, and moving it turned out not to be a coordinate swap.

## Headline: neither library system runs LibCal

The single most consequential finding. San José Public Library and Santa Clara
County Library District both run **BiblioCommons**, and **neither publishes
iCal** — `https://sjpl.bibliocommons.com/events/calendar.ics` is a hard 404.
Both the existing `.ics` adapter and the LibCal RSS adapter are unable to read
either system, so a third adapter was written:
`functions/src/ingest/sources/bibliocommons.ts`.

BiblioCommons turns out to be the better source of the two. Each branch carries
`mapLocation.centrePoint {lat,lng}` with an `isGeocoded` flag **in the feed**, so
there is no hand-maintained venue coordinate table (the Cleveland config had one,
and three CPL branches were permanently uncoordinated because OSM did not list
them). The adapter trusts a coordinate only when `isGeocoded === true`; an
ungeocoded centre point is a city centroid and would put the 500 ft check-in gate
around the wrong building.

## The rule this survey works to

**Parse public feeds and open data freely. Do not scrape any source whose terms
prohibit it.**

This corrects an earlier, stricter rule ("APIs and public feeds only"), which
was broader than the facts support and would have cost us real supply for no
benefit. City calendars, library systems and parks departments are fair game and
always were. Where a source publishes a public HTML calendar and no feed,
parsing it is acceptable **provided its terms do not forbid automated access** —
and that is checked, per source, before any adapter is written.

Two named exceptions, off-limits regardless: **Google Maps/Places** and
**Meetup**. Both prohibit it explicitly in their terms. For Google it is also
strategically backwards — the entire premise of this corpus is events Google
does not have, so seeding it from Google would defeat the measurement in
`coverage-check.mjs` as well as the product.

In practice this sprint that rule admitted exactly one source (Midpen, below)
and excluded exactly one (Santa Clara County Parks, also below) — and it
excluded that one on evidence, not on a blanket prohibition.

Since 2026-10-19 the rule is applied automatically: `functions/src/discovery/`
inspects candidate hosts, records evidence for six rules (deny-list, robots,
machine-readable listing, terms, real events, not adult content) and activates
or rejects them with no human approval. One of its discovery origins (W4.4)
queries OpenStreetMap through the Overpass API for organisations with a
`website` tag inside the launch area (`overpassQuery()` in
`functions/src/discovery/discover.ts`; the result is cached weekly in
`/discoveryCache`). **Map data © OpenStreetMap contributors, available under
the Open Database License (ODbL), <https://www.openstreetmap.org/copyright>.**
Only the website hosts are kept; no OSM geometry is stored in `/sources`.
The Midpen preserve coordinates below were likewise geocoded against
OpenStreetMap (Nominatim) and carry the same credit.

## Results

| Source | System | Status | Result |
|---|---|---|---|
| San José Public Library | BiblioCommons | ✅ ingesting | **6,477 events**, branch coordinates in-feed |
| Santa Clara County Library District | BiblioCommons | ✅ ingesting | **2,106 events** |
| Midpen Regional Open Space | HTML listing | ✅ ingesting | **57 events, 56 with coordinates**, all free |
| San José State University | Localist | ✅ ingesting | full page / 30 days, `geo` present |
| Stanford University | Localist | ✅ ingesting | full page / 30 days; ~17 mi, inside the radius |
| Ticketmaster Discovery | API | ✅ ingesting | SAP Center, the California Theatre etc. |
| SerpApi (Google Events) | API | ✅ gap-filler | quota-capped, unchanged |
| Santa Clara University | Localist | ❌ **403** | blocks server-side requests |
| City of San José | — | ❌ **403** | calendar ICS endpoint denies non-browser agents |
| Santa Clara County Parks | — | ❌ **403 (WAF)** | blocks everything, incl. `robots.txt` |
| National Park Service | API | ❌ n/a | **no NPS unit inside the radius** |

### On NPS, and what replaced it

`nps.parkCodes` is **empty** for this area. Cuyahoga Valley NP sat genuinely
inside Cleveland's 25 miles; the nearest units here are Golden Gate NRA (~50 mi)
and Pinnacles (~80 mi), both outside it, and `isInsideArea` would discard their
events anyway. Listing them would manufacture a source that contributes nothing.

The **adapter stays in the tree** — it is verified, costs nothing to keep, and
the next launch area may well have a park in range.

The outdoor/nature supply NPS was carrying is **replaced, not absorbed as a
loss**, by Midpen. That is a straight upgrade on every axis that matters:

| | Cuyahoga Valley (Cleveland) | Midpen (San Jose) |
|---|---|---|
| Events | 39 | **57** |
| Sites in radius | 1 park | **19 preserves, all inside** |
| With coordinates | park-level | **56 of 57, preserve-level** |
| Volunteer programming | some | **18 of 57** |

All 19 preserve coordinates were geocoded against OpenStreetMap (Nominatim) on
2026-09-13 and each was checked to fall inside the radius; a unit test asserts
that, so a bad coordinate cannot ship. A preserve missing from the table yields
an event with **no** coordinates rather than a guessed one.

**Known rough edge:** guided hikes classify as `Sports`, because that is the
closest fit in the existing `EventCategory` taxonomy and because Midpen's own
activity column calls them hikes. It is not wrong, but a user filtering "Sports"
expecting a ball game gets a nature walk. The events carry `outdoors` and the
activity name as tags, and the ranker maps the `outdoors` interest onto Sports,
so discovery works. Adding a real `Outdoors` category is a taxonomy change
across the app and is deliberately not bundled into this sprint.

### Why Midpen is parsed from HTML, and Santa Clara County Parks is not

**Midpen — parsed, with permission established first.** They publish no events
feed: `/events/feed`, `/events/rss.xml`, `/events.ics`, `/api/events` and
`/jsonapi` all 404, and `/rss.xml` is a site-wide "recent content" feed of ten
mixed items with no start times or locations. So it was HTML or nothing. Before
writing the adapter:

* `robots.txt` **allows** `/events` — it disallows only `/core`, `/profiles`,
  `/node/add`, `/comment/reply`, `/filter/tips`, `/media/oembed` and some READMEs.
* Their terms page (`/terms-use-privacy`, ~13k characters, read in full)
  contains **no** prohibition on automated access — no mention of scraping,
  crawling, spiders, robots, harvesting or data mining. Its one "commercial"
  clause governs user-submitted comments, not access.

A public agency, public programming, a page robots explicitly permits. It
qualifies under the rule above.

**Santa Clara County Parks — NOT parsed.** `sccgov.org` and `parks.sccgov.org`
return **403 to every request, including `robots.txt` itself**, with a browser
User-Agent as well as ours. That is an active WAF block, and because it also
blocks their rules file, their permissions **cannot be read at all**. Evading a
WAF is not "parsing a public page", and proceeding without being able to check
permission is not a judgement call we get to make on their behalf. They become a
recruitment target — which is a better outcome anyway, since an organizer
account gives us their programming with their consent and a contact behind it.

### Midpen will break, and it will say so

A feed has a contract; a page does not. When Midpen redesigns, the selectors
stop matching. The failure that must never happen is returning **zero** events
quietly — that reads as "no events this week" and nobody investigates, while the
staleness sweeper deactivates the whole outdoor category over three cycles.

So `fetchMidpen` **throws** when the page loads but yields no parseable rows.
The ingest runner records a source error, existing events are left alone, and
the failure is visible. A thrown error is a bug report; an empty array is a
silent outage. Two unit tests pin this by feeding it a redesigned page and a
table with no event links.

### The original ❌ rows were a recruitment list

This was the September 13 interpretation. The SCU entry is now disproven by
the LiveWhale feed above. City of San José and County Parks still need the
separate-host probes described in the next sprint scope.

## Reproducing this survey

```bash
# Midpen: no feed anywhere, and the listing that replaces it
for p in /events/feed /events/rss.xml /events.ics /api/events /jsonapi; do
  curl -s -o /dev/null -w "$p: %{http_code}\n" "https://www.openspace.org$p"
done
curl -s "https://www.openspace.org/robots.txt" | grep -i event   # no Disallow
curl -s "https://www.openspace.org/events" | grep -c "<tr"

# Santa Clara County Parks: 403 on everything, robots.txt included
curl -s -o /dev/null -w "sccgov:        %{http_code}\n" "https://parks.sccgov.org/"
curl -s -o /dev/null -w "sccgov robots: %{http_code}\n" "https://parks.sccgov.org/robots.txt"

# Library systems — the two that needed the new adapter
curl -s "https://gateway.bibliocommons.com/v2/libraries/sjpl/events?limit=1" \
  | python3 -c "import sys,json;print('sjpl',json.load(sys.stdin)['events']['pagination']['count'])"
curl -s "https://gateway.bibliocommons.com/v2/libraries/sccl/events?limit=1" \
  | python3 -c "import sys,json;print('sccl',json.load(sys.stdin)['events']['pagination']['count'])"

# Proof there is no iCal path (expect 404)
curl -s -o /dev/null -w "sjpl ics: %{http_code}\n" "https://sjpl.bibliocommons.com/events/calendar.ics"

# Localist
curl -s "https://events.sjsu.edu/api/2/events?days=30&pp=100"     | head -c 80
curl -s "https://events.stanford.edu/api/2/events?days=30&pp=100" | head -c 80

# The two that refuse us (expect 403)
curl -s -o /dev/null -w "scu:  %{http_code}\n" "https://events.scu.edu/api/2/events?days=30&pp=3"
curl -s -o /dev/null -w "sjca: %{http_code}\n" "https://www.sanjoseca.gov/Home/Components/Calendar/Event/ICS"
```

Adapter behaviour is pinned without network by
`functions/test-fixtures/sjpl-bibliocommons-sample.json` (a trimmed live capture,
including a virtual event with no branch) — `npm run test:units` in `functions/`.

## One bug this move surfaced

SerpApi event ids hashed on the **UTC** calendar date. SerpApi's `when` field is
optional, so the same event arrives sometimes as `"Sat, Sep 20, 6 PM"` and
sometimes as bare `"Sep 20"`. In `America/New_York` a 6 PM start is still 22:00Z
the same day, so both hashed identically and dedupe worked. In
`America/Los_Angeles` 6 PM PDT is 01:00Z the **next** day — the two records hash
differently and the event would have ingested twice. Fixed in
`sources/serpapi.ts` by hashing the local calendar date; regression test in
`ingest-unit.mjs`.
