# Free park guides and trail overviews — local evidence

This implements the online guide and overview portions of C2/C3, using the
permission-checked C1 catalog. F1 place stories, C4 offline packs, C5 copy,
physical-device QA and the rest of the sprint remain required and pending.
Nothing was deployed. Ranking and the frozen D1 classifier were not changed.

## Behavior

- `nearbyParkGuides` uses a checksummed compact index, bounding-box pruning
  followed by distance to actual boundaries, and generation-bound pages of 100.
  It retains all qualifying source parks across pages, including closed sites.
  Distances are straight-line distances to the footprint, not walking routes.
- `parksAtCoordinate` connects existing places to park boundaries by coordinates,
  with holes and separate polygon islands preserved. Source names never decide
  the join. Overlapping City/County records remain separately attributed.
- `parkGuide` supplies confirmed amenity facts, each amenity's published status,
  numeric playground age ranges only when supplied, source accessibility and
  entrance details, trails, attribution and the next seven days of public events.
  Unknown hours remain unknown. Source-closed amenities are shown as closed;
  they cannot satisfy availability filters. County POIs confirm presence but
  do not publish operational availability. Every page explains that distinction.
- Guide events use actual coordinates within the boundary, independent of the
  feed's current category/cache. Queries page beyond 500 rows. Hidden, removed,
  private, virtual, blocked and expired listings are excluded. Curated Programs
  enforce the account's age bounds; adult-only listings require an adult profile.
  General children's activities remain discoverable by parents and guests, with
  their participant age facts displayed. The guide's event details can open the
  existing event-action sheet.
- Signed-out guests and free signed-in accounts can read online guides. No
  anonymous account is created for them. Signed-in browsing has a persistent
  server request budget; guest protection is bounded, in-memory and per instance,
  not a global distributed rate cap. Guest IP-derived keys are not persisted.
- Discover has a park directory and source-backed rows; Map has separate park
  guide markers/list rows. Existing places link to all geometry-matched guides.
  Official records do not create additional collectible IDs or invented points.
- Toddler playground, dog area/on-leash trail, restroom and drinking-water
  filters are shared and persisted. Unknown facts are excluded. Closed, future
  and other parks not listed open do not pass these availability filters.
  Existing Collection rows honor the same shared choices when selected.
- Trail lists preserve published length, type, width class/units, dog permission
  and elevation where available. A dedicated MapKit view draws the original
  trail lines and boundary outlines, including holes, with a user annotation and
  recenter control. A park not listed open cannot turn its trails into an
  available-access claim. The required notice and official closure link are
  visible. No route-following, turn-by-turn or voice guidance was added.
- Only the system supplies background map imagery; no base imagery is downloaded
  or cached by Verdure. The view explicitly explains the connection limitation.
  This is still the online feature, not proof of an offline pack.
- Public catalog requests belong to the shared service, survive navigation
  cancellation and reject superseded location responses. Profile-filtered guide
  events are not persisted or reused across accounts.
- Generic place detail no longer fabricates category-based hours, amenities or
  wheelchair accessibility, and no longer matches venue events by name fragments.

## Design and inspection

The guide follows Verdure's existing identity: canvas `#ECEEDD`, surface
`#EDEFDE`, raised surface `#F7F9EF`, ink `#0E1B16`, soft ink `#46574C`, spruce
`#14532D`; New York display and Rubik body text through the existing Dynamic Type
tokens. Left-aligned status and facts lead the page. Park status, official site,
attribution and trail-map entry precede long amenity lists. No invented history,
decorative counters or new automatic animations were added.

The finished simulator screenshots were inspected: the closed site and its
closed playground are clearly labelled; attribution is visible near the title.
The County map shows separate trail and boundary lines, its notice, official
link and readable legend. Bottom space keeps content clear of the floating tab
bar. Full VoiceOver, largest Dynamic Type, dark-mode and outdoor GPS validation
remain G requirements, not claims made from these screenshots.

