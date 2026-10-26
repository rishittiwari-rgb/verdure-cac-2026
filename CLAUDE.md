# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Verdure is a community-centered iOS app that revives outdoor spaces and strengthens local connections through gamified exploration, personalized recommendations, and local event boards. It features a Pokémon GO-style collection system where users collect places and attend events to earn points redeemable for gift cards. Tagline: **"Step Outside. Connect Within."**

## Target Audience

- Adults (21–40), Students (13–20), Parents (any age)

## Repository Structure

```
Verdure Logo.png           — Brand logo (compass + leaf)

Verdure/                   — Xcode project container (XcodeGen)
  project.yml              — XcodeGen spec (name/target/bundle = Verdure)
  Verdure.xcodeproj        — Generated project
  Secrets.xcconfig         — Firebase project id / SerpApi key (gitignored)
  Verdure/                 — SwiftUI app source
    VerdureApp.swift       — @main App + RootView (owns state, drives light/dark color scheme)
    Theme/
      VerdureTheme.swift   — "Warm Forest" palette (adaptive light + dark), clay tokens, Fredoka/Rubik type ramp, spacing, radii
    Resources/Fonts/       — Fredoka + Rubik static weights (bundled via UIAppFonts)
    Models/
      Models.swift             — Place, Event, Challenge, DailyGem, CommunityPost, etc.
      CollectionModels.swift   — PlaceRarity, CollectiblePlace, Reward, RewardTier
      GameStateManager.swift   — @Observable game state (UserDefaults + Firestore sync)
      AuthService.swift / FirestoreService.swift — Firebase Auth + Firestore
      PlacesAPIService.swift / EventsAPIService.swift — live places/events (adult-aware queries)
      FunctionsService.swift / EconomyService.swift / SocialService.swift — callable wrappers
      StoreService.swift       — StoreKit 2 (Verdure+ product ids)
      LocationManager.swift    — CLLocationManager wrapper
      SampleData.swift         — QA fixtures ONLY: injected when `SampleData.isEnabled` (DEBUG + `-QAOfflineData YES`); compiled out of Release
    Components/
      ClayKit.swift            — claymorphism primitives: ClayBackground/claySurface, ClayButton, ClayChip, ClayIconTile, ClayProgressBar, KickerLabel, ClaySectionHeader, Haptics
      ClayMotion.swift         — gyro ParallaxTilt, Shimmer, IdleFloat, AmbientGlow, SoftGrain, VerdureBackground, RiseIn
      VerdureMedallion3D.swift — SceneKit 3D compass-leaf medallion (+ faux-3D ClayMedallion)
      SharedComponents.swift   — VerdureButton, CategoryPill, StatCard, AvatarCircle, NeonProgressRing, PlacePlaceholder, etc. (all clay)
      RarityBadge.swift        — RarityBadge/PointsBadge/RarityDot + rarity/category/tier → clay accent mappings
    Views/
      MainTabView.swift        — 5-tab clay floating tab bar (Discover, Plan, Friends, Rewards, Profile);
                                 Discover has three modes (Events, Places, Map); Collection lives under Profile
      Onboarding/OnboardingView.swift — clay onboarding w/ 3D medallion hero
      Discovery/, Events/, Explore/ (ExploreView, PlaceDetailView), Map/MapExploreView.swift + DailyGemView.swift
      Collection/ (CollectionView, CollectionCelebrationView)
      Social/, Community/CommunityView.swift, Notifications/, Moderation/, Legal/, Paywall/
      Profile/ProfileView.swift, Rewards/ (RewardsStoreView, RewardConfirmationView)
    Assets.xcassets/         — AppIcon (compass-leaf on clay-cream), VerdureMark imageset
  VerdureTests/ , VerdureUITests/ — unit, journey and accessibility suites (need Xcode)

functions/                 — Cloud Functions (TypeScript, Node 20). ALL point math and ingestion live here
  src/index.ts             — callables (checkInToEvent, collectPlace, redeemReward …) + every re-export
  src/secrets.ts           — the shared defineSecret() declarations (others live in the module that uses them)
  src/ingest/              — event ingestion: areas.ts (launch areas + the sourcing rule), sources-config.ts (seeds),
                             sources-registry.ts (/sources collection + ABSOLUTE deny-list), sources/<adapter>.ts (13 adapters),
                             normalize.ts + classify.ts (FROZEN), annotate.ts (adultOnly + topicTags), store.ts (listing
                             checks, fuzzy dedupe, write-only-on-change), health.ts, ics.ts
  src/discovery/           — W4 automatic source discovery: http.ts (bounded fetch, record/replay), robots.ts, terms.ts,
                             inspect.ts (platform fingerprinting), decide.ts (six rules + evidence), discover.ts
                             (five origins incl. OpenStreetMap/Overpass, /sourceCandidates queue, daily + weekly jobs,
                             intake), removal.ts (requestSourceRemoval / removalToken endpoints, /removedHosts)
  src/ranking.ts           — v1 ranker + the config/ranking switch;  src/ranking-v2.ts — v2 (off by default)
  src/interests.ts         — CAC 2026: app interest labels → server terms, precise phrase/category/tag matcher (both rankers and reasons use it)
  src/adventure-engine.ts  — CAC 2026: the deterministic Adventure Planner (no model key needed); src/model-key.ts reads the optional key
  src/subscriptions.ts, fulfillment.ts, adventure.ts, eventPlanner.ts, notifications.ts, social.ts, organizers.ts,
  partners.ts, staff-*.ts, parks/, offline/, programs.ts, place-stories.ts, moderation.ts, account.ts
  scripts/                 — unit suites, emulator E2Es, baseline, migrate-sources, seed-review-account … (see npm commands)
  seed/ranking-config.json — the config/ranking seed (added this sprint by the ranking workstream)
  discovery/model-urls.json — the model-supplied URL list, one discovery origin
  test-fixtures/           — recorded feed samples and the 11,603-record corpus; tests never touch the live internet
  .env                     — NON-secret config (sandbox defaults); secrets go through functions:secrets:set
docs/                      — surveys, audits, baselines, sprint reports, READ-BUDGET.md, GO-LIVE-CHECKLIST.md
reference/verdure-discovery/ — John's Python engine, staged for porting (read-only)
firestore.rules / firestore.indexes.json / storage.rules — ship with the feature that needs them
```

