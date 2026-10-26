# Verdure — CAC 2026 handoff: FINAL REPORT

Branch `cac-2026`. Work done 2026-10-24/25 on a **Windows machine with no Xcode**, against the
local Firebase emulators only. Nothing was deployed, pushed, purchased or flipped. No paid API
was used. Every Swift change in this report is **written but not compiled here**, every iOS
suite says **not run**, and there are **no new screenshots** — those three things need a Mac
and are listed under "What is not perfect" with exactly what to run.

**Mac pass, 2026-10-25 (`docs/MAC-VERIFICATION-2026-10-25.md`):** the Mac half of the handoff
is done. The Swift compiled after one fix, every iOS suite ran (each UI class alone, the
intermittent ones three times in a row — all but the partner-consent test, which stays open), `demo-screens/` holds the ordered screenshots, and the
backend final proof was rerun on the final code. Eleven defects were found and fixed, each with
the test that catches it; the 1.6 table and "What is not perfect" below carry the Mac results.

## How this branch relates to the Mac's work

The handoff described work on Rishit's Mac that never reached the team remote
(`appc/cac-2026` ends at `8fa3143`). It arrived later as `CAC-handoff-main.zip` (the Mac tree
as of 2026-10-23 19:45 PDT, no git history). By then items 1.1–1.5 had been built here from
`8fa3143`. The two were combined with a real three-way merge (`mac-handoff` branch =
the zip's tree on the shared base; merge commit `ada4950`):

| Area | Kept | Why |
|---|---|---|
| Swift (places, start-up, credit, UI-test helpers, new tests, pbxproj) | **the Mac's** | compiled and run on a Mac; mine never was |
| Ranking (`interests.ts`, `ranking.ts`, `ranking-v2.ts`) | **mine** + the Mac's Spanish branch-name stripping | tested against the loaded corpus and the handoff's acceptance criteria (50/50) |
| Adventure Planner engine and callable | **mine** + the Mac's `modelKey()` | implements the handoff's "last fix round" list with 62 unit checks and 11 hand-reviewed scenarios |
| Event planner fallback | **the Mac's** `sequenceEventsFallback` + a multi-day rule and 25 new unit checks | its same-day chaining and all-day handling are right for the real data; it shipped with no tests and produced one-stop plans when a day held one event |
| Discovery fixtures, careercenter adapter fixtures, demo/outdoor scripts, `.env.example` | **the Mac's** | |
| Secrets rules | the Mac's `.gitignore` (functions/.env ignored) + my scan gate + `ensure-env.mjs` | brief-compliant and still non-interactive on a fresh clone |

## Commits on this branch

| Commit | Item | Summary |
|---|---|---|
| `12d42fb` | 1.1 | For You personalized: labels understood, precise matching, interest retrieval, match-first order |
| `ca74814` | 1.2 | Adventure Planner works with no AI key: deterministic engine, hours, sunset, heat, rain |
| `2ab1dd6` | 1.3 | False "AI" claims removed (privacy policy, listing, StoreKit copy, comments) |
| `3b95b85` | 1.4 | OpenStreetMap: mirrors, per-area cache, snapshot, parallel start-up loads (Swift later superseded by the Mac's) |
| `c238ad6` `cc0de18` `769c2dd` | 1.5 | Secrets out of the tree, scan gate, keyed providers tested, new-repo procedure |
| `a7ca6e1` | 1.7 | `run-all.command` and a planner UI test (the latter later superseded) |
| `a9030d6` | 1.6 | planner picks follow the ranking, Google Maps intake, acceptance reasons check, E2E planner checks |
| `6d54d15` `ada4950` | merge | the Mac tree and its three-way merge |
| `8edea91` `9c463d9` | 1.6 | museum terms fixture (discovery-unit 160/160), CLAUDE.md |
| `6f1734a` `3a36929` `0e42149` | 1.6 / 1.1 cause 5 | live discovery recording, five sources, corroboration rule, fresh corpus, www fallback, same-time alternatives |
| `6d5e431` | — | final suite numbers (Windows) |
| (Mac pass) | Mac | compile fix, OSM credit above the tab bar, map pill, `run-all.command` fixes, 304 reloads, test fixes, screenshots, Mac numbers (`docs/MAC-VERIFICATION-2026-10-25.md`) |

---

## 1.0 Recover and reload

- Clean tree; fast-forwarded to `appc/cac-2026`; no half-finished edits in this clone (the
  Mac's drafts came via the zip and were merged as above). Backend built clean.
  `xcodegen generate` and the simulator build need a Mac: **not run**.
- Emulators: Firestore on 8899 with Java 21, via `node functions/scripts/sprint-emulators.mjs --config-only`.
- Data reloaded through the real pipeline:

| Data | Count (2026-10-25) | Command |
|---|---|---|
| events (public feeds, live) | **8,035** created: bibliocommons 7,385 · livewhale 342 · localist 181 · libcal 61 · midpen 57 · legistar 9 | `node functions/scripts/refresh-public-corpus-local.mjs <report.json>` |
| of which in the next 14 days | 2,048 | |
| park catalog (live) | **5,507** features: city-parks 614 · city-amenities 2,260 · county-trails 1,744 · county-poi 852 · county-boundaries 37 | `node functions/scripts/parks-local.mjs --live` |
| outdoor / volunteer sources | see 1.1 cause 5 | discovery, below |

- Exported to `../emulator-data` (35 MB). `run-all.command` starts the emulators with
  `--import ../emulator-data --export-on-exit`, so a restart never wipes the data, and keeps
  the Mac awake with `caffeinate -dims`.

## 1.1 Personalization (For You) — P0

**Root cause, confirmed in code:** the app stores interests as PlaceCategory labels
(`Parks`, `Trails`, `Gardens`, `Playgrounds`, `Waterfront`, `Sports`, `Scenic`, `Community`)
while both rankers only knew a lower-case vocabulary (`outdoors`, `fitness`, `volunteering`…).
`INTEREST_TO_CATEGORY["parks"]` was `undefined`, so the interest term was **0 for every event
for every real user** and For You was ordered by distance, timing and quality alone — hence
random sports events for Community and career workshops for Parks + Trails (the student floor
then lifted workshops to 0.75 against everybody else's 0). The build has no "Volunteering"
option; `Community` maps to community + volunteering.

Fixes (`functions/src/interests.ts`, `ranking.ts`, `ranking-v2.ts`):

1. **Labels understood** — `normalizeInterests` maps every PlaceCategory label to server terms;
   both rankers and the reasons builder go through it. Stored server terms still pass through.
2. **Candidate pool** — `interestCandidates`: per distinct interest set, the next 14 days of
   events whose `topicTags` or specific categories speak to the picks (≤ 150 + ≤ 100 docs,
   cached 5 min per interest set, shared by every user with the same picks). New composite index
   `events: areaId, active, topicTags (CONTAINS), date` (both the Mac and this branch added it;
   collapsed to one). `docs/READ-BUDGET.md` updated.
3. **Interest vs distance** — weights interest **0.16 → 0.20**, distance **0.24 → 0.20** (others
   unchanged), and a direct match **orders above every non-match** (`rankEvents` sorts on
   `parts.interestMatch`, then score). Still "rank, never filter": nothing is dropped, distance
   orders within each group, a user with no picks gets the pure score. The student floor still
   lifts opportunities (0.75 / 0.9) but can no longer beat a direct match. A pick's *primary*
   meaning (hiking for Trails, waterfront for Waterfront) leads its shared outdoors matches.
4. **False matches** — matching is phrase-based on the title, the frozen classifier's
   *specific* categories (Cleanup, Volunteer, Sports, Market, Hackathon), and an allow-list of
   whole feed tags; description phrases, umbrella feed labels ("Health & Fitness") and
   lift-only categories (Festival for Community) raise the score (0.8) but never count as a
   match or earn a reason. Venue, branch and organizer names are stripped first (Mitchell Park
   Library, Greenhouse Community Room, Educational Park, "biblioteca Rose Garden"). Bare words
   that produced the false matches are gone: park, garden, walk, social, community, civic,
   nature, bay, reservoir, roses, game, summit, ridge. A lecture *about* a topic is not the
   activity. Catch-all categories (Workshop, Social, Meetup) never match.
5. **Supply** — see the discovery section below.
6. **Exploration slot** — the 10th card is the only off-interest card, labelled in `parts`
   (`exploration: 1`) **and carries its own reason** the card shows: "Something different —
   outside your picks". It prefers quality, then score.

Also fixed in passing: **v1 series collapse** (a recurring listing was three identical cards;
now one card with `moreDates`, the later dates move to the end of the list, nothing dropped);
the reasons line **names the user's own pick** ("Because you like Parks") and is emitted only
on a direct match (a stored server term reads as "family activities"); the client's offline
fallback map drops the catch-all categories (`Trails → Sports + Meetup` was how career events
reached a Parks + Trails user with the backend down). Changing interests re-ranks at once
(the user document is read fresh per request; the pool cache is keyed by the interest set).

**Before → after** (fresh account at the launch-area centre, 2,048 events in the next 14 days;
`docs/PERSONALIZATION-REVIEW-2026-10-25.md`, evidence `docs/evidence/personalization-2026-10-25.json`):

| Pick | matching events in 14 d | pool before → after | matches in pool before → after | top-10 matches |
|---|---|---|---|---|
| Parks | 28 | 272 → 367 | 11 → 24 | 9 (+ exploration) |
| Trails | 28 | 272 → 367 | 11 → 24 | 9 |
| Gardens | 52 | 270 → 365 | 12 → 25 | 9 |
| Playgrounds | 957 | 272 → 340 | 94 → 154 | 9 |
| Waterfront | 30 | 272 → 367 | 11 → 24 | 9 |
| Sports | 71 | 272 → 420 | 18 → 58 | 9 |
| Scenic | 31 | 272 → 367 | 12 → 27 | 9 |
| Community | 306 | 272 → 417 | 94 → 140 | 9 |
| Parks + Trails (student) | 28 | 272 → 367 | 11 → 24 | 9, **0 career/hackathon** |

Before the fix the interest term was 0 for every label. Pairwise overlap of the top 10:
Parks + Trails vs Community **1**, Sports vs Community **1**; outdoor picks overlap each other
(Parks vs Waterfront 10) because the corpus holds few waterfront-specific listings — the
waterfront-specific ones lead. Manual review of every top 10: **zero false matches** after
three rounds (removed on the way: South Bay Needlepointers → Waterfront via "bay"; a
geothermal "Reservoir" seminar; "The Songs of Nature" exhibit; "Open Lab Hours at AI Center
for Civic…"; "Cinema Sunday: Yellow Rose" → Gardens; "Monday Meditation" → Sports via a
"Health & Fitness" tag; a drag-story-time *lecture* → Playgrounds).

Tests: `ranking-unit` **52 → 99**, `ranking-v2-unit` 69, `personalization-e2e.mjs` **50/50**
on the populated emulator, the Mac's `foryou-interests-e2e.mjs` (callable level; its `--keep`
accounts feed `DemoWalkthroughUITests.testForYouFollowsEachAccountsPicks`), Swift
`CoreLogicTests.testFallbackMappingAvoidsCatchAllCategories` (not run). `ranking.version` stays **v1**.

## 1.2 Adventure Planner (free, no AI key)

`functions/src/adventure-engine.ts` (pure, 62 unit checks) builds the itinerary from the same
candidate allowlist the model would get; `planAdventure` uses it whenever no key exists and
falls back to it if a model call fails (`modelKey()` reads the key without a warning per plan).
Rules, each tested: member-only organisations are never stops; posted OSM hours honoured **at
arrival**, a stop never runs past its closing (an earlier stop is cut short to reach a later
one; a two-stop plan keeps a "quick look" that ends at closing and says so); at most one stop
with unposted hours, none outdoors after dark, no trail after dark; a pick's own category beats
distance and each pick gets a stop when one exists; 85 °F caps outdoor stops at 45 min, 95 °F
at 30 and lets an indoor stop in as "a break from the heat"; rain prefers shelter, avoids
trails and sitting down, ends indoors; plain outdoor stops finish before sunset (Open-Meteo
supplies sunrise/sunset), a sunset spot or indoor stop goes last; nearest-neighbour order,
travel deducted, **never over the minutes asked**; phrase pools with no phrase repeated and
**no invented facts** (no benches, lawns, loop paths, views or swings); a sparse area plans;
"everything nearby is closed at this hour" is said instead of invented.

`docs/PLANNER-REVIEW-2026-10-25.md`: eleven scenarios on **real City of San José parks** from
the ingested catalog (hours fixture-supplied and labelled), each reviewed by hand; **11/11**
after three fix rounds (the review lines record the first draft's faults).

`planEvents` with no key: the Mac's `sequenceEventsFallback` (best-ranked anchor, same-day
chain with travel legs, all-day listings, concrete reasons) plus a rule that continues onto
later days when the anchor's day holds fewer than two stops. The client shows the planner's
notes and the server's own sentence on a precondition failure; "Weather data by Open-Meteo.com"
is unchanged and the response carries the attribution too.

Planner UI test: the Mac's `DemoWalkthroughUITests.testAdventurePlannerShowsPlanWithWeatherCredit`
(no skip) — **not run here**.

## 1.3 Remove false "AI" claims

Privacy policy (`Legal.swift` and the website's `legal.ts`, identical, the Mac's wording):
AI is used only when configured; otherwise plans are built on Verdure's own servers with no AI
provider. `AppStore/LISTING.md` says the planner works with no key. `Verdure.storekit` no longer
says "AI planner, AR adventures" (prices, tiers, features unchanged). Code comments stop calling
it "AI". `git grep` for `AI planner|AI Adventure|optional AI|AI-powered` over user-facing files: **0**.

## 1.4 Nearby places (OpenStreetMap)

The Mac's `OpenStreetMapData.swift`: `OverpassClient` with the identifying user agent
`Verdure/1.0 (+https://verdure-app.com)`, four mirrors in order with a 25 s request and
resource limit each (a 200 with a "too busy" remark counts as a failure), per-area
`OSMAreaCache`, and the **bundled snapshot** `Resources/osm-snapshot-san-jose.json` — the
app's own query captured live 2026-10-23 17:50Z, 9 km around the launch-area centre, 693
elements (332 named: 207 parks, 38 paths, 38 water, 19 gardens, 14 sports centres, 11
community centres, 2 viewpoints), used only when no mirror answers and nothing is cached.
The credit reads "© OpenStreetMap contributors · ODbL · data as of <date>" wherever `osm-`
places are on screen; `NearbyPlacesTests` and `DataCreditTests` cover it (not run here).
`InitialLoad.start` runs the places and events loads together (the ~22 s wait is gone).
`Verdure/scripts/build-osm-snapshot.py` (the Mac's) rebuilds the snapshot from a live Overpass answer
or a Geofabrik extract. Overpass itself was unreachable from this network all day (502 "all
query workers are busy" from overpass-api.de and its backends; connection timeouts from the
mirrors), so no fresh capture was possible here; the Mac's capture stands.

## 1.5 Secrets and config

- `Verdure/Secrets.xcconfig`, `Verdure/Verdure/GoogleService-Info.plist`, `functions/.env`,
  `functions/.secret.local`, `functions/.env.local`, `*.p8` are ignored and untracked; the
  `.template` / `.env.example` files stay tracked. `functions/scripts/ensure-env.mjs` copies
  `.env.example` to `.env` at the start of every build so a fresh clone's emulators stay
  non-interactive.
- The new NPS and Recreation.gov keys live **only** in `Verdure/Secrets.xcconfig` and
  `functions/.secret.local`; both answer 200 live. Without a key NPS answers 403 and RIDB 401,
  which the app never sees: a missing key means no request (`PlacesAPIService` guards;
  `ingest-unit` proves an NPS source with no key resolves to an empty list without fetching).
- `functions/scripts/check-no-secrets.mjs` (`npm run check:secrets`, first in `test:units`):
  shape-based scan of every tracked file plus a refusal of any tracked secret file;
  `--history` scans every commit on every branch.
- History: the two burned keys appear **3 times each** in this clone's history (with the old
  Firebase browser key and a SerpApi-style key); the new NPS key **0** times and in **0**
  tracked files. `docs/NEW-REPO-PUSH.md` is the clean-history push procedure (an orphan first
  commit of the current tree, scan, push only when Rishit says so).
- `GoogleService-Info.plist` `GOOGLE_APP_ID` and `Secrets.xcconfig` `FIREBASE_GOOGLE_APP_ID`
  both read `1:350584206981:ios:d008b84adbc0f34bd29bec`.
- The handoff document still holds the two key values; replace them with "sent to developer".

## 1.6 Tests

All backend numbers below are from the final code on this branch, run 2026-10-25 03:09–03:17 UTC on the local emulators (Windows, Java 21). Every suite rebuilt first.

| Suite | Result | Command |
|---|---|---|
| Backend units | **16 suites green**: fulfillment 15 · subscription 8 · ingest 240 · ranking 100 · ranking-v2 69 · notifications 31 · partners 38 · event-planner 26 · adventure-engine 62 · parks 81 · offline 24 · programs 34 · place-stories 34 · rank-eval 42 · discovery 162; classifier freeze ✓, secret scan ✓ (5,426 tracked files), indexes ✓ (49 checks) | `cd functions && npm run test:units` |
| Backend E2E | **363 / 363** (was 356/357 before the merge fixes) | `npm run e2e` |
| Red team | **96 attacks blocked, 0 vulnerable** (was 95/1: the Google Maps intake gap) | `npm run redteam` |
| Acceptance | **64 / 64**, all eight steps (was 55/61 at the start of this work) | `npm run acceptance` |
| Discovery E2E (replay of the 2026-10-25 recording) | **58 / 58** | `npm run e2e:discovery` |
| Live discovery recording | 2,357 responses · 149 hosts · 120 inspections · 5 activated | `npm run e2e:discovery:record` (1 h 52 min) |
| Personalization acceptance | **50 / 50** on the loaded corpus (after the new sources) | `node scripts/personalization-e2e.mjs` |
| For You demo accounts (the Mac's check) | **4 / 4** | `node scripts/foryou-interests-e2e.mjs --keep` |
| Planner review | **11 / 11** scenarios, hand-reviewed | `node scripts/planner-review.mjs` |
| iOS unit (`VerdureTests`) | **not run** here (no Xcode) — Mac: see below | `docs/MAC-HANDOFF-2026-10-25.md` § 1 |
| iOS UI, each class alone | **not run** here — Mac: see below | idem |
| Fresh-install walkthrough + screenshots | **not done** here — Mac: see below | `DemoWalkthroughUITests` |

**Mac, 2026-10-25, on the final code** (Xcode 26.5, iPhone 17 Pro / iOS 26.5; full detail in
`docs/MAC-VERIFICATION-2026-10-25.md`):

| Suite | Result |
|---|---|
| Backend units | **17 suites green** (the 16 above + `run-all` 10); classifier ✓, secret scan ✓ (5,471 files), indexes ✓ |
| Backend E2E · red team · acceptance | **363 / 363** · **96 blocked, 0 vulnerable** · **64 / 64** |
| Discovery E2E | **59 / 59** (the 58 above + the 304 check) |
| For You accounts | **12 / 12** (the 4 above + one account per pick) |
| `VerdureTests` | **161 / 161, 0 skipped** |
| `RewardsLiveCatalogTests`, `PartnerDiscoveryTests` | three in a row each, green (Rewards fixed: it could not run twice) |
| `JourneyTests`, `PartnerSurfaceTests` | **16 / 16** and **4 / 4**, three in a row each |
| `LivePartnerConsentUITests` | **not proved**: 6 of 8 runs green; two lost Notifications taps, cause not found (open) |
| `AccessibilityAuditTests` · `TextSizeMatrixTests` · `PlaceStoryUITests` · `ExploreBetaUITests` · `OnboardingRegressionUITests` | **15 / 15** · **10 / 10** · **1 / 1** · **1 / 1** · **2 / 2** |
| `DemoWalkthroughUITests` | **6 / 6** on the final app code; 5 / 6 in each of three later runs on the final test code, every failure diagnosed (planner quota, a Sunday-afternoon weekend, a tap lost under 12 GB of swap); screenshots in `demo-screens/` |

The intermittent tests the Windows pass could not check: `RewardsLiveCatalogTests` failed every
time it ran after a first run (fixed codes; now per-run), the Curated Program and partner taps were
lost to scroll momentum, re-renders and a moving row (fixed in the tests: held drags, settle waits,
waiting for the row), and the partner-consent Notifications tap is still lost in some runs with no
cause found — recorded, not hidden.

## 1.7 Ready to record

`run-all.command` (repo root) does the whole stack in one double-click on the Mac — see its
header. `../emulator-data` holds the export it imports. **Run on the Mac 2026-10-25** after four
fixes (executable bit, Java 21 pick, the discovery replay, the counts step) and the 304 fix in
`refresh-public-corpus-local.mjs`; a full reload gives 19 active sources and 8,630 events.

---

## Discovery recording run and outdoor/volunteer sources (1.1 cause 5, 1.6)

`npm run e2e:discovery:record` ran live for 1 h 52 min (2026-10-25 00:50–02:41 UTC): **2,357 responses from 149 hosts**, 120 inspections against the daily budget of 300, candidates from four origins (corpus links 10, OpenStreetMap organisations 1,119, organizer URLs 0, the model URL list 28 — the 27 South Bay outdoor/parks/volunteer hosts added in `functions/discovery/model-urls.json` plus the career centre). Stanford's Localist API sample, the Children's Discovery Museum and evols.org were recorded afterwards so the replay can decide them. Fixtures: `functions/test-fixtures/discovery/live-2026-10-25` (43 MB, `MANIFEST.json` label).

| Outcome | Hosts | Detail |
|---|---|---|
| **Activated** | 5 | `savesfbay.org` (wordpress-tec, 6 volunteer plantings), `careercenter.sjsu.edu` (rss-ics, 23), `allcove.org` (wordpress-tec, 127), `abilitypath.org` (ics, 1 → 0 in area), `bayvp.org` (wordpress-tec, 1) |
| Rejected | 115 | 101 "no feed, API or schema.org Event data found"; 9 RSS present but not a feed this sprint can read; 2 restrictive terms (ACTIVE Network, Atria); the City legistar feed "9 upcoming but none inside the radius (0 with coordinates)"; 2 "no upcoming event in 0 sampled" — every one with evidence in `docs/evidence/discovery-cycle-2026-10-25.md` |
| Unknown | 1 | `evols.org`: sitemap lists no event pages; re-inspect monthly (removed from the model list so the replay has zero unknowns) |
| Refused before inspection | 4 + 9 | deny-listed or malformed hosts; `sccgov.org` still answers nothing at all (robots.txt unreadable → never active) |

Of the 27 outdoor hosts proposed, **one** publishes something the pipeline can read (Save The Bay, WordPress + The Events Calendar). scvas.org, valleywater.org, sanjoseparks.org, ourcityforest.org, keepcoyotecreekbeautiful.org, happyhollow.org, yosemite.org and the rest publish no feed, API or schema.org Event data — a parser cannot fix that; a human has to ask them for a calendar feed (the same conclusion as `docs/FEED-SURVEY-SAN-JOSE.md`).

`functions/scripts/activate-discovered-local.mjs` replayed the recorded cycle on the data emulator: **active sources 14 → 19, +157 events** (`docs/evidence/discovery-live-2026-10-25.json`).

**Outdoor supply before → after** (`outdoor-supply.mjs`: Midpen, Cleanup, or a non-library title naming a hike/trail/walk/preserve/cleanup…, events with coordinates):

| Radius / window | Before | After | Why unchanged |
|---|---|---|---|
| 15 mi / 14 d | 9 (all Midpen) | 9 | Save The Bay's listings carry **no coordinates** (the wordpress-tec adapter has no venue geocoding), so a distance-based count cannot see them |
| 25 mi / 14 d | 20 (all Midpen) | 20 | same |

Where the new events do show: For You. A Parks + Trails account's top 10 now includes "Native Planting at Mountain View A2W!" (Save The Bay) at position 5 — `personalization-e2e` 50/50 and the Mac's `foryou-interests-e2e` 4/4 after the reload; per-pick matching events over 14 days moved Parks 28 → 30, Gardens 52 → 54, Waterfront 30 → 32, Scenic 31 → 33, Sports 71 → 81, Community 306 → 350 (`docs/PERSONALIZATION-REVIEW-2026-10-25.md`).

One thing the new sources exposed and this branch fixed: allcove's "senses and sensibility: glitter jars" arrived classified **Cleanup** by the frozen classifier and read "Because you like Parks" for a Parks account. On auto-discovered sources a category match now needs corroboration (title phrase, allow-listed tag or description); config sources keep trusting the classifier. Test in `ranking-unit`.

## What is not perfect, and exactly why

1. ~~No Swift compiled, no iOS test run, no screenshots, flakes unproved~~ — done on the Mac
   2026-10-25; see the Mac table in 1.6 and `docs/MAC-VERIFICATION-2026-10-25.md`.
2. **The Mac engine's "… km from where you started" intro is gone.** The merge kept this
   branch's planner engine, whose intro gives the plan's length and stop count; the Mac's UI
   test was updated to that. Re-adding a distance-home sentence would be an engine change with
   its own review, not a fix.
3. **Live OpenStreetMap was unreachable on 2026-10-25** — all four public Overpass mirrors timed
   out from the Mac's network, so every place on screen came from the dated snapshot
   (2026-10-23), with its date beside the credit. The Map no longer spins while that happens.
4. **History not purged in this clone** — `docs/NEW-REPO-PUSH.md`.
5. **Hosts that refuse automated access** — Santa Clara County Parks, City of San José and
   SCU still return 403 and need a human to ask; see the discovery section.
6. **The 8 GB Mac needs everything else closed for a full run.** With a browser holding ~5.7 GB
   the machine swapped 13 GB: the Firestore emulator answered acceptance writes with
   `DEADLINE_EXCEEDED` after 15+ minutes (2 hours, 6 "failures") and app pages took 10 s to draw.
   The same suites passed with it closed (acceptance 64/64 in 53 s). Close browsers first.