- [Closed City park](evidence/park-guide-closed-2026-10-04.png)
- [County trail overview](evidence/park-guide-trails-2026-10-04.png)

## Verification and exact reruns

Run from the repository root. The local working emulators must be running on
Firestore 8899, Auth 9099 and Functions 5002. These fixture scripts reject a
non-loopback target, restore the catalog/source-health state, and remove their
own generations, events, users and counters. Do not run catalog fixture scripts
concurrently with native SDK/UI checks.

```sh
npm --prefix functions run test:units
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/park-guides-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/parks-e2e.mjs
```

Fresh TypeScript build and all 366 backend unit checks passed, including 80 park
checks and the D1 freeze guard. The new actual callable suite passed 29 checks:
111-source-park pagination, exact geometry/hole joins, closed flags, corrupted
index refusal, >500 event scanning, free access, age/block/privacy handling,
malformed input and the authenticated request budget. All 28 pipeline regressions passed after the index change; the website was not changed.

Native checks require a populated, permission-checked **real** C1 catalog. The
current local generation is `8738ac5f-5451-43c0-b101-e1aa3c296558`: 5,507 usable
features, 651 park records, with a compact index added by replay of the existing
permission-checked capture. See PARK-PIPELINE-2026-10-04.md for capture/replay and
license-expiry requirements. It is a local capture, not production data.

```sh
cd Verdure
xcrun simctl location D55D802A-6C43-4FD0-8E2F-65952BF28EB7 set 37.335,-121.89
xcrun simctl privacy D55D802A-6C43-4FD0-8E2F-65952BF28EB7 grant location com.verdure-app.verdure
xcodebuild -quiet -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Plus' \
  -only-testing:VerdureTests/CoreLogicTests/testParkGeometryJoinsByBoundaryAndExcludesHoles \
  -only-testing:VerdureTests/CoreLogicTests/testParkGeometryPreservesSeparateIslandsAndRejectsBadCoordinates \
  -only-testing:VerdureTests/CoreLogicTests/testParkAmenityFiltersPersistWithoutLosingExistingChoices \
  -only-testing:VerdureTests/CoreLogicTests/testParkGuideLoadsRealCatalogThroughLocalCallableSDK \
  -only-testing:VerdureTests/CoreLogicTests/testParkCatalogRequestSurvivesCallerNavigationCancellation \
  -only-testing:VerdureUITests/JourneyTests/testSourceBackedParkGuideRespectsClosedStatusAndAttribution \
  -only-testing:VerdureUITests/JourneyTests/testParkTrailMapShowsOfficialNoticeWithoutRouteGuidance test
```

Fresh final run: **7 passed, 0 failed, 0 skipped**, on iPhone 16 Plus / iOS 18.4
Simulator, result `Test-Verdure-2026.10.04_04-44-25--0700.xcresult`. It includes
real-catalog Firebase SDK decoding, coordinate joins and navigation-cancellation
recovery. The existing 12 discovery-filter tests also passed in an earlier
focused fresh run. No full new iOS-suite, physical GPS, airplane-mode pack,
production index, paid push/purchase or real-device evidence is implied.

Initial UI runs exposed a collapsed search drawer and test setup errors: the
generic QA sample center is Minneapolis, and a distant lazy County row requires
scrolling. The current tests use explicit local emulators and the San José
simulated coordinate, with sample data disabled. The final source-backed flows
passed after those corrections. All passing evidence comes from a fresh build.

The new upcoming-events query matches the existing composite index with
`hidden`, `active`, `broadcast`, then ascending `date`. The full H1 inventory and
guard are still pending; an emulator pass is not production index proof.

After adding attribution directly to the trail-map footer, that actual County
UI flow passed again on a fresh build (1/1, no skips):
`Test-Verdure-2026.10.04_04-54-32--0700.xcresult`. The saved trail screenshot is from this final run.