### Backend rules that are not conventions

- **Sourcing rule** (`functions/src/ingest/areas.ts`, `docs/FEED-SURVEY-SAN-JOSE.md`): parse public feeds and open data freely; never scrape a source whose terms prohibit it; a 403 is a recruitment target, not a parsing target. **Deny-list is absolute** (`sources-registry.ts` `DENIED_DOMAINS`): Google Maps/Places, Meetup, Facebook/Instagram, Eventbrite, ACTIVE Network are refused in code regardless of what any `/sources` document says.
- **Frozen classifier** (`docs/audits/classifier-freeze-2026-10-03.json`): `ingest/classify.ts`, `normalize.ts` and the bibliocommons / localist / livewhale / libcal adapters are byte-pinned to commit `d4b71507`. `npm run check:classifier` fails on any change; `test:units` runs it first. New behaviour goes in `annotate.ts` or a new file.
- **Indexes and rules land with the feature**: `npm run check:indexes` inventories every query shape in `src/` against `firestore.indexes.json` (`docs/FIRESTORE-INDEXES.md`).
- **Sources are data**: ingestion reads only `/sources` documents with `status == "active"`; staff read, only server code writes. Server-owned collections: `/sources`, `/sourceCandidates`, `/rejectedListings`, `/removalRequests`, `/removedHosts`, `/discoveryRuns`, `/discoveryCache`, `/sourceSubmissions`, `config/ranking`.

### Backend commands (`cd functions`)

| Command | What |
|---|---|
| `npm run build` | `tsc` into `lib/` (every E2E builds first) |
| `npm run check:classifier` / `npm run check:indexes` | the two gates above |
| `npm run test:units` | gates (classifier freeze, **secret scan**, indexes) + build + 17 unit suites (fulfillment, subscription, ingest, ranking, ranking-v2, notifications, partners, event-planner, **adventure-engine**, parks, offline, programs, place-stories, rank-eval, discovery, **run-all**: executable scripts + Java 21 pick + reload steps) |
| `npm run check:secrets` | `check-no-secrets.mjs`: no key material or secret file in any tracked file (`--history` scans every commit) |
| `node scripts/personalization-e2e.mjs` / `foryou-interests-e2e.mjs` | For You acceptance per interest pick on the loaded emulator (writes `docs/PERSONALIZATION-REVIEW-<date>.md`) / the callable-level check whose `--keep` accounts the demo UI test uses |
| `node scripts/planner-review.mjs` | regenerates the 11 Adventure Planner scenarios (`docs/PLANNER-REVIEW-<date>.md`) |
| `node scripts/outdoor-supply.mjs`, `discover-outdoor-local.mjs` | outdoor/volunteer supply count and OSM-organisation discovery on the emulator (CAC 2026, 1.1 cause 5) |
| `python3 Verdure/scripts/build-osm-snapshot.py overpass <answer.json> <fetchedAt>` | rebuilds `Verdure/Verdure/Resources/osm-snapshot-san-jose.json` (the dated OpenStreetMap starting cache) from a live Overpass answer or a Geofabrik extract |
| `npm run e2e` / `npm run redteam` | full emulator E2E / attack suite (auth, functions, firestore, storage emulators) |
| `npm run e2e:ingest` / `npm run e2e:sources` | ingest write-path metering / `/sources` registry E2E (firestore emulator only) |
| `npm run baseline` | corpus replay + measurements, writes `docs/BASELINE-*.json` |
| `npm run migrate:sources:emulator` | seed `/sources` from config on the emulator; `node scripts/migrate-sources.mjs --live` for production (refuses without the flag) |
| `node scripts/discovery-e2e.mjs` (under `emulators:exec`) | W4 discovery/removal/self-healing E2E; `--record` for the one live fixture run |
| `npm run acceptance` | sprint acceptance script (`scripts/sprint-acceptance.mjs`) on the firestore emulator; results in `docs/ACCEPTANCE.md` |
| `npm run seed:review` | `seed-review-account.mjs <uid>` for App Review |
| `npm run ingest:smoke`, `coverage`, `coverage:emulator`, `corpus:local`, `public-feed:check`, `backfill:emulator-test`, `seed:partners` | diagnostics and local seeds |

Emulator ports are in `firebase.json` (firestore 8899; 8080 wedges on this machine). Only one process may run the emulators at a time.

## How to Run the App

```bash
open Verdure/Verdure.xcodeproj
```
Select an iPhone simulator and press Cmd+R. Requires Xcode 15+ (iOS 17 target).

If you add new `.swift` files, regenerate the project:
```bash
cd Verdure && xcodegen generate
```

## Build Command

