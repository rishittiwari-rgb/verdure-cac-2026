# Separate official park-data pipeline — local evidence

The C1 backend pipeline is implemented. It is not deployed. App park pages,
Discover/Map integration and offline packs remain unfinished, so C1's full
connection to existing native places/events is not yet claimed complete.

## Publisher access and permission

Read `PARK-SOURCE-LICENSES-2026-10-04.md` and its metadata evidence first. Those
permissions were committed as `28d2ca3` before feature ingestion. Each run
rechecks City CC BY metadata and its exact service link, and each County item's
public access, County ownership, service URL and reviewed empty `licenseInfo`.
A changed license/owner/service stops that source before any feature download.
No County Creative Commons license is inferred.

County policy pages returned HTTP 403 to our plain automated HTTP reader.
The permission basis is the recorded official Hub-linked policy review, not a
claim that the pipeline fetched those policies live. Recorded permission expires
November 3, 2026 UTC. Before extending that date, review the actual publisher
policies and update the evidence/permission record. Expiry or changed metadata
appears as a failure in Operations; it never silently renews permission. No
blocked host was bypassed and no photographs/third-party imagery were ingested.

## Download, normalization and publication

`functions/src/parks` is separate from event ingestion. The exported
`placeDataWeekly` schedule runs Tuesday at 06:00 America/Los_Angeles, after the
City's documented Monday publication. No scheduler has been deployed.

Each source snapshots its object IDs, then requests exact sets of at most 100
GeoJSON features with `outSR=4326`. Missing/duplicate/unexpected IDs, truncation,
API/HTTP errors, empty snapshots, changed essential fields, invalid geometry,
unapproved hosts, redirects and size/vertex limits are explicit failures.
County trails/POIs request only Public distribution; the source uses both
`Public` and `public`, which are accepted case-insensitively. Internal/restricted
distribution is refused. Trail public-use restrictions remain in the data;
they do not become open hiking trails.

Status, age ranges, drinking water, restrooms and dog permissions come from
structured fields. Decorative fountains, water bodies and splash play do not
confirm drinking water. Missing attributes stay unknown. County numeric trail
width has no verified unit; preserve it with `widthUnit: null`. The published
width-class domain explicitly gives feet, and is retained separately. Elevation
is absent. No hours, accessible entrances or route guidance are invented.

Exact point-in-polygon, polygon/multiline intersection and hole/multipolygon
handling decide joins. Bounding boxes only prune candidates. Names do not
participate. `parkIdsAt` supplies the same coordinate join for existing places
and events; native consumption is still pending with C2. Separate City/County
records may overlap; they are not merged by a name heuristic.

One real City feature, `city-amenities_1636`, included a closed a-b-a exterior
with zero area alongside its valid parking-area polygon. The initial run failed
and published nothing. Normalization now omits only that mathematically empty
component, records a note on the feature and a visible source-health count, and
preserves every vertex of its non-empty component. Nonfinite/unclosed/malformed
geometry is still refused. Three County trail features have null geometry and
are explicitly counted as unjoinable. They acquire no guessed coordinates.

All five sources must succeed before a new catalog is published. A generation
is built privately, with all nested GeoJSON encoded as lossless gzip chunks and
SHA-256 checksums. Only a final transaction changes `parkCatalog/current`.
Partial/failed downloads never replace the previous complete catalog; older
concurrent runs cannot replace a newer result. Source health preserves the last
successful download separately from current errors and catalog publication.
Complete/abandoned generations older than two weeks are pruned, protecting the
active generation. No client, including an admin, can mutate pipeline records.

## Actual local read-back

The public capture completed at `2026-10-04T10:30:39.961Z`. Its decoded JSON is
12,767,387 bytes, SHA-256
`94ec773a361b47b946ca478da75732fbd0ab69928ad08a896d5f3a3ad14850fc`.
It is stored locally at `/tmp/verdure-park-capture-2026-10-04.json.gz`; that
temporary file is not a durable committed fixture. The capture script can
re-fetch the current public data; counts may change with publisher updates.

Generation `47b99513-5106-41ea-a414-08880efeda3f` was published only to the local
Firestore emulator. Full read-back verified every stored geometry checksum:

| Source | Downloaded | Usable geometry |
| --- | ---: | ---: |
| City parks | 614 | 614 |
| City amenities | 2,260 | 2,260 |
| County boundaries | 37 | 37 |
| County trails | 1,747 | 1,744 |
| County POIs | 852 | 852 |
| Total | 5,510 | 5,507 |

Geometry linked 3,001 of 3,112 amenity features and 1,723 of 1,744 trail features
to at least one source park. Unmatched features are retained with no fabricated
park link. These are feature/join counts, not park coverage or accuracy scores.
Exact counts/statuses/normalization evidence are committed in
`evidence/park-pipeline-local-2026-10-04.json`.

## Re-run

From the repository root, with loopback Firebase emulators running on Auth
9099, Firestore 8899 and Functions 5002:

```sh
npm --prefix functions run build
node functions/scripts/parks-capture.mjs /tmp/verdure-park-capture-2026-10-04.json.gz
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/parks-local.mjs /tmp/verdure-park-capture-2026-10-04.json.gz
npm --prefix functions run test:units
```

The capture is read-only against public sources. The ingestion runner refuses
non-loopback Firestore and uses the local project ID; it cannot deploy. `--live`
can replace the capture path to run the same permission-checked adapters while
still writing only to a loopback emulator.

To exercise the actual staff screen, start the website in local staff mode:

```sh
cd Verdure-website--main
VERDURE_STAFF_EMULATOR=1 npm run dev -- --port 3104 --hostname 127.0.0.1
```

Then, from the repository root:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 VERDURE_PARKS_TEST_URL=http://127.0.0.1:3104 node functions/scripts/parks-e2e.mjs
```

The pipeline test passed 33 checks, including a source outage visible in the
real browser, prior-success/catalog preservation, recovery, source pagination,
large lossless geometry chunks, corruption refusal, older-run protection,
authorization, direct SDK rules and abandoned-generation cleanup. Fixture
catalogs/health are restored afterward; disposable Auth accounts are deleted.
The new pure unit suite passed 59 checks. The complete backend unit run passed
345 checks. A fresh isolated emulator regression run also passed all 337
existing end-to-end checks and blocked all 49 red-team attacks. The website's
fresh production build and lint passed. These are local tests; no physical GPS, offline pack, native park
page or live index enforcement result is implied.

Remaining C2–C5 work: free park API/native guides, this week's geometry-linked
events, confirmed amenity filters, attribution/closure notices on every guide,
trail overlays, Plus-only server-generated packs with size/expiry/Wi-Fi refresh,
offline-action restrictions, feature/copy parity, and outdoor physical-device
testing. Ranking and the frozen classifier remain untouched.
