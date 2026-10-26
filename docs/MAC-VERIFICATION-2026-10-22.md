# Mac verification of the CAC 2026 branch — 2026-10-22

First compile of the Swift written on Windows since 2026-10-18 (W5 reasons/hide/series,
adult-aware queries, the CAC 2026 credit additions). Machine: macOS 27.0.1, Xcode 27.1,
simulator iPhone 16 Pro (iOS 18.4). Backend: local Firebase emulators only
(`node functions/scripts/sprint-emulators.mjs`: Auth 9099, Firestore 8899, Functions 5002,
Storage 9199). Nothing deployed, purchased or flipped.

## What it took to compile

`xcodegen generate` was required: the hand-edited `project.pbxproj` did not include
`VerdureTests/RankedFeedReasonsTests.swift`, and wrote the new `com.verdure-app.*` bundle
ids unquoted (a hyphen needs quoting in the pbxproj format). The regenerated file fixes both.

Two compile errors under Xcode 27.1's Swift; both are in code older than this sprint:

| File | Error | Fix |
|---|---|---|
| `Views/MainTabView.swift` `init()` | `self._selected used before being initialized` — two `@State` properties assigned through their wrappers before all storage was initialised | initialise `_showCollectionOnLaunch` / `_communityOnLaunch` with `State(initialValue:)`; the old assignments never reached SwiftUI's state anyway |
| `Models/Analytics.swift` `log` | `sending 'payload' risks causing data races` — a non-Sendable `[String: Any]` handed to `await addDocument` in a Task | completion-handler `addDocument`, still fire-and-forget |

None of the four W5 risk spots in `docs/W5-APP-EXPERIENCE-2026-10-20.md` needed a change.

## Native suites

| Suite | Result |
|---|---|
| `VerdureTests` | **143 passed, 1 skipped, 0 failed** (144) |
| `VerdureUITests` | **48 of 48 passed** (after the park-directory fix below) |

Connected tests need seeded emulators; with them down every "actual SDK" test fails on
"Could not connect". Seeding used for this run (from the repo root, emulators up):

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=connectify-19dd8
node functions/scripts/refresh-public-corpus-local.mjs /tmp/corpus-refresh.json   # today's public events
node functions/scripts/parks-local.mjs --live
node functions/scripts/offline-native-fixture.mjs
node functions/scripts/program-native-fixture.mjs
node functions/scripts/rewards-native-fixture.mjs
node functions/scripts/seed-stories-native.mjs
```

`PartnerSurfaceTests/testLiveStaffWithdrawalDismissesOpenMapOffer` must run through
`functions/scripts/partner-detail-native.sh` (it streams simulated GPS fixes); it passes there.

Fixed while running:

- `CoreLogicTests.testVolunteerSupplyReadsCompletePublicCorpusBeyondFirstDiscoveryPage`: the
  test's own reference query predated the W2 rule and was denied signed out; it now constrains
  `adultOnly == false` like the app's queries.
- Accessibility audit, W5 event detail: the decorative icon in `EventDetailSheet.detailRow`
  exposed the raw symbol name `leaf.circle.fill`; it is hidden and the row reads as one element.
- Accessibility audit, offline packs: "Change selection", "Verdure+ details" and "Open your
  packs" set `minHeight: 44` outside the button, so the hit area stayed text-sized; the frame
  now sits inside the label with a content shape.

Fixed after the first pass: `JourneyTests.testParkTrailMapShowsOfficialNoticeWithoutRouteGuidance`.
On one iPhone 16 Pro simulator, searching "Los Gatos Creek" in the park directory loaded all 12
matches, but the `LazyVStack` underestimated its height (mixed row heights) and the last result,
the County park, could never be scrolled into view; a real user could hit the same. Rebuilding
the stack per query (`.id(search)`) did not help; laying out a short result list (≤ 100 rows,
which covers any search) eagerly did, and the full directory stays lazy. The test now passes on
that simulator twice in a row and on a fresh iPhone 16 Pro.

## Backend (emulator)

`npm run test:units`: every suite green except `discovery-unit` 154/160 (the six recorded
terms fixtures, pre-existing). `npm run e2e` 357/357. `npm run e2e:ingest` 33/33.
`npm run e2e:sources` 30/30. `npm run redteam`: 95 blocked, 1 vulnerable — the intake endpoint
accepts a Google Maps URL (pre-existing; discovery fixes are kept off this branch).
`npm run acceptance`: 7 of 8 steps pass; `decide` fails because the configured Stanford
Localist source now fails `realEvents` against the recorded fixture (discovery, not touched here).

## The CAC verify items, seen running

| Item | Seen |
|---|---|
| App against local emulators with today's events | Yes — 8,130 events read from the public feeds into the emulator; Events tab showed 168 events, today Fri Oct 23 |
| Legal → Terms ends with "Data and acknowledgements" | Yes |
| Planner shows the Open-Meteo link | Not seen — see below |
| Four screens show the OpenStreetMap credit | Not seen — see below |

The public Overpass server (`overpass-api.de`, the app's only OpenStreetMap source) was at
capacity during this session: the app's query timed out or returned "502 … All query workers
are busy and the request queue is full" on every attempt. With no `osm-` places loaded, the
credits are correctly hidden, and the planner refuses with fewer than two nearby places, so
neither could be shown. A watcher retried every few minutes from 23:30 to 04:02 PDT and never
got an answer; at 04:05 the two public mirrors (`overpass.kumi.systems`,
`overpass.private.coffee`) timed out too, while GitHub and Open-Meteo answered normally.
Repeat on recording day once Overpass answers.

Overpass now answers 406 to generic user agents (`curl/…`, `Mozilla/5.0`) and 200 to an
identifying one, so `PlacesAPIService.queryOverpass` now sends `Verdure/1.0 (+https://verdure-app.com)`
rather than relying on the default CFNetwork agent.

## Firebase iOS app re-registration

`com.verdure-app.verdure` registered in `connectify-19dd8` as iOS app
`1:350584206981:ios:d008b84adbc0f34bd29bec` (`firebase apps:create`), and
`GoogleService-Info.plist` replaced with the downloaded config; `Secrets.xcconfig`
`FIREBASE_GOOGLE_APP_ID` points at the same app. The app builds and launches with no
Firebase bundle-id mismatch warning. The two old registrations (the former ownership prefix,
`.verdure` and `.connectify`) still exist in the project; deleting them is the owner's call.