```bash
cd Verdure && xcodebuild -project Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

Dependencies: Firebase (Auth + Firestore) via SwiftPM. Fonts (Fredoka, Rubik) are bundled. Otherwise SwiftUI, SceneKit, MapKit, CoreLocation, CoreMotion, PhotosUI.

## Design Language — "Warm Forest" Claymorphism

The app's visual system mirrors the Verdure website: **claymorphism** with a sage-cream/forest-green palette. Supports **light (default)** and **dark** (deep-evergreen clay) modes; toggle in Profile → Settings.

### Claymorphism rules (non-negotiable)
- **One light source, top-left, everywhere.** Inner gloss highlight offset top-left, inner depth shadow bottom-right, plus a soft outer float. On press, clay sinks IN (inner shadows invert, float collapses). Implemented in `ClayKit.ClayBackground` via SwiftUI `.shadow(.inner(...))` on a gradient fill + stacked outer `.shadow`.
- **Restraint.** Clay is for objects users press or that read as physical (buttons, cards, tiles, chips, wells). Backgrounds and long text stay flat.
- **Depth hierarchy.** Bigger/softer floats for hero cards (`elevation` param), tighter for chips.

### Palette (`VerdureTheme.swift`, all adaptive)
- **Silica/cream** `#E6E8D4` (light canvas) / deep evergreen `#0A140F` (dark canvas) — dominant surface
- **Teal** `#16BFA5` — bright clay accent (dark text)
- **Spruce** `#14532D` — primary CTA / heading accent (light text)
- **Gold** `#B8860B` — warm accent + points (dark text)
- **Evergreen ink** `#0E1B16` — body text; also the dark "wallet/stat" clay tile
- Category & rarity map to these accents (see `RarityBadge.swift` extensions).

### Typography
- **Display: Fredoka** (chunky rounded) — hero + short section headers only. `VType.display(...)`
- **Body/UI: Rubik** — everything else. `VType.body(...)`, `VType.num(...)` for tabular stats.

### Motion (no generic fade-up)
- Physical springs with overshoot (`back.out`-like), weighted `riseIn`/`idleFloat`, gyro `parallaxTilt`, shimmer, particle bursts, the map radar sweep, and the SceneKit medallion idle-spin/drag.

## Architecture

- **Color scheme:** `RootView` (in `VerdureApp.swift`) owns `@AppStorage("prefersDarkMode")` and applies `.preferredColorScheme` — kept in a View (not the App struct) so toggling updates reliably.
- **State:** `GameStateManager` (`@Observable`, `.environment()`-injected) persists to UserDefaults + syncs to Firestore.
- **Dual currency:** XP = progression (levels); Points = spendable (gift cards).
- **Rarity:** 4 tiers (Common 5 / Uncommon 10 / Rare 25 / Legendary 50 pts). Events are the primary earner (75–250 pts).
- **Proximity:** real GPS via `LocationManager`; collection requires <500 ft. Event check-in requires proximity + proof-of-attendance photo (verification is placeholder).
- **No fallback to fabricated content:** live screens show honest empty states. `SampleData` is injected only when `SampleData.isEnabled` is true (DEBUG build + `-QAOfflineData YES`, the UI-test harness); in Release the branch is compiled out, and `GameStateManager` refuses to collect or check in to any sample id under any code path.
- **Adult-only gating:** every stored event carries `adultOnly` (never missing) and `topicTags`; rules deny minors and signed-out clients any `/events` query without `adultOnly == false`, and the client duplicates that filter (`EventsAPIService.swift`).

## Backend / External

- **Firebase** project is `connectify-19dd8` (Auth + Firestore + Functions + Storage). Bundle id `com.verdure-app.verdure` (the plist mismatch was fixed 2026-07-20 by CLI re-registration).
- **Events come from Firestore only**: scheduled `ingestCivic` / `ingestTicketed` read the active `/sources` for each launch area (San Jose / South Bay), run the frozen classifier, annotate, listing checks, fuzzy dedupe, and write only what changed. No vendor key ships in the iOS bundle.
- **Discovery** (`src/discovery/`): `discoverSources` daily finds new hosts from five origins (corpus links, OpenStreetMap via Overpass, probing, organizer calendar URLs + the `sourceIntake` endpoint, the model URL list), inspects at most 300/day, decides with six evidenced rules and activates sources with no human approval; `recheckSourcesWeekly` pauses on tightened robots/terms; `requestSourceRemoval` / `removalToken` remove a host on request (published-token guard above 100 active events). Fetches record/replay fixtures so no test reaches the live internet.
- **Ranking**: v1 (`ranking.ts`) is live; v2 (`ranking-v2.ts`) is behind `config/ranking` and stays off until the blind judge.
- The paid steps to go live, with costs, owners and verification commands, are in `docs/GO-LIVE-CHECKLIST.md`.

## ⚠️ DEPLOY STATUS — re-verified against the live project 2026-08-09

Do not infer deploy state from changelog prose. E2E "37/37 green" is the **local
emulator**, not production. Live facts, re-checkable any time with the command below:

| Component | Live status (2026-08-09) |
|---|---|
| Firestore rules | ✅ **DEPLOYED** — ruleset `43d80b64…`, sha256 of live source matches `firestore.rules` byte-for-byte, updated 2026-07-29T01:32Z |
| Cloud Functions | ❌ **NOT DEPLOYED** — 0 functions exist (v1 and v2 APIs both empty) |
| Cloud Storage | ❌ **NO BUCKET** — Storage never initialised in console |
| Billing plan | ❌ **Spark** (`billingEnabled: false`) — Functions *cannot* deploy until Blaze |

**The backend stack is Firebase, not Supabase.** Supabase is the *marketing
website* only (kept in a separate repository, not here). The iOS app has zero Supabase code:
its SwiftPM deps are FirebaseAuth/Firestore/Functions/Storage and it ships a
`GoogleService-Info.plist`. There is no migration branch, stash, or plan. Do not
act on a belief that the app moved to Supabase — it did not.

