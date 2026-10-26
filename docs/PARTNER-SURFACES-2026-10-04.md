# Location-based partner surfaces: local evidence

D1 remains frozen at `d4b7150`; `ranking.ts` is unchanged. A1–A5 are implemented.
The full sprint is still incomplete; the requirement ledger retains B–H and
the optional features. No deploy, billing, environment or key changes occurred.

## Behavior

- Organic For You and Everything query only events; partner cards use a separate
  payload. `events_feed`, `for_you`, `everything` and social surfaces are refused.
- Map partners use ink storefront pins with a gold border, a default-on per-account local toggle,
  offer details, estimated walking time and remembered server dismissal.
- Near you claims at most one card per app session, within 800 metres. Server
  time controls coffee/morning, food/mealtimes and activities/weekend rules.
  Both location endpoints enforce proximity; there is no distant fallback.
  Cached cards expire at the server's hour boundary or actual perk expiry.
  Authenticated known-document SDK listeners remove stale pins/cards on partner
  or perk revision/availability changes without movement or manual refresh. Only existing When-In-Use GPS is used.
- Rewards defaults to Nearby when actual GPS exists, preserves the original
  order without GPS, sorts unknown coordinates last, and preserves ties.
- Offer visibility requires an active partner, recorded agreement, valid price,
  future expiry and stock (sold-out offers remain visible in Rewards).
  Emulator fixtures name entirely fictional businesses and record fixture-only
  agreement references. Staff creation/CSV/deactivation tooling is implemented locally; see STAFF-CONSOLE-2026-10-04.md.
- RSVP alerts are queued atomically with Going, using the venue location.
  They become due one hour before start, or immediately for a late RSVP.
  A 15-minute worker rechecks attendance, availability, opt-in and quiet hours.
  Cancelled/past events cannot notify. The notification, sent ledger and shared
  weekly slot commit together, so concurrent workers/retries cannot duplicate
  the in-app alert. Push is attempted once through the existing notifier after
  commit; a crash at that boundary can miss delivery, rather than resend it.
- RSVP offers default off with a separate server-backed preference. No new
  background-location permission or collection was introduced. A6 is pending.

## Re-run

From the repository root, build Functions, then start a separate terminal:

```sh
cd functions && npm run build
# From the repository root, in the service terminal:
node functions/scripts/sprint-emulators.mjs
```

The helper derives a gitignored local configuration from `firebase.json`.
It uses port 5002 for Functions and does not stop an unrelated port-5001 service.
`--lan` is for later physical-device QA only. Set the DEBUG user default
`QAUseFirestoreEmulator=YES` and `QAEmulatorHost` to the Mac's LAN address for
that phase; all four Firebase services use the same host.

From `functions/`, while those services run:

```sh
npm run test:units
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/sprint-partners-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/rsvp-partners-e2e.mjs
```

Observed: seven backend unit suites, 286 passed / 0 failed; focused partner
endpoint/feed checks, 16 passed; RSVP job checks, 19 passed. The Everything
check uses the app's area/date/visibility filters, ordering and page limit.
The RSVP checks include concurrent workers, retry, cancel/re-RSVP, cap sharing,
quiet hours, separate opt-out, distant venues and event expiry.

Fresh iOS unit results: 107 passed / 0 failed on iPhone 16 Plus, iOS 18.4
Simulator. Includes an assertion that the unit host's Firestore is local,
plaintext and memory-cached; Auth/Functions/Storage are routed locally in the
same startup branch, with remote-push startup skipped. This corrects the first
D1 unit host's denied production analytics attempts.

```sh
cd Verdure
xcodegen generate
xcodebuild -quiet -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Plus' \
  -only-testing:VerdureTests \
  -only-testing:VerdureUITests/PartnerSurfaceTests \
  -only-testing:VerdureUITests/AccessibilityAuditTests/testAuditNotificationSettings test
```

Scoped simulator UI checks covered Rewards' Nearby fallback, notification settings and the map-layer toggle. The map audit passed with one narrowly recorded exception: MapKit's native Legal attribution link has a text-sized hit region. Full physical VoiceOver and the complete G script remain required. Live partner pin/card interaction on physical phones remains unverified. Push delivery, real purchases, universal links and cellular use against a local emulator remain explicitly untested.

