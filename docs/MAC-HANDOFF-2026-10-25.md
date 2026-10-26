# Handoff to the Mac — what to run, in order (2026-10-25)

> **Done on the Mac, 2026-10-25** — results, the eleven fixes and every deviation are in
> `docs/MAC-VERIFICATION-2026-10-25.md`. Two corrections to the commands below: Xcode 26.5 has no
> "iPhone 16 Pro" simulator (use `name=iPhone 17 Pro` or a device id), and
> `PartnerSurfaceTests` runs directly (`QA.launch` sets the simulated location), without
> `partner-detail-native.sh`. Screenshots are `demo-screens/*.jpg` (full resolution, JPEG 90).

For whoever picks up branch `cac-2026` on a Mac with Xcode (the agent or the person). Everything
below is what could NOT be done on the Windows machine that produced this branch. The full
account of what was done and why is `FINAL-REPORT.md`; this file is only the to-do list for
the Mac, with the exact commands and what "done" looks like for each. Read the "Rules" first.

## Rules for this branch (from the handoff doc)

- No new features or redesigns: bug fixes and making existing features work as designed.
- No deploy. No push to the **team's new repository** until Rishit says so (the push to
  `lalubalu/appc` is the owner's own remote and has been made). No paid APIs, no Anthropic key.
- Never commit keys. `Verdure/Secrets.xcconfig`, `GoogleService-Info.plist`, `functions/.env`
  and `functions/.secret.local` are ignored; `npm run check:secrets` fails the build on any key.
- Do not touch the six frozen classifier files (`npm run check:classifier`).
- Every fix: root cause + a test that would have caught it. No skipped tests, sleeps or
  retry-until-pass. Commit after each finished item.

## 0. Get the tree and the local secrets

```bash
git clone https://github.com/lalubalu/appc.git verdure && cd verdure && git checkout cac-2026
cp Verdure/Secrets.xcconfig.template Verdure/Secrets.xcconfig          # fill: Firebase ids (see below), NPS_API_KEY, RECREATION_GOV_KEY
# GoogleService-Info.plist: download it for iOS app 1:350584206981:ios:d008b84adbc0f34bd29bec
#   (Firebase console → connectify-19dd8 → Project settings → Your apps → com.verdure-app.verdure)
#   and put it at Verdure/Verdure/GoogleService-Info.plist. FIREBASE_GOOGLE_APP_ID in Secrets.xcconfig must be that id.
printf 'NPS_API_KEY=<key>\nRECREATION_GOV_KEY=<key>\n' > functions/.secret.local
cd functions && npm install && npm run build && npm run test:units && cd ..     # must be green; the build creates functions/.env from .env.example
```

The two provider keys are the ones Rishit issued (the handoff doc should now say "sent to
developer"); the old ones in this repository's history are burned and must not be reused.

## 1. Compile and run the iOS suites (nothing here has ever been compiled)

```bash
cd Verdure && xcodegen generate && cd ..          # picks up the new Swift files; the pbxproj in the tree is the Mac's from 10-23
# Emulators with the exported data, in a second terminal (Java 21 first on PATH):
./run-all.command --no-app                       # or: node functions/scripts/sprint-emulators.mjs   (+ data scripts, see run-all.command)
cd Verdure
xcodebuild -project Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
xcodebuild -project Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test -only-testing:VerdureTests
for c in JourneyTests AccessibilityAuditTests TextSizeMatrixTests LivePartnerConsentUITests PartnerSurfaceTests PlaceStoryUITests ExploreBetaUITests DemoWalkthroughUITests OnboardingRegressionUITests; do
  xcodebuild -project Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test -only-testing:VerdureUITests/$c -parallel-testing-enabled NO || echo "FAILED $c"
done
```

Swift that changed on this branch beyond the Mac's own 10-23 tree, so compile errors (if any)
will be here: `Models.swift` (the offline fallback map), `CoreLogicTests.swift`
(`testFallbackMappingAvoidsCatchAllCategories`), `AdventurePlannerService.swift` and
`AdventurePlannerView.swift` (planner `notes`, the server's error sentence), `Legal.swift`,
`PaywallView.swift`, `ExploreView.swift` (a comment). `PartnerSurfaceTests.testLiveStaffWithdrawalDismissesOpenMapOffer`
runs through `functions/scripts/partner-detail-native.sh` (simulated GPS).

Done looks like: 0 build errors, 0 failures, 0 unexplained skips (the known conditional skips
are the ones that need a connected emulator or the website on port 3105 — with the emulators
up they run).

## 2. The three intermittent UI tests and the two intermittent unit tests

Run each class **three times in a row** with `-parallel-testing-enabled NO`:
`JourneyTests` (Curated Program), `LivePartnerConsentUITests`, `PartnerSurfaceTests`;
unit: `RewardsLiveCatalogTests`, `PartnerDiscoveryTests`. The Mac's `QAHelpers` rewrite
(reveal/settle/type, per-launch location, prompt answered, audit without retries) is the fix
on the branch; if any still fails, find the cause in the attached screenshot and fix it with a
test, no sleeps.

## 3. Screenshots and the demo path

With the emulators holding the exported data (`../emulator-data`, imported by
`run-all.command`), the demo account `demo-judge@example.test / local-demo-walkthrough` and the
For You accounts (`foryou-student-trails`, `foryou-community-sports`, password
`local-foryou-check`) exist. `DemoWalkthroughUITests` attaches ordered screenshots
(`NN-name`); export them to `demo-screens/`. Required by the handoff:
`demo-screens/foryou-<interest>.png` for each pick (sign in as a fresh account per pick, or use
`node functions/scripts/personalization-e2e.mjs` output as the oracle for what the top cards
should be), the planner with the Open-Meteo credit, Explore and the map with the OpenStreetMap
credit ("© OpenStreetMap contributors · ODbL · data as of …"), an event detail with reasons, a
park guide, Settings → Terms → "Data and acknowledgements".

Status bar 9:41: `xcrun simctl status_bar <udid> override --time 9:41` (run-all does it).

## 4. Final proof from scratch, then the tag

```bash
cd functions && npm run test:units && npm run e2e && npm run redteam && npm run acceptance && npm run e2e:discovery && cd ..
# plus the iOS suites from step 1 and a fresh-install walkthrough (DemoWalkthroughUITests.testJudgeWalkthrough)
git tag cac-final-3 && git push appc cac-final-3
```

Expected backend numbers (Windows, 2026-10-25): see `FINAL-REPORT.md` § 1.6. Anything different
is a regression to explain, not to ignore.

## 5. The new team repository (only when Rishit says so)

`docs/NEW-REPO-PUSH.md`: an orphan first commit of the current tree, `npm run check:secrets`
and `node functions/scripts/check-no-secrets.mjs --history` on the new history (must be clean),
then push. This clone's history still contains the burned keys; never push *this* history to
the new repository.

## Known gaps to carry into FINAL-REPORT.md if they stay

- Save The Bay's six volunteer events (wordpress-tec) carry no coordinates, so distance-based
  surfaces (map, "near you" counts) do not see them; the adapter would need venue geocoding.
- Most South Bay outdoor organisations publish no machine-readable calendar (115 hosts rejected
  with evidence in `docs/evidence/discovery-cycle-2026-10-25.md`); Santa Clara County Parks,
  the City of San José and SCU refuse automated access (403). A person has to ask them.
- `evols.org` (Environmental Volunteers) answered but its sitemap lists no event pages; it waits
  for the monthly re-inspection.