**Consequence while Functions are down:** check-ins/collects apply optimistically on
device and queue in `pendingOps` forever; nothing is server-credited, no proof photo
uploads (no bucket), and `/attendance` audit rows are never written. The queue is
durable and replays automatically once the backend is live — no data is lost.
`GameStateManager.serverConfirmed` guards against the cloud's empty balance
overwriting those local earnings (see `CloudMergeTests`).

Re-verify live state at any time:
```bash
# prints billing plan, deployed function count, storage buckets, and diffs the
# live Firestore ruleset against firestore.rules
npx firebase-tools projects:list        # confirms auth
npx firebase-tools deploy --only functions --non-interactive   # errors if still Spark
```

## GO-LIVE RUNBOOK — run in this order

The full ordered list with costs, owner roles and a verification command per
step (Apple Developer, Blaze + budget alert, bucket, all 12 secrets, deploy order
incl. indexes, `config/ranking` and `/sources` seeds, App Store Connect products,
APNs, review account, TestFlight, first-week checks) is
`docs/GO-LIVE-CHECKLIST.md`. The short form below is kept for orientation;
the checklist wins where they differ (it also lists `TICKETMASTER_KEY` and
`SERPAPI_KEY`, and the `firestore:indexes` deploy step).

Everything below is written and tested against the emulators; step 1 is the only
one a human must do in a browser, and nothing after it can run until it's done.

```bash
# 1. HUMAN, IN THE CONSOLE (billing decision — cannot be scripted):
#    a) console.firebase.google.com → connectify-19dd8 → Upgrade → Blaze
#    b) Build → Storage → "Get Started" (creates the bucket)
#       Set a budget alert while you're there; Blaze is pay-as-you-go.

# 2. Secrets. Deploys succeed without these, but the features stay inert:
#    each one is read via defineSecret and simply reports "not configured".
cd functions
npx firebase-tools functions:secrets:set TREMENDOUS_API_KEY            # gift cards
npx firebase-tools functions:secrets:set TREMENDOUS_FUNDING_SOURCE_ID
npx firebase-tools functions:secrets:set TREMENDOUS_CATALOG            # {"starbucks-5":"<product id>", ...}
npx firebase-tools functions:secrets:set APPLE_IAP_PRIVATE_KEY         # .p8 CONTENTS
npx firebase-tools functions:secrets:set APPLE_IAP_KEY_ID
npx firebase-tools functions:secrets:set APPLE_IAP_ISSUER_ID
npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY             # adventure planner
npx firebase-tools functions:secrets:set RECREATION_GOV_KEY            # places proxy
npx firebase-tools functions:secrets:set NPS_API_KEY

# 3. Deploy. Rules first — they're the lockdown the callables assume.
cd ..
npx firebase-tools deploy --only firestore:rules
npx firebase-tools deploy --only storage
npx firebase-tools deploy --only functions

# 4. VERIFY IT ACTUALLY LANDED (do not trust step 3's output alone):
#    functions should be non-empty, buckets non-empty, billingEnabled true.
#    The same read-only REST checks that produced the table above.
npx firebase-tools functions:list
```

Then: point App Store Server Notifications V2 at the deployed
`appStoreNotifications` URL, set `APPLE_APP_APPLE_ID` in `functions/.env`, flip
`APPLE_IAP_ENVIRONMENT` to `production` at launch, and work through
`DEVICE-QA.md` on two real phones.

## Test evidence (2026-09-13)

Every number below is produced by the command next to it. None of it is a
deploy claim — see DEPLOY STATUS above, which is unchanged and unverified since
2026-08-09.

| Suite | Result | Command |
|---|---|---|
| iOS unit | **100 / 100** | `cd Verdure && xcodebuild -project Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test -only-testing:VerdureTests` |
| iOS UI + a11y | **26 / 26** | same, `-only-testing:VerdureUITests` |
| Backend unit | **199 / 199** | `cd functions && npm run test:units` |
| Backend E2E (emulator) | **275 / 275** | `cd functions && npm run e2e` |
| Red team | **48 attacks blocked, 0 vulnerable** | `cd functions && npm run redteam` |
| Live feed ingest | **1,057 events, 5 sources** | `cd functions && node scripts/ingest-smoke.mjs` |
| Corpus coverage | reports whatever it is, exit 0 | `cd functions && npm run coverage:emulator` |

`npm run e2e` and `npm run redteam` now run `npm run build` first. They did not
before, so they executed against whatever was last compiled into `lib/` — an
edit to a `.ts` file followed by `npm run e2e` tested the PREVIOUS build and
passed. Treat any green from before 2026-09-13 with that in mind.

Later evidence supersedes this table: `docs/HALFWAY-REPORT-2026-10-18.md`
section 3 (2026-10-18/19: units 633 across 12 suites, E2E 357/357, red team 63
blocked, ingest write-path 33, sources 30; iOS suites **not run**, no Mac) and
`docs/SPRINT-REPORT-2026-10-20.md` for the final sprint numbers. Anything
reported on a Windows machine without Xcode says "not run" for iOS, never
"passing".

## What Needs to Be Done (Backend & Beyond)