The initial 100-perk limit and stationary map/card caching gaps were resolved
in the complete-catalog checkpoint below. H1's full source/index inventory is
now checked separately in FIRESTORE-INDEXES.md; emulator success does not prove
a live index exists.

## Complete catalog and stationary invalidation checkpoint

Active perks are paged by document ID in batches of 500; parent partners are
loaded in batches of 200. Map, near-you and Rewards no longer silently truncate
at 100 offers. A 501-partner corpus with the closest offer after the first 500
and a 502-fixture Rewards catalog passed the connected regression.

Staff partner/perk writes, code refill and last-code redemption update safe
`partnerStatus`/`perkStatus` metadata in the same transaction. Authenticated
clients may get a known metadata document; list and all client writes are
refused. Metadata exposes only visibility/availability, a public-field revision and perk
expiry, never contacts, agreement details or code values. The iOS service owns
and cancels SDK listeners/timers; account/session/request guards discard late
callbacks. Missing legacy metadata allows the canonical callable result, and
cached SDK metadata cannot invalidate a newer callable response.

`functions/scripts/partner-catalog-e2e.mjs`: 25 passed, including complete
catalog, real listeners, non-enumeration, deactivation, renamed businesses,
last-code stock and refill. `staff-partners-e2e.mjs`: 47 passed again.
The actual iOS service test observes perk/partner removal and timed expiry with
Firebase SDK callbacks, without manually refreshing the service.

```sh
# Requires the local sprint emulator already running after a fresh Functions build.
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/partner-catalog-e2e.mjs
```

The above checkpoint proves map/near-you cache invalidation. The later Rewards
checkpoint below extends that evidence. Physical partner-venue and distance QA
remains pending.

## Rewards cache checkpoint

The canonical Rewards payload now includes parent/perk revisions. The native
EconomyService listens to known metadata documents, removes withdrawn or
changed rows immediately, and coalesces a fresh canonical fetch. Revision
changes include partial stock decrements, so 2 → 1 codes updates a stationary
screen. Perk metadata uses `revisionVersion: 2`: persisted older-format hashes
are not compared with newly computed v2 hashes. A read-only emulator inspection
found one active source-backed status with a different hash format, and actual
native map/Rewards tests now install legacy metadata and verify that it cannot
trigger a repeated remove/refetch loop. Staff writes upgrade metadata atomically.
Perk metadata distinguishes `visible` from `available`: zero-stock
offers stay visible in Rewards, but withdrawing an already sold-out perk still
changes its revision and removes it. Metadata remains non-enumerable and
client-immutable; no contacts, agreements or code values are disclosed.

Expiry removes cached rows on a timer. Early-access opening rechecks canonical
eligibility. The catalog now correctly returns Plus members' early offers as
unlocked; the previous flag locked the UI even though server redemption allowed
the purchase. Actual free/Plus catalog checks cover both sides of that window.
SDK account changes clear catalog, codes, listeners and pending
requests; late responses cannot publish another account's data. Already issued
codes remain available after an offer is withdrawn, until account clearing.
Rewards drops a pending redemption confirmation when its exact offer snapshot
changes and checks the current snapshot again before sending a redemption.
An open map/card offer detail dismisses when its snapshot is withdrawn or
replaced. The fresh actual MapKit-pin/open-sheet journey now passes: a staff partner withdrawal removes the pin, Near you card and open detail without a gesture or manual refresh. Before/after screenshots were visually inspected. This uses a stream of CLI simulated location fixes, not physical GPS.

Downloaded packs continue to preserve immutable view-only snapshots offline,
with a visible warning that availability may have changed. Online, their perk
rows use the current canonical catalog for the downloaded IDs, so withdrawn
offers are not promoted from stale pack bytes. These changes do not enable any
offline redemption or check-in. The planner/event-detail sponsored callable has
no native cached consumer in the inspected app source.

Fresh backend units: 431 passed, plus 49 source/index guard cases and the
six-file classifier freeze. Connected catalog/rules/listener checks: 30 passed.
Fresh scoped native tests: 10 passed, zero failed/skipped, covering real staff
callables, stock/title/price/business edits, sold-out withdrawal, partner
withdrawal, historic codes, early-access opening, timed expiry and SDK sign-out.
They also rerun map/card removal/expiry and reward-price parsing/sort regression.

