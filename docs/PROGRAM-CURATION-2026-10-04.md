# D3 — staff-curated Programs, local evidence

Programs are official application listings, separate from volunteering and
attendance events. Staff can create, edit and deactivate them under `/admin`.
The app links to the organization; it offers no applications, resumes, employer
accounts, matching, RSVP, attendance check-in or Program points.

## Implementation and requirement mapping

- `functions/src/programs.ts`: required title, organization, public HTTPS
  official link, future deadline, minimum/maximum ages, published cost, format
  and local address. The existing geocoder supplies coordinates; a client cannot
  supply them. Virtual listings use the organization's local address for radius
  counting. Both age bounds are required, from 13 to 110. Zero cost means free.
- Save/list/deactivate require the canonical Firebase Auth admin claim on the
  server. The CLI remains the only grant path. Every staff read and mutation is
  audited; mutations record reason, actor, target, time, before and after in the
  same transaction. Editing cannot restore previously moderated content.
- `programListings` reads the account's canonical birth year and block list;
  missing, underage and otherwise ineligible ages fail closed. Supply is fully
  paged, then checked for location, visibility and deadline. More than 2,000
  current candidates yields an explicit error instead of a partial count.
- The native service retrieves this eligible supply independently of the normal
  80-event page, so the Program chip uses all current eligible listings in the
  selected radius. Ten unique listings are required. The existing browsing
  center is used when GPS is unavailable, consistently with ordinary filters.
  Account changes/sign-out immediately invalidate the prior account's eligibility.
- `program-feed.ts` applies canonical age/deadline/visibility policy after the
  existing ranking function, before issuing telemetry IDs. Ranking weights,
  signals and synonyms remain unchanged. Save/deactivate/expiry also invalidate
  the area feed cache. The frozen D1 classifier remains unchanged.
- Deadlines are checked on reads and native filter refreshes. A 15-minute
  scheduled job deactivates expired records with a system audit. Its transaction
  rereads the deadline so concurrent extensions cannot be expired incorrectly.
- Programs are excluded from outing planning, group plans, invitations, RSVP,
  check-in and park-week events: an application deadline is not an event at the
  venue. Organizer callables and direct client rules cannot create Programs.
- Saved Programs can appear in an eligible member's private offline pack with
  official URL, deadline, age bounds, cost and format. The pack retains the
  account's birth year for offline checks. Both the saved list and an open saved
  detail recheck deadline/age; expired or newly ineligible details are replaced
  by an unavailable explanation. Matching app/website privacy and App Privacy
  notes disclose the retained birth year in this feature change.
- Two composite index definitions were added: `events` source/deadline and
  category/active/deadline. Their presence in the file is not a production
  deployment claim; the full H1 inventory remains required.

## Verified locally

| Gate | Evidence |
| --- | --- |
| Fresh backend units | 424 passed, including 34 Program validation/eligibility checks |
| Broad isolated backend | 337 end-to-end checks passed; 49 attacks blocked, zero vulnerable |
| Actual Program callable/client rules | 42 passed: guest/non-admin/revoked-token refusal for all three admin paths, required fields, canonical age, 9/10 threshold, virtual/cost/radius, feed eligibility, expiry, moderation preservation, pagination, SDK create refusal, RSVP/invite refusal and audits |
| Actual offline pack regressions | 35 passed, including saved eligible/ineligible Programs and exclusion from park-week event lists |
| Actual staff browser | 8 passed: sign-in, required-field refusal, create/edit/deactivate, persisted values, actual audits and 390px layout |
| Native units | The fresh full unit run passed 123 tests; its separately selected Program UI initially failed on an offscreen test tap |
| Corrected native Program UI | 1 passed: actual sign-in, 50-mile radius, current-supply chip, real poster tap, official-listing control, no attendance controls, accessibility audit |
| Final offline adjustment | Fresh focused native run: 1 deadline/year-transition unit and 1 actual download/relaunch/stored-event/trail/storage UI journey passed |
| Website | Fresh production build, typecheck and lint passed; 18 legal/pricing/app parity and production-page checks passed |
| Freeze | `check-classifier-freeze.mjs` passed; no changes to `ranking.ts` or `CLAUDE.md` |

The failed native attempt is preserved in
`evidence/program-native-units-and-ui-attempt-2026-10-04.json`. Corrected UI and
offline summaries are separate JSON receipts; they do not relabel the failed
combined bundle as passing. Check labels are saved in
`evidence/program-local-checks-2026-10-04.json`. Staff/mobile and native/detail
screenshots were inspected and are committed alongside the receipts.

The earlier native blank-screen defect was a periodic timeline whose start
changed on every state update. A stable epoch start fixes that feedback loop.
The final UI selector targets an actual event poster, scrolls its center above
the persistent tab bar and then taps. An earlier offscreen tap selected Friends
instead; its failure was corrected, not recorded as a successful detail visit.

## Re-run

Use the existing local emulator setup (Auth 9099, Firestore 8899, Functions 5002,
Storage 9199), the same project and no production credentials. From repository
root:

```sh
npm --prefix functions run test:units
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/programs-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/offline-e2e.mjs
node functions/scripts/sprint-regressions.mjs
```

The broad runner owns separate disposable emulator ports; do not run its
fixed-name fixtures against the working corpus. Run Program callables before
seeding native Programs, since the callable test intentionally measures exactly
nine/ten teen-eligible listings.

For the staff browser, run the website locally on port 3104 using its documented
explicit staff-emulator configuration, then:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node Verdure-website--main/scripts/program-console-e2e.mjs
```

Seed the two native fixture scripts with both loopback environment variables:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/program-native-fixture.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/offline-native-fixture.mjs
xcodebuild -project Verdure/Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,id=D55D802A-6C43-4FD0-8E2F-65952BF28EB7' -only-testing:VerdureTests/CoreLogicTests/testProgramActualSDKEligibilityFullSupplyAccountChangeAndDeepLinks -only-testing:VerdureTests/CoreLogicTests/testProgramThresholdUsesUniqueCurrentInRadiusListingsAndFiltersDeadlines -only-testing:VerdureTests/CoreLogicTests/testSavedProgramRechecksDeadlineAndAgeAsTimeAdvancesOffline -only-testing:VerdureUITests/JourneyTests/testCuratedProgramActualSignInChipAndOfficialListingDetail -only-testing:VerdureUITests/JourneyTests/testOfflinePackSignInSizeDownloadRelaunchAndStoredTrailView test
```

Use an available simulator ID if this host changes. The real public local park
catalog is required for the offline journey. Afterwards run both fixture scripts
with `--clean`; this was done after the final passing checks. Fixtures are
fictional, account ages and Plus entitlement are emulator setup, and no real
business or Program was activated. None of this proves signup, purchases or a
real organization's application flow.

## Remaining full-sprint gates

D3 software is implemented and checked locally. Physical two-phone, outdoor
GPS/airplane mode and the final whole-sprint acceptance remain pending. D2 real
supply, F1/F2, A6, remaining partner-cache audit and H1/H2 remain in scope.
Nothing was deployed, no paid account was purchased, no ranking tuning changed,
and no optional feature was silently cut.