- [ ] **Work `docs/GO-LIVE-CHECKLIST.md` top to bottom** — Apple Developer ($99/yr), Blaze + budget alert, bucket, secrets, deploy (rules → storage → indexes → functions), seeds, products, APNs, review account, TestFlight, first-week checks. Each row carries its cost, owner role and verify command. Nothing on it has been started.
- [ ] **Upgrade Firebase project to Blaze + enable Storage** — the ONLY human-gated step; everything below is written and waiting. Re-verified 2026-08-09: still Spark, still 0 functions, still no bucket.
- [ ] Deploy rules + storage + **indexes** + functions (see checklist), then re-verify live state and update DEPLOY STATUS from the read-backs
- [ ] Seed `config/ranking` (`functions/seed/ranking-config.json`) and `/sources` (`node scripts/migrate-sources.mjs --live`) after the first functions deploy
- [ ] Record the live discovery fixtures once (`node scripts/discovery-e2e.mjs --record` under `emulators:exec`) so the W4 E2E replays offline; run the W6.1 blind judge before `config/ranking.version` moves to `v2`
- [x] ~~Build and run the iOS suites on a Mac~~ — done 2026-10-22 (`docs/MAC-VERIFICATION-2026-10-22.md`): unit 143 + 1 skipped, UI 48/48; and for branch `cac-2026` on 2026-10-25 (`docs/MAC-VERIFICATION-2026-10-25.md`): unit 161/161, every UI class green alone (the partner-consent test 6 of 8 runs, open), screenshots in `demo-screens/`
- [ ] Create the two Verdure+ subscriptions in App Store Connect (`com.verdure-app.verdure.plus.monthly` / `.yearly` — local testing uses `Verdure/Verdure.storekit` via the Verdure scheme)
- [ ] **Real-device QA (2 phones)** — script written at `DEVICE-QA.md`; needs hardware. Runs 2 and 3 also need the backend live.
- [ ] Fund a Tremendous account + map reward ids → product ids (`TREMENDOUS_CATALOG`); flip `TREMENDOUS_ENV=production` in `functions/.env`
- [ ] APNs Auth Key (.p8) → Firebase Cloud Messaging, and Push Notifications capability on the App ID (code is done; nothing delivers without these)
- [ ] Once Functions are live: add the Verdure+ 1.25x multiplier to `PaywallView.features` AND the store description in the same commit (both files carry the instruction)
- [x] ~~Server-side subscription check~~ — done (`functions/src/subscriptions.ts`)
- [x] ~~Real gift-card fulfillment~~ — done (`functions/src/fulfillment.ts`, Tremendous)
- [ ] **Create the App Review demo account** — `appreview@verdure-app.com` (the address the script expects), then `node functions/scripts/seed-review-account.mjs <uid>`. Blocked on Functions being live (points are server-authoritative; a client cannot mint them). Without it a reviewer cannot reach the redemption flow at all.
- [ ] **Recruit the three South Bay organizers that block us** — City of San José, Santa Clara University and **Santa Clara County Parks** (~28 parks) all return 403 to server-side requests; SCC Parks blocks `robots.txt` too, so its terms cannot even be read. These need a human to ask, not a better parser. See `docs/FEED-SURVEY-SAN-JOSE.md`.
- [ ] **Watch the Midpen adapter** — it parses HTML because no feed exists, so a site redesign breaks it. It throws loudly by design; make sure someone sees the ingest source error when it does.
- [ ] Consider a real `Outdoors` event category — guided hikes currently classify as `Sports`, which is the closest fit in the existing taxonomy but not what a user filtering Sports expects. App-wide taxonomy change.
- [ ] **Replace the placeholder partners with real agreements** — `functions/scripts/seed-partners.mjs` seeds three fictional businesses and refuses to run outside the emulator. No partner agreement exists yet.
- [ ] Real photos (AsyncImage + CDN) to replace clay icon placeholders
- [ ] Real social features (follows, per-user feeds)
- [ ] Dynamic Type app-wide (scaled variants exist in VType; check-in, paywall, empty states, and all surfaces added 2026-09-13 adopted)
- [x] ~~Personalized recommendations~~ — done (`functions/src/ranking.ts`); interests were collected and read by nothing before it
- [x] ~~Event notifications~~ — done (`functions/src/notifications.ts`); `sendEventReminders` was an empty stub behind a daily schedule
- [x] ~~Partner perk UI~~ — done; the server system existed with no client
- [x] ~~Product analytics~~ — done (`Analytics.swift`, `/analytics/{yyyy-mm-dd}/events`)

## Changelog

- **2026-10-25 (Mac)** — **The Mac half of the CAC 2026 handoff: compiled, every suite run, screenshots.** Full account in `docs/MAC-VERIFICATION-2026-10-25.md` (Xcode 26.5, iPhone 17 Pro / iOS 26.5, local emulators only). App fixes: the Windows-written `ForEach(plan.notes, id: .self)` did not compile (`\.self`); the OpenStreetMap credit on place detail sat under the floating tab bar (bottom padding 48 → 110, like every other tab screen); the Map's "Locating places…" pill spun for up to 100 s over places already shown while the Overpass mirrors timed out (it now shows only on an empty map). Stack fixes: `run-all.command` and `partner-detail-native.sh` were committed non-executable; the Java pick put Java 8 first when `java_home -v 21` fell back (`functions/scripts/java21.sh`); the discovery step never replayed the recorded cycle (14 active sources, not 19); the counts step failed silently; a second reload aborted on an unchanged feed's 304 (`IngestResult.notModified`). Test fixes, each with its recorded cause: a fixed-count precondition, a non-rerunnable Rewards test (per-run offers and codes), and UI taps lost to momentum, re-renders and moving rows (held drags, relaunch after sign-in, settle waits — no sleeps, no retries). New `run-all-unit` suite (10 checks); For You keeps one account per pick for `demo-screens/foryou-<pick>.jpg`. Final code: units 17 suites green, E2E 363/363, red team 96/0, acceptance 64/64, discovery 59/59, For You 12/12, iOS unit 161/161 (0 skipped), every UI class green alone, `JourneyTests` and `PartnerSurfaceTests` three times in a row; `LivePartnerConsentUITests` is **not proved** (6 of 8 runs green — a Notifications tap is sometimes lost, cause not found; open in the verification doc).