The first native preflight had eight passes and one map/card invalidation
timeout with an ambiguous shared assertion. Its result is retained; the stage
diagnostic now identifies perk withdrawal, partner withdrawal or clock expiry.
The fresh ten-test run passed, but the original timeout's exact cause has not
been established. Two candidate builds of the new test then failed Swift 6's
SDK `sending` ownership check; transferring a fresh JSON object fixed the test
helper without weakening compiler settings.

The offline-pack sign-in/download/relaunch/stored-trail/storage UI regression
passed. The first Rewards UI attempt failed before confirmation; the focused
rerun passed after waiting for the account balance and positioning the button
above the tab bar. A combined SDK/UI attempt passed all ten native checks but
could not find the redemption button after the SDK test had redeemed that same
offer. The UI test now creates a separate fictional offer rather than resetting
redemption history. These unsuccessful attempts are retained as separate
receipts, never counted as green combined runs.

The final standalone UI test passed with its own offer, including actual
withdrawal closing the open confirmation and removing the row without manual
refresh or a gesture, followed by a passing structural accessibility audit.
Before/after screenshots were inspected. Latest receipts are in
`docs/evidence/rewards-backend-units-2026-10-04.log`,
`rewards-catalog-e2e-2026-10-04.log`, `rewards-sdk-legacy-summary-2026-10-04.json`,
`partner-sdk-legacy-summary-2026-10-04.json` and `rewards-ui-summary-2026-10-04.json`.
The recorded combined-attempt JSON still honestly includes its failed UI test.
The Rewards and offline native fixture scripts were cleaned after verification;
immutable fictional staff audit history is retained locally.

```sh
# Local sprint emulators must already be running; no production endpoints.
npm --prefix functions run test:units
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/partner-catalog-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  node functions/scripts/rewards-native-fixture.mjs
cd Verdure
xcodegen generate
xcodebuild -quiet -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Plus' \
  -only-testing:VerdureTests/PartnerDiscoveryTests \
  -only-testing:VerdureTests/RewardCatalogParityTests \
  -only-testing:VerdureTests/RewardsLiveCatalogTests test
# Back at the repository root after testing:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  node functions/scripts/rewards-native-fixture.mjs --clean
```

Physical venue/GPS/two-phone gates, the full final regression and the other
unfinished sprint sections remain required. No deployment or optional cut.


### Open-detail UI receipt

Run `zsh functions/scripts/partner-detail-native.sh` with local Auth/Firestore/Functions
listening at 9099/8899/5002 and the named iOS simulator booted. Override
`VERDURE_QA_SIMULATOR` / `VERDURE_QA_RESULT` as needed. The wrapper freshly builds,
streams simulated location, clears that simulation and cleans only the known
fictional Rewards fixtures. The saved wrapper itself subsequently passed end to end on October 4, with a fresh build and one passing test (zero failures/skips). Receipt: `docs/evidence/native-map-final-2026-10-04.json`; result bundle: `/tmp/verdure-final-map-detail-20261004.xcresult`. It cleared simulated location and cleaned its reserved Rewards fixture on exit. Its final before/after screenshots were inspected and saved as `partner-detail-final-{before,after}-withdrawal-2026-10-04.png`.

The actual recorded source build passed one test at
`/tmp/verdure-partner-open-detail-stream-2026-10-04.xcresult`; summary and screenshots
are in `docs/evidence/partner-open-detail-summary-2026-10-04.json` and
`partner-detail-{before,after}-withdrawal-2026-10-04.png`. The refactored Rewards
helper also passed its named UI regression in the mixed two-test attempt.

Three failed attempts are retained: XCTest's AX scroll-to-visible failure on a
visible annotation; a repeated fixed-code fixture rejected as duplicate; and a
one-shot-location attempt which displayed the launch-area fallback with no pin.
The final test taps the measured on-screen annotation and generates a new
fictional code for each run. A live simulated location stream passed; stale
one-shot location is the likely reason for the fallback, not a proved physical
GPS defect. None of these results establishes outdoor/device behavior.

## Final recovery-source verification

The fresh recovery-source map withdrawal run passed 1/1 with zero failures/skips; before/after screenshots were inspected. Receipt: `docs/evidence/native-map-recovery-final-2026-10-04.json`. Images: `partner-detail-recovery-before-withdrawal-2026-10-04.png` and `partner-detail-recovery-after-withdrawal-2026-10-04.png`. Physical venue/GPS acceptance remains untested.
