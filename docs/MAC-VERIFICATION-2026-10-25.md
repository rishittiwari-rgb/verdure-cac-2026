# Mac verification of branch `cac-2026` — 2026-10-25

The Mac half of `docs/MAC-HANDOFF-2026-10-25.md`: first compile of the Windows branch, the iOS
suites, the intermittent tests, the screenshots and the final proof. Machine: MacBook with 8 GB
RAM, Xcode 26.5 (17F42), simulator **iPhone 17 Pro, iOS 26.5** (this Xcode has no iPhone 16 Pro;
use `-destination 'platform=iOS Simulator,name=iPhone 17 Pro'` or the device id), Homebrew
OpenJDK 21.0.11, Node 22.17. Local emulators only; nothing deployed, purchased or flipped.

## Setup

- Clone of `lalubalu/appc`, branch `cac-2026` at `6d5e431`, placed one level below the helper
  folder `run-all.command` expects (`../emulator-data`, `../run-all-logs`, `../DerivedData`).
- Secrets (all ignored, `check:secrets` clean): `functions/.secret.local` holds only
  `NPS_API_KEY` and `RECREATION_GOV_KEY` (the two new keys); `Verdure/Secrets.xcconfig` is the
  template with the Firebase ids and the two keys; `GoogleService-Info.plist` is the one for app
  `1:350584206981:ios:d008b84adbc0f34bd29bec` (all five Firebase values match the xcconfig). No
  Anthropic, SerpApi, Tremendous or Apple IAP key on this machine's branch config.
- The Mac's earlier tree (`mac-handoff`) differs from the Mac checkout of 2026-10-23 only in
  generated `graphify-out/` files and a local `.claude/settings.local.json`: no Mac work is missing.
- Data: `./run-all.command --no-app` (emulator export from 2026-10-23 imported, today's public
  feeds, parks, recorded discovery replay, fixtures, Demo Judge, For You accounts), the website on
  127.0.0.1:3105 (`next build && next start`) for the connected Terms test.

## What was wrong, and the fix (each with the test that catches it)

App and backend:

| # | Symptom | Root cause | Fix | Test |
|---|---|---|---|---|
| 1 | The app did not compile (`generic parameter 'ID' could not be inferred`) | `AdventurePlannerView.swift:225` `ForEach(plan.notes, id: .self)` — the key-path backslash was lost on the branch's Windows commit (`ca74814`), which had never been compiled | `id: \.self` | the build (`xcodebuild build`) |
| 2 | On every place detail the OpenStreetMap credit (an ODbL requirement) was hidden | `PlaceDetailView` padded its content by `Spacing.xxl` (48 pt); every other screen under the floating tab bar pads 110 pt, so the credit — the last row — sat behind the bar at the end of the scroll | `.padding(.bottom, 110)` | `DemoWalkthroughUITests.testJudgeWalkthrough` now requires the credit on screen above the tab bar (it only asked for existence, through `app.links`, which SwiftUI does not always use for a `Link`) |
| 3 | A second `run-all.command` reload aborted at step 1 ("A configured public source failed") | `refresh-public-corpus-local.mjs` read `fetched == 0` as a failure, but an unchanged feed answers 304 to the stored ETag (W4.4) — a successful run that reads nothing; LiveWhale and Localist did exactly that 20 minutes after the first load | `IngestResult.notModified` (from `fetchSourcesIsolated`), and the script accepts a type whose feeds all answered 304 | `discovery-e2e`: "runSource reports the 304 as notModified with no error" |
| 4 | Double-clicking `run-all.command` failed with "permission denied" (exit 126); so did `partner-detail-native.sh` | both were committed as `100644` from Windows | `100755` | `run-all-unit`: every tracked script with a `#!` line is committed `100755` |
| 5 | `run-all.command` refused to start: "Java 21 is required … (found: 1.8.0)" with Java 21 first on PATH | with no *registered* JDK 21 (Homebrew's `openjdk@21` is keg-only), `/usr/libexec/java_home -v 21` exits 0 and answers with the default JVM, which the script then put first on PATH | `functions/scripts/java21.sh`: every candidate (`tools/bin`, `tools/jdk`, `java_home`, both Homebrew prefixes) is asked for its version | `run-all-unit`: five checks with fake JVMs (8, 17, 21, non-executable, empty `java_home` answer) |
| 6 | A fresh stack had 14 active sources, not the 19 the reports measured (+157 events missing, Save The Bay among them) | `run-all.command` predates `activate-discovered-local.mjs`; its "sources found by discovery" step only seeded the config sources | the step replays the recorded discovery cycle after the seed | `run-all-unit`: the replay runs after the seed and before the For You accounts |
| 7 | The "counts" step printed nothing | its inline module ran from the repo root, where `firebase-admin` does not resolve, and `2>/dev/null \|\| true` hid the error | runs from `functions/`, failure printed | `run-all-unit`: every inline module runs from `functions/`; no silenced failure |
| 8 | `CoreLogicTests.testVolunteerSupplyReadsCompletePublicCorpusBeyondFirstDiscoveryPage` failed: 79 is not greater than 80 | the precondition was a fixed count standing in for "supply beyond the first discovery page" (`maxEvents` = 80 cards of every category); the live feeds listed 79 public volunteer events that day | the precondition is the property itself: some current volunteer listing lies outside the app's first-page query | the test |
| 9 | The Map kept a "Locating places…" spinner for up to 100 s with the places already on it (the walkthrough's "Map: still loading after 15 s") | the pill followed `placesService.isLoading`, which stays true while the four Overpass mirrors are asked (25 s each) even though the stored places — the area cache or the dated snapshot — are already shown; on 2026-10-25 every public mirror timed out from this network | the pill only shows while the map has nothing on it | `testJudgeWalkthrough`: every main screen settles within 15 s |
| 10 | `RewardsLiveCatalogTests.testStaffChangesStockExpiryAndAccountClearCachedRewards` failed every time it ran after a first run (3/3 alone, green in the full suite right after a reseed) — the "intermittent" unit test of the earlier reports | fixed perk ids and codes: a redeemed code can never be uploaded again, and the staff account's issued-code count grows by one per run | per-run offer ids and codes, the issued-code check counts from the account's baseline; `rewards-native-fixture.mjs` removes every offer of the fictional partner | the test, three times in a row with no reseed |
| 11 | `docs/FIRESTORE-INDEXES.md` stale after #3 (`check:indexes` failed) | the inventory records query locations; one added line moved `ingest/index.ts:381` to `:382` | regenerated with `--write-docs` (one line) | `check:indexes` |
| 12 | After a UI test run, the demo opened in the wrong city (Places, Map and distances followed the simulator's last position, Minneapolis after an offline test) | `run-all.command` never set the simulator's location; the UI tests set it per launch | the script sets the simulated GPS to the seeded launch area (SJSU) before launching | `run-all-unit`: the location is set, and before the launch |
| 13 | ⌘R in Xcode ran the app against the live, undeployed Firebase project, and the paywall launched by `run-all.command` cannot load the test subscriptions | the scheme loaded `Verdure.storekit` but passed no emulator flags | the scheme's run action passes `-QAUseFirestoreEmulator YES -QAEmulatorHost 127.0.0.1` (untick to use the live project) | the generated scheme; ⌘R with the stack running |
| 14 | On any Mac but the verified one, `run-all.command` could not build (it named one simulator by id) and a fresh clone had no `Secrets.xcconfig` or `GoogleService-Info.plist`, so xcodegen/xcodebuild failed before the app ran | the gitignored config files and the simulator id were assumed present | the script creates both files from their templates with emulator placeholders when missing (the API-key placeholder keeps the 39-character, leading-`A` shape Firebase Installations checks at launch; the first placeholder crashed the app with I-FIS008000), and falls back to the newest available iPhone simulator (`VERDURE_SIMULATOR` overrides) | run from a fresh clone of the submission repo: build, install, launch, app stays up; `plutil -lint` on the generated plist, `run-all-unit` 11/11, secret scan |

UI-test causes (the app was right; the tests acted too early or with momentum):

- **Taps lost after sign-in** (`DemoWalkthroughUITests`, the Plan tab and the Places segment
  did nothing). The test sent the app Home to dismiss the keychain "Save Password?" sheet; the
  recording shows the app blank on return and the signed-in feed landing ~50 s after sign-in on
  this machine, with the tap in the middle of it. Now: terminate and relaunch signed in (as the
  Journey and partner helpers already do), answer the location prompt, and act once the ranked
  For You slate — the feed's last read — has stopped changing.
- **Ranked card tapped off screen** (`testJudgeWalkthrough`, "Event detail: never appeared").
  The test scrolled while the slate was still loading, carried the card past the top before it
  existed, then tapped its off-screen frame. Now it waits for the card, then `QA.reveal`s it.
- **Taps during deceleration** (`JourneyTests` Curated Program: the poster tap opened nothing,
  4 s after a fling, with the card visibly still; the offline-pack test: Profile's Sign in did
  nothing after `QA.reveal` reached it with two flings — the second began while the first still
  coasted, the loop exited as the button passed through view, `QA.settle` needed ~5 s to see two
  equal frames, and the tap came 1.6 s later). A swipe coasts for seconds, its tail below what
  frame polling resolves, and a tap then only stops the scroll. New `QA.scroll` is a held drag
  that releases at zero velocity; `QA.reveal`, the walkthrough's `scrollTo`, the Curated poster
  positioning and every other scroll-then-tap site use it (Accessibility planner entry, the
  offline pack's Prepare, the Daily Gem tile, the partner Redeem). Swipes remain only where
  nothing is tapped next (screenshots).
- **Password field never focused** (`DemoWalkthroughUITests`). With the keyboard up, XCTest
  scrolled the password field into view itself and tapped while the form moved. Every sign-in
  helper now ends the email with Return, which closes the keyboard first (6 call sites).
- **Notifications row moved under the tap** (`LivePartnerConsentUITests`, "expected Adult-only
  nearby deals to appear" — the third "intermittent" UI test). The fixture account owns an
  approved organizer; that row loads after sign-in, grows from one line ("Become an Organizer")
  to two and pushes the rows below down. The recording shows the rows still moving at the tap.
  The test now waits for the organizer row, then positions and settles Notifications.
- **Tap 1 s after first render** (`JourneyTests.testInterestTuningFlow`, picker never opened;
  1 of 3 runs). The button now settles (`QA.waitUntilStable`, the helper written for exactly
  this) before the tap.
- **Event planner asked for "this weekend" on a Sunday afternoon**
  (`testEventPlannerSequencesRealEvents`, "Event plan: never appeared" after 14:30 on 2026-10-25).
  The planner answered, correctly, "Not enough real events fit yet": the test used the defaults
  ("This weekend", "Short drive"), which leave little late on a Sunday. It now picks "Tomorrow" and
  "Anywhere nearby" and checks they took.
- **Stale planner assertion** (`testAdventurePlannerShowsPlanWithWeatherCredit`). It expected
  the Mac engine's "… from where you started" intro; the merge kept the Windows engine
  (`adventure-engine.ts`, 62 unit checks, 11 hand-reviewed scenarios), whose intro opens with the
  plan's length and stop count. The assertion now checks that. The Mac's distance-home sentence is
  **not** in the merged engine — a deliberate merge outcome, recorded here rather than re-added.

Added for the handoff's screenshot list: `foryou-interests-e2e.mjs --keep` keeps one account per
interest pick (`foryou-pick-<pick>`, 8 new checks: each gets a top-10 card naming its own pick), and
`testForYouFollowsEachAccountsPicks` signs in to all ten accounts, one screenshot each.

## Results on the final code

Backend (`cd functions`, Java 21, one emulator suite at a time):

| Suite | Result |
|---|---|
| `npm run test:units` | classifier freeze ✓ · secret scan ✓ (5,471 files) · indexes ✓ · 17 suites green: fulfillment 15 · subscription 8 · ingest 240 · ranking 100 · ranking-v2 69 · notifications 31 · partners 38 · event-planner 26 · adventure-engine 62 · parks 81 · offline 24 · programs 34 · place-stories 34 · rank-eval 42 · discovery 162 · **run-all 10** |
| `npm run e2e` | **363 / 363** |
| `npm run redteam` | **96 attacks blocked, 0 vulnerable** |
| `npm run acceptance` | **64 / 64** |
| `npm run e2e:discovery` | **59 / 59** (Windows' 58 + the 304 check) |
| `node scripts/foryou-interests-e2e.mjs --keep` | **12 / 12** (Windows' 4 + one account per pick) |
| `./run-all.command --no-app` (full reload) | 19 active sources, 8,630 events; parks: city 614, county trails 1,744, county POI 852, city amenities 2,260, boundaries 37 |

iOS (iPhone 17 Pro, iOS 26.5; each UI class alone with `-parallel-testing-enabled NO`; emulators
loaded by `run-all.command`, website on port 3105). Result bundles and logs:
`../results-mac-2026-10-25/` (one line per run in `summary.txt`).

| Suite | Result |
|---|---|
| `VerdureTests` | **161 / 161, 0 skipped** (the connected Terms test ran against the local website) |
| `RewardsLiveCatalogTests`, three in a row, no reseed | **2 / 2** each run |
| `PartnerDiscoveryTests`, three in a row | **3 / 3** each run |
| `JourneyTests`, three in a row | **16 / 16** each run (the third run's result bundle failed to write for disk space after `** TEST SUCCEEDED **`) |
| `LivePartnerConsentUITests`, three in a row | **not proved** — 6 of 8 runs green on the final code; see below |
| `PartnerSurfaceTests`, three in a row | **4 / 4** each run |
| `AccessibilityAuditTests` | **15 / 15** |
| `TextSizeMatrixTests` | **10 / 10** |
| `PlaceStoryUITests` | **1 / 1** |
| `ExploreBetaUITests` | **1 / 1** |
| `OnboardingRegressionUITests` | **2 / 2** |
| `DemoWalkthroughUITests` | **6 / 6** on the final app code (12:01 run; the screenshots); on the final test code 5 / 6 in three runs, each failure diagnosed — the Demo Judge's monthly plans used up by earlier runs (u1, the test now says so), "this weekend" nearly over on a Sunday afternoon (v1, the test now asks for tomorrow), and the first onboarding tap lost while the Mac swapped 12 GB (x1) — fresh-install judge walkthrough, the key-less Adventure Planner with the Open-Meteo credit, the event planner, For You for ten accounts, the signed-in demo and its tour |

**Open: `LivePartnerConsentUITests` is not proved stable.** Runs on the final code: u1 ✓ u2 ✗ u3 ✓,
v1 ✓ v2 ✗ v3 ✓, w1 ✓ w2 ✓ (and s1–s3 ✓ before the last `QA.scroll` change). Both failures are the
same step: the tap on Profile → Notifications opens nothing. In both, the recording shows a settled
screen (the organizer row already loaded, nothing moving), the tap lands on the row's centre, the
row is fully tappable (`settingsRow` has `.contentShape(Rectangle())`), no system alert or overlay is
on screen, and the app's log has no presentation warning. Ruled out with evidence: the moving
organizer row (now waited for), momentum (no scroll before the tap), an occluding system sheet, and
state carried between runs (identical persisted preferences after a passing first and second run).
The cause is not found; the test is unchanged beyond the organizer-row wait, with no retry added.

## Screenshots (`demo-screens/`)

From `DemoWalkthroughUITests` on the final app code (the 12:01 run, 6 / 6), status bar 9:41, full resolution (1206 × 2622) as
JPEG quality 90 (the PNGs are 2.7 MB each; the lossless set is kept outside the repo):

- `01`–`20`: the judge walkthrough in order — onboarding, interests, sign-in, the Events feed and
  its reasons line, event detail with "Why you're seeing this" and feedback, Places, place detail
  with the OpenStreetMap credit (`11-credit-osm-place`), the Map with "© OpenStreetMap
  contributors · ODbL · data as of Oct 23, 2026", the four other tabs, Settings, Terms, the end
  of Terms with "Data and acknowledgements" (`19-credit-terms-end`), Privacy.
- `foryou-<pick>` for each of the eight interest picks, `foryou-student-trails` (Parks + Trails)
  and `foryou-community-sports`: each top card names its own pick.
- `planner`, `planner-plan`, `credit-weather` ("Weather data by Open-Meteo.com"), `planner-stops`
  (the key-less Adventure Planner); `planner-events` (the Plan tab's event planner).
- `demo-ready`, `discover`, `plan`, `friends`, `rewards`, `profile`: the signed-in Demo Judge tour.
- `park-guide-closed`: a source-backed park guide (closed status and attribution), from `JourneyTests`.

## Environment notes

- **Memory.** This Mac has 8 GB. With a browser holding ~5.7 GB the machine swapped 10–13 GB and
  disk fell to 121 MB free; then the Firestore emulator answered acceptance writes with
  `DEADLINE_EXCEEDED` after 15+ minutes, the discovery replay stalled, and onboarding pages took
  10 s each to draw. The same suites passed with it closed (acceptance 64/64 in 53 s, the replay in
  5.5 minutes). Close browsers before a full run. 6.5 GB of old build caches (`../dd`,
  `../dd-test`) were deleted with the owner's agreement; `../results` (Oct 22–23 bundles) was kept.
- **OpenStreetMap.** All four public Overpass mirrors timed out from this network on 2026-10-25
  (`overpass-api.de` included, with the app's User-Agent); places came from the dated snapshot.
- **The Demo Judge has five free plans a month.** Each `DemoWalkthroughUITests` run spends two
  (the Adventure Planner and the event planner), so a third run after a reseed is refused —
  correctly — with "Your monthly free plans are used". The test now says so instead of "Event
  plan: never appeared"; reseed with `./run-all.command --reload-only` (or
  `functions/scripts/demo-investor-local.mjs`) after two runs.
- **Run them alone.** `npm run test:units` started next to `acceptance` and `e2e:discovery` slowed
  the emulator into the same deadline failures; one emulator-backed suite at a time.