- **2026-10-25** — **CAC 2026 handoff (branch `cac-2026`): personalization, key-less planner, OpenStreetMap resilience, secrets out of the tree.** Full report in `FINAL-REPORT.md`; the Mac's parallel work (CAC-handoff-main.zip, 2026-10-23) was merged three-way (`ada4950`). **1.1 root cause:** the app stores interests as PlaceCategory labels ("Parks") and both rankers knew only a lower-case vocabulary, so the interest term was 0 for every real user. `src/interests.ts` normalises labels and matches by title phrases, the classifier's SPECIFIC categories and allow-listed feed tags (description phrases and umbrella labels only lift); venue/branch names are stripped; a direct match orders above every non-match (rank, never filter); interest-keyed retrieval adds the next 14 days of the user's kind of event to the pool (new index `events: areaId, active, topicTags, date`); weights interest 0.16 → 0.20, distance 0.24 → 0.20; the reasons line says "Because you like Parks"; slot 10 is the labelled exploration card; v1 collapses series. **1.2:** `adventure-engine.ts` plans with no key (member-only skip, hours at arrival, one unposted stop, heat caps, rain, sunset, never over budget, no repeated phrases, no invented facts); `planEvents` has a real deterministic plan. **1.3:** "AI" claims reworded (privacy policy, listing, StoreKit copy). **1.4:** four Overpass mirrors (25 s each), per-area cache, bundled dated snapshot, places and events start together. **1.5:** Secrets.xcconfig, GoogleService-Info.plist, functions/.env and .secret.local are ignored; `check:secrets` gates the build; `docs/NEW-REPO-PUSH.md` is the clean-history push. **Not done here (Windows, no Xcode):** no Swift compiled, no iOS suite run, no screenshots; see FINAL-REPORT.md.

- **2026-10-20** — **Final sprint: annotation, minor protection, ranking v2 staged, automatic source discovery, go-live checklist.** Full report with every number in `docs/SPRINT-REPORT-2026-10-20.md` (written by the orchestrator); halfway evidence in `docs/HALFWAY-REPORT-2026-10-18.md`. Built and verified on the local Firebase emulator on Windows: **nothing deployed, purchased or flipped, and no Swift compiled** (no Mac), so every iOS change is reported as not run. **W1:** every stored event carries `adultOnly` (never missing; structured age fields first, errs toward true — 36.5 % of the recorded corpus, almost all adult library programs) and John's 19 `topicTags` (`ingest/annotate.ts`); his `validate.py` blocking rules → `/rejectedListings` (30-day expiry), his `dedupe.py` fuzzy pass (Jaccard ≥ 0.7, 30 min, same venue or 0.25 mi), and **write-only-what-changed** (content hash, 24 h refresh): an unchanged ingest run went from 8,675 writes to 18. The six classifier files stay byte-frozen (`npm run check:classifier`). **W2:** rules deny minors and signed-out clients any `/events` read without `adultOnly == false`; client queries, social, parks, planners, notifications and ranking all carry the filter; client creates must send `adultOnly` and may not set server fields. **W3:** `ranking-v2.ts` ported from John's engine (product rules, constraints, feedback affinity with 30-day half-life, first-shown novelty, notify eligibility) behind `config/ranking`, v1 still serving; reads per feed open measured at 371 cold / 7 warm against `docs/READ-BUDGET.md`. **W4:** sources are data — `/sources` with an absolute in-code deny-list (Google, Meetup, Facebook/Instagram, Eventbrite, ACTIVE), `migrate-sources.mjs` seeds it (refuses a live run without `--live`); `discovery/` inspects hosts from five origins (corpus links, OpenStreetMap via Overpass, probing, organizer URLs + intake, model URL list), decides with six evidenced rules, activates with no human approval, re-checks weekly, pauses after three failures or a sudden zero, treats a 304 as a free successful run, and honours removal requests (`requestSourceRemoval` / `removalToken`, published-token guard above 100 active events, `/removedHosts` never rediscovered). Three new adapters (wordpress-tec, jsonld, rss-ics). Documented deviation: public institutions (.edu/.gov/.us, library platforms) pass the terms rule with the matched clause recorded, because the literal rule would reject SJSU, SJPL and the career centre. **W7:** `docs/GO-LIVE-CHECKLIST.md` — every paid step in order with cost, owner role and verify command; this file and `README.md` brought back in line with the code (five tabs, not six; `SampleData` gated behind `isEnabled`, not a fallback; backend modules, collections, scripts and commands listed). Halfway suites: units 633, E2E 357/357, red team 63 blocked, ingest write-path 33, sources 30 — all emulator, none a deploy claim.

- **2026-09-13 (follow-up)** — **Streak freeze made universal; Midpen replaces NPS; scraping rule corrected.** The streak freeze was already free; the TEST now pins that as a tripwire (universal terms, fixed allowance with no tier dimension, and no paywall string may mention it) rather than describing an absence of code. Verdure+ is **four benefits** — unlimited planner, early perk access, cash gift cards, **advanced stats** — and advanced stats is now genuinely gated, because advertising it otherwise repeats the Gold/Platinum mistake; the four headline numbers stay free and only the category breakdown and 30-day rhythm are behind it. The member badge drops off the sold list (still real, just not a reason to pay). **`nps.parkCodes` stays empty but the category is no longer thin:** new `sources/midpen.ts` ingests Midpeninsula Regional Open Space District — **57 live events, 56 with coordinates, 19 preserves all inside the radius**, against Cuyahoga Valley's 39 events at one park. The NPS adapter stays for a future market. Midpen parses HTML because they publish no feed, and **permission was established before the adapter was written** (robots.txt allows `/events`; their terms contain no prohibition on automated access) — it throws rather than returning `[]` when the markup changes, because a silent zero would let the staleness sweeper drain the outdoor category. **Santa Clara County Parks is excluded on evidence:** sccgov.org 403s every request including `robots.txt`, so its rules cannot be read; it is a recruitment target, not a parsing target. The ingest rule is now recorded in `ingest/areas.ts` and the survey doc: **parse public feeds and open data freely; do not scrape a source whose terms prohibit it**, with Google Maps/Places and Meetup as standing exceptions — for Google also because seeding this corpus from Google would invalidate `coverage-check.mjs` along with the product claim.

- **2026-09-13** — **Sprint: correctness, personalization, notifications, perks, measurement.** Every item in the sprint doc landed; nothing was cut. **The tree as pulled did not compile** — two breaks in the app target and one in the test target, the last being the real cause of the reported "48 tests, down from 55" (the target wasn't building, so those tests were never run, not lost). **A1:** the client reward catalog was **35x underpriced** (1,000 pts shown for a card the server charges 35,000 for), the comment claiming it mirrored `REWARD_COSTS` was false, and six `active: false` rewards were browsable but permanently un-redeemable. Repriced, pruned, and the **server catalog is now the single source of truth** (`EconomyService` → `listRewardsCatalog`); the local array is DEBUG-only fallback, and `RewardCatalogParityTests` reads `functions/src/economy.ts` from Swift so either list changing alone fails the build. **A2:** the paywall and LISTING.md both sold the $25/$50 tiers the server refuses — replaced with what ships, planner first. **A3:** the Adventure Planner had **no economic gate** (30/hour meant one free account could bill 720 Anthropic calls a day forever); now 5/calendar-month for free users, checked and incremented in ONE transaction, with a distinguishable error that routes to the paywall **without losing the in-progress request**. **A4:** launch area **Cleveland → San Jose**, which was not a coordinate swap: both South Bay library systems run **BiblioCommons, not LibCal, and neither publishes iCal** (SJPL's `.ics` is a hard 404), so a third adapter was written — SJPL 6,477 events and SCCLD 2,106, with branch coordinates **in the feed**. Survey with re-runnable probes in `docs/FEED-SURVEY-SAN-JOSE.md`. **B:** `ranking.ts` — nothing read `users/{uid}.interests` before this; six weighted signals, **rank never filter**, with `recommendFor()` shared by C and E so no second ordering can drift. **C:** `sendEventReminders` was an empty function body behind a daily schedule; replaced by a ranked digest gated four ways (prefs, quiet hours, 2/week claimed transactionally, a floor of 5 qualifying events), server-side preferences, priming that never spends the one iOS prompt without explaining first, and deep links **that survive cold launch**. **D:** partner perks had a complete server system and no UI; `FunctionsService` was also discarding the perk code the server returns, which made the flow impossible to finish. **E:** partner surfacing where the trust rules are enforced in types — `friends_activity` is not in the `SurfaceId` union, so placing a perk there is a compile error — and free/Plus get identical placements. **F:** first-party analytics (behavioural data cannot be backfilled) and a coverage script with **no threshold and exit 0**, so nobody can tune a threshold instead of the corpus. **G:** streak insurance (one forgiven day per 30, deliberately **not** purchasable), friends-going in the planner, real stats from persisted earn history, a friends leaderboard whose scores are client-unwritable — plus **three false privacy-policy claims** removed, including one the sprint flagged (student status, never collected) and two this sprint's own work made untrue. **H:** privacy labels updated for the analytics that now exist, a demo account the reviewer can actually use (a fresh account has zero points and cannot reach the redemption flow at all), Dynamic-Type-safe empty states, and a11y audits for the new surfaces — one of which caught a real Voice Control defect (a button labelled "My redeemed codes" while showing "My Codes"). **Three bugs found in passing:** SerpApi hashed event ids on the **UTC** date, so on the West Coast an evening event would ingest twice; my own BiblioCommons adapter trusted `isGeocoded` and silently discarded correct coordinates for **2,106 events** (SCCLD sets the flag on no branch); and **`npm run e2e` never built**, so it had been testing stale `lib/` output — a vacuous-green generator, now fixed.

- **2026-08-09** — **The backend's two dead ends closed; planner + push added.** Re-verified live state: **still Spark, 0 functions, no bucket** — the checklist was right and the changelog prose was wrong, so check-ins have been queuing on-device for three weeks and nothing has ever been server-credited (no data lost; `pendingOps` is durable). Also settled a live misconception: **the iOS app has never used Supabase** — that's the marketing website; the app is 100% Firebase. Two features that shipped as no-ops are now real: **gift-card fulfilment** (`fulfillment.ts`, Tremendous — trigger + 30-min sweeper drain `/fulfillments`, idempotent on `external_id`, permanent failures refund points and un-redeem the reward, $25+ holds for manual approval) and **Verdure+ entitlement** (`subscriptions.ts`, App Store Server API + Server Notifications V2 write `plusExpiresAt`, which `hasActivePlus` reads and nothing previously wrote — so the 1.25x multiplier and Plus early access were inert for paying members). Ownership binding uses a **uid-derived `appAccountToken`** (RFC 4122 v5), so there's no stored field to overwrite and a replayed transaction id computes the wrong token. New **AI Adventure Planner** (`adventure.ts` + `AdventurePlannerView`): Claude picks from a candidate allowlist of real nearby places, weather from Open-Meteo (no API key), and **any stop it invents is dropped server-side** — grounding is mechanical, not a prompt instruction. **Push notifications** wired (FirebaseMessaging, APNs bridge, token stored per-user and removed on sign-out). Three real bugs fixed: `externalFetch` read `process.env` secrets it never declared, so both place providers would have returned "not configured" **in production only**; the new server-written `plus*` fields would have tripped the user-doc `hasOnly()` allowlist and permanently locked users out of their own document (the exact failure the rules comment already warned about); and `defineString` params made `npm run e2e` hang on an interactive prompt (fixed with `functions/.env`). `fcmTokens` now bounded at 10 — it's client-writable and fanned out to by `onPostCreated`. Push token lifecycle wired end to end (the settings toggle now actually registers with APNs; token attaches on sign-in and detaches on sign-out — otherwise a shared phone keeps receiving push for the previous account), and Restore Purchases falls back to the server's verified entitlement when StoreKit returns nothing. Tests: **backend E2E 48/48** (was 37), **23 new backend unit checks** incl. a golden vector pinning the `appAccountToken` derivation, **iOS 55/55** incl. a new a11y audit for the planner. `DEVICE-QA.md` written — the 2-phone field script, still unrun, and honestly marked as such.

- **2026-07-21** — **Backend E2E-proven + everything hardcoded made real.** New Local-Emulator E2E suite (`npm run e2e` in functions/; firebase-tools@13, firestore emulator on port 8899 — 8080 wedges on this machine; Firestore over gRPC only): **25/25 green** covering storage ownership/image rules, checkIn proof+GPS validation & haversine rejection & clamps & idempotency, attendance audit, rules lockdown, redeem lifecycle, and the new post-like rule (+1-only, deployed). Fabrications removed app-wide: real daily **streak** (foreground-day tracking), real **challenges** (monthly progress from a persisted earn-history) and **badges** (unlock dates persisted, real notifications) via `GamificationEngine`; Community rebuilt fake-free (real authors→stories, real trending from post places, real counts, Firestore-backed likes with per-device dedupe, honest member sheets, samples never mixed into real feed); notifications inbox no longer seeded — persisted real entries only; places carry **real coordinates** (collectibles/map no longer hash-scattered), **real photos** (NPS/RecGov/OSM via AsyncImage), real OSM hours when present ("typical" clearly labeled otherwise), and **no synthetic ratings/review counts/attendee counts anywhere**; PlaceDetail Share/Directions/Save all work (save persisted), events-at-place matched from live events; reward confirmation copy honest (email delivery, no fake code). **Dynamic Type enabled globally** at the VType ramp. Tests: 16/16 XCTest (incl. new streak/challenge/badge suite). Firestore rules redeployed.

- **2026-07-20** — **Attendance evidence + honest paywall + tests.** Check-in now demands real proof: GPS proximity gate in EventDetailSheet (CoreLocation vs. event coords — source-provided or geocoded; hard 500 ft gate when the venue is known), proof photo spooled to Application Support and uploaded to Storage (`proofs/{uid}/{digest}.jpg`) during queue flush, and `checkInToEvent` now REQUIRES proofPath + lat/lng server-side (path-ownership check, best-effort existence check, ≤1.5 km haversine vs. stored event coords, `/attendance` audit log). Events carry optional `latitude/longitude` (rules-validated; community events geocode at creation; Eventbrite/Localist/Commons parse source coords; sample events seeded). Legacy event backfill dropped (nothing honest to submit). Fixed the Firebase bundle-ID mismatch via CLI re-registration (`apps:create` + new GoogleService-Info.plist — warning verified gone in launch logs). Paywall now sells ONLY live benefits (Premium Rewards + new profile member badge); roadmap features removed from sale copy. `VType.scaled*` Dynamic Type variants added (check-in + paywall adopted). New VerdureTests target: 10 passing transaction-logic tests (double check-in/collect no-ops, fast double-redeem, proof spooling, queue persistence + v1 decode, reset). Firestore rules redeployed. Functions/Storage deploys still blocked on Blaze + console Storage setup.

- **2026-07-19** — **Server-authoritative points + personalization + Verdure+.** Points/check-ins/redemptions now go through Cloud Functions callables (`checkInToEvent`, new `collectPlace`, `redeemReward` w/ real REWARD_COSTS); GameStateManager applies earns optimistically and reconciles via a persisted pending-op queue (offline-safe, idempotent replays, legacy backfill on first connect). Firestore rules deployed with production lockdown (client writes to points/checked-in/redeemed denied; zero-on-create). FirebaseFunctions added to SwiftPM. Daily Gem reworked into a once-per-day fun-fact splash (generic nature/community/environment facts, no repeats until pool exhausts — `DailyGemStore`). New "For You" personalized events section (interest→event-category mapping + in-app interest picker). Paid events removed (Ticketmaster/SeatGeek providers off; Eventbrite/Localist filtered to free). Verdure+ subscription via StoreKit 2 (`StoreService`, clay `PaywallView`, `Verdure.storekit` scheme config; Gold/Platinum reward tiers gated). VoiceOver pass on check-in, redeem, and onboarding flows.

- **2026-06-17** — **Verdure rebrand + full visual overhaul.** Complete rename Connectify → Verdure (project, target, scheme, bundle id `com.verdure-app.verdure`, source folder, all symbols/strings). New "Warm Forest" claymorphism design system (`VerdureTheme` + `ClayKit` + `ClayMotion`), Fredoka/Rubik bundled fonts, real SceneKit 3D compass-leaf medallion, clay floating tab bar, and every screen rebuilt in clay (light + dark). New app icon from the compass-leaf logo. Old neon/"Bio" component library removed.
